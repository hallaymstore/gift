'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { publicUploadError, transientUploadError, sendShortsVideo, MAX_FAST_UPLOAD } = require('./shorts-upload');

test('never leak a bot token from a Telegram error', () => {
  const original = 'request to https://api.telegram.org/bot9153574805:AAexampleSECRET1234567890123456/sendVideo failed, reason: socket hang up';
  const safe = publicUploadError(new Error(original));
  assert.match(safe, /Telegram API\/sendVideo/);
  assert.doesNotMatch(safe, /9153574805|AAexampleSECRET/);
});

test('only transient upload errors are retried', () => {
  assert.equal(transientUploadError(new Error('socket hang up')), true);
  assert.equal(transientUploadError(new Error('ETIMEDOUT')), true);
  assert.equal(transientUploadError({response:{error_code:429}}), true);
  assert.equal(transientUploadError({response:{error_code:400},message:'Bad Request'}), false);
});

test('retry a socket reset once and deliver the same output', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-shorts-upload-test-'));
  const filename = path.join(dir, 'shorts.mp4');
  try {
    await fs.writeFile(filename, Buffer.alloc(2048));
    let calls = 0, retry = 0;
    const message = await sendShortsVideo({
      telegram: {sendVideo: async (id, file, options) => {
        calls++;
        assert.equal(id, 1234);
        assert.equal(file.source, filename);
        assert.equal(options.supports_streaming, true);
        if (calls === 1) throw new Error('socket hang up');
        return {message_id: 77};
      }},
      chatId: 1234, output: filename, caption: 'Kod: 769', filename: 'out.mp4',
      pause: async () => {}, onRetry: async () => {retry++;}
    });
    assert.equal(message.message_id, 77);
    assert.equal(calls, 2);
    assert.equal(retry, 1);
  } finally {
    await fs.rm(dir, {recursive:true,force:true});
  }
});

test('do not retry Telegram client-side 400 errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-shorts-upload-test-'));
  const filename = path.join(dir, 'shorts.mp4');
  try {
    await fs.writeFile(filename, Buffer.alloc(2048));
    let calls = 0;
    await assert.rejects(() => sendShortsVideo({
      telegram: {sendVideo: async () => {
        calls++;
        throw { response: {error_code:400},message:'Bad Request' };
      }},
      chatId: 7, output: filename
    }), /Bad Request/);
    assert.equal(calls, 1);
  } finally {
    await fs.rm(dir, {recursive:true,force:true});
  }
});

test('fast uploads cap size', () => {
  assert.ok(MAX_FAST_UPLOAD < 20 * 1024 * 1024);
});
