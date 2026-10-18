<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import SortableTable from '@shell/components/SortableTable';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import BlockedDeleteModal from '../components/BlockedDeleteModal.vue';
import RelatedResourcesTable from '../components/RelatedResourcesTable.vue';
import ValuesSummaryTable from '../components/ValuesSummaryTable.vue';
import RenderedYamlFiles from '../components/RenderedYamlFiles.vue';
import {
  FLEET_BUNDLE, FLEET_BUNDLE_DEPLOYMENT, APP, APP_INSTANCE, PROVISIONING_CLUSTER, REGISTRATION_TOKEN,
  crdRelatedRows, appStorageRelatedRow, bundleRelatedRows, steveType
} from '../config/types';
import { undeclaredWarnings } from '../render';

export default {
  name: 'DetailAppInstance',

  components: {
    ResourceTabs,
    Tab,
    Banner,
    SortableTable,
    BlockedDeleteModal,
    RelatedResourcesTable,
    ValuesSummaryTable,
    RenderedYamlFiles,
  },

  props: {
    value: {
      type:     Object,
      required: true,
    },
  },

  data() {
    return { registrationToken: null };
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

    clusterFiles() {
      return [{
        name:    this.value.clusterName,
        content: this.value.renderedClusterTemplate,
      }];
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

    relatedRows() {
      const t = this.t.bind(this);
      const rows = [];
      const app = this.value.app;

      if (app) {
        rows.push(appStorageRelatedRow(app, t, 'app-source'));
      }

      rows.push(...crdRelatedRows(t));

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
            role:       t('appsPlus.related.dependencyInstanceRole', { app: dep }),
          });
        } else {
          rows.push({
            key:        `dep-app-${ dep }`,
            stateColor: depApp ? 'bg-warning' : 'bg-error',
            stateLabel: depApp ? t('appsPlus.dependencies.notInstalled') : t('appsPlus.dependencies.missing'),
            kind:       'App (Dependency)',
            name:       dep,
            namespace:  '—',
            to:         depApp?.detailLocation || null,
            role:       t('appsPlus.related.dependencyAppRole'),
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
          role:       t('appsPlus.related.dependentInstanceRole', { app: reqInst.appDisplay }),
        });
      });

      rows.push(...bundleRelatedRows(this.value, t));

      (this.value.bundleDeployments || []).forEach((bd) => {
        rows.push({
          key:        `bd-${ bd.metadata?.namespace }-${ bd.metadata?.name }`,
          stateColor: 'bg-success',
          stateLabel: 'Active',
          kind:       'Fleet BundleDeployment',
          name:       bd.metadata?.name,
          namespace:  bd.metadata?.namespace || '—',
          to:         null,
          role:       t('appsPlus.related.bundleDeploymentRole'),
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
          role:       t('appsPlus.related.deployedResourceRole', { cluster: deployed.clusterName }),
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
        <pre class="cluster-panel__cmd">{{ nodeCommand }}</pre>
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
        <RenderedYamlFiles :files="clusterFiles" />
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
        <ValuesSummaryTable
          :app="value.app"
          :rows="valueRows"
          :undeclared="undeclared"
          :show-overrides="true"
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
        <RenderedYamlFiles :files="resources" />
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
        <RelatedResourcesTable
          :rows="relatedRows"
          :hint="t('appsPlus.related.instanceHint')"
        />
      </Tab>
    </ResourceTabs>

    <BlockedDeleteModal />
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

  &__cmd {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    overflow-x: auto;
  }
}
</style>
