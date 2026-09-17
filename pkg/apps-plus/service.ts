// The backend this extension owns, and how it gets into a cluster.
//
// Apps Plus is otherwise entirely a browser bundle, and a browser bundle can only act while
// somebody is looking at it. That is fine for a UI, and wrong for the parts of this extension
// that have to exist whether or not a tab is open:
//
//   - the two CRDs (App and Installation). Rancher installs an extension chart as its `UIPlugin`
//     alone and discards everything else in it - CRDs included - so the CRDs cannot travel in
//     the chart. Without them the dashboard hides this product's nav entry, because it will not
//     draw a nav entry for a resource type whose schema is not on the cluster. So installing the
//     extension appears to do nothing.
//   - the service. An Installation deleted through this extension carries the
//     `appsplus.io/cleanup` finalizer, and something has to tear down what it deployed and take
//     that finalizer off or the object sits Terminating for ever. A closed tab must not leave a
//     permanent tombstone.
//
// So this bundle bootstraps its own backend on load, the same way `agents` and Extension Studio
// do: create-if-missing, from the browser, once. After that nobody has to be watching. The user
// only ever installs the UI extension; this is what turns that single install into a working one.
//
// Two environments, resolved at run time:
//   - a normal cluster (this is the general case): a dedicated `apps-plus` namespace, a
//     ServiceAccount with a *narrow* ClusterRole - the service only finishes deletes, so it only
//     needs to read Installations, patch their finalizers, and delete the Fleet Bundles they
//     made - and the service in that namespace.
//   - Extension Studio: its own namespace and cluster-admin ServiceAccount already exist and the
//     registry is read from there, so we keep using them and only add the CRDs. Detected by the
//     `extension-studio` namespace being present.
//
// The service source is generated into service.generated.ts from service/server.mjs, and the two
// CRDs into crds.generated.ts from service/crds/*.yaml; both are committed so normal builds never
// run those scripts. A `raw-loader!` import would tie this to one webpack config surviving in a
// build this repo does not own; the Studio bakes its own pod source in exactly this way.
import { SERVICE_SOURCE as SERVER_SOURCE } from './service.generated';
import { CRD_DEFINITIONS } from './crds.generated';

export const SERVICE_NAME = 'apps-plus-api';
export const SERVICE_PORT = 8090;

/** The general-case home for the backend, created if absent. */
const GENERAL_NAMESPACE = 'apps-plus';
/** Extension Studio's namespace and its cluster-admin ServiceAccount, reused when they exist. */
const STUDIO_NAMESPACE = 'extension-studio';
const STUDIO_ACCOUNT = 'extension-studio';

const BASE = '/k8s/clusters/local';

/**
 * The label the Studio's registry selects on, and the annotation both products stamp versions
 * with. Spelled here rather than imported: this extension does not depend on that one being
 * installed, and a registry entry that only appears when the Studio is loaded is a registry that
 * describes the reader instead of the cluster.
 */
const API_REGISTRY_LABEL = 'barn.rancher.io/api-registry';
const VERSION_ANNOTATION = 'barn.rancher.io/source-version';

/** Where the backend lands and who it runs as, decided once per load. */
interface Target {
  namespace:      string;
  serviceAccount: string;
  /** True when we own the ServiceAccount and its RBAC (the general case); false in the Studio. */
  manageRbac:     boolean;
}

/**
 * A fingerprint of the source, so a pod running a stale copy can be spotted.
 *
 * The same djb2-ish hash Extension Studio and `agents` use, for the same reason and so the three
 * are comparable at a glance. It is not a checksum anybody should trust against tampering; it
 * exists to answer "is this the source this bundle would write", which is a question about
 * staleness.
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

/** The Steve URL for one object; no namespace segment for cluster-scoped kinds. */
function objectUrl(type: string, namespace: string | undefined, name: string): string {
  return namespace ? `${ BASE }/v1/${ type }/${ namespace }/${ name }` : `${ BASE }/v1/${ type }/${ name }`;
}

