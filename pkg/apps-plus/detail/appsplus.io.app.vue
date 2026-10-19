<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import RelatedResourcesTable from '../components/RelatedResourcesTable.vue';
import ValuesSummaryTable from '../components/ValuesSummaryTable.vue';
import RenderedYamlFiles from '../components/RenderedYamlFiles.vue';
import {
  APP, APP_INSTANCE, FLEET_BUNDLE,
  crdRelatedRows, appStorageRelatedRow, bundleRelatedRows
} from '../config/types';
import { undeclaredWarnings } from '../render';

export default {
  name: 'DetailApp',

  components: {
    ResourceTabs,
    Tab,
    Banner,
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

  async fetch() {
    await Promise.all([
      this.$store.dispatch('management/findAll', { type: APP }),
      this.$store.dispatch('management/findAll', { type: APP_INSTANCE }),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE }).catch(() => []),
    ]);
  },

  computed: {
    apps() {
      return this.$store.getters['management/all'](APP) || [];
    },

    appsByName() {
      return Object.fromEntries(this.apps.map((app) => [app.metadata?.name, app]));
    },

    templates() {
      return this.value.templates || [];
    },

    instances() {
      return this.value.instances || [];
    },

    dependencies() {
      return this.value.dependencies || [];
    },

    missingDependencies() {
      return new Set(this.value.missingDependencies || []);
    },

    valueRows() {
      const values = this.value.spec?.values || {};

      return Object.keys(values).sort().map((name) => ({
        name,
        default: values[name],
      }));
    },

    undeclared() {
      return undeclaredWarnings(this.value);
    },

    relatedRows() {
      const t = this.t.bind(this);
      const rows = [
        ...crdRelatedRows(t),
        appStorageRelatedRow(this.value, t),
      ];

      this.dependencies.forEach((dep) => {
        const depApp = this.appsByName[dep];
        const missing = !depApp;

        rows.push({
          key:        `dep-app-${ dep }`,
          stateColor: missing ? 'bg-error' : 'bg-success',
          stateLabel: missing ? t('appsPlus.dependencies.missing') : 'Active',
          kind:       'App (Dependency)',
          name:       dep,
          namespace:  '—',
          to:         depApp?.detailLocation || null,
          role:       t('appsPlus.related.dependencyAppRole'),
        });
      });

      this.apps.forEach((other) => {
        if (other.metadata?.name !== this.value.metadata?.name && (other.dependencies || []).includes(this.value.metadata?.name)) {
          rows.push({
            key:        `dependent-app-${ other.metadata?.name }`,
            stateColor: 'bg-info',
            stateLabel: 'Dependent',
            kind:       'App (Dependent)',
            name:       other.nameDisplay,
            namespace:  '—',
            to:         other.detailLocation,
            role:       t('appsPlus.related.dependentAppRole', { app: this.value.nameDisplay }),
          });
        }
      });

      this.instances.forEach((inst) => {
        rows.push(
          {
            key:        `inst-${ inst.metadata?.name }`,
            stateColor: inst.state === 'active' ? 'bg-success' : 'bg-warning',
            stateLabel: inst.stateDisplay || inst.state,
            kind:       'AppInstance',
            name:       inst.nameDisplay,
            namespace:  inst.targetNamespace || '—',
            to:         inst.detailLocation,
            role:       t('appsPlus.related.instanceRole', { targets: inst.targetDisplay }),
          },
          ...bundleRelatedRows(inst, t),
        );
      });

      return rows;
    },
  },
};
</script>

<template>
  <div>
    <ResourceTabs
      :value="value"
      :need-events="false"
      :need-related="false"
    >
      <Tab
        name="templates"
        :label="t('appsPlus.app.templates')"
        :weight="10"
      >
        <Banner
          v-if="value.isHelmChart"
          color="info"
          :label="t('appsPlus.helm.detailBanner', { chart: value.helmDisplay, repo: value.helmRepo || '—' })"
        />
        <RenderedYamlFiles :files="templates" />
        <Banner
          v-if="!templates.length && !value.isHelmChart"
          color="warning"
          :label="t('appsPlus.app.noTemplates')"
        />
      </Tab>

      <Tab
        name="values"
        :label="t('appsPlus.app.values')"
        :weight="9.5"
        :error="!!undeclared.length"
      >
        <ValuesSummaryTable
          :app="value"
          :rows="valueRows"
          :undeclared="undeclared"
        />
      </Tab>

      <Tab
        name="dependencies"
        :label="t('appsPlus.app.dependencies')"
        :weight="9.2"
        :error="missingDependencies.size > 0"
      >
        <ul
          v-if="dependencies.length"
          class="instance-list"
        >
          <li
            v-for="dep in dependencies"
            :key="dep"
          >
            <router-link
              v-if="appsByName[dep]?.detailLocation"
              :to="appsByName[dep].detailLocation"
            >
              <code>{{ dep }}</code>
            </router-link>
            <code v-else>{{ dep }}</code>
            <span class="ml-10 text-muted">
              {{ missingDependencies.has(dep) ? t('appsPlus.dependencies.notFound') : t('appsPlus.dependencies.exists') }}
            </span>
          </li>
        </ul>
        <Banner
          v-else
          color="info"
          :label="t('appsPlus.dependencies.empty')"
        />
      </Tab>

      <Tab
        name="instances"
        :label="t('appsPlus.headers.instances')"
        :weight="9"
      >
        <ul class="instance-list">
          <li
            v-for="instance in instances"
            :key="instance.id"
          >
            <router-link :to="instance.detailLocation">
              {{ instance.nameDisplay }}
            </router-link>
            <span class="text-muted ml-10">{{ instance.targetDisplay }}</span>
          </li>
        </ul>
        <Banner
          v-if="!instances.length"
          color="info"
          :label="t('appsPlus.list.noInstances')"
        />
      </Tab>

      <Tab
        name="related"
        :label="t('appsPlus.related.tabLabel')"
        :weight="8"
      >
        <RelatedResourcesTable
          :rows="relatedRows"
          :hint="t('appsPlus.related.appHint')"
        />
      </Tab>
    </ResourceTabs>
  </div>
</template>

<style lang="scss" scoped>
.instance-list {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>
