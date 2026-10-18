<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import SortableTable from '@shell/components/SortableTable';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { BadgeState } from '@components/BadgeState';
import BlockedDeleteModal from '../components/BlockedDeleteModal.vue';
import {
  FLEET_BUNDLE, FLEET_BUNDLE_DEPLOYMENT, APP, APP_INSTANCE, PROVISIONING_CLUSTER, REGISTRATION_TOKEN,
  RELATED_HEADERS, crdRelatedRows, steveType
} from '../config/types';
import { undeclaredWarnings } from '../render';

export default {
  name: 'DetailAppInstance',

  components: {
    ResourceTabs,
    Tab,
    Banner,
    SortableTable,
    BadgeState,
    BlockedDeleteModal,
  },

  props: {
    value: {
      type:     Object,
      required: true,
    },
  },

  data() {
    return {
      registrationToken:     null,
      blockedDeleteInstance: null,
    };
  },

  async fetch() {
    await Promise.all([
      this.$store.dispatch('management/findAll', { type: APP }),
      this.$store.dispatch('management/findAll', { type: APP_INSTANCE }).catch(() => []),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE }),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE_DEPLOYMENT }).catch(() => []),
      this.$store.dispatch('management/findAll', { type: PROVISIONING_CLUSTER }).catch(() => []),
    ]);

    const namespace = this.value.managementClusterNamespace;

    if (namespace) {
      const tokens = await this.$store
        .dispatch('management/findAll', { type: REGISTRATION_TOKEN })
        .catch(() => []);

      this.registrationToken = tokens
        .find((token) => token.metadata?.namespace === namespace) || null;
    }
  },

  mounted() {
    if (typeof window !== 'undefined') {
      window.addEventListener('appsplus:blocked-delete', this.onBlockedDelete);
    }
  },

  beforeUnmount() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('appsplus:blocked-delete', this.onBlockedDelete);
    }
  },

  computed: {
    apps() {
      return this.$store.getters['management/all'](APP) || [];
    },

    appsByName() {
      return Object.fromEntries(this.apps.map((app) => [app.metadata?.name, app]));
    },

    instances() {
      return this.$store.getters['management/all'](APP_INSTANCE) || [];
    },

    resources() {
      return this.value.renderedResources || [];
    },

    valueRows() {
      const app = this.value.app;
      const defaults = app?.spec?.values || {};
      const overrides = this.value.spec?.values || {};
      const names = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);

      return [...names].sort().map((name) => ({
        name,
        default:  defaults[name],
        override: overrides[name],
      }));
    },

    undeclared() {
      return undeclaredWarnings(this.value.app);
    },

    stateBannerColor() {
      const state = this.value.state;

      if (state === 'error') {
        return 'error';
      }

      return state === 'warning' ? 'warning' : 'info';
    },

    deployedHeaders() {
      return [
        {
          name: 'state', labelKey: 'appsPlus.deployed.state', value: 'stateLabel', width: 125, sort: ['ready', 'kind', 'name']
        },
        {
          name: 'kind', labelKey: 'appsPlus.deployed.kind', value: 'kind', sort: ['kind', 'name']
        },
        {
          name: 'name', labelKey: 'appsPlus.deployed.name', value: 'name', sort: ['name']
        },
        {
          name: 'namespace', labelKey: 'appsPlus.deployed.namespace', value: 'namespace', sort: ['namespace', 'name']
        },
        {
          name: 'cluster', labelKey: 'appsPlus.deployed.cluster', value: 'clusterName', sort: ['clusterName', 'name']
        },
      ];
    },

    deployedRows() {
      let clusters = [];

      try {
        clusters = this.$store.getters['management/all'](PROVISIONING_CLUSTER) || [];
      } catch {
        clusters = [];
      }

      const idByName = {};

      clusters.forEach((cluster) => {
        const id = cluster.status?.clusterName;

        if (id) {
          idByName[cluster.metadata?.name] = id;
        }
      });

      return this.value.deployedResources.map((row) => {
        const id = idByName[row.clusterName];
        const resource = steveType({ apiVersion: row.apiVersion, kind: row.kind });
        const to = !id ? null : row.namespace ? {
          name:   'c-cluster-product-resource-namespace-id',
          params: {
            cluster: id, product: 'explorer', resource, namespace: row.namespace, id: row.name
          },
        } : {
          name:   'c-cluster-product-resource-id',
          params: {
            cluster: id, product: 'explorer', resource, id: row.name
          },
        };

        return {
          ...row,
          to,
          stateLabel: row.ready ? this.t('appsPlus.deployed.ready') : this.t('appsPlus.deployed.notReady'),
          clusterTo:  id ? { name: 'c-cluster-explorer', params: { cluster: id } } : null,
        };
      });
    },

    relatedHeaders() {
      return RELATED_HEADERS;
    },

    relatedRows() {
      const rows = [];
      const app = this.value.app;

      if (app) {
        rows.push({
          key:        `app-source-${ app.metadata?.name }`,
          stateColor: 'bg-success',
          stateLabel: 'Stored',
          kind:       'App (Template Storage)',
          name:       app.nameDisplay,
          namespace:  '—',
          to:         app.detailLocation,
          role:       this.t('appsPlus.related.appStorageRole', {
            templates: (app.templates || []).length,
            values:    Object.keys(app.spec?.values || {}).length,
          }),
        });
      }

      rows.push(...crdRelatedRows(this.t));

      (app?.dependencies || []).forEach((dep) => {
        const depInst = this.instances.find((inst) => inst.spec?.app === dep && !inst.isTerminating);
        const depApp = this.appsByName[dep];

        if (depInst) {
          rows.push({
            key:        `dep-inst-${ depInst.metadata?.name }`,
            stateColor: depInst.state === 'active' ? 'bg-success' : 'bg-warning',
            stateLabel: depInst.stateDisplay || depInst.state,
            kind:       'AppInstance (Dependency)',
            name:       depInst.nameDisplay,
            namespace:  depInst.targetNamespace || '—',
            to:         depInst.detailLocation,
            role:       this.t('appsPlus.related.dependencyInstanceRole', { app: dep }),
          });
        } else {
          rows.push({
            key:        `dep-app-${ dep }`,
            stateColor: depApp ? 'bg-warning' : 'bg-error',
            stateLabel: depApp ? this.t('appsPlus.dependencies.notInstalled') : this.t('appsPlus.dependencies.missing'),
            kind:       'App (Dependency)',
            name:       dep,
            namespace:  '—',
            to:         depApp?.detailLocation || null,
            role:       this.t('appsPlus.related.dependencyAppRole'),
          });
        }
      });

      (this.value.dependentInstances || []).forEach((reqInst) => {
        rows.push({
          key:        `req-inst-${ reqInst.metadata?.name }`,
          stateColor: 'bg-info',
          stateLabel: 'Dependent',
          kind:       'AppInstance (Dependent)',
          name:       reqInst.nameDisplay,
          namespace:  reqInst.targetNamespace || '—',
          to:         reqInst.detailLocation,
          role:       this.t('appsPlus.related.dependentInstanceRole', { app: reqInst.appDisplay }),
        });
      });

      (this.value.bundles || []).forEach((bundle) => {
        rows.push({
          key:        `bundle-${ bundle.metadata?.namespace }-${ bundle.metadata?.name }`,
          stateColor: 'bg-success',
          stateLabel: `${ this.value.readyDisplay } Ready`,
          kind:       'Fleet Bundle',
          name:       bundle.metadata?.name,
          namespace:  bundle.metadata?.namespace || '—',
          to:         bundle.detailLocation,
          role:       this.t('appsPlus.related.bundleRole', { instance: this.value.nameDisplay }),
        });
      });

      (this.value.bundleDeployments || []).forEach((bd) => {
        rows.push({
          key:        `bd-${ bd.metadata?.namespace }-${ bd.metadata?.name }`,
          stateColor: 'bg-success',
          stateLabel: 'Active',
          kind:       'Fleet BundleDeployment',
          name:       bd.metadata?.name,
          namespace:  bd.metadata?.namespace || '—',
          to:         null,
          role:       this.t('appsPlus.related.bundleDeploymentRole'),
        });
      });

      this.deployedRows.forEach((deployed) => {
        rows.push({
          key:        `deployed-${ deployed.key }`,
          stateColor: deployed.ready ? 'bg-success' : 'bg-warning',
          stateLabel: deployed.stateLabel,
          kind:       deployed.kind,
          name:       deployed.name,
          namespace:  deployed.namespace || '—',
          to:         deployed.to,
          role:       this.t('appsPlus.related.deployedResourceRole', { cluster: deployed.clusterName }),
        });
      });

      return rows;
    },

    cluster() {
      return this.value.provisionedCluster;
    },

    nodeCommand() {
      return this.registrationToken?.status?.nodeCommand || null;
    },
  },

  methods: {
    onBlockedDelete(event) {
      const instance = event?.detail?.instance;

      if (instance) {
        this.blockedDeleteInstance = instance;
      }
    },
  },
};
</script>

