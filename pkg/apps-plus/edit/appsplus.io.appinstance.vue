<script>
import CreateEditView from '@shell/mixins/create-edit-view';
import CruResource from '@shell/components/CruResource';
import NameNsDescription from '@shell/components/form/NameNsDescription';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import Tabbed from '@shell/components/Tabbed';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { Checkbox } from '@components/Form/Checkbox';
import RenderedYamlFiles from '../components/RenderedYamlFiles.vue';
import {
  APP, APP_INSTANCE, FLEET_CLUSTER, APP_QUERY, DEFAULT_TARGET_NAMESPACE
} from '../config/types';
import { NAMESPACE } from '@shell/config/types';
import { DEFAULT_CLUSTER_VALUES } from '../config/cluster-template';
import {
  renderTemplates, missingValues, appVariables, undeclaredWarnings, isSet, typedOverrides, BUILT_IN_VALUES
} from '../render';
import { fetchHelmVersionDetails } from '../helm';

export default {
  name:         'CruAppInstance',
  inheritAttrs: false,

  components: {
    CruResource,
    NameNsDescription,
    LabeledSelect,
    LabeledInput,
    Tabbed,
    Tab,
    Banner,
    Checkbox,
    RenderedYamlFiles,
  },

  mixins: [CreateEditView],

  async fetch() {
    this.apps = await this.$store.dispatch('management/findAll', { type: APP });
    this.clusters = await this.$store.dispatch('management/findAll', { type: FLEET_CLUSTER });
    this.namespaces = await this.$store.dispatch('management/findAll', { type: NAMESPACE }).catch(() => []);
    this.instances = await this.$store.dispatch('management/findAll', { type: APP_INSTANCE }).catch(() => []);
    this.ensureDefaultVersion();
  },

  data() {
    if (!this.value.spec) {
      this.value.spec = {};
    }

    const spec = this.value.spec;

    if (!spec.app && this.$route.query?.[APP_QUERY]) {
      spec.app = this.$route.query[APP_QUERY];
    }

    if (!Array.isArray(spec.targets)) {
      spec.targets = [];
    }

    if (!spec.values) {
      spec.values = {};
    }

    if (!spec.provisionCluster) {
      spec.provisionCluster = { enabled: false };
    }

    return {
      DEFAULT_TARGET_NAMESPACE,
      apps:            [],
      clusters:        [],
      namespaces:      [],
      instances:       [],
      versionDefaults: null,
    };
  },

  watch: {
    selectedApp() {
      this.versionDefaults = null;
      this.ensureDefaultVersion();
    },

    'value.spec.version'(ver) {
      this.loadVersionDefaults(ver);
    },
  },

  computed: {
    appOptions() {
      return this.apps.map((app) => ({
        label: app.nameDisplay,
        value: app.metadata?.name,
      }));
    },

    versionOptions() {
      if (!this.selectedApp?.isHelmChart) {
        return [];
      }

      return (this.selectedApp.helmVersions || []).map((v) => ({
        label: v,
        value: v,
      }));
    },

    clusterOptions() {
      return this.clusters.map((cluster) => ({
        label: cluster.metadata?.name,
        value: cluster.metadata?.name,
      }));
    },

    namespaceOptions() {
      const found = new Set();

      this.namespaces.forEach((namespace) => found.add(namespace.metadata?.name));
      this.instances.forEach((instance) => {
        if (instance.spec?.namespace) {
          found.add(instance.spec.namespace);
        }
      });
      found.delete(undefined);

      return [...found].sort();
    },

    selectedApp() {
      return this.apps.find((app) => app.metadata?.name === this.value.spec.app) || null;
    },

    provisions: {
      get() {
        return !!this.value.spec.provisionCluster?.enabled;
      },
      set(enabled) {
        this.value.spec.provisionCluster = {
          ...(this.value.spec.provisionCluster || {}),
          enabled,
        };

        if (enabled) {
          this.value.spec.targets = [];
        }
      },
    },

    clusterName: {
      get() {
        return this.value.spec.provisionCluster?.name || '';
      },
      set(name) {
        this.value.spec.provisionCluster = {
          ...(this.value.spec.provisionCluster || {}),
          name,
        };
      },
    },

    targetNames: {
      get() {
        return (this.value.spec.targets || []).map((target) => target.clusterName);
      },
      set(names) {
        this.value.spec.targets = (names || []).map((clusterName) => ({ clusterName }));
      },
    },

    previewFiles() {
      if (!this.selectedApp) {
        return [];
      }

      const files = [...renderTemplates(this.selectedApp, this.value)];

      if (this.helmPreview) {
        files.unshift({
          name:    this.selectedApp.helmDisplay,
          content: this.helmPreview,
        });
      }

      return files;
    },

    clusterPreviewFiles() {
      return [{
        name:    this.clusterName || this.value.metadata?.name || '',
        content: this.value.renderedClusterTemplate,
      }];
    },

    helmPreview() {
      if (!this.selectedApp?.isHelmChart) {
        return '';
      }

      const helm = this.selectedApp.spec?.helm || {};
      const baseValues = this.versionDefaults || this.selectedApp.spec?.values || {};

      return JSON.stringify({
        repo:        helm.repo || '',
        chart:       helm.chart || '',
        version:     this.value.spec.version || helm.version || '',
        releaseName: helm.releaseName || this.value.metadata?.name || helm.chart || '',
        values:      { ...baseValues, ...typedOverrides(baseValues, this.values) },
      }, null, 2);
    },

    missingDependencies() {
      return this.selectedApp?.missingDependencies || [];
    },

    values: {
      get() {
        return this.value.spec.values || {};
      },
      set(values) {
        this.value.spec.values = { ...values };
      },
    },

    missing() {
      return missingValues(this.selectedApp, this.value);
    },

    valueKeys() {
      if (!this.selectedApp) {
        return [];
      }

      const base = appVariables(this.selectedApp, this.provisions);
      const extra = this.versionDefaults ? Object.keys(this.versionDefaults) : [];

      return [...new Set([...base, ...extra])]
        .filter((name) => !BUILT_IN_VALUES.includes(name))
        .sort();
    },

    undeclared() {
      return undeclaredWarnings(this.selectedApp);
    },

    appDefaults() {
      const declared = this.versionDefaults || this.selectedApp?.spec?.values || {};

      return this.provisions ? { ...DEFAULT_CLUSTER_VALUES, ...declared } : declared;
    },

    valueRows() {
      const names = new Set(this.valueKeys);

      Object.keys(this.values).forEach((name) => names.add(name));

      return [...names].sort().map((name) => ({
        name,
        current: this.values[name] ?? '',
        default: isSet(this.appDefaults, name) ? this.appDefaults[name] : undefined,
        stale:   !this.valueKeys.includes(name),
      }));
    },

    validationPassed() {
      return !!this.value.metadata?.name && !!this.value.spec.app && !this.missing.length;
    },
  },

  methods: {
    ensureDefaultVersion() {
      if (this.selectedApp?.isHelmChart && !this.value.spec.version) {
        this.value.spec.version = this.selectedApp.helmVersion || this.selectedApp.helmVersions?.[0] || '';
      }
    },

    async loadVersionDefaults(ver) {
      if (!this.selectedApp?.isHelmChart || !ver || ver === this.selectedApp.helmVersion) {
        this.versionDefaults = null;

        return;
      }

      try {
        const details = await fetchHelmVersionDetails(
          this.selectedApp.helmRepo,
          this.selectedApp.helmChart,
          ver,
        );

        this.versionDefaults = details?.values || null;
      } catch {
        this.versionDefaults = null;
      }
    },

    setValue(name, entered) {
      const values = { ...this.values };

      if (entered === '' || entered === undefined || entered === null) {
        delete values[name];
      } else {
        values[name] = entered;
      }

      this.values = values;
    },
  },
};
</script>

