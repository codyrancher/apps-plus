<script>
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';

export default {
  name: 'BlockedDeleteModal',

  components: {
    Banner,
    RcButton,
  },

  data() {
    return { instance: null };
  },

  mounted() {
    if (typeof window !== 'undefined') {
      window.addEventListener('appsplus:blocked-delete', this.onBlockedDelete);
    }
  },

  beforeUnmount() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('appsplus:blocked-delete', this.onBlockedDelete);
    }
  },

  methods: {
    onBlockedDelete(event) {
      const instance = event?.detail?.instance;

      if (instance) {
        this.instance = instance;
      }
    },

    close() {
      this.instance = null;
    },
  },
};
</script>

<template>
  <div
    v-if="instance"
    class="dep-modal-backdrop"
    data-testid="dependency-delete-warning-modal"
    @click.self="close"
  >
    <div class="dep-modal">
      <div class="dep-modal__header">
        <h3>{{ t('appsPlus.dependencies.cannotDeleteTitle', { name: instance.nameDisplay }) }}</h3>
      </div>
      <div class="dep-modal__body">
        <Banner
          color="warning"
          :label="t('appsPlus.dependencies.cannotDeleteWarning', { name: instance.nameDisplay, app: instance.appDisplay })"
        />
        <p class="mt-10 mb-10">
          {{ t('appsPlus.dependencies.reliedOnByLabel') }}
        </p>
        <ul class="dep-modal__links">
          <li
            v-for="depInst in instance.dependentInstances"
            :key="depInst.metadata.name"
          >
            <router-link
              :to="depInst.detailLocation"
              data-testid="dependent-instance-link"
              @click="close"
            >
              {{ depInst.nameDisplay }} ({{ depInst.appDisplay }})
            </router-link>
          </li>
        </ul>
      </div>
      <div class="dep-modal__footer">
        <RcButton
          variant="primary"
          data-testid="close-dependency-warning-btn"
          @click="close"
        >
          {{ t('generic.close') }}
        </RcButton>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dep-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dep-modal {
  background: var(--body-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  width: 520px;
  max-width: 92vw;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);

  &__header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);

    h3 {
      margin: 0;
      font-size: 18px;
    }
  }

  &__body {
    padding: 20px;
  }

  &__links {
    margin: 0;
    padding-left: 20px;

    li {
      margin-bottom: 6px;
      font-family: monospace;
    }
  }

  &__footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
  }
}
</style>
