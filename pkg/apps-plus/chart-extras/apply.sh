#!/usr/bin/env bash
# Overlay the Apps Plus backend (CRDs + service) onto the already-published chart, so a single
# `helm install` of it stands up everything the extension needs on one cluster. Run by the
# patch-chart job after the shell's generator has published the UI-only chart to gh-pages.
#
#   apply.sh <gh-pages-root>
#
# Idempotent: re-running overwrites the overlaid files and recomputes the digest, so a rebuilt
# version converges rather than doubling up.
set -euo pipefail

GHPAGES="${1:?usage: apply.sh <gh-pages-root>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OVERLAY="$ROOT/pkg/apps-plus/chart-extras"
VERSION="$(node -p "require('$ROOT/pkg/apps-plus/package.json').version")"

TGZ="$GHPAGES/assets/apps-plus/apps-plus-$VERSION.tgz"
[ -f "$TGZ" ] || { echo "apply: no published chart at $TGZ - did the generator run?"; exit 1; }

WORK="$(mktemp -d)"
tar xzf "$TGZ" -C "$WORK"
CHART="$WORK/apps-plus"

cp -R "$OVERLAY/crds"  "$CHART/crds"
cp -R "$OVERLAY/files" "$CHART/files"
cp "$OVERLAY/templates/apps-plus-api.yaml" "$CHART/templates/apps-plus-api.yaml"
grep -q '^backend:' "$CHART/values.yaml" || printf '\nbackend:\n  enabled: true\n  image: node:24\n' >> "$CHART/values.yaml"

helm lint "$CHART"
helm template apps-plus "$CHART" -n cattle-ui-plugin-system --include-crds >/dev/null

OUT="$(mktemp -d)"
helm package "$CHART" -d "$OUT" >/dev/null
cp "$OUT/apps-plus-$VERSION.tgz" "$TGZ"

# Keep the human-readable source tree in charts/ in step with the archive.
rm -rf "$GHPAGES/charts/apps-plus/$VERSION"
mkdir -p "$GHPAGES/charts/apps-plus/$VERSION"
cp -R "$CHART/." "$GHPAGES/charts/apps-plus/$VERSION/"

# Bare hex, matching the format `helm repo index` writes and verifies against - not a sha256: prefix.
DIGEST="$(sha256sum "$TGZ" | cut -d' ' -f1)"
node "$OVERLAY/reindex.mjs" "$GHPAGES/index.yaml" "$VERSION" "$DIGEST"

echo "apply: patched apps-plus $VERSION with CRDs + backend ($DIGEST)"
