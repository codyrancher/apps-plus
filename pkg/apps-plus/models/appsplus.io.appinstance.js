import jsyaml from 'js-yaml';
import SteveModel from '@shell/plugins/steve/steve-class';
import {
  APP, APP_INSTANCE, FLEET_BUNDLE, FLEET_BUNDLE_DEPLOYMENT, FLEET_CLUSTER, BUNDLE_PREFIX, DEFAULT_WORKSPACE,
  DEFAULT_TARGET_NAMESPACE,
  PROVISIONING_CLUSTER, PROVISION_WORKSPACE, PRODUCT_NAME, BLANK_CLUSTER, LIST_ROUTE, steveType,
  DEPENDENCY_INSTANCE_LABEL, REQUIRED_BY_ANNOTATION, parseDependencyList
} from '../config/types';
import { NORMAN } from '@shell/config/types';
import {
  DEFAULT_CLUSTER_TEMPLATE, DEFAULT_CLUSTER_VALUES, DEFAULT_CLUSTER_DRIVER
} from '../config/cluster-template';
import {
  renderTemplates, mergeValues, substitute, missingValues, isSet, typedOverrides, unflattenValues
} from '../render';
import { fetchHelmVersionDetails } from '../helm';

const FINALIZER = 'appsplus.io/cleanup';

export default class AppInstance extends SteveModel {
  get cards() {
    return [];
  }

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

  get version() {
    return this.spec?.version || this.app?.helmVersion || '';
  }

  get dependentInstances() {
    const myApp = this.spec?.app;

    if (!myApp) {
      return [];
    }

    try {
      const allInstances = this.$rootGetters['management/all'](APP_INSTANCE) || [];
      const requiredByNames = new Set(
        parseDependencyList(this.metadata?.annotations?.[REQUIRED_BY_ANNOTATION])
      );

      return allInstances.filter((inst) => {
        if (!inst || inst.metadata?.name === this.metadata?.name || inst.isTerminating) {
          return false;
        }

        if (requiredByNames.has(inst.metadata?.name)) {
          return true;
        }

        const deps = inst.app?.dependencies || [];

        return deps.includes(myApp);
      });
    } catch {
      return [];
    }
  }

  get isDependency() {
    return this.metadata?.labels?.[DEPENDENCY_INSTANCE_LABEL] === 'true' ||
      this.dependentInstances.length > 0;
  }

  get doneRoute() {
    return LIST_ROUTE;
  }

  get doneParams() {
    return {
      product: PRODUCT_NAME, cluster: BLANK_CLUSTER, resource: APP
    };
  }

  get listLocation() {
    return { name: LIST_ROUTE, params: this.doneParams };
  }

  get doneOverride() {
    return this.listLocation;
  }

  get groupById() {
    return this.spec?.app || '';
  }

  get targetNamespace() {
    return this.spec?.namespace || DEFAULT_TARGET_NAMESPACE;
  }

  get provisionsCluster() {
    return !!this.spec?.provisionCluster?.enabled;
  }

  get clusterName() {
    return this.spec?.provisionCluster?.name || this.metadata?.name;
  }

  get effectiveTargets() {
    if (this.provisionsCluster) {
      return [{ clusterName: this.clusterName }];
    }

    return (this.spec?.targets || [])
      .filter((target) => target?.clusterName)
      .map((target) => ({ clusterName: target.clusterName }));
  }

  get targetClusterNames() {
    return this.effectiveTargets.map((target) => target.clusterName);
  }

  get targetDisplay() {
    return this.targetClusterNames.join(', ') || '—';
  }

  get provisionedCluster() {
    if (!this.provisionsCluster) {
      return null;
    }

    try {
      return this.$rootGetters['management/all'](PROVISIONING_CLUSTER)
        .find((cluster) => cluster.metadata?.name === this.clusterName &&
          cluster.metadata?.namespace === PROVISION_WORKSPACE) || null;
    } catch {
      return null;
    }
  }

  get clusterReady() {
    return !!this.provisionedCluster?.status?.ready;
  }

  get managementClusterNamespace() {
    return this.provisionedCluster?.status?.clusterName || null;
  }

  get needsNodesRegistered() {
    if (!this.provisionsCluster) {
      return false;
    }

    return !(this.provisionedCluster?.spec?.rkeConfig?.machinePools || []).length;
  }

