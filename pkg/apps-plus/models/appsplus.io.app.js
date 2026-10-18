import SteveModel from '@shell/plugins/steve/steve-class';
import {
  APP, APP_INSTANCE, PRODUCT_NAME, BLANK_CLUSTER, CREATE_ROUTE, APP_QUERY,
  DEPENDENCIES_ANNOTATION, DEPENDS_ON_ANNOTATION, DEPENDS_ON_LABEL_PREFIX
} from '../config/types';

function splitNames(raw) {
  if (!raw || typeof raw !== 'string') {
    return [];
  }

  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * An App is the definition - a set of YAML templates or a Helm chart, the values it renders
 * with, and the other Apps it depends on. It deploys nothing by itself; an AppInstance of it
 * is what reaches a cluster.
 */
export default class App extends SteveModel {
  /**
   * What an app is called, everywhere.
   *
   * Its name, and only its name. There used to be a separate `spec.displayName` that the list
   * headings preferred, which meant an app could be called one thing in the list and another in
   * every URL, every kubectl output and every error message about it. One name is less to keep
   * in step and nothing was gained by the second.
   */
  get nameDisplay() {
    return this.metadata?.name;
  }

  /**
   * No detail-page cards. Whenever a resource shows one or two cards, the shell appends its
   * stock "Extras" card beside them - a pitch for Extensions and Cluster Tools with nothing to
   * say about an App - and the only way to decline it is to show no cards at all. Everything a
   * card would carry is already in the detail component's own header row and tabs.
   */
  get cards() {
    return [];
  }

  get templates() {
    return this.spec?.templates || [];
  }

  get templateCount() {
    return this.templates.length;
  }

  // ---------------------------------------------------------------- helm

  get isHelmChart() {
    return !!this.spec?.helm?.chart;
  }

  get helmChart() {
    return this.spec?.helm?.chart || '';
  }

  get helmVersion() {
    return this.spec?.helm?.version || '';
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

  // ---------------------------------------------------------------- dependencies

  /** Dependencies stored explicitly in spec.dependencies. */
  get explicitDependencies() {
    const raw = this.spec?.dependencies;

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((item) => String(item || '').trim())
      .filter((name) => name && name !== this.metadata?.name);
  }

  /**
   * Implicit dependencies declared via annotations or labels on the App or imported chart:
   * - metadata.annotations['appsplus.io/dependencies'] or ['appsplus.io/depends-on']
   * - metadata.labels['appsplus.io/dependencies'] or ['appsplus.io/depends-on']
   * - metadata.labels['depends-on.appsplus.io/<app-name>'] = 'true'
   */
  get implicitDependencies() {
    const found = new Set();
    const annotations = this.metadata?.annotations || {};
    const labels = this.metadata?.labels || {};

    [
      annotations[DEPENDENCIES_ANNOTATION],
      annotations[DEPENDS_ON_ANNOTATION],
      labels[DEPENDENCIES_ANNOTATION],
      labels[DEPENDS_ON_ANNOTATION],
    ].forEach((val) => {
      splitNames(val).forEach((name) => found.add(name));
    });

    Object.entries(labels).forEach(([key, val]) => {
      if (key.startsWith(DEPENDS_ON_LABEL_PREFIX) && val !== 'false' && val !== '0') {
        const dep = key.slice(DEPENDS_ON_LABEL_PREFIX.length).trim();

        if (dep) {
          found.add(dep);
        }
      }
    });

    found.delete(this.metadata?.name);

    return [...found];
  }

  /** All dependencies (explicit + implicit) of this App. */
  get dependencies() {
    return [...new Set([...this.explicitDependencies, ...this.implicitDependencies])];
  }

  /** Dependencies of this App that do not exist in the cluster yet. */
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

  /**
   * The instances of this app. Reads what is already in the store rather than fetching:
   * every page that shows this has loaded AppInstances itself, and a getter that fetched
   * would run once per row.
   */
  get instances() {
    try {
      return this.$rootGetters['management/all'](APP_INSTANCE)
        .filter((instance) => instance.spec?.app === this.metadata?.name);
    } catch {
      return [];
    }
  }

  /**
   * The glance line under the title. The masthead already has a place for counts like these,
   * and putting them there lines them up with the age and the labels instead of spending a row
   * of the page on two numbers.
   */
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

  get instancesNeedingAttention() {
    return this.instances.filter((instance) => instance.needsAttention);
  }

  /**
   * Saving an app is a deploy.
   *
   * A template is only a template until something renders it, so an edit that nobody pushed
   * would leave every instance running the previous version with no sign that they had drifted.
   * Instances that can be rendered are redeployed here; instances that cannot are left exactly
   * as they are - still running their last good render - and show a warning until someone
   * supplies what the new template asks for.
   */
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

  /**
   * The edit form for this app, which is where parameters get declared. The undeclared-value
   * banners link here from every surface that is not already it: telling somebody on an
   * install form to look under Default Values points at a section that page does not have.
   */
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
