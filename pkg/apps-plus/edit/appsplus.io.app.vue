<script>
import CreateEditView from '@shell/mixins/create-edit-view';
import CruResource from '@shell/components/CruResource';
import NameNsDescription from '@shell/components/form/NameNsDescription';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import ValuesEditor from '../components/ValuesEditor';
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
    LabeledSelect,
    LabeledInput,
    ValuesEditor,
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
      return extractMetadataDependencies(this.value.metadata);
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

    documentedValues() {
      return DOCUMENTED_VALUES;
    },

    valueKeys() {
      const found = new Set(appVariables(this.value, true));

      this.templates.forEach((template) => {
        referencedVariables(template?.content || '').forEach((name) => found.add(name));
      });

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
    </Tabbed>
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
  border:        1px solid var(--border);
  border-radius: var(--border-radius);
  overflow:      hidden;

  &__row {
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         10px 14px;
    border-bottom:   1px solid var(--border);

    &:last-child {
      border-bottom: none;
    }
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
    font-size:     11px;
    padding:       1px 8px;
    border-radius: var(--border-radius);
    background:    var(--accent-btn);
    color:         var(--link);
    border:        1px solid var(--link);
  }

  &__status {
    font-size:     11px;
    padding:       1px 8px;
    border-radius: var(--border-radius);

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
