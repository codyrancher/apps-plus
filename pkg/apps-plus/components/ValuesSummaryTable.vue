<script>
import { Banner } from '@components/Banner';
import { isSet } from '../render';

export default {
  name: 'ValuesSummaryTable',

  components: { Banner },

  props: {
    app: {
      type:    Object,
      default: null,
    },
    rows: {
      type:    Array,
      default: () => [],
    },
    undeclared: {
      type:    Array,
      default: () => [],
    },
    showOverrides: {
      type:    Boolean,
      default: false,
    },
  },

  methods: {
    hasValue(row, key) {
      return isSet(row, key);
    },
  },
};
</script>

<template>
  <div>
    <Banner
      v-for="reference in undeclared"
      :key="reference.file"
      color="warning"
    >
      {{ t('appsPlus.values.undeclared', reference) }}
      <router-link
        v-if="app?.canCustomEdit"
        :to="app.editLocation"
      >
        {{ t('appsPlus.values.undeclaredDeclareEdit', { app: app.nameDisplay }) }}
      </router-link>
    </Banner>
    <table
      v-if="rows.length"
      class="values-table"
    >
      <thead>
        <tr>
          <th>{{ t('appsPlus.values.key') }}</th>
          <th>{{ t('appsPlus.values.default') }}</th>
          <th v-if="showOverrides">
            {{ t('appsPlus.values.override') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>
            <code>{{ row.name }}</code>
          </td>
          <td>
            <span v-if="hasValue(row, 'default')">{{ row.default }}</span>
            <span
              v-else
              class="text-muted"
            >{{ showOverrides ? '—' : t('appsPlus.instance.valueNoDefault') }}</span>
          </td>
          <td v-if="showOverrides">
            <span v-if="hasValue(row, 'override')">{{ row.override }}</span>
            <span
              v-else
              class="text-muted"
            >—</span>
          </td>
        </tr>
      </tbody>
    </table>
    <Banner
      v-else-if="!undeclared.length"
      color="info"
      :label="t('appsPlus.values.none')"
    />
  </div>
</template>

<style lang="scss" scoped>
.values-table {
  border-collapse: collapse;
  min-width: 50%;

  th {
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    color: var(--muted);
    padding: 6px 24px 6px 0;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 8px 24px 8px 0;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
}
</style>
