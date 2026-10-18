<script>
import AppModal from '@shell/components/AppModal.vue';
import { LabeledInput } from '@components/Form/LabeledInput';
import { RcButton } from '@components/RcButton';
import { Banner } from '@components/Banner';
import { APP, DEPENDENCIES_ANNOTATION } from '../config/types';
import {
  fetchHelmRepoIndex,
  fetchHelmChartDetails,
  extractChartImplicitDependencies,
} from '../helm';

export default {
  name: 'ImportHelmChartModal',

  components: {
    AppModal,
    LabeledInput,
    RcButton,
    Banner,
  },

  emits: ['close', 'imported'],

  data() {
    return {
      repoUrl:       '',
      charts:        [],
      loadingIndex:  false,
      importing:     false,
      error:         '',
      debounceTimer: null,
    };
  },

  computed: {
    canImport() {
      return !!this.repoUrl?.trim() && !this.importing;
    },

    chartSummaries() {
      return this.charts.map((chart) => {
        const latest = chart.versions?.[0];
        const versions = (chart.versions || []).map((v) => v.version).filter(Boolean);
        const deps = extractChartImplicitDependencies(latest);

        return {
          name:        chart.name,
          description: chart.description || latest?.description || '',
          versions,
          deps,
        };
      });
    },
  },

  watch: {
    repoUrl(val) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      const trimmed = (val || '').trim();

      if (!trimmed || !/^https?:\/\/.+/i.test(trimmed)) {
        this.charts = [];

        return;
      }

      this.debounceTimer = setTimeout(() => {
        this.loadCharts();
      }, 400);
    },
  },

  beforeUnmount() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  },

  methods: {
    async loadCharts() {
      const url = this.repoUrl?.trim();

      if (!url) {
        return [];
      }

      this.loadingIndex = true;
      this.error = '';

      try {
        const loaded = await fetchHelmRepoIndex({ repoUrl: url });

        this.charts = loaded;
        if (!loaded.length) {
          this.error = 'No charts found in that repository.';
        }

        return loaded;
      } catch (e) {
        this.charts = [];
        this.error = `Could not load Helm repository: ${ e.message }`;

        return [];
      } finally {
        this.loadingIndex = false;
      }
    },

    async importAllCharts() {
      if (!this.canImport) {
        return;
      }

      this.importing = true;
      this.error = '';

      try {
        const repoUrl = this.repoUrl.trim().replace(/\/+$/, '').replace(/\/index\.yaml$/, '');
        let charts = this.charts;

        if (!charts.length) {
          charts = await fetchHelmRepoIndex({ repoUrl });
          this.charts = charts;
        }

        if (!charts.length) {
          throw new Error('No charts found in that repository.');
        }

        const savedApps = [];

        for (const chart of charts) {
          const latestEntry = chart.versions[0];

          if (!latestEntry) {
            continue;
          }

          const allVersions = chart.versions.map((v) => v.version).filter(Boolean);
          const details = await fetchHelmChartDetails({
            repoUrl,
            chartName:    chart.name,
            versionEntry: latestEntry,
          });

          const name = chart.name.trim();
          const description = latestEntry.description || chart.description || '';
          const helm = {
            repo:        repoUrl,
            chart:       chart.name,
            version:     latestEntry.version,
            versions:    allVersions,
            releaseName: name,
          };

          const annotations = { ...(details.annotations || {}) };

          if (description) {
            annotations['field.cattle.io/description'] = description;
          }
          if (details.implicitDependencies.length > 0 && !annotations[DEPENDENCIES_ANNOTATION]) {
            annotations[DEPENDENCIES_ANNOTATION] = details.implicitDependencies.join(',');
          }

          const existing = await this.$store
            .dispatch('management/find', { type: APP, id: name, opt: { force: true } })
            .catch(() => null);

          if (existing) {
            existing.metadata.annotations = {
              ...(existing.metadata.annotations || {}),
              ...annotations,
            };
            existing.metadata.labels = {
              ...(existing.metadata.labels || {}),
              'appsplus.io/chart': chart.name,
            };
            existing.spec = {
              ...(existing.spec || {}),
              description: description || existing.spec?.description || '',
              helm,
              values:      {
                ...(details.values || {}),
                ...(existing.spec?.values || {}),
              },
              templates: details.files?.length ? details.files : (existing.spec?.templates || []),
            };

            const saved = await existing.save();

            savedApps.push(saved);
          } else {
            const app = await this.$store.dispatch('management/create', {
              type:     APP,
              metadata: {
                name,
                annotations,
                labels: {
                  'appsplus.io/chart': chart.name,
                },
              },
              spec: {
                description,
                helm,
                values:       details.values || {},
                templates:    details.files || [],
                dependencies: details.implicitDependencies || [],
              },
            });

            const saved = await app.save();

            savedApps.push(saved);
          }
        }

        this.$emit('imported', savedApps);
        this.$emit('close');
      } catch (e) {
        this.error = `Could not import Helm charts: ${ e.message }`;
      } finally {
        this.importing = false;
      }
    },
  },
};
</script>