  get missingValues() {
    return missingValues(this.app, this);
  }

  get missingDependencies() {
    return this.app?.missingDependencies || [];
  }

  get needsAttention() {
    return this.missingValues.length > 0 || this.missingDependencies.length > 0;
  }

  get renderedResources() {
    return renderTemplates(this.app, this);
  }

  get renderedClusterTemplate() {
    if (!this.provisionsCluster) {
      return '';
    }

    const source = this.app?.spec?.clusterTemplate?.trim() || DEFAULT_CLUSTER_TEMPLATE;

    return substitute(
      source,
      { ...DEFAULT_CLUSTER_VALUES, ...mergeValues(this.app, this) },
      { ...DEFAULT_CLUSTER_VALUES, ...(this.app?.spec?.values || {}) },
    );
  }

  get bundleName() {
    return `${ BUNDLE_PREFIX }${ this.metadata?.name }`;
  }

  get bundles() {
    try {
      return this.$rootGetters['management/all'](FLEET_BUNDLE)
        .filter((bundle) => bundle.metadata?.name === this.bundleName);
    } catch {
      return [];
    }
  }

  get bundle() {
    return this.bundles[0] || null;
  }

  get details() {
    const t = this.$rootGetters['i18n/t'];
    const link = (to, content) => (to ? {
      formatter:     'Link',
      formatterOpts: { to, row: {}, options: { internal: true } },
      content,
    } : { content });

    const out = [
      { label: t('appsPlus.instance.app'), ...link(this.app?.detailLocation, this.appDisplay) },
    ];

    if (this.version) {
      out.push({ label: t('appsPlus.instance.version'), content: this.version });
    }

    out.push(
      {
        label: t(this.provisionsCluster ? 'appsPlus.instance.ownedCluster' : 'appsPlus.instance.targets'),
        ...link(this.provisionedCluster?.detailLocation, this.targetDisplay),
      },
      { label: t('appsPlus.instance.namespace'), content: this.targetNamespace },
      {
        label: t('appsPlus.instance.bundle'),
        ...link(
          this.bundle?.detailLocation,
          this.bundleSummary ? `${ this.bundleName } (${ this.readyDisplay } ready)` : this.bundleName,
        ),
      },
    );

    return out;
  }

  get bundleDeployments() {
    try {
      return this.$rootGetters['management/all'](FLEET_BUNDLE_DEPLOYMENT)
        .filter((deployment) => deployment.metadata?.name === this.bundleName);
    } catch {
      return [];
    }
  }

  get deployedResources() {
    return this.bundleDeployments.flatMap((deployment) => {
      const labels = deployment.metadata?.labels || {};
      const clusterName = labels['fleet.cattle.io/cluster'] || '';
      const clusterNamespace = labels['fleet.cattle.io/cluster-namespace'] || '';
      const notReady = {};

      (deployment.status?.nonReadyStatus || []).forEach((entry) => {
        const key = `${ entry.kind }/${ entry.namespace || '' }/${ entry.name }`;

        notReady[key] = (entry.summary?.message || []).join(', ') || entry.summary?.state || '';
      });

      return (deployment.status?.resources || []).map((resource) => {
        const key = `${ resource.kind }/${ resource.namespace || '' }/${ resource.name }`;
        const message = notReady[key];

        return {
          key:        `${ clusterName }/${ key }`,
          kind:       resource.kind,
          name:       resource.name,
          namespace:  resource.namespace || '',
          apiVersion: resource.apiVersion || '',
          clusterName,
          clusterNamespace,
          message:    message || '',
          ready:      !message,
        };
      });
    });
  }

  get bundleSummary() {
    const summaries = this.bundles
      .map((bundle) => bundle.status?.summary)
      .filter((summary) => !!summary);

    if (!summaries.length) {
      return null;
    }

    return summaries.reduce((acc, summary) => ({
      desiredReady: (acc.desiredReady || 0) + (summary.desiredReady || 0),
      ready:        (acc.ready || 0) + (summary.ready || 0),
      errApplied:   (acc.errApplied || 0) + (summary.errApplied || 0),
    }), {});
  }

  get readyDisplay() {
    const summary = this.bundleSummary;

    if (!summary) {
      return '—';
    }

    return `${ summary.ready || 0 }/${ summary.desiredReady || 0 }`;
  }

