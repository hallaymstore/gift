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
  const id=source.match(/History post\s+(\d+)/i)?.[1];
  const prefix=id?'History post '+id+': ':'';
  let description=source;
  if(/socket hang up|ECONNRESET|EPIPE/i.test(source))
    description='Telegram bilan ulanish uzildi (socket hang up/ECONNRESET). Qayta urinish rejalashtirildi.';
  else if(/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|network timeout|fetch failed/i.test(source))
    description='Telegram bilan aloqa vaqtincha uzildi (timeout). Qayta urinish rejalashtirildi.';
  else if(/caption is too long|caption_too_long/i.test(source))
    description='Rasm/video izohi Telegram ruxsat bergan hajmdan uzun.';
  else if(/Too Many Requests|FLOOD_WAIT|429|retry after/i.test(source))
    description='Telegram so‘rovlar sonini vaqtincha chekladi. Qayta urinish rejalashtirildi.';
  return (prefix+description).slice(0,Math.max(48,Number(maxLength)||180));
}

module.exports={redactTelegramSecrets,describeRelayError};
