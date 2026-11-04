'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickUniqueAmount, extractTransactions, createHamyonProvider } = require('./auto-pay');

test('two simultaneous invoices never get the same amount', () => {
  const used = [];
  for (let i = 0; i < 200; i++) {
    const a = pickUniqueAmount(25000, used, () => 0.5);
    assert.ok(a > 25000 && a <= 25999);
    assert.ok(!used.includes(a));
    used.push(a);
  }
});

test('returns null when every unique offset is taken', () => {
  const used = Array.from({ length: 999 }, (_, i) => 25001 + i);
  assert.equal(pickUniqueAmount(25000, used), null);
});

test('extractTransactions reads common response shapes and skips outgoing', () => {
  const txs = extractTransactions({ data: [
    { id: 1, amount: '25037', created_at: '2026-11-04T10:00:00Z' },
    { transaction_id: 'x2', sum: 25040, type: 'out' },
    { tx_id: 'x3', summa: 25041.0, date: '2026-11-04T10:01:00Z' }
  ] });
  assert.deepEqual(txs.map((t) => [t.id, t.amount]), [['1', 25037], ['x3', 25041]]);
});

test('provider is disabled until env is configured and sends shop credentials', async () => {
  assert.equal(createHamyonProvider({}), null);
  let sent;
  const p = createHamyonProvider({ HAMYON_API_URL: 'https://api.example.test/tx', HAMYON_SHOP_ID: '1', HAMYON_SHOP_KEY: 'k' },
    async (url, opts) => { sent = { url, opts }; return { ok: true, json: async () => [{ id: 9, amount: 25001 }] }; });
  const txs = await p.listIncoming();
  assert.equal(txs[0].amount, 25001);
  assert.deepEqual(JSON.parse(sent.opts.body), { shop_id: '1', shop_key: 'k' });
});