<template>
  <div>
    <Banner
      v-if="value.dependentInstances && value.dependentInstances.length"
      color="warning"
      data-testid="dependency-instance-banner"
    >
      <div>
        {{ t('appsPlus.dependencies.cannotDeleteWarning', { name: value.nameDisplay, app: value.appDisplay }) }}
        <span class="ml-5">{{ t('appsPlus.dependencies.reliedOnByLabel') }}</span>
        <span
          v-for="(depInst, idx) in value.dependentInstances"
          :key="depInst.metadata.name"
          class="ml-5"
        >
          <router-link
            :to="depInst.detailLocation"
            data-testid="dependent-instance-link"
          >
            {{ depInst.nameDisplay }} ({{ depInst.appDisplay }})
          </router-link><span v-if="idx < value.dependentInstances.length - 1">,</span>
        </span>
      </div>
    </Banner>

    <Banner
      v-if="value.stateDescription"
      :color="stateBannerColor"
      :label="value.stateDescription"
    />

    <div
      v-if="value.provisionsCluster"
      class="cluster-panel mb-20"
    >
      <div class="cluster-panel__head">
        <h3>{{ t('appsPlus.instance.ownedCluster') }}</h3>
        <router-link
          v-if="cluster?.detailLocation"
          :to="cluster.detailLocation"
        >
          {{ value.clusterName }}
        </router-link>
        <span
          v-else
          class="text-muted"
        >{{ value.clusterName }}</span>
      </div>

      <Banner
        v-if="!value.clusterReady"
        color="warning"
        :label="t('appsPlus.instance.clusterNotReady')"
      />

      <template v-if="nodeCommand && value.needsNodesRegistered">
        <p class="text-muted">
          {{ t('appsPlus.instance.registrationHint') }}
        </p>
        <pre class="rendered__body">{{ nodeCommand }}</pre>
      </template>
    </div>

    <ResourceTabs
      :value="value"
      :need-events="false"
      :need-related="false"
    >
      <Tab
        v-if="value.provisionsCluster"
        name="cluster"
        :label="t('appsPlus.instance.clusterPreview')"
        :weight="11"
      >
        <div class="rendered">
          <div class="rendered__name">
            {{ value.clusterName }}
          </div>
          <pre class="rendered__body">{{ value.renderedClusterTemplate }}</pre>
        </div>
      </Tab>

      <Tab
        name="deployed"
        :label="t('appsPlus.instance.deployed')"
        :weight="10.7"
      >
        <SortableTable
          v-if="deployedRows.length"
          :rows="deployedRows"
          :headers="deployedHeaders"
          key-field="key"
          default-sort-by="kind"
          :table-actions="false"
          :row-actions="false"
          :paging="true"
        >
          <template #cell:state="{row}">
            <span :class="row.ready ? 'deployed__state--ready' : 'deployed__state--not'">
              {{ row.stateLabel }}
            </span>
            <div
              v-if="row.message"
              class="text-muted text-small"
            >
              {{ row.message }}
            </div>
          </template>

          <template #cell:name="{row}">
            <router-link
              v-if="row.to"
              :to="row.to"
            >
              {{ row.name }}
            </router-link>
            <span v-else>{{ row.name }}</span>
          </template>

          <template #cell:namespace="{row}">
            <span v-if="row.namespace">{{ row.namespace }}</span>
            <span
              v-else
              class="text-muted"
            >&mdash;</span>
          </template>

          <template #cell:cluster="{row}">
            <router-link
              v-if="row.clusterTo"
              :to="row.clusterTo"
            >
              {{ row.clusterName }}
            </router-link>
            <span v-else>{{ row.clusterName }}</span>
          </template>
        </SortableTable>
        <Banner
          v-else
          color="info"
          :label="t('appsPlus.deployed.none')"
        />
      </Tab>

      <Tab
        name="values"
        :label="t('appsPlus.instance.values')"
        :weight="10.5"
        :error="!!undeclared.length"
      >
        <Banner
          v-for="reference in undeclared"
          :key="reference.file"
          color="warning"
        >
          {{ t('appsPlus.values.undeclared', reference) }}
          <router-link
            v-if="value.app?.canCustomEdit"
            :to="value.app.editLocation"
          >
            {{ t('appsPlus.values.undeclaredDeclareEdit', { app: value.app.nameDisplay }) }}
          </router-link>
        </Banner>
        <table
          v-if="valueRows.length"
          class="values-table"
        >
          <thead>
            <tr>
              <th>{{ t('appsPlus.values.key') }}</th>
              <th>{{ t('appsPlus.values.default') }}</th>
              <th>{{ t('appsPlus.values.override') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in valueRows"
              :key="row.name"
            >
              <td>
                <code>{{ row.name }}</code>
              </td>
              <td>
                <span v-if="String(row.default ?? '').trim() !== ''">{{ row.default }}</span>
                <span
                  v-else
                  class="text-muted"
                >—</span>
              </td>
              <td>
                <span v-if="String(row.override ?? '').trim() !== ''">{{ row.override }}</span>
                <span
                  v-else
                  class="text-muted"
                >—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <Banner
          v-else-if="!undeclared.length"
          color="info"
          :label="t('appsPlus.values.none')"
        />
      </Tab>

      <Tab
        name="resources"
        :label="t('appsPlus.instance.preview')"
        :weight="10"
      >
        <Banner
          v-if="value.app?.isHelmChart"
          color="info"
          :label="t('appsPlus.helm.detailBanner', { chart: value.app.helmDisplay, repo: value.app.helmRepo || '—' })"
        />
        <div
          v-for="file in resources"
          :key="file.name"
          class="rendered"
        >
          <div class="rendered__name">
            {{ file.name }}
          </div>
          <pre class="rendered__body">{{ file.content }}</pre>
        </div>
        <Banner
          v-if="!resources.length && !value.app?.isHelmChart"
          color="warning"
          :label="t('appsPlus.app.noTemplates')"
        />
      </Tab>

      <Tab
        name="related"
        :label="t('appsPlus.related.tabLabel')"
        :weight="9"
      >
        <Banner
          color="info"
          :label="t('appsPlus.related.instanceHint')"
        />
        <SortableTable
          :rows="relatedRows"
          :headers="relatedHeaders"
          key-field="key"
          :table-actions="false"
          :row-actions="false"
          :search="false"
          data-testid="related-resources-table"
        >
          <template #cell:state="{row}">
            <BadgeState
              :color="row.stateColor"
              :label="row.stateLabel"
            />
          </template>
          <template #cell:name="{row}">
            <router-link
              v-if="row.to"
              :to="row.to"
            >
              {{ row.name }}
            </router-link>
            <span v-else>{{ row.name }}</span>
          </template>
        </SortableTable>
      </Tab>
    </ResourceTabs>

    <BlockedDeleteModal
      :instance="blockedDeleteInstance"
      @close="blockedDeleteInstance = null"
    />
  </div>
</template>

<style lang="scss" scoped>
.deployed__state--ready {
  color: var(--success);
}

.deployed__state--not {
  color: var(--warning);
}

.cluster-panel {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    display: flex;
    align-items: baseline;
    gap: 10px;

    h3 {
      margin: 0;
      font-size: 14px;
    }
  }
}

.rendered {
  margin-bottom: 16px;

  &__name {
    font-family: monospace;
    font-size: 12px;
    padding: 6px 10px;
    background: var(--nav-bg);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: var(--border-radius) var(--border-radius) 0 0;
  }

  &__body {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 0 0 var(--border-radius) var(--border-radius);
    overflow-x: auto;
  }
}

.values-table {
  border-collapse: collapse;
  min-width: 50%;

  th {
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    color: var(--muted);
    padding: 6px 24px 6px 0;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 8px 24px 8px 0;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
}
</style>
