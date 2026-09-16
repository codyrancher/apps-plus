// The service this extension owns, and how it gets into a cluster.
//
// Apps Plus is otherwise entirely a browser bundle, and a browser bundle can only act while
// somebody is looking at it. That is fine for a UI and wrong for the one thing this extension
// *owes* the objects it creates: an Installation deleted through this extension carries the
// `appsplus.io/cleanup` finalizer, and something has to tear down what it deployed and take that
// finalizer off again or the object sits Terminating for ever. Until this service existed, the
// only thing that could was a loop inside the browser's own delete - so a closed tab left a
// permanent tombstone in every list that reads Installations.
//
// So: a Deployment, a Service, and the source in a ConfigMap, created from here and then running
// on its own. Modelled on Extension Studio's own service, down to the fingerprint annotation and
// the `/healthz` that reports it, because that product answered these questions first and a
// second convention would be worse than an imperfect shared one.
//
// The bootstrap still needs a browser once - something has to create the Deployment, and this
// bundle is the only thing that knows what it should contain. After that, nobody has to be
// watching. That is the same bargain the Studio's service lives under.
// Generated from service/server.mjs by scripts/gen-service.mjs, and committed. A `raw-loader!`
// import would have done the same job by tying this to one webpack config surviving in a build
// this repo does not own; the Studio bakes its own pod source in exactly this way.
import { SERVICE_SOURCE as SERVER_SOURCE } from './service.generated';

/** Where this extension's service lives. The Studio's namespace, because that is where the registry is read. */
export const SERVICE_NAMESPACE = 'extension-studio';
export const SERVICE_NAME = 'apps-plus-api';
export const SERVICE_PORT = 8090;
export const SERVICE_ACCOUNT = 'extension-studio';

const BASE = '/k8s/clusters/local';

/**
 * The label the Studio's registry selects on, and the annotation both products stamp versions
 * with. Spelled here rather than imported: this extension does not depend on that one being
 * installed, and a registry entry that only appears when the Studio is loaded is a registry that
 * describes the reader instead of the cluster.
 */
const API_REGISTRY_LABEL = 'barn.rancher.io/api-registry';
const VERSION_ANNOTATION = 'barn.rancher.io/source-version';

/**
 * A fingerprint of the source, so a pod running a stale copy can be spotted.
 *
 * The same djb2-ish hash Extension Studio uses, for the same reason and so the two are
 * comparable at a glance. It is not a checksum anybody should trust against tampering; it exists
 * to answer "is this the source this bundle would write", which is a question about staleness.
 */
function contentVersion(parts: string[]): string {
  let hash = 5381;

  for (const text of parts) {
    for (let i = 0; i < text.length; i++) {
      hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    }
  }

  return hash.toString(16).padStart(8, '0');
}

export function serviceSourceVersion(): string {
  return contentVersion([SERVER_SOURCE]);
}

function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)CSRF=([^;]*)/);

  return { 'X-Api-Csrf': match ? decodeURIComponent(match[1]) : 'CSRF' };
}

/** Same-origin request to Rancher, with the CSRF header on anything that writes. */
async function rancherFetch(path: string, init?: RequestInit): Promise<any> {
  const write = !!init?.method && init.method !== 'GET';
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      ...(write ? csrfHeader() : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const error: any = new Error(data.message || data.error || `HTTP ${ resp.status }`);

    error.status = resp.status;
    throw error;
  }

  return data;
}

function configMapBody(): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind:       'ConfigMap',
    metadata:   {
      namespace:   SERVICE_NAMESPACE,
      name:        SERVICE_NAME,
      labels:      { app: SERVICE_NAME },
      annotations: { [VERSION_ANNOTATION]: serviceSourceVersion() },
    },
    data: { 'server.mjs': SERVER_SOURCE },
  };
}

function deploymentBody(): Record<string, unknown> {
  const version = serviceSourceVersion();

  return {
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   {
      namespace:   SERVICE_NAMESPACE,
      name:        SERVICE_NAME,
      labels:      { app: SERVICE_NAME },
      annotations: { [VERSION_ANNOTATION]: version },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: SERVICE_NAME } },
      template: {
        metadata: {
          labels: { app: SERVICE_NAME },
          // On the template as well as on the Deployment, and this is the one that matters:
          // node imported its modules at start and will not re-read a ConfigMap that changes
          // underneath it. Changing an annotation here is what replaces the pod, and replacing
          // the pod is what makes new source actually run.
          annotations: { [VERSION_ANNOTATION]: version },
        },
        spec: {
          serviceAccountName: SERVICE_ACCOUNT,
          containers:         [{
            name:    'api',
            image:   'node:24',
            command: ['node', '/seed/server.mjs'],
            ports:   [{ name: 'http', containerPort: SERVICE_PORT }],
            env:     [
              { name: 'PORT', value: `${ SERVICE_PORT }` },
              { name: 'API_SOURCE_VERSION', value: version },
            ],
            volumeMounts: [{ name: 'seed', mountPath: '/seed' }],
          }],
          volumes: [{ name: 'seed', configMap: { name: SERVICE_NAME } }],
        },
      },
    },
  };
}

