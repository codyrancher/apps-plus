<script>
import AppModal from '@shell/components/AppModal.vue';
import Tabbed from '@shell/components/Tabbed';
import Tab from '@shell/components/Tabbed/Tab';
import { LabeledInput } from '@components/Form/LabeledInput';
import { RcButton } from '@components/RcButton';
import { Banner } from '@components/Banner';
import DependenciesPopover from './DependenciesPopover.vue';
import DependenciesEditor from './DependenciesEditor.vue';
import {
  APP,
  APP_INSTANCE,
  DEPENDENCIES_ANNOTATION,
  DEPENDS_ON_ANNOTATION,
  DEPENDS_ON_LABEL_PREFIX,
  parseDependencyList,
} from '../config/types';
import {
  fetchHelmRepoIndex,
  fetchHelmChartDetails,
  extractChartImplicitDependencies,
  normalizeHelmRepoUrl,
} from '../helm';

export default {
  name: 'ImportHelmChartModal',

  components: {
    AppModal,
    Tabbed,
    Tab,
    LabeledInput,
    RcButton,
    Banner,
    DependenciesPopover,
    DependenciesEditor,
  },

  emits: ['close', 'imported'],

  data() {
    return {
      repoUrl:           '',
      charts:            [],
      loadingIndex:      false,
      importing:         false,
      error:             '',
      debounceTimer:     null,
      openDepPopoverKey: null,
      selectedChartName: '',
      addedDeps:         {},
      removedDeps:       {},
    };
  },

  computed: {
    canImport() {
      return !!this.repoUrl?.trim() && !this.importing;
    },

    existingAppsByName() {
      const existingApps = this.$store.getters['management/all'](APP) || [];

      return Object.fromEntries(existingApps.map((app) => [app.metadata?.name, app]));
    },

    previewAppsByName() {
      const byName = { ...this.existingAppsByName };

      this.charts.forEach((chart) => {
        if (chart.name && !byName[chart.name]) {
          byName[chart.name] = { metadata: { name: chart.name } };
        }
      });

      return byName;
    },

    availableAppNames() {
      return Object.keys(this.previewAppsByName).filter(Boolean);
    },

    existingAppNamesSet() {
      return new Set(this.availableAppNames);
    },

    installedAppNames() {
      const instances = this.$store.getters['management/all'](APP_INSTANCE) || [];

      return new Set(
        instances
          .filter((inst) => !inst.isTerminating && inst.spec?.app)
          .map((inst) => inst.spec.app)
      );
    },

    chartSummaries() {
      return this.charts.map((chart) => {
        const latest = chart.versions?.[0];
        const versions = (chart.versions || []).map((v) => v.version).filter(Boolean);
        const explicit = this.explicitDepsFor(chart.name);
        const implicit = this.implicitDepsFor(chart.name);
        const deps = [...new Set([...explicit, ...implicit])];
        const missing = deps.filter((dep) => !this.previewAppsByName[dep]);

        return {
          name:        chart.name,
          description: chart.description || latest?.description || '',
          versions,
          deps,
          explicit,
          implicit,
          verRow:      { _key: `import-ver-${ chart.name }` },
          depRow:      {
            _key: `import-dep-${ chart.name }`,
            app:  {
              dependencies:        deps,
              missingDependencies: missing,
            },
          },
        };
      });
    },

    selectedChartSummary() {
      return this.chartSummaries.find((c) => c.name === this.selectedChartName) || this.chartSummaries[0] || null;
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
        this.selectedChartName = '';
        this.addedDeps = {};
        this.removedDeps = {};

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
    explicitDepsFor(chartName) {
      const removed = new Set(this.removedDeps[chartName] || []);
      const existing = this.existingAppsByName[chartName]?.explicitDependencies || [];
      const added = this.addedDeps[chartName] || [];

      return [...new Set([...existing, ...added])].filter((d) => d && d !== chartName && !removed.has(d));
    },

    implicitDepsFor(chartName) {
      const chart = this.charts.find((c) => c.name === chartName);
      const latest = chart?.versions?.[0];
      const removed = new Set(this.removedDeps[chartName] || []);
      const existingImplicit = this.existingAppsByName[chartName]?.implicitDependencies || [];
      const rawImplicit = [...new Set([...extractChartImplicitDependencies(latest), ...existingImplicit])];

      return rawImplicit.filter((d) => d && d !== chartName && !removed.has(d));
    },

    addChartDependency(chartName, depName) {
      if (!chartName || !depName || chartName === depName) {
        return;
      }

      const currentAdded = this.addedDeps[chartName] || [];

      if (!currentAdded.includes(depName)) {
        this.addedDeps = {
          ...this.addedDeps,
          [chartName]: [...currentAdded, depName],
        };
      }

      const currentRemoved = this.removedDeps[chartName] || [];

      if (currentRemoved.includes(depName)) {
        this.removedDeps = {
          ...this.removedDeps,
          [chartName]: currentRemoved.filter((d) => d !== depName),
        };
      }
    },

    removeChartDependency(chartName, depName) {
      if (!chartName || !depName) {
        return;
      }

      const currentAdded = this.addedDeps[chartName] || [];

      if (currentAdded.includes(depName)) {
        this.addedDeps = {
          ...this.addedDeps,
          [chartName]: currentAdded.filter((d) => d !== depName),
        };
      }

      const currentRemoved = this.removedDeps[chartName] || [];

      if (!currentRemoved.includes(depName)) {
        this.removedDeps = {
          ...this.removedDeps,
          [chartName]: [...currentRemoved, depName],
        };
      }
    },

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
        this.addedDeps = {};
        this.removedDeps = {};

        if (!loaded.length) {
          this.selectedChartName = '';
          this.error = 'No charts found in that repository.';
        } else if (!this.selectedChartName || !loaded.some((c) => c.name === this.selectedChartName)) {
          this.selectedChartName = loaded[0].name;
        }

        return loaded;
      } catch (e) {
        this.charts = [];
        this.selectedChartName = '';
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
        const repoUrl = normalizeHelmRepoUrl(this.repoUrl);
        let charts = this.charts;

        if (!charts.length) {
          charts = await fetchHelmRepoIndex({ repoUrl });
          this.charts = charts;
          if (charts.length && !this.selectedChartName) {
            this.selectedChartName = charts[0].name;
          }
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

          const removed = new Set(this.removedDeps[name] || []);
          const added = this.addedDeps[name] || [];
          const filteredImplicit = (details.implicitDependencies || []).filter((d) => d && d !== name && !removed.has(d));

          const annotations = { ...(details.annotations || {}) };

          if (description) {
            annotations['field.cattle.io/description'] = description;
          }

          [DEPENDENCIES_ANNOTATION, DEPENDS_ON_ANNOTATION].forEach((key) => {
            if (annotations[key]) {
              const remaining = parseDependencyList(annotations[key]).filter((d) => !removed.has(d));

              if (remaining.length) {
                annotations[key] = remaining.join(',');
              } else {
                delete annotations[key];
              }
            }
          });

          if (filteredImplicit.length > 0 && !annotations[DEPENDENCIES_ANNOTATION]) {
            annotations[DEPENDENCIES_ANNOTATION] = filteredImplicit.join(',');
          }

          const existing = await this.$store
            .dispatch('management/find', { type: APP, id: name, opt: { force: true } })
            .catch(() => null);

          if (existing) {
            const mergedAnnotations = {
              ...(existing.metadata?.annotations || {}),
              ...annotations,
            };
            const mergedLabels = {
              ...(existing.metadata?.labels || {}),
              'appsplus.io/chart': chart.name,
            };

            [mergedAnnotations, mergedLabels].forEach((bag) => {
              [DEPENDENCIES_ANNOTATION, DEPENDS_ON_ANNOTATION].forEach((key) => {
                if (bag[key]) {
                  const remaining = parseDependencyList(bag[key]).filter((d) => !removed.has(d));

                  if (remaining.length) {
                    bag[key] = remaining.join(',');
                  } else {
                    delete bag[key];
                  }
                }
              });

              removed.forEach((dep) => {
                delete bag[`${ DEPENDS_ON_LABEL_PREFIX }${ dep }`];
              });
            });

            const existingDeps = Array.isArray(existing.spec?.dependencies) ? existing.spec.dependencies : [];
            const finalDeps = [...new Set([...existingDeps, ...filteredImplicit, ...added])]
              .filter((d) => d && d !== name && !removed.has(d));

            existing.metadata.annotations = mergedAnnotations;
            existing.metadata.labels = mergedLabels;
            existing.spec = {
              ...(existing.spec || {}),
              description:  description || existing.spec?.description || '',
              helm,
              values:       {
                ...(details.values || {}),
                ...(existing.spec?.values || {}),
              },
              templates:    details.files?.length ? details.files : (existing.spec?.templates || []),
              dependencies: finalDeps,
            };

            const saved = await existing.save();

            savedApps.push(saved);
          } else {
            const finalDeps = [...new Set([...filteredImplicit, ...added])]
              .filter((d) => d && d !== name && !removed.has(d));

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
                dependencies: finalDeps,
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
    :width="680"
    name="import-helm-chart"
    @close="$emit('close')"
  >
    <div
      class="import-helm"
      data-testid="import-helm-modal"
      @click="openDepPopoverKey = null"
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

      <Tabbed
        v-if="chartSummaries.length"
        class="mb-15"
      >
        <Tab
          name="charts"
          :label="t('appsPlus.helm.chartsTab')"
          :weight="2"
        >
          <div
            class="import-helm__preview"
            data-testid="helm-charts-preview"
          >
            <div class="import-helm__preview-title">
              {{ t('appsPlus.helm.chartsFound', { count: chartSummaries.length }) }}
            </div>
            <table class="import-helm__table">
              <thead>
                <tr>
                  <th>{{ t('appsPlus.headers.chart') }}</th>
                  <th class="import-helm__col-indicator">
                    {{ t('appsPlus.headers.versions') }}
                  </th>
                  <th class="import-helm__col-indicator">
                    {{ t('appsPlus.headers.dependencies') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in chartSummaries"
                  :key="item.name"
                  class="import-helm__chart-item"
                >
                  <td>
                    <strong>{{ item.name }}</strong>
                    <div
                      v-if="item.description"
                      class="text-muted text-small"
                    >
                      {{ item.description }}
                    </div>
                  </td>
                  <td class="import-helm__col-indicator">
                    <DependenciesPopover
                      :row="item.verRow"
                      :versions="item.versions"
                      :open-key="openDepPopoverKey"
                      align="right"
                      @toggle="openDepPopoverKey = $event"
                    />
                  </td>
                  <td class="import-helm__col-indicator">
                    <DependenciesPopover
                      :row="item.depRow"
                      :apps-by-name="previewAppsByName"
                      :installed-app-names="installedAppNames"
                      :open-key="openDepPopoverKey"
                      align="right"
                      @toggle="openDepPopoverKey = $event"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Tab>

        <Tab
          name="dependencies"
          :label="t('appsPlus.app.dependencies')"
          :weight="1"
        >
          <div
            v-if="chartSummaries.length > 1"
            class="import-helm__chart-selector mb-15"
          >
            <span class="import-helm__chart-selector-label">
              {{ t('appsPlus.helm.selectChartForDeps') }}
            </span>
            <div class="import-helm__chart-pills">
              <button
                v-for="item in chartSummaries"
                :key="item.name"
                type="button"
                class="import-helm__chart-pill"
                :class="{ 'import-helm__chart-pill--active': selectedChartSummary?.name === item.name }"
                :data-testid="`import-dep-chart-${ item.name }`"
                @click="selectedChartName = item.name"
              >
                <span>{{ item.name }}</span>
                <span class="import-helm__chart-pill-count">{{ item.deps.length }}</span>
              </button>
            </div>
          </div>

          <DependenciesEditor
            v-if="selectedChartSummary"
            mode="edit"
            :self-name="selectedChartSummary.name"
            :explicit-dependencies="selectedChartSummary.explicit"
            :implicit-dependencies="selectedChartSummary.implicit"
            :available-app-names="availableAppNames"
            :existing-app-names="existingAppNamesSet"
            @add="addChartDependency(selectedChartSummary.name, $event)"
            @remove="removeChartDependency(selectedChartSummary.name, $event)"
          />
        </Tab>
      </Tabbed>

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
  }

  &__preview-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 8px;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;

    th {
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      padding: 4px 8px 6px 0;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 8px 8px 8px 0;
      vertical-align: middle;
      border-bottom: 1px solid var(--border);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }
  }

  &__col-indicator {
    width: 110px;
    text-align: center !important;
    padding-right: 0 !important;
  }

  &__chart-selector {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__chart-selector-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }

  &__chart-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  &__chart-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
    font-family: monospace;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--body-bg);
    color: var(--body-text);
    cursor: pointer;

    &:hover {
      border-color: var(--link);
    }

    &--active {
      background: var(--accent-btn);
      border-color: var(--link);
      color: var(--link);
      font-weight: 600;
    }
  }

  &__chart-pill-count {
    font-size: 11px;
    padding: 0 5px;
    border-radius: 10px;
    background: var(--wm-tab-bg, rgba(128, 128, 128, 0.15));
  }

  &__buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
}
</style>
