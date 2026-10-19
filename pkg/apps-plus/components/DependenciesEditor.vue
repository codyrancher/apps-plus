<script>
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';
import { _VIEW } from '@shell/config/query-params';

export default {
  name: 'DependenciesEditor',

  components: {
    LabeledSelect,
    Banner,
    RcButton,
  },

  props: {
    mode: {
      type:    String,
      default: 'edit',
    },
    selfName: {
      type:    String,
      default: '',
    },
    explicitDependencies: {
      type:    Array,
      default: () => [],
    },
    implicitDependencies: {
      type:    Array,
      default: () => [],
    },
    availableAppNames: {
      type:    Array,
      default: () => [],
    },
    existingAppNames: {
      type:    Object,
      default: () => new Set(),
    },
  },

  emits: ['add', 'remove'],

  data() {
    return { newDependency: '' };
  },

  computed: {
    isView() {
      return this.mode === _VIEW;
    },

    allDependencies() {
      const explicitSet = new Set(this.explicitDependencies);
      const implicitSet = new Set(this.implicitDependencies);
      const combined = [...new Set([...this.explicitDependencies, ...this.implicitDependencies])];

      return combined.map((name) => ({
        name,
        explicit: explicitSet.has(name),
        implicit: implicitSet.has(name),
        exists:   this.existingAppNames.has(name),
      }));
    },

    dependencyOptions() {
      const currentDeps = new Set(this.allDependencies.map((d) => d.name));

      return [...new Set(this.availableAppNames)]
        .filter((name) => name && name !== this.selfName && !currentDeps.has(name))
        .sort()
        .map((name) => ({
          label: name,
          value: name,
        }));
    },
  },

  methods: {
    addDependency() {
      const raw = typeof this.newDependency === 'object' ? this.newDependency?.value || this.newDependency?.label : this.newDependency;
      const name = String(raw || '').trim();

      if (!name || name === this.selfName) {
        return;
      }

      this.$emit('add', name);
      this.newDependency = '';
    },
  },
};
</script>

<template>
  <div class="dependencies-editor">
    <Banner
      color="info"
      :label="t('appsPlus.dependencies.hint')"
    />

    <div
      v-if="!isView"
      class="dependencies-add mb-20"
    >
      <LabeledSelect
        v-model:value="newDependency"
        class="dependencies-add__select"
        :mode="mode"
        :options="dependencyOptions"
        :taggable="true"
        :searchable="true"
        :label="t('appsPlus.dependencies.selectLabel')"
        :placeholder="t('appsPlus.dependencies.selectPlaceholder')"
        data-testid="dependency-select"
      />
      <RcButton
        variant="secondary"
        class="dependencies-add__btn"
        :disabled="!newDependency"
        data-testid="add-dependency-btn"
        @click="addDependency"
      >
        {{ t('appsPlus.dependencies.add') }}
      </RcButton>
    </div>

    <div
      v-if="allDependencies.length"
      class="dependencies-list"
    >
      <div
        v-for="dep in allDependencies"
        :key="dep.name"
        class="dependencies-list__row"
        data-testid="dependency-row"
      >
        <div class="dependencies-list__info">
          <span class="dependencies-list__name">{{ dep.name }}</span>
          <span
            v-if="dep.implicit"
            class="dependencies-list__badge"
          >
            {{ t('appsPlus.dependencies.implicit') }}
          </span>
          <span
            class="dependencies-list__status"
            :class="dep.exists ? 'dependencies-list__status--ok' : 'dependencies-list__status--missing'"
          >
            {{ dep.exists ? t('appsPlus.dependencies.exists') : t('appsPlus.dependencies.notFound') }}
          </span>
        </div>
        <RcButton
          v-if="!isView"
          variant="tertiary"
          size="sm"
          data-testid="remove-dependency-btn"
          @click="$emit('remove', dep.name)"
        >
          {{ t('appsPlus.dependencies.remove') }}
        </RcButton>
      </div>
    </div>
    <Banner
      v-else
      color="info"
      :label="t('appsPlus.dependencies.empty')"
    />
  </div>
</template>

<style lang="scss" scoped>
.dependencies-add {
  display:     flex;
  align-items: center;
  gap:         10px;

  &__select {
    flex: 1;
  }

  &__btn {
    white-space: nowrap;
  }
}

.dependencies-list {
  border:        1px solid var(--border);
  border-radius: var(--border-radius);
  overflow:      hidden;

  &__row {
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         10px 14px;
    border-bottom:   1px solid var(--border);

    &:last-child {
      border-bottom: none;
    }
  }

  &__info {
    display:     flex;
    align-items: center;
    gap:         10px;
  }

  &__name {
    font-family: monospace;
    font-weight: 600;
  }

  &__badge {
    font-size:     11px;
    padding:       1px 8px;
    border-radius: var(--border-radius);
    background:    var(--accent-btn);
    color:         var(--link);
    border:        1px solid var(--link);
  }

  &__status {
    font-size:     11px;
    padding:       1px 8px;
    border-radius: var(--border-radius);

    &--ok {
      background: var(--success-banner-bg, rgba(46, 160, 67, 0.15));
      color:      var(--success);
    }

    &--missing {
      background: var(--warning-badge, var(--warning-banner));
      color:      var(--on-warning-banner);
    }
  }
}
</style>
