<script>
import SortableTable from '@shell/components/SortableTable';
import { Banner } from '@components/Banner';
import { BadgeState } from '@components/BadgeState';
import { RELATED_HEADERS } from '../config/types';

export default {
  name: 'RelatedResourcesTable',

  components: {
    SortableTable,
    Banner,
    BadgeState,
  },

  props: {
    rows: {
      type:    Array,
      default: () => [],
    },
    hint: {
      type:    String,
      default: '',
    },
  },

  computed: {
    headers() {
      return RELATED_HEADERS;
    },
  },
};
</script>

<template>
  <div>
    <Banner
      v-if="hint"
      color="info"
      :label="hint"
    />
    <SortableTable
      :rows="rows"
      :headers="headers"
      key-field="key"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      data-testid="related-resources-table"
    >
      <template #cell:state="{row}">
        <BadgeState
          :color="row.stateColor"
          :label="row.stateLabel"
        />
      </template>
      <template #cell:name="{row}">
        <router-link
          v-if="row.to"
          :to="row.to"
        >
          {{ row.name }}
        </router-link>
        <span v-else>{{ row.name }}</span>
      </template>
    </SortableTable>
  </div>
</template>
