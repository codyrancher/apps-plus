<script>
import CreateEditView from '@shell/mixins/create-edit-view';
import CruResource from '@shell/components/CruResource';
import NameNsDescription from '@shell/components/form/NameNsDescription';
import { LabeledInput } from '@components/Form/LabeledInput';
import KeyValue from '@shell/components/form/KeyValue';
import YamlEditor from '@shell/components/YamlEditor';
import Tabbed from '@shell/components/Tabbed';
import Tab from '@shell/components/Tabbed/Tab';
import { Banner } from '@components/Banner';
import { RcButton } from '@components/RcButton';

const NEW_TEMPLATE = () => ({ name: 'resource.yaml', content: '' });

/**
 * Creating and editing an App: the chart half of this extension.
 *
 * An app is its templates, and a template is a YAML file rather than a form, so this is
 * mostly an editor and a file list. `spec` is initialised here rather than defaulted in the
 * CRD, because a create form starts from an empty resource and every field below binds
 * straight into it.
 */
export default {
  name:         'CruApp',
  inheritAttrs: false,

  components: {
    CruResource,
    NameNsDescription,
    LabeledInput,
    KeyValue,
    YamlEditor,
    Tabbed,
    Tab,
    Banner,
    RcButton,
  },

  mixins: [CreateEditView],

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

    return {
      selected: 0,
      values:   { ...spec.values },
    };
  },

  computed: {
    templates() {
      return this.value.spec.templates;
    },

    current() {
      return this.templates[this.selected] || null;
    },

    validationPassed() {
      return !!this.value.metadata?.name;
    },
  },

  watch: {
    values(neu) {
      this.value.spec.values = { ...neu };
    },
  },

  methods: {
    addTemplate() {
      this.templates.push(NEW_TEMPLATE());
      this.selected = this.templates.length - 1;
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
      :value="value"
      :mode="mode"
      :namespaced="false"
      :register-before-hook="registerBeforeHook"
    />

    <div class="row mb-20">
      <div class="col span-6">
        <LabeledInput
          v-model:value="value.spec.displayName"
          :mode="mode"
          :label="t('appsPlus.app.displayName')"
          :tooltip="t('appsPlus.app.displayNameHint')"
        />
      </div>
      <div class="col span-6">
        <LabeledInput
          v-model:value="value.spec.defaultNamespace"
          :mode="mode"
          :label="t('appsPlus.app.defaultNamespace')"
          :tooltip="t('appsPlus.app.defaultNamespaceHint')"
          placeholder="default"
        />
      </div>
    </div>

    <Tabbed :side-tabs="true">
      <Tab
        name="templates"
        :label="t('appsPlus.app.templates')"
        :weight="2"
      >
        <Banner
          color="info"
          :label="t('appsPlus.app.templatesHint')"
        />

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
            <rc-button
              v-if="!isView"
              variant="secondary"
              @click="addTemplate"
            >
              {{ t('appsPlus.app.addTemplate') }}
            </rc-button>
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
                :key="selected"
                :value="current.content"
                :mode="mode"
                :hide-preview-buttons="true"
                class="yaml"
                @update:value="updateContent"
              />
            </template>
            <Banner
              v-else
              color="warning"
              :label="t('appsPlus.app.noTemplates')"
            />
          </div>
        </div>
      </Tab>

      <Tab
        name="values"
        :label="t('appsPlus.app.values')"
        :weight="1"
      >
        <Banner
          color="info"
          :label="t('appsPlus.app.valuesHint')"
        />
        <KeyValue
          v-model:value="values"
          :mode="mode"
          :read-allowed="false"
          :as-map="true"
        />
      </Tab>
    </Tabbed>
  </CruResource>
</template>

<style lang="scss" scoped>
.template-editor {
  display: flex;
  gap: 16px;

  .file-list {
    width: 220px;
    flex-shrink: 0;

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
