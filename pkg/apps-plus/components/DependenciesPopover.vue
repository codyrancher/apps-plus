<script>
import { BadgeState } from '@components/BadgeState';

export default {
  name: 'DependenciesPopover',

  components: { BadgeState },

  props: {
    row: {
      type:     Object,
      required: true,
    },
    versions: {
      type:    Array,
      default: () => [],
    },
    appsByName: {
      type:    Object,
      default: () => ({}),
    },
    installedAppNames: {
      type:    Object,
      default: () => new Set(),
    },
    openKey: {
      type:    String,
      default: null,
    },
    align: {
      type:    String,
      default: 'left',
    },
  },

  emits: ['toggle'],

  computed: {
    rowKey() {
      return this.row._key || this.row.id;
    },

    isOpen() {
      return this.openKey === this.rowKey;
    },

    isVersionsMode() {
      return this.versions.length > 0;
    },

    dependencies() {
      return this.row?.app?.dependencies || [];
    },

    dependentInstances() {
      return this.row?.dependentInstances || [];
    },

    hasEntries() {
      return this.isVersionsMode || this.dependencies.length > 0 || this.dependentInstances.length > 0 || !!this.row?.isDependency;
    },

    missingDependencies() {
      return this.row?.app?.missingDependencies || [];
    },

    uninstalledDependencies() {
      const missing = new Set(this.missingDependencies);

      return this.dependencies.filter((dep) => !missing.has(dep) && !this.installedAppNames.has(dep));
    },

    hasWarnings() {
      return !this.isVersionsMode && (this.missingDependencies.length > 0 || this.uninstalledDependencies.length > 0);
    },
  },

  methods: {
    toggle() {
      this.$emit('toggle', this.isOpen ? null : this.rowKey);
    },
  },
};
</script>

<template>
  <span v-if="!hasEntries" />
  <div
    v-else
    class="dep-cell"
    @click.stop
  >
    <button
      type="button"
      class="dep-trigger"
      :class="{ 'dep-trigger--warning': hasWarnings }"
      :data-testid="isVersionsMode ? 'versions-trigger' : 'dependencies-trigger'"
      @click="toggle"
    >
      <i
        class="icon icon-checkmark"
        :data-testid="isVersionsMode ? 'version-checkmark' : 'dependency-checkmark'"
      />
      <i
        v-if="hasWarnings"
        class="icon icon-warning ml-5"
      />
    </button>

    <div
      v-if="isOpen"
      class="dep-popover"
      :class="{ 'dep-popover--right': align === 'right' }"
      :data-testid="isVersionsMode ? 'versions-popover' : 'dependencies-popover'"
    >
      <template v-if="isVersionsMode">
        <div class="dep-popover__header">
          {{ t('appsPlus.helm.versionsPopoverTitle', { count: versions.length }) }}
        </div>
        <ul class="dep-popover__list">
          <li
            v-for="(ver, idx) in versions"
            :key="ver"
            class="dep-popover__item"
          >
            <span>{{ ver }}</span>
            <BadgeState
              v-if="idx === 0"
              color="bg-info"
              :label="t('appsPlus.helm.latestVersion')"
            />
          </li>
        </ul>
      </template>

      <template v-else-if="dependencies.length">
        <div class="dep-popover__header">
          {{ t('appsPlus.dependencies.popoverTitle', { count: dependencies.length }) }}
        </div>
        <ul class="dep-popover__list">
          <li
            v-for="dep in dependencies"
            :key="dep"
            class="dep-popover__item"
          >
            <router-link
              v-if="appsByName[dep]?.detailLocation"
              :to="appsByName[dep].detailLocation"
              @click="$emit('toggle', null)"
            >
              {{ dep }}
            </router-link>
            <span v-else>{{ dep }}</span>

            <BadgeState
              v-if="!appsByName[dep]"
              color="bg-error"
              :label="t('appsPlus.dependencies.missing')"
            />
            <BadgeState
              v-else-if="installedAppNames.has(dep)"
              color="bg-success"
              :label="t('appsPlus.dependencies.installed')"
            />
            <BadgeState
              v-else
              color="bg-warning"
              :label="t('appsPlus.dependencies.notInstalled')"
            />
          </li>
        </ul>
      </template>

      <template v-if="!isVersionsMode && dependentInstances.length">
        <div
          class="dep-popover__header"
          :class="{ 'dep-popover__header--spaced': dependencies.length }"
        >
          {{ t('appsPlus.dependencies.reliedOnByLabel') }}
        </div>
        <ul class="dep-popover__list">
          <li
            v-for="depInst in dependentInstances"
            :key="depInst.metadata.name"
            class="dep-popover__item"
          >
            <router-link
              :to="depInst.detailLocation"
              data-testid="dependent-instance-link"
              @click="$emit('toggle', null)"
            >
              {{ depInst.nameDisplay }} ({{ depInst.appDisplay }})
            </router-link>
          </li>
        </ul>
      </template>

      <div
        v-if="hasWarnings"
        class="dep-popover__warnings"
        data-testid="dependencies-popover-warnings"
      >
        <div
          v-if="missingDependencies.length"
          class="dep-popover__warning dep-popover__warning--error"
        >
          <i class="icon icon-warning mr-5" />
          {{ t('appsPlus.dependencies.missingWarning', { deps: missingDependencies.join(', ') }) }}
        </div>
        <div
          v-if="uninstalledDependencies.length"
          class="dep-popover__warning"
        >
          <i class="icon icon-info mr-5" />
          {{ t('appsPlus.dependencies.uninstalledWarning', { deps: uninstalledDependencies.join(', ') }) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dep-cell {
  position: relative;
  display: inline-block;
}

.dep-trigger {
  display: inline-flex;
  align-items: center;
  padding: 4px 6px;
  border-radius: var(--border-radius);
  background: transparent;
  border: 1px solid transparent;
  color: var(--link);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background: var(--box-bg);
    border-color: var(--border);
  }

  &--warning {
    background: var(--warning-badge, var(--warning-banner));
    color: var(--on-warning-banner);
  }
}

.dep-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  min-width: 280px;
  padding: 12px;
  text-align: left;
  background: var(--body-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);

  &--right {
    left: auto;
    right: 0;
  }

  &__header {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);

    &--spaced {
      margin-top: 10px;
    }
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 180px;
    overflow-y: auto;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 0;
    font-family: monospace;
    font-size: 12px;
  }

  &__warnings {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__warning {
    padding: 6px 8px;
    border-radius: var(--border-radius);
    background: var(--warning-badge, var(--warning-banner));
    color: var(--on-warning-banner);
    font-size: 12px;
    line-height: 1.4;

    &--error {
      background: var(--error-banner-bg, rgba(208, 2, 27, 0.15));
      color: var(--error);
    }
  }
}
</style>
