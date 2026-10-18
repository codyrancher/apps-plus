<script>
import KeyValue from '@shell/components/form/KeyValue';
import { typedOverrides } from '../render';

export default {
  name: 'ValuesEditor',

  components: { KeyValue },

  props: {
    value: {
      type:    Object,
      default: () => ({}),
    },

    mode: {
      type:     String,
      required: true,
    },

    keys: {
      type:    Array,
      default: () => [],
    },

    placeholder: {
      type:    String,
      default: '',
    },
  },

  emits: ['update:value'],

  computed: {
    keyOptions() {
      return this.keys.map((key) => ({ label: key, value: key }));
    },

    shown() {
      return Object.entries(this.value || {}).reduce((out, [key, value]) => {
        out[key] = value === undefined || value === null ? '' : String(value);

        return out;
      }, {});
    },

    stale() {
      if (!this.keys.length) {
        return {};
      }

      const used = new Set(this.keys);

      return Object.keys(this.value || {}).reduce((acc, key) => {
        if (key && !used.has(key)) {
          acc[key] = this.t('appsPlus.values.unused', { key });
        }

        return acc;
      }, {});
    },
  },

  methods: {
    merged(edited) {
      return typedOverrides(this.value || {}, edited, true);
    },
  },
};
</script>

<template>
  <KeyValue
    class="values-editor"
    :value="shown"
    :mode="mode"
    :read-allowed="false"
    :as-map="true"
    :value-can-be-empty="true"
    :key-options="keyOptions"
    :key-taggable="true"
    :key-option-unique="true"
    :key-errors="stale"
    :key-placeholder="placeholder"
    @update:value="v => $emit('update:value', merged(v))"
  >
    <template #add="{ add }">
      <button
        type="button"
        class="btn role-tertiary add"
        data-testid="values-editor-add"
        @click="add()"
      >
        <i class="mr-5 icon icon-plus" /> {{ t('generic.add') }}
      </button>
    </template>
  </KeyValue>
</template>

<style lang="scss" scoped>
.values-editor :deep(.kv-item.key) {
  .unlabeled-select {
    height: 40px;
    min-height: 40px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .v-select,
  .vs__dropdown-toggle {
    height: 100%;
    min-height: 0;
  }

  .vs__selected-options {
    padding-top: 0;
    align-items: center;
  }
}
</style>
