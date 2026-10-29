'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanUsername, guessTitle, getDescription, getBotKind, makeBrandedCaption, brandedDelivery } = require('./auto-branding');

test('uses actual bot username for every created bot', () => {
  const stored = { message_type: 'video', title: 'Portlash / hind kino 2026', code: 'portlash', caption: '🎥 Botimiz: @Trend_KinoBot' };
  for (const username of ['y808bot', 'my_multfilm_bot', 'seriallar777bot']) {
    const output = makeBrandedCaption(stored, username, { item: 'kino', itemTitle: 'Kino' });
    assert.match(output, new RegExp('@' + username));
    assert.match(output, new RegExp('t\\.me/' + username + '\\?start=c_portlash'));
    assert.doesNotMatch(output, /@Trend_KinoBot/);
    assert.match(output, /Portlash \/ hind kino 2026/);
  }
});

test('preserves source descriptions but discards source bot ads and foreign codes', () => {
  const data = {
    message_type: 'video',
    title: 'Chandu chempion',
    code: '887-local',
    caption: '🔎 Kino kodi: 887\n🎬 Nomi: Chandu chempion\n🎞 Janr: Drama, sport\n🌐 Til: Uzbek\n🎥 Botimiz: @Trend_KinoBot\n🔗 https://t.me/Trend_KinoBot?start=887'
  };
  const result = makeBrandedCaption(data, 'new_moviebot', { item: 'kino', mainEmoji: '🎬' });
  assert.match(result, /Janr: Drama, sport/);
  assert.match(result, /Til: Uzbek/);
  assert.doesNotMatch(result, /Kino kodi: 887|@Trend_KinoBot|start=887/);
  assert.match(result, /Kod: 887-local/);
});

test('generates a concise caption when forwarded message has none', () => {
  const output = brandedDelivery({ message_type: 'video', title: 'Tom va Jerri', code: 'tom-jerry', caption: '' }, 'cartoon_b0t', { item: 'multfilm', mainEmoji: '🧸' });
  assert.equal(output.type, 'caption');
  assert.match(output.caption, /Tom va Jerri|@cartoon_b0t|Multfilm/);
  assert.ok(output.caption.length <= 1024);
});

test('type-specific text for serial, anime, courses and music', () => {
  for (const kind of ['serial', 'anime', 'dorama', 'turk serial', 'kurs', 'kitob', 'fayl', 'musiqa']) {
    const value = makeBrandedCaption({ title: 'Test', code: 'test', message_type: 'video' }, 'mybot_test', { item: kind, itemTitle: kind });
    assert.match(value, /@mybot_test/);
    assert.ok(value.length <= 1024);
  }
  assert.equal(getBotKind({ item: 'multfilm' }), 'multfilm');
  assert.equal(getBotKind({ item: 'turk serial' }), 'turkserial');
});

test('series parts have correct title and part number', () => {
  const result = makeBrandedCaption({ message_type: 'video', content_title: 'Sevimli serial', content_code_norm: 'sev', part_no: 12 }, 'my_series_bot', { item: 'serial' });
  assert.match(result, /12-qism/);
  assert.match(result, /start=c_sev/);
});

test('text posts are transformed, stickers are copied unchanged', () => {
  assert.equal(brandedDelivery({ message_type: 'text', title: 'Kurs', text: 'Mavzu: Frontend' }, 'my_testbot', { item: 'kurs' }).type, 'text');
  assert.equal(brandedDelivery({ message_type: 'sticker' }, 'my_testbot', { item: 'kino' }), null);
});

test('guesses title for admin from forwarded source caption', () => {
  assert.equal(guessTitle('🔎 Kino kodi: 887\n🎬 Nomi: Chandu chempion'), 'Chandu chempion');
  assert.equal(guessTitle('', 'Kino_2026.mp4'), 'Kino 2026');
  assert.match(getDescription('🎞 Janr: Komediya\n🤖 Botimiz: @OthersBot'), /Komediya/);
});

test('rejects invalid username instead of leaking a wrong username', () => {
  assert.equal(makeBrandedCaption({ message_type: 'video', title: 'Film' }, '!!', { item: 'kino' }), null);
  assert.equal(cleanUsername('@My_808bot'), 'My_808bot');
});

test('caps caption under Telegram limit even if original is huge', () => {
  const result = makeBrandedCaption({ message_type: 'video', title: 'Kino', code: 'abc', caption: '🍿 ' + 'sarguzasht '.repeat(300) }, 'mytestbot', { item: 'kino' });
  assert.ok(result.length <= 1024);
  assert.match(result, /t\.me\/mytestbot\?start=c_abc/);
});
