<script>
import CreateEditView from '@shell/mixins/create-edit-view';
import CruResource from '@shell/components/CruResource';
import NameNsDescription from '@shell/components/form/NameNsDescription';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import ValuesEditor from '../components/ValuesEditor';
import ImportResourceModal from '../components/ImportResourceModal';
import ImportHelmChartModal from '../components/ImportHelmChartModal';
import YamlEditor from '@shell/components/YamlEditor';
import Tabbed from '@shell/components/Tabbed';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';
import { DEFAULT_CLUSTER_TEMPLATE } from '../config/cluster-template';
import {
  APP,
  DEPENDENCIES_ANNOTATION,
  DEPENDS_ON_ANNOTATION,
  DEPENDS_ON_LABEL_PREFIX,
  parseDependencyList,
} from '../config/types';
import {
  requiredValues, appVariables, undeclaredWarnings, referencedVariables, DOCUMENTED_VALUES, BUILT_IN_VALUES
} from '../render';

const NEW_TEMPLATE = () => ({ name: 'resource.yaml', content: '' });

/**
 * Creating and editing an App: the chart half of this extension.
 *
 * An app is its templates (or Helm chart reference), its dependencies, and the values it
 * renders with. `spec` is initialised here rather than defaulted in the CRD, because a create
 * form starts from an empty resource and every field below binds straight into it.
 */
