'use strict';

// BotFactory: universal, lightweight captions for all content engines.
// Uses Telegram's real bot username, never hardcodes one bot's identity.
const SUPPORTED_MEDIA = new Set(['photo', 'video', 'animation', 'document', 'audio', 'voice']);

function cleanUsername(value) {
  const name = String(value || '').trim().replace(/^@/, '');
  return /^[a-z][a-z0-9_]{4,31}$/i.test(name) ? name : '';
}

function normalizeCode(value) {
  const code = String(value || '').trim();
  return /^[a-z0-9_-]{1,32}$/i.test(code) ? code : '';
}

function cleanText(value) {
  return String(value || '').replace(/\r/g, '').replace(/\u0000/g, '').trim();
}

// Best effort: original source captions may have a title even before the
// factory admin enters local catalog metadata.
function guessTitle(source, fileName = '') {
  const lines = cleanText(source).split('\n').map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/(?:kino\s*nomi|multfilm\s*nomi|serial\s*nomi|dorama\s*nomi|anime\s*nomi|film\s*nomi|nomi|title|name)\s*[:：\-–]\s*(.{2,})/i);
    if (match) return match[1].replace(/(?:https?:\/\/|t\.me\/|@\w+).*$/i, '').trim().slice(0, 120);
  }
  // Many forwarded posts have a plain title in their first line without "Nomi:".
  const candidate = lines.find((line) => {
    const normalized = line.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (!normalized || normalized.length < 3 || normalized.length > 120) return false;
    if (/(?:https?:\/\/|t\.me\/|@\w{5,})/i.test(normalized)) return false;
    if (/^(?:kod(?:i)?|code|код(?:и)?|janr|genre|til|yil|sifat|quality|format|davomiyligi|views?|ko.rishlar|qism|season|mavsum|musiqa kodi|muallif|botimiz|kanal)/i.test(normalized)) return false;
    return true;
  });
  if (candidate) return candidate.replace(/^[^\p{L}\p{N}]+/u, '').trim().slice(0, 120);
  const filenameTitle = cleanText(fileName).replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_-]+/g, ' ');
  if (filenameTitle.length > 2) return filenameTitle.slice(0, 120);
  return '';
}

