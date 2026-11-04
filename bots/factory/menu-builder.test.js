'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mb = require('./menu-builder');
const catalog = require('./bot-catalog');

const B = { top: '🔥 Top', fresh: '🆕 Yangilari', random: '🎲 Tasodifiy', favs: '⭐ Saqlanganlarim', help: 'ℹ️ Yordam' };
const DEF = [['top', 'fresh'], ['random', 'favs'], ['help']];

test('default layout renders builtin default labels', () => {
  const l = mb.buildDefaultLayout(DEF, B);
  assert.deepEqual(mb.renderRows(l, B), [['🔥 Top', '🆕 Yangilari'], ['🎲 Tasodifiy', '⭐ Saqlanganlarim'], ['ℹ️ Yordam']]);
});

test('rename keeps routing to builtin and default label can be restored', () => {
  let l = mb.buildDefaultLayout(DEF, B);
  const id = l.rows[0][0].id;
  l = mb.renameButton(l, B, id, '🏆 Eng zo‘rlari').layout;
  assert.deepEqual(mb.resolveText(l, B, '🏆 Eng zo‘rlari'), { type: 'builtin', canonical: '🔥 Top', key: 'top' });
  l = mb.resetLabel(l, id).layout;
  assert.equal(mb.renderRows(l, B)[0][0], '🔥 Top');
});

test('rename rejects duplicates, reserved and empty labels', () => {
  const l = mb.buildDefaultLayout(DEF, B);
  const id = l.rows[0][0].id;
  assert.ok(mb.renameButton(l, B, id, '🆕 Yangilari').error);
  assert.ok(mb.renameButton(l, B, id, '📊 Statistika', { reserved: ['📊 Statistika'] }).error);
  assert.ok(mb.renameButton(l, B, id, '  ').error);
});

test('move left/right swaps, up/down changes rows', () => {
  let l = mb.buildDefaultLayout(DEF, B);
  const help = l.rows[2][0].id;
  l = mb.moveButton(l, help, 'up').layout;
  assert.deepEqual(mb.renderRows(l, B)[1], ['🎲 Tasodifiy', '⭐ Saqlanganlarim', 'ℹ️ Yordam']);
  assert.equal(l.rows.length, 2);
  l = mb.moveButton(l, help, 'left').layout;
  assert.deepEqual(mb.renderRows(l, B)[1], ['🎲 Tasodifiy', 'ℹ️ Yordam', '⭐ Saqlanganlarim']);
  l = mb.moveButton(l, l.rows[0][0].id, 'up').layout;
  assert.deepEqual(mb.renderRows(l, B)[0], ['🔥 Top']);
});

test('add custom button, attach url/code/text actions, hide and delete', () => {
  let l = mb.buildDefaultLayout(DEF, B);
  const res = mb.addButton(l, B, { label: '📞 Aloqa' });
  l = res.layout;
  assert.equal(mb.resolveText(l, B, '📞 Aloqa').type, 'text');
  assert.ok(mb.setAction(l, B, res.id, { type: 'url', url: 'javascript:x' }).error);
  l = mb.setAction(l, B, res.id, { type: 'url', url: 'https://t.me/admin' }).layout;
  assert.deepEqual(mb.resolveText(l, B, '📞 Aloqa'), { type: 'url', url: 'https://t.me/admin' });
  l = mb.setAction(l, B, res.id, { type: 'code', code: 'avatar' }).layout;
  assert.equal(mb.resolveText(l, B, '📞 Aloqa').code, 'avatar');
  l = mb.toggleHidden(l, res.id).layout;
  assert.equal(mb.resolveText(l, B, '📞 Aloqa'), null);
  l = mb.removeButton(l, res.id).layout;
  assert.equal(mb.findButton(l, res.id), null);
});

test('normalize drops broken buttons and falls back to default', () => {
  assert.deepEqual(mb.normalizeLayout(null, DEF, B), mb.buildDefaultLayout(DEF, B));
  const l = mb.normalizeLayout({ rows: [[{ id: 'b1', action: { type: 'builtin', key: 'gone' } }, { id: 'b2', action: { type: 'builtin', key: 'top' } }]] }, DEF, B);
  assert.deepEqual(mb.renderRows(l, B), [['🔥 Top']]);
});

test('catalog: media purposes grouped and parts flag per purpose', () => {
  const presets = { kino: { title: 'KinoBot' }, serial: { title: 'SerialBot' }, channel_clone: { title: 'Kloner' } };
  assert.deepEqual(catalog.availablePurposes('media', presets), ['kino', 'serial']);
  assert.deepEqual(catalog.visibleCategories(presets).map((c) => c.key), ['media', 'channel']);
  assert.equal(catalog.isPartsPurpose('serial'), true);
  assert.equal(catalog.isPartsPurpose('kino'), false);
  assert.equal(catalog.categoryForType('anime').key, 'media');
  assert.match(catalog.purposeDetails('anime'), /qismli/);
});
