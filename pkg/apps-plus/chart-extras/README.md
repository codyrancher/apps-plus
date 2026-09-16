# chart-extras — the backend half of the published chart

The Rancher shell's chart generator (`@rancher/shell` `publish`) emits a chart containing
only the `UIPlugin`. That is the whole of a normal UI extension, but Apps Plus is not only a
UI: it defines two cluster-scoped CRDs (`apps.appsplus.io`, `appinstances.appsplus.io`) and
runs one small service (`apps-plus-api`) that finishes deleting Installations nobody stayed to
watch. Without the CRDs the extension installs but shows no nav — Rancher hides a nav entry
whose resource type has no schema on the cluster.

So a single `helm install` of the published chart is supposed to bring up everything the
extension needs on one cluster. The generator has no hook for extra resources, so the
`patch-chart` job in `.github/workflows/build-extension-charts.yml` overlays these onto the
published chart after the generator runs, using `apply.sh`:

- `crds/` — installed by Helm's `crds/` convention (first install only, which is the single
  install this is for; Helm never upgrades or deletes CRDs, by design).
- `templates/apps-plus-api.yaml` — the service: ServiceAccount, a **narrow** ClusterRole (not
  the cluster-admin it is granted inside Extension Studio), ConfigMap, Deployment, Service.
  Toggle off with `--set backend.enabled=false` on a cluster that only wants the UI.
- `files/apps-plus-api.mjs` — the service source, run from the ConfigMap by `node /seed/server.mjs`.

The source here is a copy of the service that runs in Extension Studio. If that service
changes, update this copy — `apply.sh` embeds whatever is here.
