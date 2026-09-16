// The Apps Plus service: the half of this extension that is not a browser.
//
// Everything else here is a Vue bundle, which means everything else here only happens while
// somebody has the dashboard open. That is the right bargain for a UI, and the wrong one for
// the two jobs below - both of which are *owed* by this extension to objects it created, and
// neither of which anybody is watching.
//
// Modelled on Extension Studio's service (extension-skeleton/pod/service), and deliberately the
// same shape: plain node with no dependencies, run from a ConfigMap by `node /seed/server.mjs`,
// answering `/healthz` with the fingerprint of the source it was started from so "is the cluster
// running what this bundle would write" is one unauthenticated request. It registers itself in
// the Studio's API registry like anything else - see service.ts.
//
// It talks to the apiserver directly with its own ServiceAccount token, not to Rancher and not
// as a person. That is a deliberate narrowing: this service performs one kind of janitorial work
// on one CRD, it should be able to do that with nobody logged in, and it should not be able to
// do anything else.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT || 8090);
const VERSION = process.env.API_SOURCE_VERSION || 'unknown';
const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const TOKEN = fs.readFileSync(`${ SA }/token`, 'utf8').trim();
const CA = fs.readFileSync(`${ SA }/ca.crt`);
const HOST = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
const API_PORT = process.env.KUBERNETES_SERVICE_PORT || '443';

const INSTANCES = '/apis/appsplus.io/v1alpha1/appinstances';
const BUNDLES = '/apis/fleet.cattle.io/v1alpha1';
const CLEANUP_FINALIZER = 'appsplus.io/cleanup';
const INSTALL_LABEL = 'appsplus.io/install';

/** How often the reconcile runs. Seconds' work, so the interval is about how soon, not how long. */
const TICK_MS = Number(process.env.RECONCILE_MS || 15000);

