<script>
import CreateEditView from '@shell/mixins/create-edit-view';
import CruResource from '@shell/components/CruResource';
import NameNsDescription from '@shell/components/form/NameNsDescription';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import KeyValue from '@shell/components/form/KeyValue';
import Tabbed from '@shell/components/Tabbed';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import {
  APP, FLEET_CLUSTER, APP_QUERY, DEFAULT_TARGET_NAMESPACE
} from '../config/types';
import { renderTemplates } from '../render';

/**
 * Creating and editing an AppInstance: pick an app, pick clusters, override values.
 *
 * The clusters offered are Fleet's, not Rancher's management ones, because Fleet is what
 * deploys this and a Bundle target names a Fleet Cluster. On this Rancher that is `local` in
 * the fleet-local workspace; a downstream cluster registered with Fleet appears here too,
 * with no change to this page.
 *
 * Nothing here writes the Bundle. Saving the instance does, in the model - so a YAML edit or
 * an import deploys exactly as this form does.
 */
export default {
  name:         'CruAppInstance',
  inheritAttrs: false,

  components: {
    CruResource,
    NameNsDescription,
    LabeledSelect,
    LabeledInput,
    KeyValue,
    Tabbed,
    Tab,
    Banner,
  },

  mixins: [CreateEditView],

  async fetch() {
    this.apps = await this.$store.dispatch('management/findAll', { type: APP });
    this.clusters = await this.$store.dispatch('management/findAll', { type: FLEET_CLUSTER });
  },

  data() {
    if (!this.value.spec) {
      this.value.spec = {};
    }

    const spec = this.value.spec;

    // The list's per-app "Create Instance" button arrives here with the app in the query, so
    // the form opens already pointed at the group it was pressed in.
    if (!spec.app && this.$route.query?.[APP_QUERY]) {
      spec.app = this.$route.query[APP_QUERY];
    }

    if (!Array.isArray(spec.targets)) {
      spec.targets = [];
    }

    if (!spec.values) {
      spec.values = {};
    }

    return {
      apps:     [],
      clusters: [],
      values:   { ...spec.values },
    };
  },

  computed: {
    appOptions() {
      return this.apps.map((app) => ({
        label: app.nameDisplay,
        value: app.metadata?.name,
      }));
    },

    clusterOptions() {
      return this.clusters.map((cluster) => ({
        label: cluster.metadata?.name,
        value: cluster.metadata?.name,
      }));
    },

    selectedApp() {
      return this.apps.find((app) => app.metadata?.name === this.value.spec.app) || null;
    },

    /** Two-way over spec.targets, which is a list of objects rather than the list of names
     * a multi-select works in. */
    targetNames: {
      get() {
        return (this.value.spec.targets || []).map((target) => target.clusterName);
      },
      set(names) {
        this.value.spec.targets = (names || []).map((clusterName) => ({ clusterName }));
      },
    },

    placeholderNamespace() {
      return this.selectedApp?.spec?.defaultNamespace || DEFAULT_TARGET_NAMESPACE;
    },

    /** What this instance would deploy, rendered as it will be written into the Bundle. */
    preview() {
      if (!this.selectedApp) {
        return [];
      }

      return renderTemplates(this.selectedApp, this.value);
    },

    validationPassed() {
      return !!this.value.metadata?.name && !!this.value.spec.app;
    },
  },

  watch: {
    values(neu) {
      this.value.spec.values = { ...neu };
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
      :value="value"
      :mode="mode"
      :namespaced="false"
      :register-before-hook="registerBeforeHook"
    />

    <div class="row mb-20">
      <div class="col span-6">
        <LabeledSelect
          v-model:value="value.spec.app"
          :mode="mode"
          :options="appOptions"
          :label="t('appsPlus.instance.app')"
          :tooltip="t('appsPlus.instance.appHint')"
          required
        />
      </div>
      <div class="col span-6">
        <LabeledInput
          v-model:value="value.spec.namespace"
          :mode="mode"
          :label="t('appsPlus.instance.namespace')"
          :tooltip="t('appsPlus.instance.namespaceHint')"
          :placeholder="placeholderNamespace"
        />
      </div>
    </div>

    <div class="row mb-20">
      <div class="col span-12">
        <LabeledSelect
          v-model:value="targetNames"
          :mode="mode"
          :options="clusterOptions"
          :multiple="true"
          :label="t('appsPlus.instance.targets')"
          :tooltip="t('appsPlus.instance.targetsHint')"
        />
      </div>
    </div>

    <Banner
      v-if="!targetNames.length"
      color="warning"
      :label="t('appsPlus.instance.noTargets')"
    />

    <Tabbed :side-tabs="true">
      <Tab
        name="values"
        :label="t('appsPlus.instance.values')"
        :weight="2"
      >
        <Banner
          color="info"
          :label="t('appsPlus.instance.valuesHint')"
        />
        <KeyValue
          v-model:value="values"
          :mode="mode"
          :read-allowed="false"
          :as-map="true"
        />
      </Tab>

      <Tab
        name="preview"
        :label="t('appsPlus.instance.preview')"
        :weight="1"
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
        <div
          v-for="file in preview"
          :key="file.name"
          class="rendered"
        >
          <div class="rendered__name">
            {{ file.name }}
          </div>
          <pre class="rendered__body">{{ file.content }}</pre>
        </div>
      </Tab>
    </Tabbed>
  </CruResource>
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
</style>
