import SteveModel from '@shell/plugins/steve/steve-class';
import {
  APP, FLEET_BUNDLE, FLEET_CLUSTER, BUNDLE_PREFIX, DEFAULT_WORKSPACE, DEFAULT_TARGET_NAMESPACE
} from '../config/types';
import { renderTemplates } from '../render';

/**
 * An AppInstance is one deployment of an App, and a Fleet Bundle is how it gets there.
 *
 * There is no controller behind these CRDs. Saving an instance is what writes the Bundle, and
 * Fleet's own controllers do everything after that: match the targets, ship the resources to
 * each cluster's agent, and report back. So the Bundle is not a cache of the instance - it is
 * the instance's only moving part, and `state` below is read straight off it.
 *
 * The Bundle carries an ownerReference back to the instance, which is what makes deleting an
 * instance remove what it deployed: Kubernetes garbage-collects the Bundle, and Fleet removes
 * the resources it had applied. (A namespaced dependent may name a cluster-scoped owner; the
 * reverse is what is disallowed.)
 */
export default class AppInstance extends SteveModel {
  get app() {
    const name = this.spec?.app;

    if (!name) {
      return null;
    }

    try {
      return this.$rootGetters['management/all'](APP)
        .find((app) => app.metadata?.name === name) || null;
    } catch {
      return null;
    }
  }

  get appDisplay() {
    return this.app?.nameDisplay || this.spec?.app || '—';
  }

  /** The group this row sits under in the Apps and Instances list. */
  get groupById() {
    return this.spec?.app || '';
  }

  get targetNamespace() {
    return this.spec?.namespace || this.app?.spec?.defaultNamespace || DEFAULT_TARGET_NAMESPACE;
  }

  get targetClusterNames() {
    return (this.spec?.targets || [])
      .map((target) => target?.clusterName)
      .filter((name) => !!name);
  }

  get targetDisplay() {
    return this.targetClusterNames.join(', ') || '—';
  }

  get renderedResources() {
    return renderTemplates(this.app, this);
  }

  get bundleName() {
    return `${ BUNDLE_PREFIX }${ this.metadata?.name }`;
  }

  get bundle() {
    try {
      return this.$rootGetters['management/all'](FLEET_BUNDLE)
        .find((bundle) => bundle.metadata?.name === this.bundleName) || null;
    } catch {
      return null;
    }
  }

  get bundleSummary() {
    return this.bundle?.status?.summary || null;
  }

  get readyDisplay() {
    const summary = this.bundleSummary;

    if (!summary) {
      return '—';
    }

    return `${ summary.ready || 0 }/${ summary.desiredReady || 0 }`;
  }

  /**
   * Overridden because these CRDs have no controller and so never get a status Steve could
   * derive a state from. What the row should say is what Fleet says about the Bundle.
   */
  get state() {
    if (this.metadata?.deletionTimestamp) {
      return 'removing';
    }

    const summary = this.bundleSummary;

    if (!summary) {
      return this.targetClusterNames.length ? 'pending' : 'notapplied';
    }

    if (summary.errApplied > 0) {
      return 'error';
    }

    if (summary.desiredReady > 0 && summary.ready === summary.desiredReady) {
      return 'active';
    }

    return 'pending';
  }

  get stateDescription() {
    const messages = this.bundle?.status?.conditions
      ?.filter((condition) => condition.status === 'False' && condition.message)
      ?.map((condition) => condition.message) || [];

    if (messages.length) {
      return messages.join('; ');
    }

    if (!this.targetClusterNames.length) {
      return 'No target clusters selected.';
    }

    return this.bundle ? '' : 'Waiting for the Fleet bundle to be created.';
  }

  /**
   * Save the instance, then make the Bundle match it.
   *
   * The order matters on create: the Bundle's ownerReference needs the instance's uid, which
   * only exists once the instance has been written.
   */
  async save(opt) {
    const saved = await super.save(opt);

    await this.syncBundle();

    return saved;
  }

  /**
   * Which Fleet workspace the Bundle belongs in. Fleet decides what a Bundle can target by
   * the namespace it sits in, so this follows the target cluster rather than guessing: the
   * Fleet Cluster object for `local` lives in fleet-local, a downstream one in fleet-default.
   */
  async workspaceFor(clusterName) {
    if (!clusterName) {
      return DEFAULT_WORKSPACE;
    }

    try {
      const clusters = await this.$dispatch('findAll', { type: FLEET_CLUSTER });

      return clusters.find((cluster) => cluster.metadata?.name === clusterName)
        ?.metadata?.namespace || DEFAULT_WORKSPACE;
    } catch {
      return DEFAULT_WORKSPACE;
    }
  }

  async resolveApp() {
    if (this.app) {
      return this.app;
    }

    if (!this.spec?.app) {
      return null;
    }

    try {
      return await this.$dispatch('find', { type: APP, id: this.spec.app });
    } catch {
      return null;
    }
  }

  /**
   * Create or update the Bundle this instance deploys through. Called on every save, so it
   * has to converge rather than assume: an edited instance re-renders into the Bundle that is
   * already there, and Fleet reconciles the difference on the target.
   */
  async syncBundle() {
    const app = await this.resolveApp();
    const resources = renderTemplates(app, this);
    const targets = this.targetClusterNames.map((clusterName) => ({ clusterName }));
    const namespace = await this.workspaceFor(this.targetClusterNames[0]);

    const spec = {
      resources,
      targets,
      // Fleet applies this to any rendered resource that does not name a namespace itself,
      // which is what makes one app deployable to different namespaces per instance.
      defaultNamespace: this.targetNamespace,
    };

    const existing = await this.findBundle(namespace);

    if (existing) {
      existing.spec = spec;

      return existing.save();
    }

    const bundle = await this.$dispatch('create', {
      type:     FLEET_BUNDLE,
      metadata: {
        name:            this.bundleName,
        namespace,
        labels:          { 'appsplus.io/instance': this.metadata?.name },
        ownerReferences: [{
          apiVersion:         'appsplus.io/v1alpha1',
          kind:               'AppInstance',
          name:               this.metadata?.name,
          uid:                this.metadata?.uid,
          blockOwnerDeletion: true,
        }],
      },
      spec,
    });

    return bundle.save();
  }

  async findBundle(namespace) {
    try {
      return await this.$dispatch('find', {
        type: FLEET_BUNDLE,
        id:   `${ namespace }/${ this.bundleName }`,
      });
    } catch {
      return null;
    }
  }

  get availableActions() {
    return [
      {
        action:  'redeploy',
        label:   'Redeploy',
        icon:    'icon icon-refresh',
        enabled: !!this.spec?.app,
      },
      { divider: true },
      ...super.availableActions,
    ];
  }

  /** Re-render and re-write the Bundle without touching the instance itself. */
  async redeploy() {
    try {
      await this.syncBundle();
    } catch (error) {
      this.$dispatch('growl/fromError', { title: 'Redeploy failed', error }, { root: true });
    }
  }
}
