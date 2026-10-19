<script>
import CreateEditView from '@shell/mixins/create-edit-view';
import CruResource from '@shell/components/CruResource';
import NameNsDescription from '@shell/components/form/NameNsDescription';
import { LabeledInput } from '@components/Form/LabeledInput';
import ValuesEditor from '../components/ValuesEditor';
import DependenciesEditor from '../components/DependenciesEditor.vue';
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
  extractMetadataDependencies,
} from '../config/types';
import {
  requiredValues, appVariables, undeclaredWarnings, referencedVariables, DOCUMENTED_VALUES, BUILT_IN_VALUES
} from '../render';

const NEW_TEMPLATE = () => ({ name: 'resource.yaml', content: '' });

export default {
  name:         'CruApp',
  inheritAttrs: false,

  components: {
    CruResource,
    NameNsDescription,
    LabeledInput,
    ValuesEditor,
    DependenciesEditor,
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

    return {
      selected:           0,
      clusterTemplateKey: 0,
      templatesKey:       0,
    };
  },

  computed: {
    allApps() {
      return this.$store.getters['management/all'](APP) || [];
    },

    availableAppNames() {
      return this.allApps.map((app) => app.metadata?.name).filter(Boolean);
    },

    existingAppNames() {
      return new Set(this.availableAppNames);
    },

    explicitDependencies() {
      return this.value.explicitDependencies || [];
    },

    implicitDependencies() {
      return extractMetadataDependencies(this.value.metadata);
    },

    documentedValues() {
      return DOCUMENTED_VALUES;
    },

    valueKeys() {
      const found = new Set(appVariables(this.value, !this.value.isHelmChart));

      if (!this.value.isHelmChart) {
        this.templates.forEach((template) => {
          referencedVariables(template?.content || '').forEach((name) => found.add(name));
        });
      }

      return [...found]
        .filter((name) => !BUILT_IN_VALUES.includes(name))
        .sort();
    },

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

    current() {
      return this.templates[this.selected] || null;
    },

    required() {
      return [...new Set([...requiredValues(this.value), ...requiredValues(this.value, !this.value.isHelmChart)])];
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

    addDependency(name) {
      if (!name || name === this.value.metadata?.name) {
        return;
      }

      if (!Array.isArray(this.value.spec.dependencies)) {
        this.value.spec.dependencies = [];
      }

      if (!this.value.spec.dependencies.includes(name)) {
        this.value.spec.dependencies.push(name);
      }
    },

    removeDependency(name) {
      if (Array.isArray(this.value.spec.dependencies)) {
        this.value.spec.dependencies = this.value.spec.dependencies.filter((d) => d !== name);
      }

      [this.value.metadata?.annotations, this.value.metadata?.labels].forEach((bag) => {
        if (!bag) {
          return;
        }

        [DEPENDENCIES_ANNOTATION, DEPENDS_ON_ANNOTATION].forEach((key) => {
          if (bag[key]) {
            const remaining = parseDependencyList(bag[key]).filter((d) => d !== name);

            if (remaining.length) {
              bag[key] = remaining.join(',');
            } else {
              delete bag[key];
            }
          }
        });

        if (bag[`${ DEPENDS_ON_LABEL_PREFIX }${ name }`]) {
          delete bag[`${ DEPENDS_ON_LABEL_PREFIX }${ name }`];
        }
      });
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

    <Banner
      v-if="value.isHelmChart"
      color="info"
      class="mb-20"
      :label="t('appsPlus.helm.detailBanner', { chart: value.helmDisplay, repo: value.helmRepo || '—' })"
    />

    <Tabbed
      :side-tabs="true"
      @changed="onTabChanged"
    >
      <Tab
        name="values"
        :label="t('appsPlus.app.values')"
        :weight="3"
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
        v-if="!value.isHelmChart"
        name="templates"
        :label="t('appsPlus.app.templates')"
        :weight="2"
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
              <RcButton
                variant="tertiary"
                @click="addTemplate"
              >
                {{ t('appsPlus.app.addTemplate') }}
              </RcButton>
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
        v-if="!value.isHelmChart"
        name="cluster"
        :label="t('appsPlus.app.clusterTemplate')"
        :weight="1"
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
        <RcButton
          v-if="!isView && !value.spec.clusterTemplate"
          variant="secondary"
          class="mt-10"
          @click="useDefaultClusterTemplate"
        >
          {{ t('appsPlus.app.useDefaultCluster') }}
        </RcButton>
      </Tab>

      <Tab
        name="dependencies"
        :label="t('appsPlus.app.dependencies')"
        :weight="0"
      >
        <DependenciesEditor
          :mode="mode"
          :self-name="value.metadata?.name || ''"
          :explicit-dependencies="explicitDependencies"
          :implicit-dependencies="implicitDependencies"
          :available-app-names="availableAppNames"
          :existing-app-names="existingAppNames"
          @add="addDependency"
          @remove="removeDependency"
        />
      </Tab>
    </Tabbed>
  </CruResource>
</template>

<style lang="scss" scoped>
:deep(.fill-row) > .col {
  flex:  1 1 0;
  width: auto;
}

.template-editor {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
  min-height: 360px;
}

.file-list {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  display: flex;
  flex-direction: column;
  justify-content: space-between;

  ul {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);

      &.active {
        background: var(--accent-btn);
        font-weight: 600;
      }

      .file-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  &__buttons {
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;

    > * {
      width: 100%;
      justify-content: center;
      border-radius: 0;
    }
  }
}

.file-body {
  display: flex;
  flex-direction: column;

  .yaml {
    flex: 1;
    min-height: 300px;
  }
}

.provided {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);

  &__title {
    margin-bottom: 6px;
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;

    li {
      display: contents;
    }

    code {
      color: var(--body-text);
    }
  }
}
</style>