  get state() {
    if (this.metadata?.deletionTimestamp) {
      return 'removing';
    }

    if (this.missingDependencies.length > 0) {
      return 'error';
    }

    if (this.needsAttention) {
      return 'warning';
    }

    if (this.provisionsCluster && !this.clusterReady) {
      return 'provisioning';
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
    if (this.isTerminating) {
      switch (this.terminatingStage) {
      case 'resources':
        return this.targetClusterNames.length ?
          `Removing what it deployed to ${ this.targetDisplay }.` :
          'Removing what it deployed.';
      case 'cluster':
        return `What it deployed is gone. Waiting for the cluster ${ this.clusterName } to be ` +
          'deleted, which takes a few minutes - the installation goes when the cluster does.';
      default:
        return this.provisionsCluster ?
          `The cluster ${ this.clusterName } and everything it deployed are gone; finishing up.` :
          'What it deployed is gone; finishing up.';
      }
    }

    const missingDeps = this.missingDependencies;

    if (missingDeps.length) {
      return `Missing dependency app(s): ${ missingDeps.join(', ') }.`;
    }

    const missing = this.missingValues;

    if (missing.length) {
      return `The app's templates need ${ missing.join(', ') }. Edit this instance to supply ` +
        `${ missing.length > 1 ? 'them' : 'it' }; until then it keeps running its last deploy.`;
    }

    if (this.provisionsCluster && !this.clusterReady) {
      const cluster = this.provisionedCluster;

      if (!cluster) {
        return `Waiting for the cluster ${ this.clusterName } to be created.`;
      }

      const waiting = (cluster.status?.conditions || [])
        .find((condition) => condition.type === 'Ready' && condition.status !== 'True');

      return waiting?.message || `Cluster ${ this.clusterName } is still coming up.`;
    }

    const messages = this.bundles
      .flatMap((bundle) => bundle.status?.conditions || [])
      .filter((condition) => condition.status === 'False' && condition.message)
      .map((condition) => condition.message);

    if (messages.length) {
      return messages.join('; ');
    }

    if (!this.targetClusterNames.length) {
      return 'No target clusters selected.';
    }

    return this.bundles.length ? '' : 'Waiting for the Fleet bundle to be created.';
  }

  async save(opt) {
    const missingDeps = await this.resolveMissingDependencies();

    if (missingDeps.length > 0) {
      throw new Error(`Cannot install "${ this.appDisplay }": required dependency app(s) do not exist: ${ missingDeps.join(', ') }.`);
    }

    this.ensureFinalizer();

    const saved = await super.save(opt);

    await this.reconcile();

    return saved;
  }

  ensureFinalizer() {
    const existing = this.metadata?.finalizers || [];

    if (!existing.includes(FINALIZER)) {
      this.metadata.finalizers = [...existing, FINALIZER];
    }
  }

  showBlockedDeleteModal() {
    if (!this.dependentInstances.length) {
      return false;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('appsplus:blocked-delete', { detail: { instance: this } }));
    }

    return true;
  }

  promptRemove(resources = this) {
    const list = Array.isArray(resources) ? resources : [resources];
    const blocked = list.find((item) => item?.showBlockedDeleteModal?.());

    if (blocked) {
      return;
    }

    return super.promptRemove(resources);
  }

  async remove(opt) {
    if (this.dependentInstances.length > 0) {
      const names = this.dependentInstances.map((i) => i.metadata?.name).join(', ');

      throw new Error(`Cannot delete "${ this.metadata?.name }" because it is required by: ${ names }`);
    }

    const existing = this.metadata?.finalizers || [];

    if (!existing.includes(FINALIZER)) {
      try {
        await this.patch([{ op: 'add', path: '/metadata/finalizers', value: [...existing, FINALIZER] }]);
      } catch (e) {
        console.warn(`apps-plus: could not hold ${ this.metadata?.name } for cleanup`, e); // eslint-disable-line no-console
      }
    }

    return super.remove(opt);
  }

  get isTerminating() {
    return !!this.metadata?.deletionTimestamp;
  }

  get terminatingStage() {
    if (!this.isTerminating) {
      return null;
    }

    if (this.bundles.length) {
      return 'resources';
    }

    if (this.provisionsCluster && this.provisionedCluster) {
      return 'cluster';
    }

    return 'finishing';
  }

