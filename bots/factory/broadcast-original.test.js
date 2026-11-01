'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { originalCopyOptions, copyOriginalBroadcast } = require('./broadcast-original');

test('full multiline ad, links and formatting are copied without replacing text', async () => {
  const msg = {
    message_id: 25, text: 'Sevimli kinolaringizni @y808bot orqali tomosha qiling!\n\nKino kodlari: https://t.me/Y808_FILMS',
    entities: [{ type: 'url', offset: 85, length: 23 }]
  };
  const calls = [];
  const telegram = { copyMessage: async (...args) => { calls.push(args); return { message_id: 9 }; } };
  const sent = await copyOriginalBroadcast(telegram, 1234, 4321, msg.message_id, msg);
  assert.equal(sent.message_id, 9);
  assert.deepEqual(calls, [[1234, 4321, 25, {}]]);
  assert.equal(calls[0][3].caption, undefined);
  assert.equal(calls[0][3].text, undefined);
});

test('original video, photo, caption and premium entities are never rebranded', async () => {
  const msg = { message_id: 8, video: { file_id: 'video-id' },
    caption: 'Premyera ✨', caption_entities: [{ type: 'custom_emoji', offset: 9, length: 2 }] };
  const calls = [];
  await copyOriginalBroadcast({ copyMessage: async (...args) => { calls.push(args); } }, 99, 11, 8, msg);
  assert.deepEqual(calls, [[99, 11, 8, {}]]);
});

test('original URL-only buttons are retained', () => {
  const message = { reply_markup: { inline_keyboard: [[
    { text: '🎬 Kinoni ochish', url: 'https://t.me/y808bot' },
    { text: 'Kanal', url: 'https://t.me/Y808_FILMS' }
  ]] } };
  assert.deepEqual(originalCopyOptions(message), {
    reply_markup: { inline_keyboard: [[
      { text: '🎬 Kinoni ochish', url: 'https://t.me/y808bot' },
      { text: 'Kanal', url: 'https://t.me/Y808_FILMS' }
    ]] }
  });
});

test('non-portable callback buttons from foreign bots are not transplanted', () => {
  const msg = { reply_markup: { inline_keyboard: [[{ text: 'Click', callback_data: 'abc' }]] } };
  assert.deepEqual(originalCopyOptions(msg), {});
});

test('copy failures propagate instead of quietly sending a different promo', async () => {
  const original = new Error('Forbidden: bot was blocked');
  await assert.rejects(
    copyOriginalBroadcast({ copyMessage: async () => { throw original; } }, 123, 456, 10, {}),
    error => error === original
  );
});

test('missing source message id fails before any Telegram send', async () => {
  let called = 0;
  await assert.rejects(copyOriginalBroadcast({ copyMessage: async () => { called++; } }, 1, 2, null, {}));
  assert.equal(called, 0);
});
