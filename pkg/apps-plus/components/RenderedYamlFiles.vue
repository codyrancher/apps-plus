<script>
export default {
  name: 'RenderedYamlFiles',

  props: {
    files: {
      type:    Array,
      default: () => [],
    },
  },
};
</script>

<template>
  <div>
    <div
      v-for="file in files"
      :key="file.name"
      class="rendered"
    >
      <div class="rendered__name">
        {{ file.name }}
      </div>
      <pre class="rendered__body">{{ file.content }}</pre>
    </div>
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
