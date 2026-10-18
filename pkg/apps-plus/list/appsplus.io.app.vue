<script>
import ResourceTable from '@shell/components/ResourceTable';
import Masthead from '@shell/components/ResourceList/Masthead';
import { STATE, AGE } from '@shell/config/table-headers';
import { RcButton } from '@components/RcButton';
import { BadgeState } from '@components/BadgeState';
import ActionMenu from '@shell/components/ActionMenuShell.vue';
import ImportHelmChartModal from '../components/ImportHelmChartModal.vue';
import BlockedDeleteModal from '../components/BlockedDeleteModal.vue';
import DependenciesPopover from '../components/DependenciesPopover.vue';
import {
  APP, APP_INSTANCE, FLEET_BUNDLE, FLEET_BUNDLE_DEPLOYMENT, PROVISIONING_CLUSTER
} from '../config/types';

export default {
  name:         'ListAppsAndInstances',
  inheritAttrs: false,

  components: {
    ResourceTable,
    Masthead,
    RcButton,
    BadgeState,
    ActionMenu,
    ImportHelmChartModal,
    BlockedDeleteModal,
    DependenciesPopover,
  },

  props: {
    loading: {
      type:    Boolean,
      default: false,
    },
  },

  async fetch() {
    await Promise.all([
      this.$store.dispatch('management/findAll', { type: APP }),
      this.$store.dispatch('management/findAll', { type: APP_INSTANCE }),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE }),
      this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE_DEPLOYMENT }).catch(() => []),
      this.$store.dispatch('management/findAll', { type: PROVISIONING_CLUSTER }).catch(() => []),
    ]);
  },

  data() {
    return {
      APP,
      sweep:             null,
      pollTimer:         null,
      importingHelm:     false,
      openDepPopoverKey: null,
    };
  },

  computed: {
    appSchema() {
      return this.$store.getters['management/schemaFor'](APP);
    },

    instanceSchema() {
      return this.$store.getters['management/schemaFor'](APP_INSTANCE);
    },

    instances() {
      return this.$store.getters['management/all'](APP_INSTANCE) || [];
    },

    apps() {
      return this.$store.getters['management/all'](APP) || [];
    },

    appsByName() {
      return Object.fromEntries(this.apps.map((app) => [app.metadata?.name, app]));
    },

    installedAppNames() {
      return new Set(
        this.instances
          .filter((inst) => !inst.isTerminating && inst.spec?.app)
          .map((inst) => inst.spec.app)
      );
    },

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
        nameDisplay:      this.t('appsPlus.list.noInstances'),
        targetDisplay:    '—',
        targetNamespace:  '—',
        readyDisplay:     '—',
        app,
        availableActions: [],
      }));
    },

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
          name:     'dependencies',
          labelKey: 'appsPlus.headers.dependencies',
          value:    'dependencies',
          width:    180,
        },
        {
          name:        'clusters',
          labelKey:    'appsPlus.headers.clusters',
          value:       'targetDisplay',
          sort:        ['targetDisplay'],
          dashIfEmpty: true,
        },
        {
          name:     'targetNamespace',
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

  mounted() {
    this.releaseTerminating();
    this.sweep = setInterval(() => this.releaseTerminating(), 30000);
    this.pollTimer = setInterval(() => this.refreshBundles(), 4000);
    if (typeof window !== 'undefined') {
      window.addEventListener('click', this.onOutsideClick);
    }
  },

  beforeUnmount() {
    if (this.sweep) {
      clearInterval(this.sweep);
      this.sweep = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('click', this.onOutsideClick);
    }
  },

  methods: {
    async refreshBundles() {
      if (!this.instances.length) {
        return;
      }

      await Promise.all([
        this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE, opt: { force: true } }).catch(() => []),
        this.$store.dispatch('management/findAll', { type: FLEET_BUNDLE_DEPLOYMENT, opt: { force: true } }).catch(() => []),
        this.$store.dispatch('management/findAll', { type: APP_INSTANCE, opt: { force: true } }).catch(() => []),
      ]);
    },

    async releaseTerminating() {
      for (const instance of this.instances.filter((row) => row.isTerminating)) {
        await instance.releaseWhenEmpty().catch(() => false);
      }
    },

    onOutsideClick() {
      this.openDepPopoverKey = null;
    },

    appFor(group) {
      return group?.rows?.[0]?.app || null;
    },

    attentionCount(group) {
      return (group?.rows || []).filter((row) => row.needsAttention).length;
    },

    async onHelmImported() {
      await this.$store.dispatch('management/findAll', { type: APP, opt: { force: true } });
    },
  },
};
</script>

