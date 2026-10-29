'use strict';
const { guessTitle, getDescription } = require('./auto-branding');

// Parse common caption formats: "🔎 Kino kodi: 101", "Kod: 101",
// "KODI - 101", "Code 101", "Код: 101" (no OCR or AI/network).
function extractPostCode(source) {
  const text = String(source || '').replace(/\r/g, '');
  const prefix = '(?:kino|film|video|multfilm|serial|dorama|anime|kitob|fayl|musiqa|music)\\s+';
  const keyword = '(?:kod(?:i)?|code|код(?:и)?|identifikator|raqam(?:i)?)';
  const regex = new RegExp('(?:^|\\n)\\s*[^\\p{L}\\p{N}\\r\\n]{0,8}\\s*(?:' + prefix + ')?' + keyword +
    '\\s*[:：#№.\\-–=]?\\s*([a-zA-Z0-9_-]{1,32})(?![\\w-])', 'giu');
  const match = regex.exec(text);
  return match ? match[1].trim() : '';
}

function importedMeta(message, itemTitle, slugifyCode, isValidCode) {
  const caption = String(message?.caption || message?.text || '');
  const fileName = message?.video?.file_name || message?.document?.file_name ||
    message?.audio?.file_name || message?.animation?.file_name || '';
  const explicitCode = extractPostCode(caption);
  const guessedTitle = guessTitle(caption, fileName);
  const code = explicitCode || (guessedTitle ? String(slugifyCode(guessedTitle)).slice(0, 32) : '');
  if (!code || !isValidCode(code)) {
    return { ok: false, reason: 'Kod aniqlanmadi. "Kod: 101" va "Nomi: ..." yozilgan post yuboring.' };
  }
  const title = (guessedTitle || (String(itemTitle || 'Kontent') + ' ' + code)).slice(0, 150).trim();
  const description = getDescription(caption);
  return { ok: true, title, code, description, detectedCode: Boolean(explicitCode) };
}

module.exports = { extractPostCode, importedMeta };