export default {
  name:         'CruApp',
  inheritAttrs: false,

  components: {
    CruResource,
    NameNsDescription,
    LabeledSelect,
    LabeledInput,
    ValuesEditor,
    ImportResourceModal,
    ImportHelmChartModal,
    YamlEditor,
    Tabbed,
    Tab,
    Banner,
    RcButton,
  },

  mixins: [CreateEditView],

  async fetch() {
    await this.$store.dispatch('management/findAll', { type: APP }).catch(() => []);
  },

  data() {
    if (!this.value.spec) {
      this.value.spec = {};
    }

    const spec = this.value.spec;

    if (!Array.isArray(spec.templates)) {
      spec.templates = [];
    }

    if (!spec.values) {
      spec.values = {};
    }

    if (!Array.isArray(spec.dependencies)) {
      spec.dependencies = [];
    }

    if (!spec.helm) {
      spec.helm = {};
    }

    return {
      selected:           0,
      clusterTemplateKey: 0,
      templatesKey:       0,
      importing:          false,
      importingHelm:      false,
      newDependency:      '',
    };
  },

  computed: {
    allApps() {
      return this.$store.getters['management/all'](APP) || [];
    },

    existingAppNames() {
      return new Set(this.allApps.map((app) => app.metadata?.name).filter(Boolean));
    },

    explicitDependencies() {
      return Array.isArray(this.value.spec?.dependencies) ? this.value.spec.dependencies : [];
    },

    implicitDependencies() {
      const annotations = this.value.metadata?.annotations || {};
      const labels = this.value.metadata?.labels || {};
      const fromAnnotations = [
        ...parseDependencyList(annotations[DEPENDENCIES_ANNOTATION]),
        ...parseDependencyList(annotations[DEPENDS_ON_ANNOTATION]),
      ];
      const fromLabels = Object.entries(labels)
        .filter(([k, v]) => k.startsWith(DEPENDS_ON_LABEL_PREFIX) && v !== 'false' && v !== '0')
        .map(([k]) => k.slice(DEPENDS_ON_LABEL_PREFIX.length).trim())
        .filter(Boolean);

      return [...new Set([...fromAnnotations, ...fromLabels])];
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
      const selfName = this.value.metadata?.name;
      const currentDeps = new Set(this.allDependencies.map((d) => d.name));

      return this.allApps
        .map((app) => app.metadata?.name)
        .filter((name) => name && name !== selfName && !currentDeps.has(name))
        .sort()
        .map((name) => ({
          label: name,
          value: name,
        }));
    },

    /** The variables every template gets for free. See DOCUMENTED_VALUES for what is left out. */
    documentedValues() {
      return DOCUMENTED_VALUES;
    },

    /**
     * The keys the values editor offers: the parameters this app declares (see appVariables),
     * plus every `${...}` its templates mention that nothing declared.
     */
    valueKeys() {
      const found = new Set(appVariables(this.value, true));

      this.templates.forEach((template) => {
        referencedVariables(template?.content || '').forEach((name) => found.add(name));
      });

      return [...found]
        .filter((name) => !BUILT_IN_VALUES.includes(name))
        .sort();
    },

    /** See the note in edit/appsplus.io.appinstance.vue: one source of truth, not a copy. */
    values: {
      get() {
        return this.value.spec.values || {};
      },
      set(values) {
        this.value.spec.values = { ...values };
      },
    },

    templates() {
      return this.value.spec.templates;
    },

    /** What an import has to avoid reusing. See ImportResourceModal's takenValues. */
    valueNames() {
      return Object.keys(this.values || {});
    },

    current() {
      return this.templates[this.selected] || null;
    },

    required() {
      return [...new Set([...requiredValues(this.value), ...requiredValues(this.value, true)])];
    },

    undeclared() {
      return undeclaredWarnings(this.value);
    },

    validationPassed() {
      return !!this.value.metadata?.name;
    },
  },

  methods: {
    addTemplate() {
      this.templates.push(NEW_TEMPLATE());
      this.selected = this.templates.length - 1;
    },

    addImported(imported) {
      const taken = new Set(this.templates.map((template) => template.name));
      let name = imported.name;

      for (let i = 2; taken.has(name); i++) {
        name = imported.name.replace(/\.yaml$/, `-${ i }.yaml`);
      }

      this.templates.push({ name, content: imported.content });
      this.selected = this.templates.length - 1;

      this.values = { ...imported.values, ...this.values };
    },

    addImportedHelm(imported) {
      if (!this.value.metadata.name && imported.name) {
        this.value.metadata.name = imported.name;
      }
      if (!this.value.spec.description && imported.description) {
        this.value.spec.description = imported.description;
      }

      this.value.spec.helm = { ...(imported.helm || {}) };
      this.values = { ...(imported.values || {}), ...this.values };

      if (!this.value.metadata.annotations) {
        this.value.metadata.annotations = {};
      }
      Object.assign(this.value.metadata.annotations, imported.annotations || {});
    },

    clearHelmChart() {
      this.value.spec.helm = {};
    },

    addDependency() {
      const raw = typeof this.newDependency === 'object' ? this.newDependency?.value || this.newDependency?.label : this.newDependency;
      const name = String(raw || '').trim();

      if (!name) {
        return;
      }

      if (!Array.isArray(this.value.spec.dependencies)) {
        this.value.spec.dependencies = [];
      }

      if (!this.value.spec.dependencies.includes(name)) {
        this.value.spec.dependencies.push(name);
      }

      this.newDependency = '';
    },

    removeDependency(name) {
      if (Array.isArray(this.value.spec.dependencies)) {
        this.value.spec.dependencies = this.value.spec.dependencies.filter((d) => d !== name);
      }

      const annotations = this.value.metadata?.annotations;

      if (annotations) {
        [DEPENDENCIES_ANNOTATION, DEPENDS_ON_ANNOTATION].forEach((key) => {
          if (annotations[key]) {
            const remaining = parseDependencyList(annotations[key]).filter((d) => d !== name);

            if (remaining.length) {
              annotations[key] = remaining.join(',');
            } else {
              delete annotations[key];
            }
          }
        });
      }

      const labels = this.value.metadata?.labels;

      if (labels && labels[`${ DEPENDS_ON_LABEL_PREFIX }${ name }`]) {
        delete labels[`${ DEPENDS_ON_LABEL_PREFIX }${ name }`];
      }
    },

    removeTemplate(index) {
      this.templates.splice(index, 1);
      this.selected = Math.max(0, Math.min(this.selected, this.templates.length - 1));
    },

    updateContent(content) {
      if (this.current) {
        this.current.content = content;
      }
    },

    onTabChanged({ selectedName }) {
      if (selectedName === 'templates') {
        this.templatesKey++;
      }
    },

    useDefaultClusterTemplate() {
      this.value.spec.clusterTemplate = DEFAULT_CLUSTER_TEMPLATE;
      this.clusterTemplateKey++;
    },
  },
};
</script>