<template>
  <div>
    <Masthead
      :schema="appSchema"
      :resource="APP"
    >
      <template #extraActions>
        <RcButton
          variant="secondary"
          size="large"
          class="mr-10"
          data-testid="import-helm-chart-btn"
          @click="importingHelm = true"
        >
          {{ t('appsPlus.helm.importButton') }}
        </RcButton>
      </template>
    </Masthead>

    <ResourceTable
      class="apps-plus-list"
      :schema="instanceSchema"
      :headers="headers"
      :rows="tableRows"
      :loading="loading || $fetchState.pending"
      group-by="groupById"
      :groupable="true"
      group-tooltip="appsPlus.headers.app"
      key-field="_key"
    >
      <template #group-by="group">
        <div class="app-bar">
          <div
            v-trim-whitespace
            class="group-tab"
          >
            <div class="app-name">
              <router-link
                v-if="appFor(group.group)?.detailLocation"
                :to="appFor(group.group).detailLocation"
              >
                {{ appFor(group.group).nameDisplay }}
              </router-link>
              <span v-else>{{ appFor(group.group)?.nameDisplay }}</span>

              <span
                v-if="appFor(group.group)?.isHelmChart"
                class="helm-badge"
                :title="appFor(group.group).helmRepo ? `${appFor(group.group).helmDisplay} — ${appFor(group.group).helmRepo}` : appFor(group.group).helmDisplay"
              >
                {{ t('appsPlus.list.helmBadge', { chart: appFor(group.group).helmDisplay }) }}
              </span>

              <span
                v-if="attentionCount(group.group)"
                class="attention"
                :title="t('appsPlus.list.needsAttention', { count: attentionCount(group.group) })"
              >
                {{ t('appsPlus.list.needsAttention', { count: attentionCount(group.group) }) }}
              </span>
            </div>
            <div
              v-if="appFor(group.group)?.description"
              v-clean-tooltip="appFor(group.group).description"
              class="description text-muted text-small"
            >
              {{ appFor(group.group).description }}
            </div>
          </div>
          <div class="right mr-10">
            <RcButton
              v-if="appFor(group.group)"
              variant="secondary"
              class="mr-5"
              @click="$router.push(appFor(group.group).createInstanceLocation)"
            >
              {{ t('appsPlus.action.createInstance') }}
            </RcButton>
            <ActionMenu
              v-if="appFor(group.group)"
              :resource="appFor(group.group)"
              data-testid="app-actions"
              :button-aria-label="t('appsPlus.action.appActions', { name: appFor(group.group).nameDisplay })"
            />
          </div>
        </div>
      </template>

      <template #cell:state="{row}">
        <BadgeState
          v-if="row.isPlaceholder"
          color="bg-darker"
          :label="t('appsPlus.list.notInstalled')"
          data-testid="state-not-installed"
        />
        <BadgeState
          v-else
          :value="row"
          data-testid="instance-state-badge"
        />
      </template>

      <template #cell:name="{row}">
        <span
          v-if="row.isPlaceholder"
          class="text-muted"
        >
          {{ t('appsPlus.list.noInstances') }}
        </span>
        <div
          v-else
          class="name-cell"
        >
          <router-link
            v-if="row.detailLocation"
            :to="row.detailLocation"
          >
            {{ row.nameDisplay }}
          </router-link>
          <span v-else>{{ row.nameDisplay }}</span>

          <button
            v-if="row.isDependency"
            type="button"
            class="dep-instance-badge"
            data-testid="dependency-instance-badge"
            :title="t('appsPlus.list.dependencyInstanceHint')"
            @click.stop="row.showBlockedDeleteModal()"
          >
            {{ t('appsPlus.list.dependencyBadge') }}
          </button>
        </div>
      </template>

      <template #cell:dependencies="{row}">
        <DependenciesPopover
          :row="row"
          :apps-by-name="appsByName"
          :installed-app-names="installedAppNames"
          :open-key="openDepPopoverKey"
          @toggle="openDepPopoverKey = $event"
        />
      </template>
    </ResourceTable>

    <ImportHelmChartModal
      v-if="importingHelm"
      @imported="onHelmImported"
      @close="importingHelm = false"
    />

    <BlockedDeleteModal />
  </div>
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
      min-height: 40px;

      .group-tab {
        max-width: calc(100% - 260px);
        min-width: 0;
        display: flex;
        flex-direction: row;
        align-items: baseline;
        gap: 10px;
      }

      .app-name {
        display: flex;
        flex-direction: row;
        align-items: center;
        line-height: 30px;
        flex-shrink: 0;

        > :first-child {
          flex-shrink: 0;
        }
      }

      .description {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .helm-badge {
        margin-left: 10px;
        padding: 1px 8px;
        border-radius: var(--border-radius);
        background: var(--accent-btn);
        color: var(--link);
        border: 1px solid var(--link);
        font-size: 11px;
        line-height: 18px;
        white-space: nowrap;
      }

      .attention {
        margin-left: 10px;
        padding: 1px 8px;
        border-radius: var(--border-radius);
        background: var(--warning-badge, var(--warning-banner));
        color: var(--on-warning-banner);
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    td {
      overflow: visible;
    }
  }
}

.name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dep-instance-badge {
  padding: 1px 8px;
  border-radius: var(--border-radius);
  background: var(--warning-badge, var(--warning-banner));
  color: var(--on-warning-banner);
  border: none;
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}
</style>