// Exclude only promotional bot/channel lines and original foreign bot codes;
// keep actual plot, genre, year, translation and quality details.
function getDescription(source) {
  const lines = cleanText(source).split('\n').map((line) => line.trim()).filter(Boolean);
  const kept = [];
  for (const line of lines) {
    if (/(?:kino\s*nomi|multfilm\s*nomi|serial\s*nomi|dorama\s*nomi|anime\s*nomi|film\s*nomi|nomi|title|name)\s*[:：\-–]/i.test(line)) continue;
    if (/(?:kino|film|serial|multfilm|dorama|anime|qism)?\s*(?:kod[iы]?|code)\s*[:：\-–]/i.test(line)) continue;
    if (/(?:botimiz|botim|our\s+bot|bizning\s+bot|botga\s+kiring|botni\s+bos|download\s+bot)\b/i.test(line)) continue;
    if (/(?:obuna\s+bo.l|kanalimiz|kanalga\s+kiring|join\s+channel|subscribe|telegram\s+kanal)/i.test(line)) continue;
    if (/(?:https?:\/\/|t\.me\/|telegram\.me\/|@\w{5,})/i.test(line)) continue;
    if (/(?:ko.rishlar|views?|просмотров)\s*[:：\-–]?\s*\d+/i.test(line)) continue;
    if (/^\s*[#@]+\w+(?:\s+[#@]\w+)*$/.test(line)) continue;
    kept.push(line);
  }
  return [...new Set(kept)].join('\n').slice(0, 440);
}

const HOOKS = {
  kino: ['🍿 Kino kechangiz uchun navbatdagi tanlov!', '🎥 Tomosha qilish uchun ajoyib kino!', '✨ Bugun qanday kino ko‘ramiz?'],
  multfilm: ['🧸 Multfilm va maroqli lahzalar bir joyda!', '🌈 Kichkintoylar va kattalar uchun multfilm!', '🍿 Multfilm vaqti!'],
  serial: ['📺 Keyingi qismga tayyormisiz?', '🍿 Serial kayfiyati boshlansin!', '✨ Sevimli seriallaringiz shu yerda!'],
  dorama: ['🎭 Doramalar olamiga marhamat!', '💫 Yangi hikoyaga sho‘ng‘ing!', '💕 Dorama tomoshasi uchun tanlov!'],
  anime: ['🌸 Anime muxlislari, bu siz uchun!', '⚡ Anime kayfiyati boshlansin!', '✨ Qiziqarli anime tanlovi!'],
  turkserial: ['🇹🇷 Turk seriallari muxlislari uchun!', '📺 Turk seriallaridan yangi tanlov!', '🍿 Sevimli voqealar davom etadi!'],
  kurs: ['🎓 Bilim olish uchun navbatdagi material!', '📚 O‘rganish vaqti!', '🚀 Yangi ko‘nikmalarga bir qadam!'],
  kitob: ['📚 Navbatdagi mutolaa uchun tavsiya!', '📖 Kitobxonlar, bu siz uchun!', '✨ Bilim olami shu yerda!'],
  fayl: ['📦 Kerakli faylni shu yerda toping!', '⚡ Yuklab olish uchun tayyor material!', '📁 Foydali fayllar bir joyda!'],
  music: ['🎵 Musiqa tinglash vaqti!', '🎧 Quloqchinlarni taqing!', '✨ Musiqiy kayfiyat shu yerda!']
};

function getBotKind(config) {
  const key = String(config?.type_key || config?.typeKey || config?.item || config?.key || 'kino').toLowerCase();
  if (key.includes('musiqa')) return 'music';
  if (key.includes('mult')) return 'multfilm';
  if (key.includes('turk')) return 'turkserial';
  if (key.includes('serial')) return 'serial';
  for (const type of Object.keys(HOOKS)) if (key.includes(type)) return type;
  return 'kino';
}

function makeBrandedCaption(stored, botUsername, config = {}) {
  const username = cleanUsername(botUsername);
  if (!username || !stored) return null;
  const kind = getBotKind(config);
  const emoji = String(config?.mainEmoji || ({ kino: '🎬', multfilm: '🧸', serial: '📺', dorama: '🎭', anime: '🌸', turkserial: '🇹🇷', kurs: '🎓', kitob: '📚', fayl: '📦', music: '🎵' }[kind] || '🎬'));
  const label = String(config?.itemTitle || 'Kontent');
  const source = cleanText(stored.caption || stored.text || '');
  const title = cleanText(stored.content_title || stored.title || guessTitle(source, stored.file_name) || ('Yangi ' + label)).slice(0, 130);
  const code = normalizeCode(stored.content_code_norm || stored.code);
  const partNo = Number(stored.part_no);
  const description = cleanText(stored.description) || getDescription(source);
  let hash = 0;
  for (const character of (code || title)) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  const hooks = HOOKS[kind];
  const hook = hooks[hash % hooks.length];
  const tail = [
    '',
    hook,
    code ? '🔎 Kod: ' + code : '',
    '🤖 Botimiz: @' + username,
    '🔗 https://t.me/' + username + (code ? '?start=c_' + code : ''),
    '💙 Do‘stlaringiz bilan ulashing!'
  ].filter((line) => line !== '').join('\n');

  const header = emoji + ' ' + title + (Number.isInteger(partNo) && partNo > 0 ? '\n🎞 ' + partNo + '-qism' : '');
  // Telegram captions are limited to 1024 characters. Reserve space for header
  // and own link, and use an unsplit UTF-16 string.
  const budget = Math.max(0, 1024 - header.length - tail.length - 4);
  const safeDescription = description.slice(0, Math.min(440, budget)).trimEnd();
  const result = header + (safeDescription ? '\n\n' + safeDescription : '') + '\n' + tail;
  return result.slice(0, 1024);
}

function brandedDelivery(stored, botUsername, config = {}) {
  const caption = makeBrandedCaption(stored, botUsername, config);
  if (!caption) return null;
  if (SUPPORTED_MEDIA.has(stored.message_type)) return { type: 'caption', caption };
  if (stored.message_type === 'text') return { type: 'text', text: caption };
  return null; // sticker, video_note etc. must be copied unchanged.
}

module.exports = { cleanUsername, guessTitle, getDescription, getBotKind, makeBrandedCaption, brandedDelivery };