function serviceBody(): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind:       'Service',
    metadata:   { namespace: SERVICE_NAMESPACE, name: SERVICE_NAME, labels: { app: SERVICE_NAME } },
    spec:       {
      selector: { app: SERVICE_NAME },
      ports:    [{
        name: 'http', port: SERVICE_PORT, targetPort: SERVICE_PORT, protocol: 'TCP',
      }],
    },
  };
}

/** Where a caller reaches this service: a path on Rancher's own origin, through the apiserver proxy. */
export function serviceUrl(): string {
  return `${ BASE }/api/v1/namespaces/${ SERVICE_NAMESPACE }/services/http:${ SERVICE_NAME }:${ SERVICE_PORT }/proxy`;
}

/**
 * This extension's entry in the Studio's API registry.
 *
 * The registry is a set of label-selected ConfigMaps, one writer each, and it vouches for
 * nothing - an entry is a claim by whoever wrote it. Writing ours directly rather than calling
 * into the Studio keeps this extension independent of that one being loaded, which is the whole
 * point of a registry read from Kubernetes rather than from a service.
 *
 * `version` is the service source fingerprint rather than the package version, because the field
 * exists for the mismatch case and this is the value that can be checked: `/healthz` reports the
 * same string.
 */
function registryBody(): Record<string, unknown> {
  const data = {
    extension: 'apps-plus',
    title:     'Apps Plus API',
    url:       serviceUrl(),
    docs:      'openapi.json',
    version:   serviceSourceVersion(),
  };

  return {
    apiVersion: 'v1',
    kind:       'ConfigMap',
    metadata:   {
      namespace:   SERVICE_NAMESPACE,
      name:        'apps-plus-api-registry',
      labels:      { [API_REGISTRY_LABEL]: 'true' },
      annotations: { [VERSION_ANNOTATION]: contentVersion([JSON.stringify(data)]) },
    },
    data,
  };
}

/**
 * Create what is missing, and replace what has fallen behind.
 *
 * "Fallen behind" is decided by the fingerprint annotation rather than by comparing bodies: two
 * objects that differ only in the fields Kubernetes adds are not a difference anybody wants
 * acted on, and a body comparison would rewrite these on every page load for ever.
 *
 * Every failure is swallowed. This runs on every load for every user, most of whom cannot write
 * to that namespace and none of whom asked for it - so it must be silent when it cannot act. The
 * cost of that is a service that quietly does not exist for somebody with no RBAC; the cost of
 * the alternative is an error toast on every page load for everyone who is not an admin.
 */
async function ensure(type: string, name: string, body: Record<string, unknown>): Promise<void> {
  const url = `${ BASE }/v1/${ type }/${ SERVICE_NAMESPACE }/${ name }`;
  const existing = await rancherFetch(url).catch(() => null);

  if (!existing) {
    await rancherFetch(`${ BASE }/v1/${ type }`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);

    return;
  }

  const want = (body.metadata as any)?.annotations?.[VERSION_ANNOTATION];
  const have = existing.metadata?.annotations?.[VERSION_ANNOTATION];

  if (!want || want === have) {
    return;
  }

  await rancherFetch(url, {
    method: 'PUT',
    body:   JSON.stringify({ ...existing, metadata: { ...existing.metadata, annotations: { ...(existing.metadata?.annotations || {}), ...(body.metadata as any).annotations }, ...(body.metadata as any).labels ? { labels: { ...(existing.metadata?.labels || {}), ...(body.metadata as any).labels } } : {} }, ...body.data ? { data: body.data } : {}, ...body.spec ? { spec: body.spec } : {} }),
  }).catch(() => null);
}

/**
 * Put the service in the cluster and say so in the registry.
 *
 * The ConfigMap first, because the Deployment mounts it: created the other way round, the pod
 * spends its first minute in ContainerCreating waiting for a volume that does not exist yet.
 */
export async function ensureService(): Promise<void> {
  await ensure('configmaps', SERVICE_NAME, configMapBody());
  await ensure('apps.deployments', SERVICE_NAME, deploymentBody());
  await ensure('services', SERVICE_NAME, serviceBody());
  await ensure('configmaps', 'apps-plus-api-registry', registryBody());
}
