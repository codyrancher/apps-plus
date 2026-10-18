import { SERVICE_SOURCE as SERVER_SOURCE } from './service.generated';
import { CRD_DEFINITIONS } from './crds.generated';

export const SERVICE_NAME = 'apps-plus-api';
export const SERVICE_PORT = 8090;

const GENERAL_NAMESPACE = 'apps-plus';
const STUDIO_NAMESPACE = 'extension-studio';
const STUDIO_ACCOUNT = 'extension-studio';

const BASE = '/k8s/clusters/local';

const API_REGISTRY_LABEL = 'barn.rancher.io/api-registry';
const VERSION_ANNOTATION = 'barn.rancher.io/source-version';

interface Target {
  namespace:      string;
  serviceAccount: string;
  manageRbac:     boolean;
}

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

function objectUrl(type: string, namespace: string | undefined, name: string): string {
  return namespace ? `${ BASE }/v1/${ type }/${ namespace }/${ name }` : `${ BASE }/v1/${ type }/${ name }`;
}

async function createIfAbsent(type: string, namespace: string | undefined, name: string, body: Record<string, unknown>): Promise<void> {
  const existing = await rancherFetch(objectUrl(type, namespace, name)).catch(() => null);

  if (existing) {
    return;
  }

  await rancherFetch(`${ BASE }/v1/${ type }`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
}

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
    body:   JSON.stringify({
      ...existing,
      metadata: {
        ...existing.metadata,
        annotations: { ...(existing.metadata?.annotations || {}), ...(body.metadata as any).annotations },
      },
      ...body.data ? { data: body.data } : {},
      ...body.spec ? { spec: body.spec } : {},
    }),
  }).catch(() => null);
}

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
          labels:      { app: SERVICE_NAME },
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

export function serviceUrl(namespace: string): string {
  return `${ BASE }/api/v1/namespaces/${ namespace }/services/http:${ SERVICE_NAME }:${ SERVICE_PORT }/proxy`;
}

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

async function resolveTarget(): Promise<Target> {
  const studio = await rancherFetch(objectUrl('namespaces', undefined, STUDIO_NAMESPACE)).catch(() => null);

  if (studio) {
    return { namespace: STUDIO_NAMESPACE, serviceAccount: STUDIO_ACCOUNT, manageRbac: false };
  }

  return { namespace: GENERAL_NAMESPACE, serviceAccount: SERVICE_NAME, manageRbac: true };
}

export async function ensureService(): Promise<void> {
  for (const crd of CRD_DEFINITIONS) {
    const name = (crd as any).metadata.name;
    const url = objectUrl('apiextensions.k8s.io.customresourcedefinitions', undefined, name);
    const existing = await rancherFetch(url).catch(() => null);

    if (!existing) {
      await rancherFetch(`${ BASE }/v1/apiextensions.k8s.io.customresourcedefinitions`, {
        method: 'POST',
        body:   JSON.stringify(crd),
      }).catch(() => null);
    } else if (JSON.stringify(existing.spec?.versions) !== JSON.stringify((crd as any).spec?.versions)) {
      await rancherFetch(url, {
        method: 'PUT',
        body:   JSON.stringify({ ...existing, spec: (crd as any).spec }),
      }).catch(() => null);
    }
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