  get stateDisplay() {
    switch (this.terminatingStage) {
    case 'resources':
      return 'Removing resources';
    case 'cluster':
      return 'Deleting cluster';
    case 'finishing':
      return 'Finishing';
    default:
      return super.stateDisplay;
    }
  }

  async releaseWhenEmpty() {
    if (!this.isTerminating || !(this.metadata?.finalizers || []).includes(FINALIZER)) {
      return false;
    }

    if (await this.deleteBundles()) {
      return false;
    }

    if (await this.deleteCluster()) {
      return false;
    }

    if (await this.hasRemainingResources()) {
      return false;
    }

    try {
      await this.patch([{
        op:    'replace',
        path:  '/metadata/finalizers',
        value: (this.metadata.finalizers || []).filter((f) => f !== FINALIZER),
      }]);
    } catch (e) {
      console.warn(`apps-plus: could not release ${ this.metadata?.name }`, e); // eslint-disable-line no-console

      return false;
    }

    return true;
  }

  async deleteBundles() {
    let remaining = false;

    for (const namespace of await this.candidateWorkspaces()) {
      const bundle = await this.findBundle(namespace);

      if (!bundle) {
        continue;
      }

      remaining = true;

      if (!bundle.metadata?.deletionTimestamp) {
        try {
          await bundle.remove();
        } catch (e) {
          console.warn(`apps-plus: could not remove bundle ${ namespace }/${ this.bundleName }`, e); // eslint-disable-line no-console
        }
      }
    }

    return remaining;
  }

  async deleteCluster() {
    if (!this.provisionsCluster) {
      return false;
    }

    const cluster = await this.findCluster();

    if (!cluster) {
      return false;
    }

    if (!cluster.metadata?.deletionTimestamp) {
      try {
        await cluster.remove();
      } catch (e) {
        console.warn(`apps-plus: could not remove cluster ${ this.clusterName }`, e); // eslint-disable-line no-console
      }
    }

    return true;
  }

  async hasRemainingResources() {
    if (this.provisionsCluster && await this.findCluster()) {
      return true;
    }

    for (const namespace of await this.candidateWorkspaces()) {
      if (await this.findBundle(namespace)) {
        return true;
      }
    }

    return false;
  }

  async reconcile(visited = new Set()) {
    const missingDeps = await this.resolveMissingDependencies();

    if (missingDeps.length > 0) {
      throw new Error(`Cannot deploy "${ this.appDisplay }": required dependency app(s) do not exist: ${ missingDeps.join(', ') }.`);
    }

    if (this.needsAttention) {
      return false;
    }

    await this.ensureDependencyInstances(visited);
    await this.syncCluster();
    await this.syncBundle();

    return true;
  }

  async findAllOrCached(type, opt) {
    try {
      return await this.$dispatch('findAll', opt ? { type, opt } : { type });
    } catch {
      try {
        return this.$rootGetters['management/all'](type) || [];
      } catch {
        return [];
      }
    }
  }

  async ensureDependencyInstances(visited = new Set()) {
    const app = await this.resolveApp();

    if (!app) {
      return;
    }

    const myAppName = app.metadata?.name;

    if (!myAppName || visited.has(myAppName)) {
      return;
    }

    visited.add(myAppName);

    const deps = app.dependencies || [];

    if (!deps.length) {
      return;
    }

    const allInstances = await this.findAllOrCached(APP_INSTANCE, { force: true });

    for (const depAppName of deps) {
      if (visited.has(depAppName)) {
        continue;
      }

      const existing = allInstances.find((inst) => (
        inst?.spec?.app === depAppName && !inst.isTerminating
      ));

      if (existing) {
        const currentReq = new Set(
          parseDependencyList(existing.metadata?.annotations?.[REQUIRED_BY_ANNOTATION])
        );

        if (this.metadata?.name && !currentReq.has(this.metadata.name)) {
          currentReq.add(this.metadata.name);
          existing.metadata.annotations = {
            ...(existing.metadata?.annotations || {}),
            [REQUIRED_BY_ANNOTATION]: [...currentReq].join(','),
          };
          try {
            await existing.save();
          } catch {}
        }
        continue;
      }

      const depInstanceName = `${ depAppName }-dep`;
      const created = await this.$dispatch('create', {
        type:     APP_INSTANCE,
        metadata: {
          name:        depInstanceName,
          labels:      { [DEPENDENCY_INSTANCE_LABEL]: 'true' },
          annotations: this.metadata?.name ? { [REQUIRED_BY_ANNOTATION]: this.metadata.name } : {},
        },
        spec: {
          app:       depAppName,
          namespace: this.targetNamespace,
          targets:   this.effectiveTargets,
        },
      });

      const savedDep = await created.save();

      allInstances.push(savedDep);
    }
  }

