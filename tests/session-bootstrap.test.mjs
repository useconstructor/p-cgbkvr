import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

// Controlled client contracts, not native-browser or deployment evidence.
function fixture(handler, { deniedStorage = false, deniedLock = false, missingLock = false, marker } = {}) {
  const values = new Map(marker ? [['tm-session-expectation:direct', JSON.stringify(marker)]] : []);
  const localStorage = {
    getItem(key) { if (deniedStorage) throw new DOMException('Denied', 'SecurityError'); return values.get(key) ?? null; },
    setItem(key, value) { if (deniedStorage) throw new DOMException('Denied', 'SecurityError'); values.set(key, value); },
  };
  const window = { setTimeout, clearTimeout, location: { origin: 'http://localhost' } };
  window.self = window.top = window;
  const moduleScope = { exports: {} }, calls = [];
  const fetch = async (url, options) => {
    const call = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    calls.push(call); return handler(call);
  };
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/order-client.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module: moduleScope, exports: moduleScope.exports, window, localStorage,
    navigator: { locks: missingLock ? undefined : { request: async (_name, _options, work) => {
      if (deniedLock) throw new DOMException('Denied', 'SecurityError'); return work();
    } } }, fetch, crypto: webcrypto, DOMException, AbortController, URL, Intl });
  return { api: moduleScope.exports, calls };
}
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const noOwner = () => reply(401, { error: { code: 'SESSION_REQUIRED', message: 'No owner' } });
const owned = { cart: { id: 'owned-cart' }, latestOrder: null };

test('response loss retains intent; automatic mount never replays; explicit retry uses exact payload', async () => {
  let posts = 0, owner = false;
  const { api, calls } = fixture(call => {
    if (call.url === '/api/cart') return owner ? reply(200, owned) : noOwner();
    posts++;
    if (posts === 1) throw new TypeError('Response lost after commit');
    owner = true; return reply(200, { cart: owned.cart });
  });
  await assert.rejects(api.establishSession(), e => e.body.error.code === 'SESSION_INITIALIZATION_UNCERTAIN');
  await assert.rejects(api.establishSession(), e => e.status === 401);
  assert.equal(posts, 1);
  assert.equal((await api.establishSession(false, true)).cart.id, 'owned-cart');
  const submitted = calls.filter(c => c.method === 'POST');
  assert.equal(submitted.length, 2); assert.deepEqual(submitted[1].body, submitted[0].body);
  assert.equal(submitted[0].body.recover, false);
});

test('authorized read reconciles lost response without another bootstrap POST', async () => {
  let owner = false;
  const { api, calls } = fixture(call => {
    if (call.url === '/api/cart') return owner ? reply(200, owned) : noOwner();
    owner = true; throw new TypeError('Body lost after cookie arrived');
  });
  assert.equal((await api.establishSession()).cart.id, 'owned-cart');
  assert.equal((await api.establishSession()).cart.id, 'owned-cart');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('reload metadata cannot automatically replay, but explicit retry keeps the saved original key', async () => {
  const original = { idempotencyKey: webcrypto.randomUUID(), recover: false };
  let owner = false;
  const { api, calls } = fixture(call => {
    if (call.url === '/api/cart') return owner ? reply(200, owned) : noOwner();
    owner = true; return reply(200, {});
  }, { marker: { bootstrapKey: original.idempotencyKey, recover: original.recover } });
  await assert.rejects(api.establishSession(), e => e.status === 401);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.equal((await api.establishSession(false, true)).cart.id, 'owned-cart');
  assert.deepEqual(calls.find(c => c.method === 'POST').body, original);
});

test('an actual HTTP refusal remains its original error and does not claim reconciliation', async () => {
  const { api, calls } = fixture(call => call.url === '/api/cart' ? noOwner() : reply(503, {
    error: { code: 'SERVICE_UNAVAILABLE', message: 'The server refused initialization' },
  }));
  await assert.rejects(api.establishSession(), e => e.status === 503 && e.body.error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(calls.filter(c => c.method === 'GET').length, 1);
});

test('unknown private-read network failure cannot bootstrap even through explicit retry', async () => {
  const { api, calls } = fixture(() => { throw new TypeError('Private read unavailable'); });
  await assert.rejects(api.establishSession(), /Private read unavailable/);
  await assert.rejects(api.establishSession(false, true), /Private read unavailable/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('known lost ownership never silently starts a new identity on access retry', async () => {
  const { api, calls } = fixture(() => noOwner(), { marker: { expected: true } });
  await assert.rejects(api.establishSession(false, true), e => e.status === 401);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('denied storage/lock: automatic and access retry make no POST; explicit permission reuses intent', async () => {
  const { api, calls } = fixture(call => call.url === '/api/cart' ? noOwner() : reply(200, {}), {
    deniedStorage: true, deniedLock: true,
  });
  await assert.rejects(api.establishSession(), e => e.status === 401);
  await assert.rejects(api.establishSession(false, true), e => e.status === 401);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  await assert.rejects(api.establishSession(true), e => e.status === 401);
  await assert.rejects(api.establishSession(true), e => e.status === 401);
  const submitted = calls.filter(c => c.method === 'POST');
  assert.equal(submitted.length, 2); assert.deepEqual(submitted[1].body, submitted[0].body);
  assert.equal(submitted[0].body.recover, true);
});

test('missing Web Locks API fails closed for automatic, access retry and explicit new-session actions', async () => {
  const { api, calls } = fixture(call => call.url === '/api/cart' ? noOwner() : reply(200, {}), { missingLock: true });
  await assert.rejects(api.establishSession(), e => e.status === 401);
  await assert.rejects(api.establishSession(false, true), e => e.status === 401);
  await assert.rejects(api.establishSession(true), e => e.status === 401);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('present API with pre-callback SecurityError allows one explicitly requested attempt only', async () => {
  const { api, calls } = fixture(call => call.url === '/api/cart' ? noOwner() : reply(200, {}), {
    deniedStorage: true, deniedLock: true,
  });
  await assert.rejects(api.establishSession(), e => e.status === 401);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  await assert.rejects(api.establishSession(true), e => e.status === 401);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('concurrent explicit retries share one genuine initialization promise and POST', async () => {
  let posts = 0, owner = false;
  const { api } = fixture(async call => {
    if (call.url === '/api/cart') return owner ? reply(200, owned) : noOwner();
    posts++; await new Promise(resolve => setTimeout(resolve, 10)); owner = true; return reply(200, {});
  });
  const results = await Promise.all([api.establishSession(false, true), api.establishSession(false, true)]);
  assert.equal(posts, 1); assert.equal(results[0].cart.id, results[1].cart.id);
});
