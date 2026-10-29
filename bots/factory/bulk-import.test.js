'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPostCode, importedMeta } = require('./bulk-import');

for (const [src, code] of [
  ['🔎 Kino kodi: 887\n🎬 Nomi: Chandu chempion', '887'],
  ['🧸 Multfilm KOD: 101', '101'],
  ['Code 101', '101'],
  ['KODI - 202', '202'],
  ['🎥 Kod: Spiderman_4', 'Spiderman_4'],
  ['Код: 981', '981'],
  ['🎞 Serial kodi № 001', '001'],
  ['Musiqa kodi = track-9', 'track-9']
]) {
  test('code: ' + src, () => assert.equal(extractPostCode(src), code));
}

test('does not mistake a video resolution for a code', () => {
  assert.equal(extractPostCode('🎬 Film nomi: Avatar\n🎥 1080p HD'), '');
});
test('import both title and source description but not source bot promotion', () => {
  const msg = { video: { file_id: 'abc' }, caption: '🔎 Kino kodi: 887\n🎬 Nomi: Chandu chempion\n🎭 Janr: Sport\n🎥 Botimiz: @Trend_KinoBot' };
  const result = importedMeta(msg, 'Kino', s => s.toLowerCase().replace(/\s+/g,'_'), s => /^[a-z0-9_-]{1,32}$/i.test(s));
  assert.deepEqual({code:result.code,title:result.title,detectedCode:result.detectedCode}, {code:'887',title:'Chandu chempion',detectedCode:true});
  assert.match(result.description, /Sport/);
  assert.doesNotMatch(result.description, /Trend_KinoBot/);
});
test('uses filename as title when no caption title', () => {
  const result = importedMeta({document:{file_name:'Sevimli_multfilm.mp4'},caption:'Code: 55'},'Multfilm', s=>s, s=>true);
  assert.equal(result.title, 'Sevimli multfilm');
  assert.equal(result.code, '55');
});
test('title creates slug when code is missing', () => {
  const result = importedMeta({caption:'Nomi: Ona'}, 'Kino', s=>s.toLowerCase(), s=>/^[a-z]{1,32}$/.test(s));
  assert.equal(result.code, 'ona');
  assert.equal(result.detectedCode, false);
});
test('rejects empty posts instead of inserting fake placeholder', () => {
  const result = importedMeta({video:{file_id:'file'}},'Kino', s=>s,s=>true);
  assert.equal(result.ok, false);
});
