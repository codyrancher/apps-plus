<script>
import ResourceTabs from '@shell/components/form/ResourceTabs';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';
import { APP_INSTANCE } from '../config/types';

/** An app's templates, and the instances currently running them. */
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
    await this.$store.dispatch('management/findAll', { type: APP_INSTANCE });
  },

  computed: {
    templates() {
      return this.value.templates || [];
    },

    instances() {
      return this.value.instances || [];
    },
  },
};
</script>

<template>
  <div>
    <div class="row mb-20">
      <div class="col span-4">
        <label class="text-label">{{ t('appsPlus.headers.templates') }}</label>
        <div>{{ templates.length }}</div>
      </div>
      <div class="col span-4">
        <label class="text-label">{{ t('appsPlus.headers.instances') }}</label>
        <div>{{ instances.length }}</div>
      </div>
      <div class="col span-4">
        <label class="text-label">{{ t('appsPlus.app.defaultNamespace') }}</label>
        <div>{{ value.spec?.defaultNamespace || 'default' }}</div>
      </div>
    </div>

    <rc-button
      variant="secondary"
      class="mb-20"
      :to="value.createInstanceLocation"
    >
      {{ t('appsPlus.action.createInstance') }}
    </rc-button>

    <ResourceTabs :value="value">
      <Tab
        name="templates"
        :label="t('appsPlus.app.templates')"
        :weight="10"
      >
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
          v-if="!templates.length"
          color="warning"
          :label="t('appsPlus.app.noTemplates')"
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
</style>
