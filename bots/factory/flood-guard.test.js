'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { callWithRetry, retryAfterSec, createLimiter, installFloodGuard } = require('./flood-guard');
const { panelLink, verify } = require('./web-panel');

test('retryAfterSec reads Telegram 429 parameters only', () => {
  assert.equal(retryAfterSec({ code: 429, parameters: { retry_after: 7 } }), 7);
  assert.equal(retryAfterSec({ response: { error_code: 429, parameters: { retry_after: 3 } } }), 3);
  assert.equal(retryAfterSec({ code: 403 }), 0);
});

test('callWithRetry waits retry_after and retries, other errors pass through', async () => {
  const waits = [];
  let n = 0;
  const out = await callWithRetry(async () => { if (n++ < 2) throw { code: 429, parameters: { retry_after: 2 } }; return 'ok'; }, { wait: async (ms) => waits.push(ms) });
  assert.equal(out, 'ok');
  assert.deepEqual(waits, [2000, 2000]);
  await assert.rejects(callWithRetry(async () => { throw { code: 400 }; }, { wait: async () => {} }));
});

test('limiter spaces calls to the configured rate', async () => {
  let t = 0;
  const waits = [];
  const take = createLimiter(10, () => t, async (ms) => { waits.push(ms); });
  await take(); await take(); await take();
  assert.deepEqual(waits, [100, 200]);
});

test('installFloodGuard patches only send methods once', async () => {
  class T { async callApi(m) { return m; } }
  assert.equal(installFloodGuard(T, { rate: 1000 }), true);
  assert.equal(installFloodGuard(T), false);
  assert.equal(await new T().callApi('getMe'), 'getMe');
  assert.equal(await new T().callApi('sendMessage'), 'sendMessage');
});

test('panel link is signed, expires and rejects tampering', () => {
  const now = Date.UTC(2026, 0, 1);
  const u = new URL(panelLink('https://x.test/', 's3cret', 'm_1', now));
  const exp = u.searchParams.get('exp'); const sig = u.searchParams.get('sig');
  assert.equal(u.pathname, '/panel/m_1');
  assert.equal(verify('s3cret', 'm_1', exp, sig, now), true);
  assert.equal(verify('s3cret', 'm_2', exp, sig, now), false);
  assert.equal(verify('other', 'm_1', exp, sig, now), false);
  assert.equal(verify('s3cret', 'm_1', exp, sig, now + 2 * 86400 * 1000), false);
});
