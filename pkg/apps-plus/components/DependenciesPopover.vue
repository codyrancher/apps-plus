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
  },

  emits: ['toggle'],

  computed: {
    rowKey() {
      return this.row._key || this.row.id;
    },

    isOpen() {
      return this.openKey === this.rowKey;
    },

    dependencies() {
      return this.row?.app?.dependencies || [];
    },

    missingDependencies() {
      return this.row?.app?.missingDependencies || [];
    },

    uninstalledDependencies() {
      const missing = new Set(this.missingDependencies);

      return this.dependencies.filter((dep) => !missing.has(dep) && !this.installedAppNames.has(dep));
    },

    hasWarnings() {
      return this.missingDependencies.length > 0 || this.uninstalledDependencies.length > 0;
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
  <span
    v-if="!dependencies.length"
    class="text-muted"
  >
    —
  </span>
  <div
    v-else
    class="dep-cell"
    @click.stop
  >
    <button
      type="button"
      class="dep-trigger"
      :class="{ 'dep-trigger--warning': hasWarnings }"
      data-testid="dependencies-trigger"
      @click="toggle"
    >
      <span>
        {{ dependencies.length === 1 ? dependencies[0] : dependencies.length }}
      </span>
      <i
        v-if="hasWarnings"
        class="icon icon-warning ml-5"
      />
    </button>

    <div
      v-if="isOpen"
      class="dep-popover"
      data-testid="dependencies-popover"
    >
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
  padding: 2px 10px;
  border-radius: 12px;
  background: var(--box-bg);
  border: 1px solid var(--border);
  color: var(--body-text);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--link);
    color: var(--link);
  }

  &--warning {
    border-color: var(--warning);
  }
}

.dep-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  min-width: 280px;
  padding: 12px;
  background: var(--body-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);

  &__header {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
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
    font-size: 12px;
    color: var(--warning);

    &--error {
      color: var(--error);
    }
  }
}
</style>