/** The apiserver, as this pod. */
function k8s(path, { method = 'GET', body, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${ TOKEN }` };

    if (body) {
      headers['content-type'] = contentType || 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }

    const req = https.request({
      host: HOST, port: API_PORT, path, method, ca: CA, headers,
    }, (res) => {
      let text = '';

      res.on('data', (c) => {
        text += c;
      });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const error = new Error(`${ method } ${ path } -> ${ res.statusCode } ${ text.slice(0, 300) }`);

          error.status = res.statusCode;

          return reject(error);
        }
        try {
          resolve(text ? JSON.parse(text) : null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/** The Bundles one Installation deployed, which carry its name as a label. */
async function bundlesOf(name) {
  const selector = encodeURIComponent(`${ INSTALL_LABEL }=${ name }`);
  const list = await k8s(`${ BUNDLES }/bundles?labelSelector=${ selector }`).catch(() => null);

  return list?.items || [];
}

/**
 * One pass at releasing one Installation that is mid-delete.
 *
 * This is the browser model's `releaseWhenEmpty` (models/appsplus.io.appinstance.js), in a
 * service, and deliberately in the same order - the order is the promise the UI makes: the
 * Bundles first, because they are seconds and a cluster is minutes, and because a cluster torn
 * down under its own workloads is the wrong way round.
 *
 * Returns true only when the finalizer actually came off. False means there is still something
 * to tear down and the next tick should look again, which is what makes this a driver rather
 * than a retry: each tick does one pass and the object either progresses or does not.
 *
 * Why this exists at all: deleting an Installation is two steps and only the first is
 * Kubernetes'. The delete adds `appsplus.io/cleanup` and asks for the delete; something then has
 * to tear down what it deployed and take the finalizer off. Until now the only thing that could
 * was a loop inside the browser's own delete - so closing the tab, navigating away, or a teardown
 * that outlasted the loop's two minutes left the object Terminating for ever, with its row still
 * in every list and a second delete doing nothing because the object was already deleting.
 */
async function releaseOne(instance) {
  const name = instance?.metadata?.name;
  const finalizers = instance?.metadata?.finalizers || [];

  if (!name || !instance.metadata?.deletionTimestamp || !finalizers.includes(CLEANUP_FINALIZER)) {
    return false;
  }

  const bundles = await bundlesOf(name);
  const alive = bundles.filter((bundle) => !bundle.metadata?.deletionTimestamp);

  for (const bundle of alive) {
    await k8s(`${ BUNDLES }/namespaces/${ bundle.metadata.namespace }/bundles/${ bundle.metadata.name }`, { method: 'DELETE' }).catch(() => null);
  }

  // Asked to go is not gone. Anything still listed - including the ones just asked for - means
  // come back next tick.
  if (bundles.length) {
    return false;
  }

  // A JSON patch, because a merge patch cannot take one entry out of a list. Conflicts are
  // ordinary here: another tick, or a browser doing the same work, may have got there first, and
  // the finalizer being off is all this wanted either way.
  await k8s(`${ INSTANCES }/${ name }`, {
    method:      'PATCH',
    contentType: 'application/json-patch+json',
    body:        JSON.stringify([{
      op: 'replace', path: '/metadata/finalizers', value: finalizers.filter((f) => f !== CLEANUP_FINALIZER),
    }]),
  });

  return true;
}

/** Every Installation mid-delete, one pass each. */
async function reconcile() {
  const list = await k8s(INSTANCES);
  const terminating = (list?.items || []).filter((i) => i.metadata?.deletionTimestamp);
  const released = [];

  for (const instance of terminating) {
    if (await releaseOne(instance).catch(() => false)) {
      released.push(instance.metadata.name);
    }
  }

  return { terminating: terminating.map((i) => i.metadata.name), released };
}

// What the last tick did, so the endpoint below reports observed fact rather than running the
// work again for a reader. A GET that has side effects is a GET nobody can safely poll.
let last = { at: null, terminating: [], released: [], error: '' };

async function tick() {
  try {
    const result = await reconcile();

    last = { at: new Date().toISOString(), ...result, error: '' };
    if (result.released.length) {
      console.log(`[apps-plus] released ${ result.released.join(', ') }`);
    }
  } catch (e) {
    last = {
      at: new Date().toISOString(), terminating: [], released: [], error: e.message,
    };
    console.warn(`[apps-plus] reconcile failed: ${ e.message }`);
  }
}

const OPENAPI = {
  openapi: '3.1.0',
  info:    {
    title:       'Apps Plus API',
    version:     VERSION,
    description: 'The part of Apps Plus that runs without a browser: it finishes deleting Installations whose teardown nobody stayed to watch.',
  },
  paths: {
    '/healthz': {
      get: {
        operationId: 'healthz',
        summary:     'Liveness, and which source this pod is running.',
        description: 'The version is the fingerprint of the service source the pod was started with, so a cluster running a stale copy can be spotted without reading its ConfigMap. No credential: a probe has none, and a liveness check that can fail on authorization restarts healthy pods.',
        responses:   { 200: { description: 'The service is up, and which source it is.' } },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'openapi',
        summary:     'This document.',
        responses:   { 200: { description: 'The OpenAPI document.' } },
      },
    },
    '/v1/cleanup': {
      get: {
        operationId: 'cleanupState',
        summary:     'What the last reconcile saw and released.',
        description: 'Observed, not performed: this reports the most recent tick rather than running one, so it is safe to poll. `terminating` is what was mid-delete when it ran and `released` is what had its finalizer taken off. An empty `terminating` with no error is the healthy steady state.',
        responses:   { 200: { description: 'The last tick.' } },
      },
    },
  },
};

function send(res, status, body) {
  const text = JSON.stringify(body, null, 1);

  res.writeHead(status, {
    'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'access-control-allow-origin': '*',
  });
  res.end(text);
}

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://apps-plus-api').pathname;

  if (path === '/healthz') {
    return send(res, 200, { ok: true, version: VERSION });
  }
  if (path === '/openapi.json') {
    return send(res, 200, OPENAPI);
  }
  if (path === '/v1/cleanup') {
    return send(res, 200, last);
  }

  return send(res, 404, { error: `No route for ${ path }. GET /openapi.json is the list.` });
}).listen(PORT, () => {
  console.log(`[apps-plus] listening on :${ PORT } (source ${ VERSION })`);
  tick();
  setInterval(tick, TICK_MS);
});
