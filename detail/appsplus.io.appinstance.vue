<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { FLEET_BUNDLE, APP } from '../config/types';

/**
 * What one instance actually deployed, and what Fleet says about it.
 *
 * The rendered YAML is recomputed from the app rather than read back off the Bundle, so a
 * template edited since the last deploy shows as what would be deployed. The Bundle summary
 * beside it is the other half of that: what is on the clusters right now.
 */
export default {
  name: 'DetailAppInstance',

  components: { ResourceTabs, Tab, Banner },

  props: {
    value: {
      type:     Object,
      required: true,
    },
  },

  async fetch() {
    await Promise.all([
      this.$store.dispatch('management/findAll', { type: APP }),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE }),
    ]);
  },

  computed: {
    resources() {
      return this.value.renderedResources || [];
    },

    summary() {
      return this.value.bundleSummary;
    },

    bundleLocation() {
      return this.value.bundle?.detailLocation || null;
    },
  },
};
</script>

<template>
  <div>
    <Banner
      v-if="value.stateDescription"
      :color="value.state === 'error' ? 'error' : 'info'"
      :label="value.stateDescription"
    />

    <div class="row mb-20">
      <div class="col span-3">
        <label class="text-label">{{ t('appsPlus.instance.app') }}</label>
        <div>
          <router-link
            v-if="value.app?.detailLocation"
            :to="value.app.detailLocation"
          >
            {{ value.appDisplay }}
          </router-link>
          <span v-else>{{ value.appDisplay }}</span>
        </div>
      </div>
      <div class="col span-3">
        <label class="text-label">{{ t('appsPlus.instance.targets') }}</label>
        <div>{{ value.targetDisplay }}</div>
      </div>
      <div class="col span-3">
        <label class="text-label">{{ t('appsPlus.instance.namespace') }}</label>
        <div>{{ value.targetNamespace }}</div>
      </div>
      <div class="col span-3">
        <label class="text-label">{{ t('appsPlus.instance.bundle') }}</label>
        <div>
          <router-link
            v-if="bundleLocation"
            :to="bundleLocation"
          >
            {{ value.bundleName }}
          </router-link>
          <span
            v-else
            class="text-muted"
          >{{ value.bundleName }}</span>
          <span
            v-if="summary"
            class="ml-5 text-muted"
          >({{ value.readyDisplay }} ready)</span>
        </div>
      </div>
    </div>

    <ResourceTabs :value="value">
      <Tab
        name="resources"
        :label="t('appsPlus.instance.preview')"
        :weight="10"
      >
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
          v-if="!resources.length"
          color="warning"
          :label="t('appsPlus.app.noTemplates')"
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
</style>