<template>
  <AppModal
    :width="600"
    name="import-helm-chart"
    @close="$emit('close')"
  >
    <div
      class="import-helm"
      data-testid="import-helm-modal"
    >
      <h4 class="import-helm__title">
        {{ t('appsPlus.helm.importTitle') }}
      </h4>

      <Banner
        color="info"
        :label="t('appsPlus.helm.importHint')"
      />

      <LabeledInput
        v-model:value="repoUrl"
        class="mb-15"
        data-testid="helm-repo-url-input"
        :label="t('appsPlus.helm.repoUrl')"
        :placeholder="t('appsPlus.helm.repoUrlPlaceholder')"
        @keyup.enter="importAllCharts"
      />

      <div
        v-if="loadingIndex"
        class="text-muted mb-10"
      >
        {{ t('appsPlus.helm.loadingCharts') }}
      </div>

      <div
        v-if="chartSummaries.length"
        class="import-helm__preview mb-15"
        data-testid="helm-charts-preview"
      >
        <div class="import-helm__preview-title">
          {{ t('appsPlus.helm.chartsFound', { count: chartSummaries.length }) }}
        </div>
        <ul class="import-helm__chart-list">
          <li
            v-for="item in chartSummaries"
            :key="item.name"
            class="import-helm__chart-item"
          >
            <div class="import-helm__chart-head">
              <strong>{{ item.name }}</strong>
              <span class="text-muted ml-10">
                {{ item.versions.join(', ') }}
              </span>
              <span
                v-if="item.deps.length"
                class="import-helm__dep-pill ml-10"
              >
                {{ t('appsPlus.list.dependsOn', { deps: item.deps.join(', ') }) }}
              </span>
            </div>
            <div
              v-if="item.description"
              class="text-muted text-small"
            >
              {{ item.description }}
            </div>
          </li>
        </ul>
      </div>

      <Banner
        v-if="error"
        color="error"
        :label="error"
      />

      <div class="import-helm__buttons">
        <RcButton
          variant="secondary"
          @click="$emit('close')"
        >
          {{ t('generic.cancel') }}
        </RcButton>
        <RcButton
          variant="primary"
          data-testid="helm-import-confirm"
          :disabled="!canImport"
          @click="importAllCharts"
        >
          {{ importing ? t('appsPlus.helm.importing') : t('appsPlus.helm.importAction') }}
        </RcButton>
      </div>
    </div>
  </AppModal>
</template>

<style lang="scss" scoped>
.import-helm {
  padding: 16px;

  &__title {
    margin-bottom: 12px;
  }

  &__preview {
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    padding: 10px 12px;
    max-height: 220px;
    overflow-y: auto;
  }

  &__preview-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 8px;
  }

  &__chart-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  &__chart-item {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);

    &:last-child {
      border-bottom: none;
    }
  }

  &__chart-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  &__dep-pill {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: var(--border-radius);
    background: var(--box-bg);
    border: 1px solid var(--border);
  }

  &__buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
}
</style>