/**
 * Create an object that is not there, and treat one that is as success.
 *
 * The right rule for anything whose value is that it exists - a namespace, a ServiceAccount, a
 * CRD, an RBAC binding: replacing them would either be a no-op or throw away something a user may
 * have adjusted. Two tabs opened at once both see nothing and both POST; one wins and the other
 * is told the object already exists, which is the outcome both wanted. Every failure is swallowed
 * by the caller: this runs on every load for every user, most of whom cannot write these objects
 * and none of whom asked to, so it must be silent when it cannot act.
 */
async function createIfAbsent(type: string, namespace: string | undefined, name: string, body: Record<string, unknown>): Promise<void> {
  const existing = await rancherFetch(objectUrl(type, namespace, name)).catch(() => null);

  if (existing) {
    return;
  }

  await rancherFetch(`${ BASE }/v1/${ type }`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
}

/**
 * Create what is missing, and replace what has fallen behind.
 *
 * For objects whose value is their *contents* - the service source in a ConfigMap, the version
 * the Deployment's pod template carries, the registry entry. "Fallen behind" is decided by the
 * fingerprint annotation rather than by comparing bodies: two objects that differ only in the
 * fields Kubernetes adds are not a difference anybody wants acted on, and a body comparison would
 * rewrite these on every page load for ever.
 */
async function ensureFresh(type: string, namespace: string, name: string, body: Record<string, unknown>): Promise<void> {
  const url = objectUrl(type, namespace, name);
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
    body:   JSON.stringify({ ...existing, metadata: { ...existing.metadata, annotations: { ...(existing.metadata?.annotations || {}), ...(body.metadata as any).annotations } }, ...body.data ? { data: body.data } : {}, ...body.spec ? { spec: body.spec } : {} }),
  }).catch(() => null);
}

// ---- object bodies ------------------------------------------------------------------------

function namespaceBody(ns: string): Record<string, unknown> {
  return { apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } };
}

function serviceAccountBody(t: Target): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind:       'ServiceAccount',
    metadata:   { namespace: t.namespace, name: t.serviceAccount, labels: { app: SERVICE_NAME } },
  };
}

/**
 * The narrow role the service needs: read Installations and patch their finalizers, and read and
 * delete the Fleet Bundles they deploy. Deliberately not cluster-admin - the service performs one
 * kind of janitorial work and should be able to do that and nothing else.
 */
function clusterRoleBody(): Record<string, unknown> {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind:       'ClusterRole',
    metadata:   { name: SERVICE_NAME, labels: { app: SERVICE_NAME } },
    rules:      [
      { apiGroups: ['appsplus.io'], resources: ['appinstances'], verbs: ['get', 'list', 'watch', 'patch'] },
      { apiGroups: ['appsplus.io'], resources: ['apps'], verbs: ['get', 'list', 'watch'] },
      { apiGroups: ['fleet.cattle.io'], resources: ['bundles'], verbs: ['get', 'list', 'watch', 'delete'] },
    ],
  };
}

function clusterRoleBindingBody(t: Target): Record<string, unknown> {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind:       'ClusterRoleBinding',
    metadata:   { name: SERVICE_NAME, labels: { app: SERVICE_NAME } },
    roleRef:    { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: SERVICE_NAME },
    subjects:   [{ kind: 'ServiceAccount', name: t.serviceAccount, namespace: t.namespace }],
  };
}

function configMapBody(t: Target): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind:       'ConfigMap',
    metadata:   {
      namespace:   t.namespace,
      name:        SERVICE_NAME,
      labels:      { app: SERVICE_NAME },
      annotations: { [VERSION_ANNOTATION]: serviceSourceVersion() },
    },
    data: { 'server.mjs': SERVER_SOURCE },
  };
}

