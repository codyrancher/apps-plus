<script>
import AppModal from '@shell/components/AppModal';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';
import {
  APP,
  CATALOG_CLUSTER_REPO,
  DEPENDENCIES_ANNOTATION,
} from '../config/types';
import {
  fetchHelmRepoIndex,
  fetchHelmChartDetails,
  extractChartImplicitDependencies,
} from '../helm';

export default {
  name: 'ImportHelmChartModal',

  components: {
    AppModal,
    LabeledSelect,
    LabeledInput,
    Banner,
    RcButton,
  },

  props: {
    /**
     * When true (default, used on the Apps list page), importing creates and saves a new
     * `appsplus.io.app` resource directly. When false (used on the App create/edit page),
     * importing emits the chart details so the open form can populate itself.
     */
    createApp: {
      type:    Boolean,
      default: true,
    },
  },

  emits: ['close', 'imported'],

  async fetch() {
    const repos = await this.$store
      .dispatch('management/findAll', { type: CATALOG_CLUSTER_REPO })
      .catch(() => []);

    this.clusterRepos = (repos || [])
      .filter((r) => r.spec?.url)
      .map((r) => ({
        label: `${ r.metadata.name } (${ r.spec.url })`,
        value: r.metadata.name,
        url:   r.spec.url,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  data() {
    return {
      clusterRepos: [],
      clusterRepo:  '',
      repoUrl:      '',
      charts:       [],
      chartName:    '',
      version:      '',
      appName:      '',
      loadingIndex: false,
      importing:    false,
      error:        '',
    };
  },

  watch: {
    clusterRepo(name) {
      if (!name) {
        return;
      }

      const found = this.clusterRepos.find((r) => r.value === name);

      if (found?.url) {
        this.repoUrl = found.url;
        this.loadCharts();
      }
    },

    chartName(name) {
      const entry = this.selectedChart;

      this.version = entry?.versions?.[0]?.version || '';
      if (name) {
        this.appName = name;
      }
    },
  },

  computed: {
    chartOptions() {
      return this.charts.map((c) => ({
        label:       c.description ? `${ c.name } — ${ c.description }` : c.name,
        value:       c.name,
        name:        c.name,
        description: c.description,
      }));
    },

    selectedChart() {
      return this.charts.find((c) => c.name === this.chartName) || null;
    },

    versionOptions() {
      return (this.selectedChart?.versions || []).map((v) => ({
        label: v.appVersion ? `${ v.version } (App: ${ v.appVersion })` : v.version,
        value: v.version,
      }));
    },

    selectedVersionEntry() {
      return (this.selectedChart?.versions || []).find((v) => v.version === this.version) || null;
    },

    implicitDependencies() {
      return extractChartImplicitDependencies(this.selectedVersionEntry);
    },

    canLoadCharts() {
      return !!(this.repoUrl?.trim() || this.clusterRepo) && !this.loadingIndex;
    },

    canImport() {
      if (!this.chartName || !this.version || this.importing || this.loadingIndex) {
        return false;
      }

      if (this.createApp && !this.appName?.trim()) {
        return false;
      }

      return true;
    },
  },

  methods: {
    async loadCharts() {
      if (!this.repoUrl?.trim() && !this.clusterRepo) {
        return;
      }

      this.loadingIndex = true;
      this.error = '';
      this.charts = [];
      this.chartName = '';
      this.version = '';

      try {
        const matchedRepo = this.clusterRepos.find((r) => r.url === this.repoUrl?.trim());
        const clusterRepo = matchedRepo ? matchedRepo.value : '';

        this.charts = await fetchHelmRepoIndex({
          clusterRepo,
          repoUrl: this.repoUrl?.trim(),
        });

        if (this.charts.length > 0) {
          this.chartName = this.charts[0].name;
        } else {
          this.error = 'No charts found in that repository.';
        }
      } catch (e) {
        this.error = `Could not load Helm repository: ${ e.message }`;
      } finally {
        this.loadingIndex = false;
      }
    },

    async importSelected() {
      if (!this.canImport || !this.selectedVersionEntry) {
        return;
      }

      this.importing = true;
      this.error = '';

      try {
        const matchedRepo = this.clusterRepos.find((r) => r.url === this.repoUrl?.trim());
        const clusterRepo = matchedRepo ? matchedRepo.value : '';
        const repoUrl = this.repoUrl?.trim().replace(/\/index\.yaml$/, '');

        const details = await fetchHelmChartDetails({
          clusterRepo,
          repoUrl,
          chartName:    this.chartName,
          versionEntry: this.selectedVersionEntry,
        });

        const name = (this.appName || this.chartName).trim();
        const description = this.selectedVersionEntry.description || this.selectedChart?.description || '';
        const helm = {
          repo:        repoUrl,
          chart:       this.chartName,
          version:     this.version,
          releaseName: name,
          ...(clusterRepo ? { clusterRepo } : {}),
        };

        const annotations = { ...(details.annotations || {}) };

        if (description) {
          annotations['field.cattle.io/description'] = description;
        }
        if (details.implicitDependencies.length > 0 && !annotations[DEPENDENCIES_ANNOTATION]) {
          annotations[DEPENDENCIES_ANNOTATION] = details.implicitDependencies.join(',');
        }

        if (this.createApp) {
          const existing = await this.$store
            .dispatch('management/find', { type: APP, id: name, opt: { force: true } })
            .catch(() => null);

          if (existing) {
            existing.metadata.annotations = {
              ...(existing.metadata.annotations || {}),
              ...annotations,
            };
            existing.spec = {
              ...(existing.spec || {}),
              helm,
              values: {
                ...(details.values || {}),
                ...(existing.spec?.values || {}),
              },
            };

            const saved = await existing.save();

            this.$emit('imported', saved);
            this.$emit('close');

            return;
          }

          const app = await this.$store.dispatch('management/create', {
            type:     APP,
            metadata: {
              name,
              annotations,
              labels: {
                'appsplus.io/chart': this.chartName,
              },
            },
            spec: {
              helm,
              values:       details.values || {},
              templates:    [],
              dependencies: [],
            },
          });

          const saved = await app.save();

          this.$emit('imported', saved);
          this.$emit('close');
        } else {
          this.$emit('imported', {
            name,
            description,
            helm,
            values:               details.values || {},
            implicitDependencies: details.implicitDependencies,
            annotations,
          });
          this.$emit('close');
        }
      } catch (e) {
        this.error = `Could not import Helm chart: ${ e.message }`;
      } finally {
        this.importing = false;
      }
    },
  },
};
</script>

<template>
  <AppModal
    :width="640"
    name="import-helm-chart"
    @close="$emit('close')"
  >
    <div class="import-helm">
      <h4 class="import-helm__title">
        {{ t('appsPlus.helm.importTitle') }}
      </h4>

      <Banner
        color="info"
        :label="t('appsPlus.helm.importHint')"
      />

      <LabeledSelect
        v-if="clusterRepos.length"
        v-model:value="clusterRepo"
        class="mb-10"
        :options="clusterRepos"
        :searchable="true"
        :clearable="true"
        :label="t('appsPlus.helm.clusterRepo')"
      />

      <div class="import-helm__repo-row mb-10">
        <LabeledInput
          v-model:value="repoUrl"
          class="import-helm__repo-input"
          :label="t('appsPlus.helm.repoUrl')"
          :placeholder="t('appsPlus.helm.repoUrlPlaceholder')"
          @keyup.enter="loadCharts"
        />
        <RcButton
          variant="secondary"
          class="import-helm__load-btn"
          :disabled="!canLoadCharts"
          @click="loadCharts"
        >
          {{ loadingIndex ? t('appsPlus.helm.loadingCharts') : t('appsPlus.helm.loadCharts') }}
        </RcButton>
      </div>

      <LabeledSelect
        v-model:value="chartName"
        class="mb-10"
        :options="chartOptions"
        :searchable="true"
        :disabled="!charts.length"
        :label="t('appsPlus.helm.chart')"
      />

      <div class="row mb-10">
        <div :class="createApp ? 'col span-6' : 'col span-12'">
          <LabeledSelect
            v-model:value="version"
            :options="versionOptions"
            :searchable="true"
            :disabled="!versionOptions.length"
            :label="t('appsPlus.helm.version')"
          />
        </div>
        <div
          v-if="createApp"
          class="col span-6"
        >
          <LabeledInput
            v-model:value="appName"
            :disabled="!chartName"
            :label="t('appsPlus.helm.appName')"
          />
        </div>
      </div>

      <Banner
        v-if="implicitDependencies.length"
        color="info"
        :label="t('appsPlus.helm.implicitDependenciesFound', { deps: implicitDependencies.join(', ') })"
      />

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
          :disabled="!canImport"
          @click="importSelected"
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

  &__repo-row {
    display:     flex;
    align-items: stretch;
    gap:         8px;
  }

  &__repo-input {
    flex: 1;
  }

  &__load-btn {
    align-self: center;
    white-space: nowrap;
  }

  &__buttons {
    display:         flex;
    justify-content: flex-end;
    gap:             8px;
    margin-top:      16px;
  }
}
</style>
