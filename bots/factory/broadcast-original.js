'use strict';

/**
 * Broadcast messages are authored by an administrator and must not be run
 * through content-delivery auto-branding. Telegram's server-side copy keeps
 * the original text, entities, caption entities, media and premium emoji.
 *
 * Only portable URL buttons are explicitly reattached: callback buttons from
 * another bot cannot safely be reused by this bot.
 */
function originalCopyOptions(message) {
  const rows = message?.reply_markup?.inline_keyboard;
  if (!Array.isArray(rows) || !rows.length) return {};

  // Only include complete URL-only keyboards, never broken partial rows.
  const portable = rows.every(row => Array.isArray(row) && row.length > 0 &&
    row.every(button => typeof button?.text === 'string' &&
      typeof button?.url === 'string' && /^https:\/\//i.test(button.url)));
  if (!portable) return {};
  return {
    reply_markup: {
      inline_keyboard: rows.map(row => row.map(({ text, url }) => ({ text, url })))
    }
  };
}

async function copyOriginalBroadcast(telegram, destination, sourceChatId, sourceMessageId, message) {
  if (!telegram?.copyMessage) throw new Error('Telegram copyMessage mavjud emas');
  if (!destination || !sourceChatId || !Number.isSafeInteger(Number(sourceMessageId)) ||
      Number(sourceMessageId) <= 0) throw new Error('Broadcast manba/maqsad maʼlumoti noto‘g‘ri');
  // No text/caption overrides: never substitute automated promo templates.
  return telegram.copyMessage(destination, sourceChatId, Number(sourceMessageId),
    originalCopyOptions(message));
}

module.exports = { originalCopyOptions, copyOriginalBroadcast };
