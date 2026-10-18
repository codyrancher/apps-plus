<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import SortableTable from '@shell/components/SortableTable';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';
import { BadgeState } from '@components/BadgeState';
import {
  APP, APP_INSTANCE, FLEET_BUNDLE, RELATED_HEADERS, crdRelatedRows
} from '../config/types';
import { undeclaredWarnings } from '../render';

export default {
  name: 'DetailApp',

  components: {
    ResourceTabs,
    SortableTable,
    Tab,
    Banner,
    RcButton,
    BadgeState,
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

    relatedHeaders() {
      return RELATED_HEADERS;
    },

    relatedRows() {
      const rows = [...crdRelatedRows(this.t)];

      rows.push({
        key:        `app-storage-${ this.value.metadata?.name }`,
        stateColor: 'bg-success',
        stateLabel: 'Stored',
        kind:       'App (Template Storage)',
        name:       this.value.nameDisplay,
        namespace:  '—',
        to:         this.value.detailLocation,
        role:       this.t('appsPlus.related.appStorageRole', {
          templates: this.templates.length,
          values:    Object.keys(this.value.spec?.values || {}).length,
        }),
      });

      this.dependencies.forEach((dep) => {
        const depApp = this.appsByName[dep];
        const missing = !depApp;

        rows.push({
          key:        `dep-app-${ dep }`,
          stateColor: missing ? 'bg-error' : 'bg-success',
          stateLabel: missing ? this.t('appsPlus.dependencies.missing') : 'Active',
          kind:       'App (Dependency)',
          name:       dep,
          namespace:  '—',
          to:         depApp?.detailLocation || null,
          role:       this.t('appsPlus.related.dependencyAppRole'),
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
            role:       this.t('appsPlus.related.dependentAppRole', { app: this.value.nameDisplay }),
          });
        }
      });

      this.instances.forEach((inst) => {
        rows.push({
          key:        `inst-${ inst.metadata?.name }`,
          stateColor: inst.state === 'active' ? 'bg-success' : 'bg-warning',
          stateLabel: inst.stateDisplay || inst.state,
          kind:       'AppInstance',
          name:       inst.nameDisplay,
          namespace:  inst.targetNamespace || '—',
          to:         inst.detailLocation,
          role:       this.t('appsPlus.related.instanceRole', { targets: inst.targetDisplay }),
        });

        (inst.bundles || []).forEach((bundle) => {
          rows.push({
            key:        `bundle-${ bundle.metadata?.namespace }-${ bundle.metadata?.name }`,
            stateColor: 'bg-success',
            stateLabel: `${ inst.readyDisplay } Ready`,
            kind:       'Fleet Bundle',
            name:       bundle.metadata?.name,
            namespace:  bundle.metadata?.namespace || '—',
            to:         bundle.detailLocation,
            role:       this.t('appsPlus.related.bundleRole', { instance: inst.nameDisplay }),
          });
        });
      });

      return rows;
    },
  },
};
</script>

<template>
  <div>
    <RcButton
      variant="secondary"
      class="mb-20"
      @click="$router.push(value.createInstanceLocation)"
    >
      {{ t('appsPlus.action.createInstance') }}
    </RcButton>

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
        <div
          v-for="file in templates"
          :key="file.name"
          class="rendered"
        >
          <div class="rendered__name">
            {{ file.name }}
          </div>
          <pre class="rendered__body">{{ file.content }}</pre>
        </div>
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
        <Banner
          v-for="reference in undeclared"
          :key="reference.file"
          color="warning"
        >
          {{ t('appsPlus.values.undeclared', reference) }}
          <router-link
            v-if="value.canCustomEdit"
            :to="value.editLocation"
          >
            {{ t('appsPlus.values.undeclaredDeclareEdit', { app: value.nameDisplay }) }}
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
                >{{ t('appsPlus.instance.valueNoDefault') }}</span>
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
        <Banner
          color="info"
          :label="t('appsPlus.related.appHint')"
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
  </div>
</template>

<style lang="scss" scoped>
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

.instance-list {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
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
