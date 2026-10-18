import jsyaml from 'js-yaml';
import {
  DEPENDENCIES_ANNOTATION,
  DEPENDS_ON_ANNOTATION,
  DEPENDS_ON_LABEL_PREFIX,
  parseDependencyList,
} from './config/types';
import { flattenValues } from './render';
import { serviceUrl } from './service';

const PROXY_BASES = [
  serviceUrl('apps-plus'),
  serviceUrl('extension-studio'),
  '/k8s/clusters/local/api/v1/namespaces/extension-studio/services/http:apps-plus-api:80/proxy',
];

export interface HelmChartVersion {
  version: string;
  appVersion?: string;
  description?: string;
  urls?: string[];
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
  dependencies?: Array<{ name: string; version?: string; repository?: string }>;
}

export interface HelmChartEntry {
  name: string;
  description: string;
  versions: HelmChartVersion[];
}

/**
 * Fetch a remote URL as text or ArrayBuffer, trying direct browser fetch first
 * and falling back to the in-cluster apps-plus-api proxy when CORS blocks direct access.
 */
async function fetchRemote(url: string, binary = false): Promise<any> {
  try {
    const res = await fetch(url);

    if (res.ok) {
      return binary ? await res.arrayBuffer() : await res.text();
    }
  } catch {
    // Fall back to apps-plus-api proxy below.
  }

  let res: Response | null = null;

  for (const base of PROXY_BASES) {
    const proxyUrl = `${ base }/v1/helm/fetch?url=${ encodeURIComponent(url) }${ binary ? '&encoding=base64' : '' }`;
    const candidate = await fetch(proxyUrl, {
      headers:     { accept: 'application/json' },
      credentials: 'same-origin',
    }).catch(() => null);

    if (candidate?.ok) {
      res = candidate;
      break;
    }
  }

  if (!res || !res.ok) {
    throw new Error(`Could not fetch ${ url }`);
  }

  const payload = await res.json();

  if (binary && payload?.base64) {
    const raw = atob(payload.base64);
    const bytes = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }

    return bytes.buffer;
  }

  return payload?.data || '';
}

/**
 * Parse a Helm repository index (either already-parsed JSON from Rancher's ClusterRepo
 * `?link=index` endpoint or raw YAML text from `index.yaml`).
 */
