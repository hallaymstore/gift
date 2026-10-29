'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { brandText, shouldAutoBrand } = require('./auto-branding');

test('only y808bot is enabled by default', () => {
  assert.equal(shouldAutoBrand('@y808bot'), true);
  assert.equal(shouldAutoBrand('other_kinobot'), false);
});

test('replaces bot mention without touching film title and channel handle', () => {
  const input = '🎬 Nomi: Portlash / hind kino 2026\n🎥 Botimiz: @Trend_KinoBot\n📣 Kanal: @TrendKino';
  const result = brandText(input, [], 'y808bot');
  assert.equal(result.text, '🎬 Nomi: Portlash / hind kino 2026\n🎥 Botimiz: @y808bot\n📣 Kanal: @TrendKino');
  assert.equal(result.changed, true);
});

test('replaces deep links with the locally indexed content code', () => {
  const r = brandText('https://t.me/Trend_KinoBot?start=355', [], '@y808bot', 'portlash');
  assert.equal(r.text, 'https://t.me/y808bot?start=c_portlash');
});

test('preview cannot reuse other bots deep link codes', () => {
  const r = brandText('t.me/Trend_KinoBot?start=355', [], '@y808bot');
  assert.equal(r.text, 't.me/y808bot');
});

test('keeps UTF-16 custom emoji formatting offsets after replacement', () => {
  const text = '🎬 @Trend_KinoBot HD';
  const entities = [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '123' }, { type: 'bold', offset: text.indexOf('HD'), length: 2 }];
  const r = brandText(text, entities, 'y808bot');
  assert.equal(r.text, '🎬 @y808bot HD');
  assert.equal(r.entities[0].offset, 0);
  assert.equal(r.entities[1].offset, r.text.indexOf('HD'));
});

test('replaces inline text_link URL even if caption only says Botimiz', () => {
  const text = '🎥 Botimiz';
  const r = brandText(text, [{ type: 'text_link', offset: 3, length: 7, url: 'https://t.me/Trend_KinoBot?start=355' }], 'y808bot', 'portlash');
  assert.equal(r.text, text);
  assert.equal(r.entities[0].url, 'https://t.me/y808bot?start=c_portlash');
  assert.equal(r.changed, true);
});

test('does not rewrite unrelated bots managed by same factory', () => {
  const r = brandText('@Trend_KinoBot', [], 'other_kinobot');
  assert.equal(r.text, '@Trend_KinoBot');
  assert.equal(r.changed, false);
});
