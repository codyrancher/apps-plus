export const PRODUCT_NAME = 'fleet';
export const BLANK_CLUSTER = '_';

export const APP = 'appsplus.io.app';
export const APP_INSTANCE = 'appsplus.io.appinstance';
export const CRD = 'apiextensions.k8s.io.customresourcedefinition';

export function steveType(manifest: { apiVersion?: string; kind?: string }): string {
  const kind = (manifest?.kind || '').toLowerCase();
  const group = (manifest?.apiVersion || '').split('/')[0];

  return group && group !== 'v1' ? `${ group }.${ kind }` : kind;
}

export const FLEET_BUNDLE = 'fleet.cattle.io.bundle';
export const FLEET_CLUSTER = 'fleet.cattle.io.cluster';
export const FLEET_BUNDLE_DEPLOYMENT = 'fleet.cattle.io.bundledeployment';

export const BUNDLE_PREFIX = 'apps-plus-';
export const DEFAULT_WORKSPACE = 'fleet-local';

export const PROVISIONING_CLUSTER = 'provisioning.cattle.io.cluster';
export const PROVISION_WORKSPACE = 'fleet-default';

export const REGISTRATION_TOKEN = 'management.cattle.io.clusterregistrationtoken';
export const DEFAULT_TARGET_NAMESPACE = 'default';

export const LIST_ROUTE = 'c-cluster-product-resource';
export const CREATE_ROUTE = 'c-cluster-product-resource-create';
export const DETAIL_ROUTE = 'c-cluster-product-resource-id';

export const APP_QUERY = 'app';

export const DEPENDENCIES_ANNOTATION = 'appsplus.io/dependencies';
export const DEPENDS_ON_ANNOTATION = 'appsplus.io/depends-on';
export const DEPENDS_ON_LABEL_PREFIX = 'depends-on.appsplus.io/';

export function parseDependencyList(raw?: string | null): string[] {
  if (!raw || typeof raw !== 'string') {
    return [];
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return parsed.map((d) => String(d || '').trim()).filter(Boolean);
      }
    } catch {}
  }

  return trimmed
    .split(/[,;\s]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

export function extractMetadataDependencies(metadata?: {
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
  name?: string;
} | null): string[] {
  if (!metadata) {
    return [];
  }

  const found = new Set<string>();
  const annotations = metadata.annotations || {};
  const labels = metadata.labels || {};

  [
    annotations[DEPENDENCIES_ANNOTATION],
    annotations[DEPENDS_ON_ANNOTATION],
    labels[DEPENDENCIES_ANNOTATION],
    labels[DEPENDS_ON_ANNOTATION],
  ].forEach((val) => {
    parseDependencyList(val).forEach((d) => found.add(d));
  });

  Object.entries({ ...labels, ...annotations }).forEach(([key, val]) => {
    if (key.startsWith(DEPENDS_ON_LABEL_PREFIX) && val !== 'false' && val !== '0') {
      const dep = key.slice(DEPENDS_ON_LABEL_PREFIX.length).trim();

      if (dep) {
        found.add(dep);
      }
    }
  });

  if (metadata.name) {
    found.delete(metadata.name);
  }

  return [...found];
}

export const RELATED_HEADERS = [
  {
    name:     'state',
    labelKey: 'appsPlus.related.state',
    value:    'stateLabel',
    width:    120,
  },
  {
    name:     'kind',
    labelKey: 'appsPlus.related.kind',
    value:    'kind',
    width:    210,
  },
  {
    name:     'name',
    labelKey: 'appsPlus.related.name',
    value:    'name',
  },
  {
    name:     'namespace',
    labelKey: 'appsPlus.related.namespace',
    value:    'namespace',
    width:    150,
  },
  {
    name:     'role',
    labelKey: 'appsPlus.related.role',
    value:    'role',
  },
];

export function crdRelatedRows(t: (key: string) => string) {
  const crdLink = (crdName: string) => ({
    name:   DETAIL_ROUTE,
    params: {
      cluster:  'local',
      product:  'explorer',
      resource: CRD,
      id:       crdName,
    },
  });

  return [
    {
      key:        'crd-apps',
      stateColor: 'bg-success',
      stateLabel: 'Active',
      kind:       'CustomResourceDefinition',
      name:       'apps.appsplus.io',
      namespace:  '—',
      to:         crdLink('apps.appsplus.io'),
      role:       t('appsPlus.related.crdAppsRole'),
    },
    {
      key:        'crd-appinstances',
      stateColor: 'bg-success',
      stateLabel: 'Active',
      kind:       'CustomResourceDefinition',
      name:       'appinstances.appsplus.io',
      namespace:  '—',
      to:         crdLink('appinstances.appsplus.io'),
      role:       t('appsPlus.related.crdAppInstancesRole'),
    },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function appStorageRelatedRow(app: any, t: (key: string, args?: any) => string, keyPrefix = 'app-storage') {
  return {
    key:        `${ keyPrefix }-${ app.metadata?.name }`,
    stateColor: 'bg-success',
    stateLabel: 'Stored',
    kind:       'App (Template Storage)',
    name:       app.nameDisplay,
    namespace:  '—',
    to:         app.detailLocation,
    role:       t('appsPlus.related.appStorageRole', {
      templates: (app.templates || []).length,
      values:    Object.keys(app.spec?.values || {}).length,
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bundleRelatedRows(instance: any, t: (key: string, args?: any) => string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (instance?.bundles || []).map((bundle: any) => ({
    key:        `bundle-${ bundle.metadata?.namespace }-${ bundle.metadata?.name }`,
    stateColor: 'bg-success',
    stateLabel: `${ instance.readyDisplay } Ready`,
    kind:       'Fleet Bundle',
    name:       bundle.metadata?.name,
    namespace:  bundle.metadata?.namespace || '—',
    to:         bundle.detailLocation,
    role:       t('appsPlus.related.bundleRole', { instance: instance.nameDisplay }),
  }));
}
