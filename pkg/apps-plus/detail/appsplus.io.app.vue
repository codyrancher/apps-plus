<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';
import { APP, APP_INSTANCE } from '../config/types';
import { undeclaredWarnings } from '../render';

/** An app's templates (or Helm chart), dependencies, and the instances currently running them. */
export default {
  name: 'DetailApp',

  components: {
    ResourceTabs, Tab, Banner, RcButton
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
    ]);
  },

  computed: {
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
  },
};
</script>

<template>
  <div>
    <rc-button
      variant="secondary"
      class="mb-20"
      @click="$router.push(value.createInstanceLocation)"
    >
      {{ t('appsPlus.action.createInstance') }}
    </rc-button>

    <ResourceTabs :value="value">
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
          <router-link :to="value.editLocation">
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
            <code>{{ dep }}</code>
            <span
              class="ml-10 text-muted"
            >
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
