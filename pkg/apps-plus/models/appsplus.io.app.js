import SteveModel from '@shell/plugins/steve/steve-class';
import {
  APP, APP_INSTANCE, PRODUCT_NAME, BLANK_CLUSTER, CREATE_ROUTE, APP_QUERY,
  extractMetadataDependencies
} from '../config/types';

export default class App extends SteveModel {
  get nameDisplay() {
    return this.metadata?.name;
  }

  get cards() {
    return [];
  }

  get templates() {
    return this.spec?.templates || [];
  }

  get isHelmChart() {
    return !!this.spec?.helm?.chart;
  }

  get helmChart() {
    return this.spec?.helm?.chart || '';
  }

  get helmVersion() {
    return this.spec?.helm?.version || '';
  }

  get helmVersions() {
    const list = this.spec?.helm?.versions;

    if (Array.isArray(list) && list.length) {
      return list;
    }

    return this.helmVersion ? [this.helmVersion] : [];
  }

  get helmRepo() {
    return this.spec?.helm?.repo || '';
  }

  get helmDisplay() {
    if (!this.isHelmChart) {
      return '';
    }

    return this.helmVersion ? `${ this.helmChart } (${ this.helmVersion })` : this.helmChart;
  }

  get explicitDependencies() {
    const raw = this.spec?.dependencies;

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((item) => String(item || '').trim())
      .filter((name) => name && name !== this.metadata?.name);
  }

  get implicitDependencies() {
    return extractMetadataDependencies(this.metadata);
  }

  get dependencies() {
    return [...new Set([...this.explicitDependencies, ...this.implicitDependencies])];
  }

  get missingDependencies() {
    const deps = this.dependencies;

    if (!deps.length) {
      return [];
    }

    try {
      const existing = new Set(
        (this.$rootGetters['management/all'](APP) || []).map((app) => app.metadata?.name)
      );

      return deps.filter((dep) => !existing.has(dep));
    } catch {
      return [];
    }
  }

  get instances() {
    try {
      return this.$rootGetters['management/all'](APP_INSTANCE)
        .filter((instance) => instance.spec?.app === this.metadata?.name);
    } catch {
      return [];
    }
  }

  get details() {
    const t = this.$rootGetters['i18n/t'];
    const items = [];

    if (this.isHelmChart) {
      items.push({ label: t('appsPlus.headers.chart'), content: this.helmDisplay });
      if (this.helmRepo) {
        items.push({ label: t('appsPlus.headers.repo'), content: this.helmRepo });
      }
    } else {
      items.push({ label: t('appsPlus.headers.templates'), content: this.templates.length });
    }

    if (this.dependencies.length) {
      items.push({ label: t('appsPlus.headers.dependencies'), content: this.dependencies.join(', ') });
    }

    items.push({ label: t('appsPlus.headers.instances'), content: this.instances.length });

    return items;
  }

  async save(opt) {
    const saved = await super.save(opt);

    await this.redeployInstances();

    return saved;
  }

  async redeployInstances() {
    let instances = [];

    try {
      instances = await this.$dispatch('findAll', { type: APP_INSTANCE, opt: { force: true } });
    } catch {
      return;
    }

    const mine = instances.filter((instance) => instance.spec?.app === this.metadata?.name);

    for (const instance of mine) {
      try {
        await instance.reconcile();
      } catch (error) {
        this.$dispatch('growl/fromError', {
          title: `Could not redeploy ${ instance.metadata?.name }`,
          error,
        }, { root: true });
      }
    }
  }

  get canCustomEdit() {
    return true;
  }

  get editLocation() {
    return { ...this.detailLocation, query: { mode: 'edit' } };
  }

  get createInstanceLocation() {
    return {
      name:   CREATE_ROUTE,
      params: {
        product: PRODUCT_NAME, cluster: BLANK_CLUSTER, resource: APP_INSTANCE
      },
      query: { [APP_QUERY]: this.metadata?.name },
    };
  }
}
