# apps-plus, from inside the pod

You are claude, running in the pod that serves this extension, in the tree it serves.

`/app` is a whole Rancher dashboard build with this package (`/app/pkg/apps-plus`) compiled
into it, and `vue-cli-service serve` is watching it. Every file you save here is recompiled and
pushed into the browser within a few seconds. There is no build step, and **restarting the dev
server is the one thing that interrupts whoever is watching it**.

## What this extension is

Two ideas, and the whole thing follows from them:

- An **App** is a definition - a set of YAML files and the values they render with. It is the
  chart half. It deploys nothing.
- An **AppInstance** is one deployment of an App to one or more clusters. It is the release
  half. It can instead *provision* a cluster of its own and deploy to that.

The list page shows both at once, apps as group headings and their instances as the rows,
which is the shape Cluster Explorer uses for Projects and Namespaces.

**Fleet does the deploying.** There is no controller behind these CRDs and there is not meant
to be one: saving an AppInstance renders its App's templates and writes a `fleet.cattle.io`
Bundle, and Fleet's own controllers match the targets, ship the resources to each cluster's
agent and report back. The Bundle carries an ownerReference to the instance, so deleting an
instance garbage-collects the Bundle and Fleet removes what it applied.

That is why `models/appsplus.io.appinstance.js` is the biggest file here. It is not a model
with helpers on it; it is the reconciler, and `save()` is the only place a deploy happens.

## Provisioning a cluster

An instance with `spec.provisionCluster.enabled` creates a `provisioning.cattle.io/v1 Cluster`
in `fleet-default` from the app's `spec.clusterTemplate`, rendered with the same `${...}`
substitution as any resource template. **One instance owns at most one cluster**, and an
instance that provisions one deploys to that cluster and nothing else - the target picker is
replaced, not added to.

The cluster carries an ownerReference back to the instance, so **deleting an instance deletes
its cluster**. That is deliberate and it is destructive; `confirmRemove` makes Rancher demand
the name be typed, and `warnDeletionMessage` says what is about to go. Do not quietly remove
either.

Three things about this that are easy to get wrong:

- **The Bundle is written before the cluster exists.** A new cluster has no Fleet `Cluster`
  object for minutes, so resolving its workspace by lookup falls back to `fleet-local` and the
  Bundle lands somewhere it can never match. When an instance provisions, the workspace is
  known up front (`fleet-default`). Fleet tolerates a target that is not there yet.
- **The default template is a *custom* cluster** - no `machinePools`, so no cloud credential is
  needed and Rancher publishes a registration command instead. Adding a `machinePools` block
  with a `machineConfigRef` makes it driver-backed, which needs a credential configured first.
- **Steve's collection cache lies.** Listing `fleet.cattle.io.bundle` can omit a Bundle that
  exists and include one that is gone, for minutes at a time; a GET by id is accurate. That is
  why `pruneBundles()` looks each candidate workspace up by id rather than listing and
  filtering - built on a listing, the prune silently did nothing.

## What is where

| Thing | File |
| --- | --- |
| Entry point | `index.ts` - `importTypes`, `addProduct`, and no routes at all |
| Product, nav, type options | `product.ts` |
| Shared names | `config/types.ts` |
| Template rendering | `render.ts` |
| App model | `models/appsplus.io.app.js` |
| Instance model, and the Bundle sync | `models/appsplus.io.appinstance.js` |
| The Apps and Instances list | `list/appsplus.io.app.vue` |
| Create/edit forms | `edit/appsplus.io.*.vue` |
| Detail pages | `detail/appsplus.io.*.vue` |
| Strings | `l10n/en-us.yaml` |
| The two CRDs | `crds.yaml` |

**This extension registers no routes.** Everything is reached through the shell's generic
`c-cluster-product-resource*` routes, which render whatever `list/`, `edit/` and `detail/`
provide for a type. Files are found by name: `appsplus.io.app` looks for
`models/appsplus.io.app.js`, `edit/appsplus.io.app.vue` and so on, and renaming the type
without renaming every file is a page that renders blank with no error.

## The types

Steve names a type `<group>.<kind lowercased>`, so the CRD `apps.appsplus.io` is
`appsplus.io.app` in every line of code here. Both are cluster-scoped, and both live in the
**management** store, because this product owns no cluster.

The CRDs are applied out of band, not by this extension:

```bash
kubectl apply -f /app/pkg/apps-plus/crds.yaml
kubectl get apps.appsplus.io appinstances.appsplus.io
```

After applying them the dashboard needs a page reload before it has the new schemas.

## Looking at what you changed

```bash
kubectl get bundles.fleet.cattle.io -A                 # one per workspace an instance targets
kubectl get appinstances.appsplus.io
kubectl -n fleet-default get clusters.provisioning.cattle.io   # what instances provisioned

# The registration command for a custom cluster, which lives in the management cluster's
# own namespace - the provisioning cluster's status.clusterName.
CN=$(kubectl -n fleet-default get cluster.provisioning.cattle.io <name> -o jsonpath='{.status.clusterName}')
kubectl -n $CN get clusterregistrationtokens.management.cattle.io default-token \
  -o jsonpath='{.status.nodeCommand}'
```

If an instance is stuck pending, the Bundle's `status` says why, and it is nearly always the
target: **a Bundle only reaches clusters in its own namespace**. That is why an instance whose
targets span two workspaces gets one Bundle in each (`targetsByWorkspace()`), and why putting
them all in the first target's workspace deploys to only some of them.

The shell's own components are the fastest documentation there is, because they are here:

```bash
ls /app/node_modules/@rancher/shell/components        # SortableTable, CruResource, YamlEditor
ls /app/node_modules/@rancher/shell/rancher-components # Banner, RcButton, Form/LabeledInput
```

`components/ExplorerProjectsNamespaces.vue` in particular is what `list/appsplus.io.app.vue`
is modelled on, down to the placeholder row that keeps an empty group visible.

## The rules of this tree

- **Nothing here syncs anywhere by itself.** This tree lives as long as the pod's `/app` does.
  The seed ConfigMap `apps-plus-extension` in `extension-studio` is what a fresh pod writes its
  tree from, with paths flattened using `__`. An edit here is not in it until it is copied over.
- **Do not restart the dev server.** Somebody is watching the pane it serves.
- **`yarn install` is minutes**, and survives only as long as this pod does.