<template>
  <CruResource
    ref="cru"
    :done-route="doneRoute"
    :mode="mode"
    :resource="value"
    :subtypes="[]"
    :validation-passed="validationPassed"
    :errors="errors"
    @error="e => errors = e"
    @finish="save"
    @cancel="done"
  >
    <NameNsDescription
      class="fill-row"
      :value="value"
      :mode="mode"
      :namespaced="false"
      description-key="spec.description"
      :register-before-hook="registerBeforeHook"
    />

    <Tabbed
      :side-tabs="true"
      @changed="onTabChanged"
    >
      <Tab
        name="values"
        :label="t('appsPlus.app.values')"
        :weight="4"
        :error="!!undeclared.length"
      >
        <Banner
          v-for="reference in undeclared"
          :key="reference.file"
          color="warning"
          :label="t('appsPlus.values.undeclared', reference) + ' ' + t('appsPlus.values.undeclaredDeclareBelow')"
        />
        <Banner
          v-if="required.length"
          color="warning"
          :label="t('appsPlus.app.requiredValues', { keys: required.join(', ') })"
        />
        <ValuesEditor
          v-model:value="values"
          :mode="mode"
          :keys="valueKeys"
          :placeholder="t('appsPlus.app.valueKeyPlaceholder')"
        />
      </Tab>

      <Tab
        name="templates"
        :label="t('appsPlus.app.templates')"
        :weight="3"
      >
        <div class="template-editor">
          <div class="file-list">
            <ul>
              <li
                v-for="(template, i) in templates"
                :key="i"
                :class="{ active: i === selected }"
                @click="selected = i"
              >
                <span class="file-name">{{ template.name || '(unnamed)' }}</span>
                <i
                  v-if="!isView"
                  class="icon icon-x"
                  @click.stop="removeTemplate(i)"
                />
              </li>
            </ul>
            <div
              v-if="!isView"
              class="file-list__buttons"
            >
              <rc-button
                variant="tertiary"
                @click="addTemplate"
              >
                {{ t('appsPlus.app.addTemplate') }}
              </rc-button>
              <rc-button
                variant="tertiary"
                @click="importing = true"
              >
                {{ t('appsPlus.app.importTemplate') }}
              </rc-button>
            </div>
          </div>

          <div class="file-body">
            <template v-if="current">
              <LabeledInput
                v-model:value="current.name"
                :mode="mode"
                class="mb-10"
                :label="t('appsPlus.app.fileName')"
              />

              <YamlEditor
                :key="`${ selected }-${ templatesKey }`"
                :value="current.content"
                :mode="mode"
                :hide-preview-buttons="true"
                class="yaml"
                @update:value="updateContent"
              />
            </template>
            <Banner
              v-else
              color="info"
              :label="t('appsPlus.app.noTemplates')"
            />
          </div>
        </div>

        <div class="provided">
          <div class="provided__title">
            {{ t('appsPlus.app.provided') }}
          </div>
          <ul class="provided__list">
            <li
              v-for="val in documentedValues"
              :key="val.name"
            >
              <code>${{ '{' }}{{ val.name }}{{ '}' }}</code>
              <span class="provided__what">{{ val.what }}</span>
            </li>
          </ul>
        </div>
      </Tab>

      <Tab
        name="helm"
        :label="t('appsPlus.app.helmChart')"
        :weight="2"
      >
        <Banner
          color="info"
          :label="t('appsPlus.helm.tabHint')"
        />

        <div
          v-if="!isView"
          class="mb-20"
        >
          <RcButton
            variant="secondary"
            class="mr-10"
            data-testid="app-edit-import-helm-btn"
            @click="importingHelm = true"
          >
            {{ t('appsPlus.helm.importButton') }}
          </RcButton>
          <RcButton
            v-if="value.spec.helm?.chart"
            variant="tertiary"
            @click="clearHelmChart"
          >
            {{ t('appsPlus.helm.clearChart') }}
          </RcButton>
        </div>

        <div class="row mb-15">
          <div class="col span-6">
            <LabeledInput
              v-model:value="value.spec.helm.repo"
              :mode="mode"
              :label="t('appsPlus.helm.repoUrl')"
              :placeholder="t('appsPlus.helm.repoUrlPlaceholder')"
            />
          </div>
          <div class="col span-6">
            <LabeledInput
              v-model:value="value.spec.helm.chart"
              :mode="mode"
              :label="t('appsPlus.helm.chart')"
            />
          </div>
        </div>

        <div class="row">
          <div class="col span-6">
            <LabeledInput
              v-model:value="value.spec.helm.version"
              :mode="mode"
              :label="t('appsPlus.helm.version')"
            />
          </div>
          <div class="col span-6">
            <LabeledInput
              v-model:value="value.spec.helm.releaseName"
              :mode="mode"
              :label="t('appsPlus.helm.releaseName')"
            />
          </div>
        </div>
      </Tab>

      <Tab
        name="dependencies"
        :label="t('appsPlus.app.dependencies')"
        :weight="1"
      >
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
              @click="removeDependency(dep.name)"
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
      </Tab>

      <Tab
        name="cluster"
        :label="t('appsPlus.app.clusterTemplate')"
        :weight="0"
      >
        <Banner
          color="info"
          :label="t('appsPlus.app.clusterTemplateHint')"
        />
        <YamlEditor
          :key="`cluster-template-${ clusterTemplateKey }`"
          :value="value.spec.clusterTemplate || ''"
          :mode="mode"
          :hide-preview-buttons="true"
          class="yaml"
          @update:value="v => value.spec.clusterTemplate = v"
        />
        <rc-button
          v-if="!isView && !value.spec.clusterTemplate"
          variant="secondary"
          class="mt-10"
          @click="useDefaultClusterTemplate"
        >
          {{ t('appsPlus.app.useDefaultCluster') }}
        </rc-button>
      </Tab>
    </Tabbed>

    <ImportResourceModal
      v-if="importing"
      :taken-values="valueNames"
      @close="importing = false"
      @imported="addImported"
    />

    <ImportHelmChartModal
      v-if="importingHelm"
      :create-app="false"
      @close="importingHelm = false"
      @imported="addImportedHelm"
    />
  </CruResource>