  async resolveMissingDependencies() {
    const app = await this.resolveApp();

    if (!app) {
      return [];
    }

    const deps = app.dependencies || [];

    if (!deps.length) {
      return [];
    }

    const allApps = await this.findAllOrCached(APP);
    const existingNames = new Set(allApps.map((a) => a.metadata?.name));

    return deps.filter((dep) => !existingNames.has(dep));
  }

  get ownerReference() {
    return {
      apiVersion:         'appsplus.io/v1alpha1',
      kind:               'AppInstance',
      name:               this.metadata?.name,
      uid:                this.metadata?.uid,
      blockOwnerDeletion: true,
    };
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

  async cloudCredentialId() {
    let credentials = [];

    try {
      credentials = await this.$dispatch('rancher/findAll', { type: NORMAN.CLOUD_CREDENTIAL }, { root: true });
    } catch {
      return '';
    }

    const match = (credentials || []).find((credential) => (
      !!credential?.[`${ DEFAULT_CLUSTER_DRIVER }credentialConfig`]
    ));

    return match?.id || '';
  }

  async syncCluster() {
    if (!this.provisionsCluster) {
      return null;
    }

    const app = await this.resolveApp();
    const source = app?.spec?.clusterTemplate?.trim() || DEFAULT_CLUSTER_TEMPLATE;
    const values = { ...DEFAULT_CLUSTER_VALUES, ...mergeValues(app, this) };

    if (!isSet(values, 'cloudCredential')) {
      values.cloudCredential = await this.cloudCredentialId();
    }

    const rendered = substitute(source, values, { ...DEFAULT_CLUSTER_VALUES, ...(app?.spec?.values || {}) });
    let documents;

    try {
      documents = jsyaml.loadAll(rendered).filter((document) => !!document);
    } catch (error) {
      throw new Error(`The cluster template is not valid YAML: ${ error.message }`);
    }

    if (!documents.length) {
      throw new Error('The cluster template is empty.');
    }

    if (!documents.some((document) => document.kind === 'Cluster')) {
      throw new Error('The cluster template describes no Cluster: one document must be a provisioning.cattle.io Cluster.');
    }

    let cluster = null;

    for (const document of documents) {
      const saved = await this.applyClusterDocument(document);

      if (document.kind === 'Cluster') {
        cluster = saved;
      }
    }

    return cluster;
  }

  async applyClusterDocument(document) {
    const type = steveType(document);
    const name = document.metadata?.name || this.clusterName;
    const namespace = document.metadata?.namespace || PROVISION_WORKSPACE;
    const body = { ...document };

    delete body.apiVersion;
    delete body.kind;
    delete body.metadata;

    const existing = await this.findClusterObject(type, namespace, name);

    if (existing) {
      Object.assign(existing, body);

      return existing.save();
    }

    const created = await this.$dispatch('create', {
      type,
      metadata: {
        name,
        namespace,
        labels:          { ...(document.metadata?.labels || {}), 'appsplus.io/instance': this.metadata?.name },
        annotations:     document.metadata?.annotations || {},
        ownerReferences: [this.ownerReference],
      },
      ...body,
    });

    return created.save();
  }

  async findClusterObject(type, namespace, name) {
    try {
      return await this.$dispatch('find', {
        type,
        id:  `${ namespace }/${ name }`,
        opt: { force: true },
      });
    } catch {
      return null;
    }
  }

  findCluster() {
    return this.findClusterObject(PROVISIONING_CLUSTER, PROVISION_WORKSPACE, this.clusterName);
  }

  async targetsByWorkspace() {
    const out = new Map();

    if (this.provisionsCluster) {
      out.set(PROVISION_WORKSPACE, [{ clusterName: this.clusterName }]);

      return out;
    }

    let clusters = [];

    try {
      clusters = await this.$dispatch('findAll', { type: FLEET_CLUSTER });
    } catch {
      clusters = [];
    }

    for (const name of this.targetClusterNames) {
      const workspace = clusters.find((cluster) => cluster.metadata?.name === name)
        ?.metadata?.namespace || DEFAULT_WORKSPACE;

      out.set(workspace, [...(out.get(workspace) || []), { clusterName: name }]);
    }

    return out;
  }

  async syncBundle() {
    const app = await this.resolveApp();
    let resources = renderTemplates(app, this);
    const byWorkspace = await this.targetsByWorkspace();
    const helmSpec = { takeOwnership: true };

    if (app?.isHelmChart) {
      const helm = app.spec?.helm || {};
      const selectedVersion = this.spec?.version || helm.version || '';
      let baseValues = app?.spec?.values || {};
      let chartFiles = app?.templates || [];

      if (helm.repo && helm.chart && selectedVersion && (selectedVersion !== helm.version || !chartFiles.length)) {
        try {
          const details = await fetchHelmVersionDetails(helm.repo, helm.chart, selectedVersion);

          if (details?.files?.length) {
            chartFiles = details.files;
          }
          if (details?.values && Object.keys(details.values).length) {
            baseValues = details.values;
          }
        } catch {}
      }

      const merged = {
        ...baseValues,
        ...typedOverrides(baseValues, this.spec?.values),
      };
      const hasChartYaml = chartFiles.some((f) => f?.name === 'Chart.yaml');

      if (hasChartYaml) {
        resources = chartFiles;
      } else {
        if (helm.repo) {
          helmSpec.repo = helm.repo;
        }
        if (helm.chart) {
          helmSpec.chart = helm.chart;
        }
        if (selectedVersion) {
          helmSpec.version = selectedVersion;
        }
      }

      helmSpec.releaseName = helm.releaseName || this.metadata?.name || helm.chart;
      if (Object.keys(merged).length > 0) {
        helmSpec.values = unflattenValues(merged);
      }
    }

    for (const [namespace, targets] of byWorkspace) {
      const bundleSpec = {
        targets,
        defaultNamespace: this.targetNamespace,
        helm:             helmSpec,
      };

      if (!app?.isHelmChart || resources.length > 0) {
        bundleSpec.resources = resources;
      }

      await this.writeBundle(namespace, bundleSpec);
    }

    await this.pruneBundles([...byWorkspace.keys()]);
  }

  async writeBundle(namespace, spec) {
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
        labels:          {
          'appsplus.io/instance': this.metadata?.name,
          'appsplus.io/install':  this.metadata?.name,
        },
        ownerReferences: [this.ownerReference],
      },
      spec,
    });

    return bundle.save();
  }

  async candidateWorkspaces() {
    const found = new Set([DEFAULT_WORKSPACE, PROVISION_WORKSPACE]);

    try {
      const clusters = await this.$dispatch('findAll', { type: FLEET_CLUSTER });

      clusters.forEach((cluster) => {
        if (cluster.metadata?.namespace) {
          found.add(cluster.metadata.namespace);
        }
      });
    } catch {}

    return [...found];
  }

  async pruneBundles(keep) {
    const candidates = await this.candidateWorkspaces();

    for (const namespace of candidates) {
      if (keep.includes(namespace)) {
        continue;
      }

      const bundle = await this.findBundle(namespace);

      if (!bundle) {
        continue;
      }

      try {
        await bundle.remove();
      } catch {}
    }
  }

  async findBundle(namespace) {
    try {
      return await this.$dispatch('find', {
        type: FLEET_BUNDLE,
        id:   `${ namespace }/${ this.bundleName }`,
        opt:  { force: true },
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
        enabled: !!this.spec?.app && !this.needsAttention,
      },
      { divider: true },
      ...super.availableActions,
    ];
  }

  async redeploy() {
    try {
      const done = await this.reconcile();

      if (!done) {
        this.$dispatch('growl/error', {
          title:   'Nothing deployed',
          message: this.stateDescription,
          timeout: 8000,
        }, { root: true });
      }
    } catch (error) {
      this.$dispatch('growl/fromError', { title: 'Redeploy failed', error }, { root: true });
    }
  }

  get confirmRemove() {
    return this.provisionsCluster;
  }

  get warnDeletionMessage() {
    if (!this.provisionsCluster) {
      return null;
    }

    return `This also deletes the cluster ${ this.clusterName } and everything running on it, ` +
      'including anything deployed there by someone else.';
  }
}
