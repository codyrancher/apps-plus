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
  half.

The list page shows both at once, apps as group headings and their instances as the rows,
which is the shape Cluster Explorer uses for Projects and Namespaces.

**Fleet does the deploying.** There is no controller behind these CRDs and there is not meant
to be one: saving an AppInstance renders its App's templates and writes a `fleet.cattle.io`
Bundle, and Fleet's own controllers match the targets, ship the resources to each cluster's
agent and report back. The Bundle carries an ownerReference to the instance, so deleting an
instance garbage-collects the Bundle and Fleet removes what it applied.

That is why `models/appsplus.io.appinstance.js` is the biggest file here. It is not a model
with helpers on it; it is the reconciler, and `save()` is the only place a deploy happens.

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
kubectl -n fleet-local get bundles                     # one per instance, named apps-plus-<instance>
kubectl -n fleet-local get bundle apps-plus-<name> -o yaml
kubectl get appinstances.appsplus.io
```

If an instance is stuck pending, the Bundle's `status` says why, and it is nearly always the
target: a Bundle in `fleet-local` can only target the local cluster, and a downstream one has
to be in `fleet-default`. `workspaceFor()` in the instance model is what picks that.

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