</template>

<style lang="scss" scoped>
:deep(.fill-row) > .col {
  flex:  1 1 0;
  width: auto;
}

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
  display:        flex;
  flex-direction: column;
  gap:            8px;

  &__row {
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         8px 12px;
    border:          1px solid var(--border);
    border-radius:   var(--border-radius);
    background:      var(--box-bg);
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
    padding:       1px 8px;
    border-radius: var(--border-radius);
    background:    var(--accent-btn);
    color:         var(--link);
    border:        1px solid var(--link);
    font-size:     11px;
  }

  &__status {
    padding:       1px 8px;
    border-radius: var(--border-radius);
    font-size:     11px;

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

.provided {
  margin-top: 16px;
  font-size: 12px;
  color: var(--muted);

  &__title {
    font-weight: 600;
    margin-bottom: 4px;
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 1px 0;
    }

    code {
      flex: 0 0 auto;
    }
  }

  &__what {
    color: var(--muted);
  }
}

.template-editor {
  display: flex;
  gap: 16px;

  .file-list {
    &__buttons {
      display: flex;
      gap:     8px;
    }

    flex:      0 1 220px;
    min-width: 0;

    ul {
      list-style: none;
      margin: 0 0 10px 0;
      padding: 0;
    }

    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: var(--border-radius);
      margin-bottom: 4px;
      cursor: pointer;
      font-family: monospace;
      font-size: 12px;

      &.active {
        border-color: var(--primary);
        color: var(--primary);
      }

      .file-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  .file-body {
    flex: 1;
    min-width: 0;

    .yaml {
      min-height: 320px;
    }
  }
}
</style>
