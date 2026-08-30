// Every name this extension shares between its product, its routes and its models.
//
// Two of them are Steve type ids rather than Kubernetes ones: Steve names a type
// `<group>.<kind lowercased>`, so the CRD `apps.appsplus.io` is `appsplus.io.app` here.

export const PRODUCT_NAME = 'apps-plus';

// A product with no cluster of its own still needs a `:cluster` param. `_` is the shell's
// placeholder for "none", exported as BLANK_CLUSTER from @shell/store/store-types.
export const BLANK_CLUSTER = '_';

export const APP = 'appsplus.io.app';
export const APP_INSTANCE = 'appsplus.io.appinstance';

export const CRD = 'apiextensions.k8s.io.customresourcedefinition';

// Fleet is what actually deploys an instance. An App Instance renders its App's templates
// into a Bundle, and Fleet's agent on each target cluster applies it and reports back.
export const FLEET_BUNDLE = 'fleet.cattle.io.bundle';
export const FLEET_CLUSTER = 'fleet.cattle.io.cluster';

// The Bundle an instance owns is named after it, so the pair can be found from either side
// without a label selector.
export const BUNDLE_PREFIX = 'apps-plus-';

// The Fleet workspace to fall back to when the target cluster cannot be resolved to one.
// fleet-local is the workspace holding the Rancher-local cluster.
export const DEFAULT_WORKSPACE = 'fleet-local';

export const DEFAULT_TARGET_NAMESPACE = 'default';

// The shell's generic resource routes. A product page reaches them with its own product name
// in the params, so none of these are registered by this extension.
export const LIST_ROUTE = 'c-cluster-product-resource';
export const CREATE_ROUTE = 'c-cluster-product-resource-create';
export const DETAIL_ROUTE = 'c-cluster-product-resource-id';

// Which App a "Create Instance" button was pressed on, carried to the create form.
export const APP_QUERY = 'app';