<template>
  <CruResource
    ref="cru"
    :done-route="doneRoute"
    :mode="mode"
    :resource="value"
    :subtypes="[]"
    :validation-passed="validationPassed"
    :errors="errors"
    @error="e => errors = e"
    @finish="save"
    @cancel="done"
  >
    <NameNsDescription
      class="fill-row"
      :value="value"
      :mode="mode"
      :namespaced="false"
      :description-hidden="true"
      :extra-columns="value.spec.app ? [] : ['app']"
      :register-before-hook="registerBeforeHook"
    >
      <template #app>
        <LabeledSelect
          v-model:value="value.spec.app"
          :mode="mode"
          :options="appOptions"
          :label="t('appsPlus.instance.app')"
          :tooltip="t('appsPlus.instance.appHint')"
          required
        />
      </template>
    </NameNsDescription>

    <div
      v-if="selectedApp && selectedApp.isHelmChart"
      class="row mb-20"
    >
      <div class="col span-6">
        <LabeledSelect
          v-model:value="value.spec.version"
          data-testid="helm-version-select"
          :mode="mode"
          :options="versionOptions"
          :label="t('appsPlus.instance.version')"
          :tooltip="t('appsPlus.instance.versionHint')"
        />
      </div>
    </div>

    <div class="section">
      <h3 class="section__title">
        {{ t('appsPlus.instance.destination') }}
      </h3>

      <Checkbox
        v-model:value="provisions"
        class="mb-20"
        :mode="mode"
        :label="t('appsPlus.instance.provision')"
        :tooltip="t('appsPlus.instance.provisionHint')"
      />

      <div class="row">
        <div class="col span-6">
          <LabeledInput
            v-if="provisions"
            v-model:value="clusterName"
            :mode="mode"
            :label="t('appsPlus.instance.clusterName')"
            :tooltip="t('appsPlus.instance.clusterNameHint')"
            :placeholder="value.metadata.name || t('appsPlus.instance.clusterNamePlaceholder')"
          />
          <LabeledSelect
            v-else
            v-model:value="targetNames"
            :mode="mode"
            :options="clusterOptions"
            :multiple="true"
            :label="t('appsPlus.instance.targets')"
            :tooltip="t('appsPlus.instance.targetsHint')"
          />
        </div>
        <div class="col span-6">
          <LabeledSelect
            v-model:value="value.spec.namespace"
            :mode="mode"
            :options="namespaceOptions"
            :taggable="true"
            :searchable="true"
            :label="t('appsPlus.instance.namespace')"
            :tooltip="t('appsPlus.instance.namespaceHint')"
            :placeholder="DEFAULT_TARGET_NAMESPACE"
          />
        </div>
      </div>
    </div>

    <Banner
      v-if="missingDependencies.length"
      color="error"
      data-testid="missing-dependency-banner"
      :label="t('appsPlus.instance.missingDependenciesError', { app: selectedApp?.nameDisplay || value.spec.app, deps: missingDependencies.join(', ') })"
    />

    <Banner
      v-if="missing.length"
      color="warning"
      :label="t('appsPlus.instance.missingValuesSummary', { keys: missing.join(', ') })"
    />

    <Banner
      v-if="provisions"
      color="warning"
      :label="t('appsPlus.instance.provisionWarning')"
    />
    <Banner
      v-else-if="!targetNames.length"
      color="warning"
      :label="t('appsPlus.instance.noTargets')"
    />

    <Tabbed
      :side-tabs="true"
      class="instance-tabs"
    >
      <Tab
        name="values"
        :label="t('appsPlus.instance.values')"
        :weight="2"
        :error="!!missing.length"
      >
        <Banner
          v-if="!selectedApp"
          color="warning"
          :label="t('appsPlus.instance.noApp')"
        />
        <template v-else>
          <Banner
            v-for="reference in undeclared"
            :key="reference.file"
            color="warning"
          >
            {{ t('appsPlus.values.undeclared', reference) }}
            <router-link
              v-if="selectedApp.canCustomEdit"
              :to="selectedApp.editLocation"
            >
              {{ t('appsPlus.values.undeclaredDeclareEdit', { app: selectedApp.nameDisplay }) }}
            </router-link>
          </Banner>
          <Banner
            v-if="!valueRows.length && !undeclared.length"
            color="info"
            :label="t('appsPlus.instance.noValues')"
          />
          <Banner
            v-else-if="valueRows.length"
            color="info"
            :label="t('appsPlus.instance.valuesHint')"
          />
        </template>

        <div class="values">
          <div
            v-for="row in valueRows"
            :key="row.name"
            class="values__row"
          >
            <LabeledInput
              :value="row.current"
              :mode="mode"
              :label="row.name"
              :required="row.default === undefined && !row.stale"
              :placeholder="row.default === undefined ? t('appsPlus.instance.valueNoDefault') : String(row.default)"
              @update:value="v => setValue(row.name, v)"
            />
            <p
              v-if="row.stale || row.default === undefined"
              class="values__note values__note--warning"
            >
              {{ row.stale ? t('appsPlus.values.unused', { key: row.name }) : t('appsPlus.instance.valueMissing') }}
            </p>
          </div>
        </div>
      </Tab>

      <Tab
        v-if="provisions"
        name="cluster"
        :label="t('appsPlus.instance.clusterPreview')"
        :weight="1"
      >
        <Banner
          color="info"
          :label="t('appsPlus.instance.clusterPreviewHint')"
        />
        <RenderedYamlFiles :files="clusterPreviewFiles" />
      </Tab>

      <Tab
        name="preview"
        :label="t('appsPlus.instance.preview')"
        :weight="0"
      >
        <Banner
          color="info"
          :label="t('appsPlus.instance.previewHint')"
        />
        <Banner
          v-if="!selectedApp"
          color="warning"
          :label="t('appsPlus.instance.noApp')"
        />
        <RenderedYamlFiles :files="previewFiles" />
      </Tab>
    </Tabbed>
  </CruResource>
</template>

<style lang="scss" scoped>
:deep(.fill-row) > .col {
  flex:  1 1 0;
  width: auto;
}

.instance-tabs {
  margin-top: 20px;
}

.section {
  margin-top:     8px;
  padding-top:    20px;
  border-top:     1px solid var(--border);

  &__title {
    margin-bottom: 12px;
    font-size:     14px;
  }
}

.values {
  display:               grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap:                   16px;
  margin-top:            10px;

  &__note {
    margin:    4px 0 0;
    font-size: 12px;
    color:     var(--muted);
  }

  &__note--warning { color: var(--warning); }
}
</style>
