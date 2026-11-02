'use strict';

// This message is shown to channel owners and also stored in MongoDB.
// Never disclose bot credentials embedded in node-fetch/Telegraf request URLs.
function redactTelegramSecrets(input) {
  return String(input ?? '')
    .replace(/(https?:\/\/api\.telegram\.org\/(?:file\/)?bot)\d{5,15}:[A-Za-z0-9_\-\[\]]{5,}(?=\/|\s|$)/gi, '$1[REDACTED]')
    .replace(/\bbot\d{5,15}:[A-Za-z0-9_-]{18,}\b/gi, 'bot[REDACTED]')
    .replace(/\b\d{5,15}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_TOKEN]')
    .replace(/(https?:\/\/api\.telegram\.org\/(?:file\/)?bot)[^/\s]+/gi, '$1[REDACTED]');
}

function describeRelayError(error, maxLength=180) {
  const source=redactTelegramSecrets(error?.description || error?.message || error);
  if(/socket hang up|ECONNRESET|EPIPE/i.test(source)) return 'Telegram bilan ulanish uzildi (socket hang up/ECONNRESET). Qayta urinish rejalashtirildi.';
  if(/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|network timeout|fetch failed/i.test(source)) return 'Telegram bilan aloqa vaqtincha uzildi (timeout). Qayta urinish rejalashtirildi.';
  if(/caption is too long|caption_too_long/i.test(source)) return 'Rasm/video izohi Telegram ruxsat bergan hajmdan uzun.';
  if(/Too Many Requests|FLOOD_WAIT|429|retry after/i.test(source)) return 'Telegram so‘rovlar sonini vaqtincha chekladi. Qayta urinish rejalashtirildi.';
  return source.slice(0,Math.max(48,Number(maxLength)||180));
}

module.exports={redactTelegramSecrets,describeRelayError};
