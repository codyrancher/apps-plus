import jsyaml from 'js-yaml';
import { extractMetadataDependencies } from './config/types';
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

export interface HelmChartDetails {
  values: Record<string, unknown>;
  implicitDependencies: string[];
  annotations: Record<string, string>;
  files: Array<{ name: string; content: string }>;
}

async function fetchRemote(url: string, binary = false): Promise<any> {
  try {
    const res = await fetch(url);

    if (res.ok) {
      return binary ? await res.arrayBuffer() : await res.text();
    }
  } catch {}

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

  return payload?.data ?? payload?.text ?? '';
}

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

export async function fetchHelmRepoIndex(opts: { repoUrl?: string }): Promise<HelmChartEntry[]> {
  if (!opts.repoUrl) {
    throw new Error('Specify a Helm repository URL.');
  }

  const trimmed = opts.repoUrl.trim().replace(/\/+$/, '');
  const indexUrl = trimmed.endsWith('/index.yaml') ? trimmed : `${ trimmed }/index.yaml`;
  const yamlText = await fetchRemote(indexUrl, false);

  return parseHelmIndex(yamlText);
}

export function extractChartImplicitDependencies(versionEntry?: HelmChartVersion | null): string[] {
  if (!versionEntry) {
    return [];
  }

  const found = new Set<string>(extractMetadataDependencies(versionEntry));

  (versionEntry.dependencies || []).forEach((dep) => {
    if (dep?.name) {
      found.add(String(dep.name).trim());
    }
  });

  return [...found];
}

async function extractChartArchive(buffer: ArrayBuffer): Promise<{
  valuesYaml?: string;
  chartYaml?: string;
  files: Array<{ name: string; content: string }>;
}> {
  if (typeof DecompressionStream === 'undefined') {
    return { files: [] };
  }

  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buffer]).stream().pipeThrough(ds);
  const decompressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const decoder = new TextDecoder();
  const out: {
    valuesYaml?: string;
    chartYaml?: string;
    files: Array<{ name: string; content: string }>;
  } = { files: [] };

  let offset = 0;

  while (offset + 512 <= decompressed.length) {
    const header = decompressed.subarray(offset, offset + 512);

    if (header.every((b) => b === 0)) {
      break;
    }

    const nameRaw = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    const typeFlag = header[156];
    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (size > 0 && contentEnd <= decompressed.length && (typeFlag === 0 || typeFlag === 48)) {
      const parts = nameRaw.split('/').filter(Boolean);

      if (parts.length >= 2) {
        const relPath = parts.slice(1).join('/');
        const text = decoder.decode(decompressed.subarray(contentStart, contentEnd));

        if (parts.length === 2 && parts[1] === 'values.yaml') {
          out.valuesYaml = text;
        } else if (parts.length === 2 && parts[1] === 'Chart.yaml') {
          out.chartYaml = text;
        }

        out.files.push({ name: relPath, content: text });
      }
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return out;
}

export async function fetchHelmChartDetails(opts: {
  repoUrl?: string;
  chartName: string;
  versionEntry: HelmChartVersion;
}): Promise<HelmChartDetails> {
  const annotations: Record<string, string> = { ...(opts.versionEntry?.annotations || {}) };
  const implicitDeps = new Set<string>(extractChartImplicitDependencies(opts.versionEntry));
  let valuesObj: Record<string, any> = {};
  let files: Array<{ name: string; content: string }> = [];

  const base = (opts.repoUrl || '').trim().replace(/\/+$/, '').replace(/\/index\.yaml$/, '');
  const rawUrl = opts.versionEntry?.urls?.[0] || (base ? `${ base }/${ opts.chartName }-${ opts.versionEntry.version }.tgz` : '');

  if (rawUrl) {
    try {
      const archiveUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${ base }/${ rawUrl.replace(/^\/+/, '') }`;
      const buffer = await fetchRemote(archiveUrl, true);
      const extracted = await extractChartArchive(buffer);

      files = extracted.files || [];

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
    } catch {}
  }

  return {
    values:               flattenValues(valuesObj),
    implicitDependencies: [...implicitDeps],
    annotations,
    files,
  };
}

export async function fetchHelmVersionDetails(repoUrl: string, chartName: string, version: string): Promise<HelmChartDetails> {
  let versionEntry: HelmChartVersion = {
    version,
    urls: [`${ repoUrl.trim().replace(/\/+$/, '') }/${ chartName }-${ version }.tgz`],
  };

  try {
    const charts = await fetchHelmRepoIndex({ repoUrl });
    const chart = charts.find((c) => c.name === chartName);
    const matched = chart?.versions.find((v) => v.version === version);

    if (matched) {
      versionEntry = matched;
    }
  } catch {}

  return fetchHelmChartDetails({
    repoUrl,
    chartName,
    versionEntry,
  });
}
