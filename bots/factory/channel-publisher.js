'use strict';

const { guessTitle, getDescription } = require('./auto-branding');
const { extractPostCode } = require('./bulk-import');

function telegramHandle(raw) {
  const text = String(raw || '').trim().replace(/^@/, '')
    .replace(/^(?:https?:\/\/)?t\.me\//i, '').replace(/\/$/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(text) ? text : '';
}

function telegramChatRef(raw) {
  const value = String(raw || '').trim();
  if (/^-100\d{6,}$/.test(value)) return value;
  const h = telegramHandle(value);
  return h ? '@' + h : '';
}

function linkedBots(raw, ownBot = '') {
  const skip = telegramHandle(ownBot).toLowerCase();
  const items = String(raw || '').split(/[\s,;|]+/)
    .map(telegramHandle).filter(Boolean);
  return [...new Set(items.filter(h => h.toLowerCase() !== skip).map(h => h.toLowerCase()))].slice(0, 5);
}

function originalSource(message) {
  const origin = message?.forward_origin;
  if (origin?.type === 'channel' && origin.chat) {
    return { chatId: String(origin.chat.id || ''), messageId: Number(origin.message_id || 0),
      handle: telegramHandle(origin.chat.username), title: String(origin.chat.title || '').slice(0, 80) };
  }
  // Legacy forwarded channel fields retained for backwards-compatible clients.
  if (message?.forward_from_chat?.type === 'channel') {
    const chat = message.forward_from_chat;
    return { chatId: String(chat.id || ''), messageId: Number(message.forward_from_message_id || 0),
      handle: telegramHandle(chat.username), title: String(chat.title || '').slice(0, 80) };
  }
  if (message?.chat?.type === 'channel') {
    return { chatId: String(message.chat.id || ''), messageId: Number(message.message_id || 0),
      handle: telegramHandle(message.chat.username), title: String(message.chat.title || '').slice(0, 80) };
  }
  return { chatId:'',messageId:0,handle:'',title:'' };
}

function messageKind(message) {
  if (message?.video) return 'video';
  if (message?.photo?.length) return 'photo';
  if (message?.animation) return 'animation';
  if (message?.document) return 'document';
  if (message?.audio) return 'audio';
  if (message?.text) return 'text';
  return '';
}

function buildChannelCaption({ message, destination, botUsername, otherBots = [], localContent = null }) {
  const ownBot = telegramHandle(botUsername);
  const channelHandle = telegramHandle(destination?.username);
  if (!ownBot || !destination?.id) throw new Error('Kino bot yoki nishon kanal sozlanmagan.');
  const raw = String(message?.caption || message?.text || '');
  const name = String(localContent?.title || guessTitle(raw,
    message?.video?.file_name || message?.document?.file_name || '') || 'Yangi post')
    .replace(/\s+/g, ' ').trim().slice(0, 115);
  const description = getDescription(raw).slice(0, 360);
  const code = localContent?.code ? String(localContent.code).trim().slice(0, 32) : '';
  const codeNorm = localContent?.code_norm ? String(localContent.code_norm).trim().slice(0, 32) : '';
  const extras = linkedBots(otherBots.join(','), ownBot);
  const lines = [
    '🎬 ' + name,
    description,
    code ? '🔎 Kino kodi: ' + code : '',
    '🤖 Botimiz: @' + ownBot,
    channelHandle ? '📢 Kanalimiz: @' + channelHandle : '📢 Kanalimiz: ' + String(destination.title || 'Kino kanali').slice(0, 70),
    codeNorm ? '▶️ https://t.me/' + ownBot + '?start=c_' + codeNorm : '▶️ https://t.me/' + ownBot,
    extras.length ? '🎞 Boshqa botlarimiz: ' + extras.map(x => '@' + x).join(' ') : '',
  ].filter(Boolean);
  // Keep copyMessage captions below Telegram's 1024 UTF-16 code unit limit.
  // Preserve branding and attribution even when original captions are long.
  let output = lines.join('\n\n');
  if (output.length > 1024) {
    lines[1] = '';
    output = lines.filter(Boolean).join('\n\n');
  }
  return output.slice(0,1024);
}

function candidateCode(message) {
  return extractPostCode(message?.caption || message?.text || '');
}

module.exports = {
  telegramHandle, telegramChatRef, linkedBots, originalSource,
  messageKind, buildChannelCaption, candidateCode
};