export function parseHelmIndex(raw: any): HelmChartEntry[] {
  const index = typeof raw === 'string' ? (jsyaml.load(raw) as any) : raw;
  const entries = index?.entries || {};

  return Object.keys(entries)
    .map((name) => {
      const list = Array.isArray(entries[name]) ? entries[name] : [];
      const versions: HelmChartVersion[] = list.map((entry: any) => ({
        version:      String(entry.version || ''),
        appVersion:   entry.appVersion ? String(entry.appVersion) : '',
        description:  entry.description || '',
        urls:         Array.isArray(entry.urls) ? entry.urls : [],
        annotations:  entry.annotations || {},
        labels:       entry.labels || {},
        dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : [],
      }));

      return {
        name,
        description: versions[0]?.description || '',
        versions,
      };
    })
    .filter((entry) => entry.versions.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load all charts from either a Rancher ClusterRepo or a Helm repository URL.
 */
export async function fetchHelmRepoIndex(opts: { clusterRepo?: string; repoUrl?: string }): Promise<HelmChartEntry[]> {
  if (opts.clusterRepo) {
    try {
      const res = await fetch(`/v1/catalog.cattle.io.clusterrepos/${ encodeURIComponent(opts.clusterRepo) }?link=index`, {
        headers:     { accept: 'application/json' },
        credentials: 'same-origin',
      });

      if (res.ok) {
        const json = await res.json();

        return parseHelmIndex(json);
      }
    } catch {
      // Fall through to repoUrl if available.
    }
  }

  if (!opts.repoUrl) {
    throw new Error('Specify a Helm repository URL.');
  }

  const trimmed = opts.repoUrl.trim().replace(/\/+$/, '');
  const indexUrl = trimmed.endsWith('/index.yaml') ? trimmed : `${ trimmed }/index.yaml`;
  const yamlText = await fetchRemote(indexUrl, false);

  return parseHelmIndex(yamlText);
}

/**
 * Extract implicit dependency App names declared on a Helm chart version via:
 * - annotations['appsplus.io/dependencies'] or annotations['appsplus.io/depends-on']
 * - annotations or labels prefixed with 'depends-on.appsplus.io/'
 * - Chart.yaml `dependencies` entries
 */
export function extractChartImplicitDependencies(versionEntry?: HelmChartVersion | null): string[] {
  if (!versionEntry) {
    return [];
  }

  const found = new Set<string>();
  const annotations = versionEntry.annotations || {};
  const labels = versionEntry.labels || {};

  parseDependencyList(annotations[DEPENDENCIES_ANNOTATION]).forEach((d) => found.add(d));
  parseDependencyList(annotations[DEPENDS_ON_ANNOTATION]).forEach((d) => found.add(d));

  Object.entries(annotations).forEach(([key, val]) => {
    if (key.startsWith(DEPENDS_ON_LABEL_PREFIX) && val !== 'false' && val !== '0') {
      const dep = key.slice(DEPENDS_ON_LABEL_PREFIX.length).trim();

      if (dep) {
        found.add(dep);
      }
    }
  });

  Object.entries(labels).forEach(([key, val]) => {
    if (key.startsWith(DEPENDS_ON_LABEL_PREFIX) && val !== 'false' && val !== '0') {
      const dep = key.slice(DEPENDS_ON_LABEL_PREFIX.length).trim();

      if (dep) {
        found.add(dep);
      }
    }
  });

  (versionEntry.dependencies || []).forEach((dep) => {
    if (dep?.name) {
      found.add(String(dep.name).trim());
    }
  });

  return [...found];
}

/**
 * Extract files (`values.yaml`, `Chart.yaml`) from a `.tgz` Helm chart archive in the browser.
 */
async function extractChartArchive(buffer: ArrayBuffer): Promise<{ valuesYaml?: string; chartYaml?: string }> {
  if (typeof DecompressionStream === 'undefined') {
    return {};
  }

  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buffer]).stream().pipeThrough(ds);
  const decompressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const decoder = new TextDecoder();
  const out: { valuesYaml?: string; chartYaml?: string } = {};

  let offset = 0;

  while (offset + 512 <= decompressed.length) {
    const header = decompressed.subarray(offset, offset + 512);
    // Empty block marks end of archive
    if (header.every((b) => b === 0)) {
      break;
    }

    const nameRaw = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (size > 0 && contentEnd <= decompressed.length) {
      // Match top-level <chart>/values.yaml and <chart>/Chart.yaml (not subcharts)
      const parts = nameRaw.split('/').filter(Boolean);

      if (parts.length === 2 && parts[1] === 'values.yaml') {
        out.valuesYaml = decoder.decode(decompressed.subarray(contentStart, contentEnd));
      } else if (parts.length === 2 && parts[1] === 'Chart.yaml') {
        out.chartYaml = decoder.decode(decompressed.subarray(contentStart, contentEnd));
      }
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return out;
}

/**
 * Fetch default values and any additional metadata from a chart version.
 */
export async function fetchHelmChartDetails(opts: {
  clusterRepo?: string;
  repoUrl?: string;
  chartName: string;
  versionEntry: HelmChartVersion;
}): Promise<{ values: Record<string, unknown>; implicitDependencies: string[]; annotations: Record<string, string> }> {
  const annotations: Record<string, string> = { ...(opts.versionEntry?.annotations || {}) };
  const implicitDeps = new Set<string>(extractChartImplicitDependencies(opts.versionEntry));
  let valuesObj: Record<string, any> = {};

  if (opts.clusterRepo) {
    try {
      const url = `/v1/catalog.cattle.io.clusterrepos/${ encodeURIComponent(opts.clusterRepo) }?link=info&chartName=${ encodeURIComponent(opts.chartName) }&version=${ encodeURIComponent(opts.versionEntry.version) }`;
      const res = await fetch(url, {
        headers:     { accept: 'application/json' },
        credentials: 'same-origin',
      });

      if (res.ok) {
        const info = await res.json();

        if (info?.values && typeof info.values === 'object') {
          valuesObj = info.values;
        }
        const chartAnnotations = info?.chart?.annotations || {};

        Object.assign(annotations, chartAnnotations);
        extractChartImplicitDependencies({
          ...opts.versionEntry,
          annotations,
          dependencies: info?.chart?.dependencies || opts.versionEntry.dependencies,
        }).forEach((d) => implicitDeps.add(d));

        return {
          values:               flattenValues(valuesObj),
          implicitDependencies: [...implicitDeps],
          annotations,
        };
      }
    } catch {
      // Fall back to archive extraction below.
    }
  }

  const rawUrl = opts.versionEntry?.urls?.[0];

  if (rawUrl) {
    try {
      const base = (opts.repoUrl || '').trim().replace(/\/+$/, '').replace(/\/index\.yaml$/, '');
      const archiveUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${ base }/${ rawUrl.replace(/^\/+/, '') }`;
      const buffer = await fetchRemote(archiveUrl, true);
      const extracted = await extractChartArchive(buffer);

      if (extracted.valuesYaml) {
        const parsed = jsyaml.load(extracted.valuesYaml);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          valuesObj = parsed as Record<string, any>;
        }
      }

      if (extracted.chartYaml) {
        const parsedChart = jsyaml.load(extracted.chartYaml) as any;

        if (parsedChart && typeof parsedChart === 'object') {
          Object.assign(annotations, parsedChart.annotations || {});
          extractChartImplicitDependencies({
            ...opts.versionEntry,
            annotations,
            labels:       { ...(opts.versionEntry.labels || {}), ...(parsedChart.labels || {}) },
            dependencies: parsedChart.dependencies || opts.versionEntry.dependencies,
          }).forEach((d) => implicitDeps.add(d));
        }
      }
    } catch {
      // Values extraction from archive is best-effort; chart can still be imported with empty default values.
    }
  }

  return {
    values:               flattenValues(valuesObj),
    implicitDependencies: [...implicitDeps],
    annotations,
  };
}