function deploymentBody(t: Target): Record<string, unknown> {
  const version = serviceSourceVersion();

  return {
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   {
      namespace:   t.namespace,
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
          serviceAccountName: t.serviceAccount,
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

function serviceBody(t: Target): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind:       'Service',
    metadata:   { namespace: t.namespace, name: SERVICE_NAME, labels: { app: SERVICE_NAME } },
    spec:       {
      selector: { app: SERVICE_NAME },
      ports:    [{
        name: 'http', port: SERVICE_PORT, targetPort: SERVICE_PORT, protocol: 'TCP',
      }],
    },
  };
}

/** Where a caller reaches this service: a path on Rancher's own origin, through the apiserver proxy. */
export function serviceUrl(namespace: string): string {
  return `${ BASE }/api/v1/namespaces/${ namespace }/services/http:${ SERVICE_NAME }:${ SERVICE_PORT }/proxy`;
}

/**
 * This extension's entry in the Studio's API registry.
 *
 * The registry is a set of label-selected ConfigMaps, one writer each, and it vouches for
 * nothing - an entry is a claim by whoever wrote it. Writing ours directly rather than calling
 * into the Studio keeps this extension independent of that one being loaded. Harmless on a
 * cluster with no Studio: it is one labelled ConfigMap nobody reads.
 */
function registryBody(t: Target): Record<string, unknown> {
  const data = {
    extension: 'apps-plus',
    title:     'Apps Plus API',
    url:       serviceUrl(t.namespace),
    docs:      'openapi.json',
    version:   serviceSourceVersion(),
  };

  return {
    apiVersion: 'v1',
    kind:       'ConfigMap',
    metadata:   {
      namespace:   t.namespace,
      name:        'apps-plus-api-registry',
      labels:      { [API_REGISTRY_LABEL]: 'true' },
      annotations: { [VERSION_ANNOTATION]: contentVersion([JSON.stringify(data)]) },
    },
    data,
  };
}

/**
 * Where the backend goes, and who owns its RBAC.
 *
 * Extension Studio already has a cluster-admin ServiceAccount in its own namespace and reads the
 * registry from there, so when that namespace is present we keep using it and add only the CRDs.
 * Everywhere else this extension owns a dedicated namespace and a narrowly-scoped identity.
 */
async function resolveTarget(): Promise<Target> {
  const studio = await rancherFetch(objectUrl('namespaces', undefined, STUDIO_NAMESPACE)).catch(() => null);

  if (studio) {
    return { namespace: STUDIO_NAMESPACE, serviceAccount: STUDIO_ACCOUNT, manageRbac: false };
  }

  return { namespace: GENERAL_NAMESPACE, serviceAccount: SERVICE_NAME, manageRbac: true };
}

/**
 * Put the whole backend in the cluster: the CRDs the nav needs, then the service that finishes
 * deletes. Create-if-missing throughout, and every failure swallowed, so a user with no RBAC
 * gets a quiet no-op rather than an error toast on every page load - the admin who installs the
 * extension is the one whose load actually creates these.
 *
 * The CRDs first: they are the reason installing the extension appeared to do nothing, and they
 * cost nothing when they already exist. Then, in the general case, the namespace, the identity
 * and its role. Then the service - the ConfigMap before the Deployment that mounts it, or the pod
 * spends its first minute in ContainerCreating waiting for a volume that does not exist yet.
 */
export async function ensureService(): Promise<void> {
  for (const crd of CRD_DEFINITIONS) {
    await createIfAbsent('apiextensions.k8s.io.customresourcedefinitions', undefined, (crd as any).metadata.name, crd);
  }

  const target = await resolveTarget();

  if (target.manageRbac) {
    await createIfAbsent('namespaces', undefined, target.namespace, namespaceBody(target.namespace));
    await createIfAbsent('serviceaccounts', target.namespace, target.serviceAccount, serviceAccountBody(target));
    await createIfAbsent('rbac.authorization.k8s.io.clusterroles', undefined, SERVICE_NAME, clusterRoleBody());
    await createIfAbsent('rbac.authorization.k8s.io.clusterrolebindings', undefined, SERVICE_NAME, clusterRoleBindingBody(target));
  }

  await ensureFresh('configmaps', target.namespace, SERVICE_NAME, configMapBody(target));
  await ensureFresh('apps.deployments', target.namespace, SERVICE_NAME, deploymentBody(target));
  await ensureFresh('services', target.namespace, SERVICE_NAME, serviceBody(target));
  await ensureFresh('configmaps', target.namespace, 'apps-plus-api-registry', registryBody(target));
}
