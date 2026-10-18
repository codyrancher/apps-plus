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

const TICK_MS = Number(process.env.RECONCILE_MS || 15000);

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

async function bundlesOf(name) {
  const [byInstall, byInstance] = await Promise.all([
    k8s(`${ BUNDLES }/bundles?labelSelector=${ encodeURIComponent(`${ INSTALL_LABEL }=${ name }`) }`).catch(() => null),
    k8s(`${ BUNDLES }/bundles?labelSelector=${ encodeURIComponent(`appsplus.io/instance=${ name }`) }`).catch(() => null),
  ]);
  const map = new Map();

  for (const item of [...(byInstall?.items || []), ...(byInstance?.items || [])]) {
    const key = `${ item.metadata?.namespace }/${ item.metadata?.name }`;

    map.set(key, item);
  }

  return [...map.values()];
}

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

  if (bundles.length) {
    return false;
  }

  await k8s(`${ INSTANCES }/${ name }`, {
    method:      'PATCH',
    contentType: 'application/json-patch+json',
    body:        JSON.stringify([{
      op: 'replace', path: '/metadata/finalizers', value: finalizers.filter((f) => f !== CLEANUP_FINALIZER),
    }]),
  });

  return true;
}

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
    '/v1/helm/fetch': {
      get: {
        operationId: 'helmFetch',
        summary:     'Fetch a Helm repository index.yaml or chart archive without browser CORS restrictions.',
        responses:   { 200: { description: 'Fetched content.' } },
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

http.createServer(async(req, res) => {
  const parsed = new URL(req.url, 'http://apps-plus-api');
  const path = parsed.pathname;

  if (path === '/healthz') {
    return send(res, 200, { ok: true, version: VERSION });
  }
  if (path === '/openapi.json') {
    return send(res, 200, OPENAPI);
  }
  if (path === '/v1/cleanup') {
    return send(res, 200, last);
  }
  if (path === '/v1/helm/fetch') {
    const targetUrl = parsed.searchParams.get('url');

    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return send(res, 400, { error: 'Missing or invalid url query parameter.' });
    }
    try {
      const upstream = await fetch(targetUrl);

      if (!upstream.ok) {
        return send(res, upstream.status, { error: `Upstream HTTP ${ upstream.status }` });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const binary = parsed.searchParams.get('binary') === '1' || parsed.searchParams.get('encoding') === 'base64';

      return send(res, 200, binary ? { base64: buf.toString('base64') } : { data: buf.toString('utf8'), text: buf.toString('utf8') });
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }

  return send(res, 404, { error: `No route for ${ path }. GET /openapi.json is the list.` });
}).listen(PORT, () => {
  console.log(`[apps-plus] listening on :${ PORT } (source ${ VERSION })`);
  tick();
  setInterval(tick, TICK_MS);
});
