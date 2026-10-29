'use strict';

// A small, robust Telegram transport for generated Shorts.
// Never display a bot token in logs or the user-facing error.
const fs = require('node:fs');

const MAX_FAST_UPLOAD = 12 * 1024 * 1024;

function publicUploadError(error) {
  const original = String(error?.message || error || 'Noma’lum xatolik');
  const sanitized = original
    .replace(/https?:\/\/api\.telegram\.org\/bot[^/\s]+/gi, 'Telegram API')
    .replace(/bot\d{7,}:[a-z0-9_-]+/gi, '[BOT_TOKEN_HIDDEN]')
    .replace(/\d{7,}:[a-z0-9_-]{20,}/gi, '[BOT_TOKEN_HIDDEN]');
  return sanitized.length > 240 ? sanitized.slice(0, 240) + '…' : sanitized;
}

function transientUploadError(err) {
  const status = Number(err?.response?.error_code || err?.code || 0);
  if (status === 429 || status >= 500) return true;
  const message = String(err?.message || err || '');
  return /socket hang up|ETIMEDOUT|ECONNRESET|EPIPE|ECONNABORTED|fetch failed|network|timeout/i.test(message);
}

async function sendShortsVideo({ telegram, chatId, output, filename, caption, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = async () => {} }) {
  if (!telegram?.sendVideo || !chatId || !output) throw new Error('Telegram video yuborish parametrlari to‘liq emas.');
  const stat = await fs.promises.stat(output);
  if (stat.size > MAX_FAST_UPLOAD) {
    throw new Error('Montaj videosi juda katta. Qisqaroq video yoki pastroq sifat kerak.');
  }
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await telegram.sendVideo(chatId, { source: output, filename }, { caption, supports_streaming: true });
    } catch (error) {
      lastError = error;
      if (!transientUploadError(error) || attempt === 2) break;
      await onRetry(attempt, publicUploadError(error));
      await pause(1200);
    }
  }
  throw new Error('Telegramga video yuborib bo‘lmadi: ' + publicUploadError(lastError));
}

module.exports = { MAX_FAST_UPLOAD, publicUploadError, transientUploadError, sendShortsVideo };
