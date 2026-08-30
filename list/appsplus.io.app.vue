<script>
import ResourceTable from '@shell/components/ResourceTable';
import { STATE, AGE } from '@shell/config/table-headers';
import { RcButton } from '@components/RcButton';
import { APP, APP_INSTANCE, FLEET_BUNDLE } from '../config/types';

/**
 * The Apps and Instances list: apps as group headings, their instances as the rows.
 *
 * This replaces the default table for the App type (the shell resolves list/<type>.vue), so
 * ResourceList above it still draws the masthead and the Create App button - what is here is
 * only the table.
 *
 * The shape is Cluster Explorer's Projects and Namespaces, including the part that is easy to
 * miss: an app with no instances still has to appear. A table grouped by a field can only show
 * groups that some row is in, so an empty app contributes one placeholder row whose only job
 * is to carry the group, and a slot keyed by its id renders it as a single "no instances yet"
 * cell instead of a row of blank columns.
 */
export default {
  name: 'ListAppsAndInstances',

  components: { ResourceTable, RcButton },

  props: {
    // Handed down by ResourceList: the Apps it loaded for the route's resource type.
    rows: {
      type:    Array,
      default: () => [],
    },

    loading: {
      type:    Boolean,
      default: false,
    },
  },

  async fetch() {
    // The apps arrive as `rows`; the other two are this page's own. Bundles are here because
    // an instance's state is Fleet's answer about its bundle, and the state column would
    // otherwise be permanently pending.
    await Promise.all([
      this.$store.dispatch('management/findAll', { type: APP_INSTANCE }),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE }),
    ]);
  },

  computed: {
    instanceSchema() {
      return this.$store.getters['management/schemaFor'](APP_INSTANCE);
    },

    instances() {
      return this.$store.getters['management/all'](APP_INSTANCE);
    },

    apps() {
      return this.rows || [];
    },

    appsByName() {
      return this.apps.reduce((acc, app) => {
        acc[app.metadata?.name] = app;

        return acc;
      }, {});
    },

    /** Apps with nothing under them, which the group-by would otherwise drop entirely. */
    emptyApps() {
      const used = new Set(this.instances.map((instance) => instance.spec?.app));

      return this.apps.filter((app) => !used.has(app.metadata?.name));
    },

    placeholderRows() {
      return this.emptyApps.map((app) => ({
        _key:             `empty-${ app.id }`,
        id:               `empty-${ app.id }`,
        mainRowKey:       app.id,
        groupById:        app.metadata?.name,
        isPlaceholder:    true,
        app,
        availableActions: [],
      }));
    },

    /**
     * Instances whose app has been deleted are dropped rather than shown under an empty
     * heading: the group header reads everything it displays off the app, and a group with no
     * app is a row nobody can act on.
     */
    tableRows() {
      const live = this.instances.filter((instance) => !!this.appsByName[instance.spec?.app]);

      return [...live, ...this.placeholderRows];
    },

    headers() {
      return [
        STATE,
        {
          name:     'name',
          labelKey: 'tableHeaders.name',
          value:    'nameDisplay',
          sort:     ['nameSort'],
        },
        {
          name:      'clusters',
          labelKey:  'appsPlus.headers.clusters',
          value:     'targetDisplay',
          sort:      ['targetDisplay'],
          dashIfEmpty: true,
        },
        {
          name:     'namespace',
          labelKey: 'appsPlus.headers.namespace',
          value:    'targetNamespace',
          sort:     ['targetNamespace'],
        },
        {
          name:     'ready',
          labelKey: 'appsPlus.headers.ready',
          value:    'readyDisplay',
          align:    'left',
          width:    80,
        },
        AGE,
      ];
    },
  },

  methods: {
    appFor(group) {
      return group?.rows?.[0]?.app || null;
    },

    placeholderSlot(app) {
      return `main-row:${ app.id }`;
    },
  },
};
</script>

<template>
  <ResourceTable
    class="apps-plus-list"
    :schema="instanceSchema"
    :headers="headers"
    :rows="tableRows"
    :loading="loading || $fetchState.pending"
    group-by="groupById"
    :groupable="false"
    key-field="_key"
  >
    <template #group-by="group">
      <div class="app-bar">
        <div
          v-trim-whitespace
          class="group-tab"
        >
          <div class="app-name">
            <span>{{ appFor(group.group)?.nameDisplay }}</span>
          </div>
          <div
            v-if="appFor(group.group)?.description"
            class="description text-muted text-small"
          >
            {{ appFor(group.group).description }}
          </div>
        </div>
        <div class="right mr-10">
          <rc-button
            v-if="appFor(group.group)"
            variant="secondary"
            class="mr-5"
            :to="appFor(group.group).createInstanceLocation"
          >
            {{ t('appsPlus.action.createInstance') }}
          </rc-button>
          <rc-button
            v-if="appFor(group.group)?.detailLocation"
            variant="link"
            :to="appFor(group.group).detailLocation"
          >
            {{ t('generic.edit') }}
          </rc-button>
        </div>
      </div>
    </template>

    <template #cell:name="{row}">
      <router-link
        v-if="row.detailLocation"
        :to="row.detailLocation"
      >
        {{ row.nameDisplay }}
      </router-link>
      <span v-else>{{ row.nameDisplay }}</span>
    </template>

    <template
      v-for="app in emptyApps"
      :key="app.id"
      #[placeholderSlot(app)]="{ fullColspan }"
    >
      <tr class="main-row">
        <td
          class="empty text-center"
          :colspan="fullColspan"
        >
          {{ t('appsPlus.list.noInstances') }}
        </td>
      </tr>
    </template>
  </ResourceTable>
</template>

<style lang="scss" scoped>
.apps-plus-list {
  & :deep() {
    .app-bar {
      contain: inline-size;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;

      .group-tab {
        max-width: calc(100% - 260px);
      }

      .app-name {
        display: flex;
        flex-direction: row;
        align-items: center;
        line-height: 30px;
      }

      .description {
        margin-top: -6px;
      }
    }

    td.empty {
      padding: 12px;
    }
  }
}
</style>
