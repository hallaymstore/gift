'use strict';

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Telegraf, Markup, session } = require('telegraf');
const BOT_CONFIGS_RAW = require('./bots.config');
const STATIC_BOT_CONFIGS = Array.isArray(BOT_CONFIGS_RAW) ? BOT_CONFIGS_RAW : (BOT_CONFIGS_RAW.staticBots || []);
const TYPE_PRESETS = Array.isArray(BOT_CONFIGS_RAW) ? {} : (BOT_CONFIGS_RAW.typePresets || {});

// =========================
// ENV SOZLAMALAR
// =========================
const MONGODB_URL = process.env.MONGODB_URL;
const PORT = Number(process.env.PORT || 3000);
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change_me_webhook_secret';
const BOT_TOKEN_SECRET = process.env.BOT_TOKEN_SECRET || WEBHOOK_SECRET;
const FACTORYBOT_TOKEN = String(process.env.FACTORYBOT_TOKEN || '').trim();
const OWNER_USERNAME = String(process.env.OWNER_USERNAME || '@Qoryogdiyev').trim();

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => Number(String(id).trim()))
    .filter(Boolean);
}

const GLOBAL_ADMIN_IDS = parseIds(process.env.ADMIN_IDS);

if (!MONGODB_URL) throw new Error('MONGODB_URL .env ichida berilmagan');
if (GLOBAL_ADMIN_IDS.length === 0) {
  throw new Error('ADMIN_IDS .env ichida berilmagan. Masalan: ADMIN_IDS=6606638731,901126203');
}

// =========================
// MONGODB MODELLAR
// =========================
mongoose.set('strictQuery', true);

const storedMessageFields = {
  source_chat_id: { type: Number, required: true },
  source_message_id: { type: Number, required: true },
  message_type: {
    type: String,
    enum: ['text', 'photo', 'video', 'document', 'animation', 'audio', 'voice', 'sticker', 'other'],
    default: 'other'
  },
  file_id: String,
  file_unique_id: String,
  file_name: String,
  mime_type: String,
  file_size: Number,
  duration: Number,
  width: Number,
  height: Number,
  text: String,
  entities: Array,
  caption: String,
  caption_entities: Array
};

const userSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    first_name: String,
    last_name: String,
    language_code: String,
    joined_at: { type: Date, default: Date.now },
    last_active_at: { type: Date, default: Date.now },
    starts: { type: Number, default: 0 },
    is_blocked: { type: Boolean, default: false }
  },
  { timestamps: true, collection: 'multibot_users' }
);
userSchema.index({ bot_key: 1, user_id: 1 }, { unique: true });

const subscriptionSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_username: { type: String, required: true, index: true },
    type: { type: String, enum: ['channel', 'group'], required: true },
    added_by: Number
  },
  { timestamps: true, collection: 'multibot_subscriptions' }
);
subscriptionSchema.index({ bot_key: 1, chat_username: 1 }, { unique: true });

const contentSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    title: { type: String, required: true },
    title_norm: { type: String, required: true, index: true },
    code: { type: String, required: true },
    code_norm: { type: String, required: true, index: true },
    description: String,

    // true bo'lsa: foydalanuvchiga avval qismlar inline chiqadi
    // false bo'lsa: kod yuborilganda post/video darrov yuboriladi
    has_parts: { type: Boolean, default: false, index: true },

    ...storedMessageFields,

    added_by: Number,
    views: { type: Number, default: 0 },
    search_count: { type: Number, default: 0 },
    last_view_at: Date,
    last_search_at: Date,
    is_active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: 'multibot_contents' }
);
contentSchema.index(
  { bot_key: 1, code_norm: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

const partSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    content_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: 'MultiBotContent' },
    content_code_norm: { type: String, required: true, index: true },
    content_title: String,
    part_no: { type: Number, required: true, index: true },
    title: String,

    ...storedMessageFields,

    added_by: Number,
    views: { type: Number, default: 0 },
    last_view_at: Date,
    is_active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: 'multibot_content_parts' }
);
partSchema.index(
  { bot_key: 1, content_id: 1, part_no: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

const User = mongoose.model('MultiBotUser', userSchema);
const Subscription = mongoose.model('MultiBotSubscription', subscriptionSchema);
const Content = mongoose.model('MultiBotContent', contentSchema);
const ContentPart = mongoose.model('MultiBotContentPart', partSchema);

const managedBotSchema = new mongoose.Schema(
  {
    bot_key: { type: String, index: true, unique: true, sparse: true },
    owner_user_id: { type: Number, required: true, index: true },
    owner_username: String,
    owner_first_name: String,

    telegram_bot_id: { type: Number, required: true, index: true },
    telegram_username: { type: String, required: true, index: true },
    telegram_first_name: String,

    title: { type: String, required: true },
    type_key: { type: String, required: true, index: true },
    admin_ids: { type: [Number], default: [] },

    token_enc: { type: String, required: true },
    token_iv: { type: String, required: true },
    token_tag: { type: String, required: true },
    token_mask: String,

    status: { type: String, enum: ['pending', 'approved', 'rejected', 'disabled'], default: 'pending', index: true },
    is_enabled: { type: Boolean, default: false, index: true },
    price_note: String,
    request_note: String,
    approved_by: Number,
    approved_at: Date,
    rejected_by: Number,
    rejected_at: Date,
    reject_reason: String
  },
  { timestamps: true, collection: 'multibot_managed_bots' }
);
managedBotSchema.index({ telegram_bot_id: 1, status: 1 });
const ManagedBot = mongoose.model('ManagedBot', managedBotSchema);


// =========================
// HELPERLAR
// =========================
function normalizeCode(code) {
  return String(code || '').trim().toLowerCase();
}

function normalizeTitle(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[ʼ‘’`´]/g, "'")
    .replace(/\s+/g, ' ');
}

function transliterateUz(text) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch',
    ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: 'g', ҳ: 'h', ў: 'o',
    А: 'a', Б: 'b', В: 'v', Г: 'g', Д: 'd', Е: 'e', Ё: 'yo', Ж: 'j', З: 'z', И: 'i', Й: 'y', К: 'k', Л: 'l',
    М: 'm', Н: 'n', О: 'o', П: 'p', Р: 'r', С: 's', Т: 't', У: 'u', Ф: 'f', Х: 'x', Ц: 's', Ч: 'ch',
    Ш: 'sh', Щ: 'sh', Ъ: '', Ы: 'i', Ь: '', Э: 'e', Ю: 'yu', Я: 'ya', Қ: 'q', Ғ: 'g', Ҳ: 'h', Ў: 'o'
  };
  return String(text || '')
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('');
}

function slugifyCode(text) {
  return transliterateUz(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 32);
}

function isValidCode(code) {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(String(code || '').trim());
}

function normalizeUsername(input) {
  const clean = String(input || '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '');
  if (!clean) return null;
  return `@${clean}`;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasUsableToken(value) {
  const token = String(value || '').trim();
  if (!token) return false;
  if (token.includes('PASTE_') || token.includes('TOKEN_HERE') || token.includes('CHANGE_ME')) return false;
  return token.includes(':');
}

function shortText(text, max = 34) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function parseMetaInput(text) {
  const parts = String(text || '')
    .split('|')
    .map((p) => p.trim());

  const title = parts[0] || '';
  const code = parts[1] || slugifyCode(title);
  const description = parts.slice(2).join(' | ').trim();
  return { title, code, description };
}

function parsePartInput(text) {
  const parts = String(text || '')
    .split('|')
    .map((p) => p.trim());

  if (parts.length >= 2) {
    return {
      contentQuery: parts[0],
      partNo: Number(parts[1]),
      title: parts.slice(2).join(' | ').trim()
    };
  }

  const match = String(text || '').trim().match(/^(.+?)\s+(\d{1,5})(?:\s+(.+))?$/);
  if (!match) return null;
  return {
    contentQuery: match[1].trim(),
    partNo: Number(match[2]),
    title: (match[3] || '').trim()
  };
}

function extractStoredMessage(ctx, botKey) {
  const msg = ctx.message;
  if (!msg) return null;

  const base = {
    bot_key: botKey,
    source_chat_id: ctx.chat.id,
    source_message_id: msg.message_id,
    text: msg.text || '',
    entities: msg.entities || [],
    caption: msg.caption || '',
    caption_entities: msg.caption_entities || []
  };

  if (msg.video) {
    return {
      ...base,
      message_type: 'video',
      file_id: msg.video.file_id,
      file_unique_id: msg.video.file_unique_id,
      file_size: msg.video.file_size || null,
      duration: msg.video.duration || null,
      width: msg.video.width || null,
      height: msg.video.height || null
    };
  }

  if (msg.document) {
    return {
      ...base,
      message_type: 'document',
      file_id: msg.document.file_id,
      file_unique_id: msg.document.file_unique_id,
      file_name: msg.document.file_name || null,
      mime_type: msg.document.mime_type || null,
      file_size: msg.document.file_size || null
    };
  }

  if (msg.animation) {
    return {
      ...base,
      message_type: 'animation',
      file_id: msg.animation.file_id,
      file_unique_id: msg.animation.file_unique_id,
      file_name: msg.animation.file_name || null,
      mime_type: msg.animation.mime_type || null,
      file_size: msg.animation.file_size || null,
      duration: msg.animation.duration || null,
      width: msg.animation.width || null,
      height: msg.animation.height || null
    };
  }

  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      ...base,
      message_type: 'photo',
      file_id: photo.file_id,
      file_unique_id: photo.file_unique_id,
      file_size: photo.file_size || null,
      width: photo.width || null,
      height: photo.height || null
    };
  }

  if (msg.audio) {
    return {
      ...base,
      message_type: 'audio',
      file_id: msg.audio.file_id,
      file_unique_id: msg.audio.file_unique_id,
      file_name: msg.audio.file_name || null,
      mime_type: msg.audio.mime_type || null,
      file_size: msg.audio.file_size || null,
      duration: msg.audio.duration || null
    };
  }

  if (msg.voice) {
    return {
      ...base,
      message_type: 'voice',
      file_id: msg.voice.file_id,
      file_unique_id: msg.voice.file_unique_id,
      file_size: msg.voice.file_size || null,
      duration: msg.voice.duration || null,
      mime_type: msg.voice.mime_type || null
    };
  }

  if (msg.sticker) {
    return {
      ...base,
      message_type: 'sticker',
      file_id: msg.sticker.file_id,
      file_unique_id: msg.sticker.file_unique_id,
      file_size: msg.sticker.file_size || null,
      width: msg.sticker.width || null,
      height: msg.sticker.height || null
    };
  }

  if (msg.text) {
    return { ...base, message_type: 'text' };
  }

  // Boshqa turdagi xabarlar ham copyMessage bilan saqlanadi.
  return { ...base, message_type: 'other' };
}

function storedInfoText(stored) {
  const size = stored.file_size ? `${(stored.file_size / 1024 / 1024).toFixed(2)} MB` : null;
  const duration = stored.duration ? `${Math.floor(stored.duration / 60)} daq ${stored.duration % 60} son` : null;
  return [
    '✅ Post/qism qabul qilindi!',
    '',
    `📦 Tur: ${stored.message_type}`,
    stored.file_name ? `📄 Fayl: ${stored.file_name}` : null,
    size ? `📏 Hajm: ${size}` : null,
    duration ? `⏱ Davomiyligi: ${duration}` : null,
    stored.caption ? '📝 Caption: bor — premium emoji/formatlar copyMessage orqali saqlanadi' : null,
    stored.text && stored.message_type === 'text' ? '📝 Text: bor — formatlar saqlanadi' : null
  ]
    .filter(Boolean)
    .join('\n');
}

async function copyStoredMessage(ctx, stored) {
  try {
    await ctx.telegram.copyMessage(ctx.chat.id, stored.source_chat_id, stored.source_message_id);
    return;
  } catch (copyError) {
    console.error('copyMessage xatosi, fallback ishlaydi:', copyError.message);
  }

  const captionExtra = {
    caption: stored.caption || undefined,
    caption_entities: stored.caption_entities || undefined
  };

  if (stored.message_type === 'text') {
    return ctx.reply(stored.text || 'Matn topilmadi.', { entities: stored.entities || undefined });
  }
  if (stored.message_type === 'photo') return ctx.replyWithPhoto(stored.file_id, captionExtra);
  if (stored.message_type === 'video') return ctx.replyWithVideo(stored.file_id, captionExtra);
  if (stored.message_type === 'animation') return ctx.replyWithAnimation(stored.file_id, captionExtra);
  if (stored.message_type === 'document') return ctx.replyWithDocument(stored.file_id, captionExtra);
  if (stored.message_type === 'audio') return ctx.replyWithAudio(stored.file_id, captionExtra);
  if (stored.message_type === 'voice') return ctx.replyWithVoice(stored.file_id, captionExtra);
  if (stored.message_type === 'sticker') return ctx.replyWithSticker(stored.file_id);

  return ctx.reply('❌ Bu postni yuborishda xatolik bo‘ldi. Admin postni qayta joylashi kerak.');
}

function createSharedUtils(bot, config, adminIds) {
  function isAdmin(userId) {
    return adminIds.includes(Number(userId));
  }

  async function saveUser(ctx, incrementStart = false) {
    if (!ctx.from) return;
    await User.updateOne(
      { bot_key: config.key, user_id: ctx.from.id },
      {
        $set: {
          username: ctx.from.username || null,
          first_name: ctx.from.first_name || null,
          last_name: ctx.from.last_name || null,
          language_code: ctx.from.language_code || null,
          last_active_at: new Date(),
          is_blocked: false
        },
        ...(incrementStart ? { $inc: { starts: 1 } } : {})
      },
      { upsert: true }
    );
  }

  async function checkAllSubscriptions(userId) {
    if (isAdmin(userId)) return true;
    const subs = await Subscription.find({ bot_key: config.key });
    if (subs.length === 0) return true;

    for (const sub of subs) {
      try {
        const member = await bot.telegram.getChatMember(sub.chat_username, userId);
        if (['left', 'kicked'].includes(member.status)) return false;
      } catch (error) {
        console.error(`❌ ${config.title} obuna tekshirish xatosi ${sub.chat_username}:`, error.message);
        return false;
      }
    }
    return true;
  }

  async function getSubscriptionKeyboard() {
    const subs = await Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 });
    const rows = subs.map((sub) => [
      Markup.button.url(
        sub.type === 'channel' ? `📢 ${sub.chat_username}` : `👥 ${sub.chat_username}`,
        `https://t.me/${sub.chat_username.replace('@', '')}`
      )
    ]);
    rows.push([Markup.button.callback('✅ Obunani tekshirish', 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
  }

  async function sendSubscriptionWarning(ctx) {
    const keyboard = await getSubscriptionKeyboard();
    return ctx.reply(
      '🔒 Botdan foydalanish uchun avval majburiy kanal/guruhlarga obuna boʻling.\n\nObuna boʻlgach, “✅ Obunani tekshirish” tugmasini bosing.',
      keyboard
    );
  }

  async function broadcastMessage(ctx, adminKeyboard) {
    const users = await User.find({ bot_key: config.key, is_blocked: { $ne: true } }).select('user_id');
    let success = 0;
    let failed = 0;

    await ctx.reply(`📢 Broadcast boshlandi. Jami foydalanuvchi: ${users.length} ta`);

    for (const user of users) {
      try {
        await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
        success += 1;
        await sleep(45);
      } catch (error) {
        failed += 1;
        if (String(error.message || '').toLowerCase().includes('blocked')) {
          await User.updateOne({ bot_key: config.key, user_id: user.user_id }, { $set: { is_blocked: true } });
        }
      }
    }

    return ctx.reply(`✅ Broadcast yakunlandi!\n\n✅ Yuborildi: ${success} ta\n❌ Xatolik: ${failed} ta`, adminKeyboard ? adminKeyboard() : undefined);
  }

  async function handleSubscriptionCallback(ctx, adminKeyboard, successText) {
    await ctx.answerCbQuery();
    await saveUser(ctx);

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok && !isAdmin(ctx.from.id)) {
      const keyboard = await getSubscriptionKeyboard();
      return ctx.editMessageText('❌ Hali barcha kanal/guruhlarga obuna boʻlmagansiz.', keyboard);
    }

    try {
      await ctx.deleteMessage();
    } catch (_) {}

    if (isAdmin(ctx.from.id)) return ctx.reply('✅ Tasdiqlandi! Admin panel:', adminKeyboard ? adminKeyboard() : undefined);
    return ctx.reply(successText || '✅ Obuna tasdiqlandi!');
  }

  return {
    isAdmin,
    saveUser,
    checkAllSubscriptions,
    getSubscriptionKeyboard,
    sendSubscriptionWarning,
    broadcastMessage,
    handleSubscriptionCallback
  };
}

// =========================
// UNIVERSAL QISMLI/QISMSIZ KONTENT BOT
// =========================
function createContentBot(config, tokenOverride = null, adminIdsOverride = null) {
  const token = String(tokenOverride || process.env[config.tokenEnv] || '').trim();
  if (!hasUsableToken(token)) {
    console.warn(`⚠️ ${config.title} ishga tushmadi: token bo'sh yoki noto'g'ri.`);
    return null;
  }

  const adminIds = adminIdsOverride || parseIds(process.env[`${config.key.toUpperCase()}_ADMIN_IDS`] || process.env.ADMIN_IDS);
  const bot = new Telegraf(token);
  const PAGE_SIZE = 3;

  bot.use(
    session({
      defaultSession: () => ({ mode: null, tempMessage: null, tempPart: null })
    })
  );

  const utils = createSharedUtils(bot, config, adminIds);
  const { isAdmin, saveUser, checkAllSubscriptions, sendSubscriptionWarning, broadcastMessage, handleSubscriptionCallback } = utils;

  function resetSession(ctx) {
    ctx.session.mode = null;
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
  }

  function addButton() {
    return `${config.addEmoji} ${config.itemTitle} qoʻshish`;
  }

  function partButton() {
    return `🎞 Qism qoʻshish`;
  }

  function listButton() {
    return `${config.listEmoji} ${config.itemPluralTitle}`;
  }

  function deleteButton() {
    return `🗑 ${config.itemTitle} oʻchirish`;
  }

  function adminKeyboard() {
    return Markup.keyboard([
      [addButton(), partButton()],
      [listButton(), '📊 Statistika'],
      [deleteButton(), '🧹 Qism oʻchirish'],
      ['📢 Broadcast'],
      ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
      ['📋 Obunalar', '➖ Obuna oʻchirish'],
      ['🏠 Bosh menyu']
    ])
      .resize()
      .oneTime(false);
  }

  async function findContentsByQuery(input, limit = 8) {
    const qCode = normalizeCode(input);
    const qTitle = normalizeTitle(input);
    if (!qCode && !qTitle) return [];

    const exact = await Content.findOne({
      bot_key: config.key,
      is_active: true,
      $or: [{ code_norm: qCode }, { title_norm: qTitle }]
    });
    if (exact) return [exact];

    const titleRegex = new RegExp(escapeRegex(qTitle), 'i');
    const codeRegex = new RegExp(`^${escapeRegex(qCode)}`, 'i');
    return Content.find({
      bot_key: config.key,
      is_active: true,
      $or: [{ code_norm: { $regex: codeRegex } }, { title_norm: titleRegex }]
    })
      .sort({ search_count: -1, views: -1, createdAt: -1 })
      .limit(limit);
  }

  async function buildPartsPage(content, pageRaw = 0) {
    let page = Number(pageRaw || 0);
    if (!Number.isFinite(page) || page < 0) page = 0;

    const total = await ContentPart.countDocuments({ bot_key: config.key, content_id: content._id, is_active: true });
    const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > maxPage) page = maxPage;

    const parts = await ContentPart.find({ bot_key: config.key, content_id: content._id, is_active: true })
      .sort({ part_no: 1 })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE);

    const text = [
      `${config.mainEmoji} ${content.title}`,
      `🔎 Kod: ${content.code}`,
      content.description ? `📝 ${content.description}` : null,
      '',
      total ? `🎞 Qismlar: ${total} ta | Sahifa: ${page + 1}/${maxPage + 1}` : `📭 Hozircha bu ${config.item}ga qism qoʻshilmagan.`,
      '',
      total ? 'Kerakli qismni tanlang:' : 'Keyinroq qayta urinib koʻring.'
    ]
      .filter(Boolean)
      .join('\n');

    const rows = parts.map((part) => [
      Markup.button.callback(`${part.part_no}-qism${part.title ? ` — ${shortText(part.title, 28)}` : ''}`, `p:e:${String(part._id)}`)
    ]);

    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `p:p:${String(content._id)}:${page - 1}`));
    if ((page + 1) * PAGE_SIZE < total) nav.push(Markup.button.callback('Keyingi ➡️', `p:p:${String(content._id)}:${page + 1}`));
    if (nav.length) rows.push(nav);

    return { text, keyboard: Markup.inlineKeyboard(rows) };
  }

  async function showContentChoices(ctx, contents) {
    const rows = contents.map((c) => [
      Markup.button.callback(`${c.has_parts ? '🎞' : config.mainEmoji} ${c.title} — ${c.code}`, `p:o:${String(c._id)}`)
    ]);
    return ctx.reply(`🔎 Bir nechta ${config.item} topildi. Keraklisini tanlang:`, Markup.inlineKeyboard(rows));
  }

  async function deliverOrShowParts(ctx, content, edit = false, page = 0) {
    if (!content.has_parts) {
      if (edit) {
        try {
          await ctx.deleteMessage();
        } catch (_) {}
      }
      await copyStoredMessage(ctx, content);
      await Content.updateOne({ _id: content._id }, { $inc: { views: 1 }, $set: { last_view_at: new Date() } });
      return;
    }

    const payload = await buildPartsPage(content, page);
    await Content.updateOne({ _id: content._id }, { $inc: { search_count: 1 }, $set: { last_search_at: new Date() } });
    if (edit) return ctx.editMessageText(payload.text, payload.keyboard);
    return ctx.reply(payload.text, payload.keyboard);
  }

  async function addChannelOrGroup(ctx, text, type) {
    const username = normalizeUsername(text);
    if (!username) return ctx.reply('❌ Username notoʻgʻri. Qayta yuboring:');

    try {
      await Subscription.create({ bot_key: config.key, chat_username: username, type, added_by: ctx.from.id });
      resetSession(ctx);
      return ctx.reply(`✅ ${username} muvaffaqiyatli qoʻshildi.\n\n⚠️ Eslatma: bot o‘sha kanal/guruhda admin boʻlishi kerak.`, adminKeyboard());
    } catch (error) {
      if (error.code === 11000) return ctx.reply(`❌ ${username} allaqachon roʻyxatda bor.`);
      console.error(error);
      return ctx.reply('❌ Saqlashda xatolik. Qayta urinib koʻring.');
    }
  }

  bot.start(async (ctx) => {
    await saveUser(ctx, true);

    if (isAdmin(ctx.from.id)) {
      return ctx.reply(`👨‍💻 ${config.title} admin paneliga xush kelibsiz!`, adminKeyboard());
    }

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok) return sendSubscriptionWarning(ctx);

    return ctx.reply(
      `${config.mainEmoji} ${config.title}ga xush kelibsiz!\n\n${config.welcomeLine}\nMasalan: ${config.codeExamples}\n\nAgar ${config.item} qismli bo‘lsa, qismlar inline tugma bo‘lib chiqadi. Qismsiz bo‘lsa, post darrov yuboriladi.\n\n/start — botni qayta ishga tushirish`
    );
  });

  bot.command('cancel', async (ctx) => {
    resetSession(ctx);
    return ctx.reply('❌ Jarayon bekor qilindi.', isAdmin(ctx.from.id) ? adminKeyboard() : undefined);
  });

  bot.hears('🏠 Bosh menyu', async (ctx) => {
    await saveUser(ctx);
    resetSession(ctx);

    if (isAdmin(ctx.from.id)) return ctx.reply('🏠 Admin menyu:', adminKeyboard());

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok) return sendSubscriptionWarning(ctx);

    return ctx.reply(`${config.mainEmoji} ${config.itemTitle} nomi yoki kodini yuboring. Masalan: ${config.codeExamples}`);
  });

  bot.action('check_subscription', async (ctx) => {
    return handleSubscriptionCallback(ctx, adminKeyboard, `✅ Obuna tasdiqlandi! Endi ${config.item} nomi yoki kodini yuboring.`);
  });

  bot.action('kind:single', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Bu faqat admin uchun.');
    ctx.session.mode = 'single_wait_message';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.editMessageText(
      `✅ Qismsiz ${config.item} tanlandi.\n\nEndi post/video/documentni yuboring yoki kanaldan forward qiling.\nKeyin nomi va kodi so‘raladi.\n\n❌ Bekor qilish: /cancel`
    );
  });

  bot.action('kind:parts', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Bu faqat admin uchun.');
    ctx.session.mode = 'parts_wait_meta';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.editMessageText(
      `✅ Qismli ${config.item} tanlandi.\n\nEndi ${config.item} nomi va kodini yuboring.\n\nFormat:\nNomi | kodi | ixtiyoriy tavsif\n\nMisol:\nPoytaxt | poytaxt | Uzbek serial\n\nKod yozmasangiz, nomdan avtomatik kod yasaladi.\n❌ Bekor qilish: /cancel`
    );
  });

  bot.action(/^p:o:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    await saveUser(ctx);

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok && !isAdmin(ctx.from.id)) return sendSubscriptionWarning(ctx);

    const content = await Content.findOne({ _id: ctx.match[1], bot_key: config.key, is_active: true });
    if (!content) return ctx.reply(`❌ ${config.itemTitle} topilmadi yoki oʻchirilgan.`);

    return deliverOrShowParts(ctx, content, true, 0);
  });

  bot.action(/^p:p:([a-f0-9]{24}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await saveUser(ctx);

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok && !isAdmin(ctx.from.id)) return sendSubscriptionWarning(ctx);

    const content = await Content.findOne({ _id: ctx.match[1], bot_key: config.key, is_active: true });
    if (!content) return ctx.reply(`❌ ${config.itemTitle} topilmadi yoki oʻchirilgan.`);

    return deliverOrShowParts(ctx, content, true, Number(ctx.match[2]));
  });

  bot.action(/^p:e:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery('Yuborilmoqda...');
    await saveUser(ctx);

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok && !isAdmin(ctx.from.id)) return sendSubscriptionWarning(ctx);

    const part = await ContentPart.findOne({ _id: ctx.match[1], bot_key: config.key, is_active: true });
    if (!part) return ctx.reply('❌ Qism topilmadi yoki oʻchirilgan.');

    await copyStoredMessage(ctx, part);
    await ContentPart.updateOne({ _id: part._id }, { $inc: { views: 1 }, $set: { last_view_at: new Date() } });
  });

  bot.hears(addButton(), async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Bu buyruq faqat admin uchun.');
    ctx.session.mode = 'choose_kind';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;

    return ctx.reply(
      `${config.addEmoji} ${config.itemTitle} qo‘shish.\n\nBu ${config.item} qismli bo‘ladimi?\n\n• Qismli bo‘lsa — foydalanuvchiga avval 3 tadan qismlar inline chiqadi.\n• Qismsiz bo‘lsa — kod/nom yuborilganda post o‘zi darrov yuboriladi.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, qismli', 'kind:parts')],
        [Markup.button.callback('❌ Yo‘q, bitta to‘liq post', 'kind:single')]
      ])
    );
  });

  bot.hears(partButton(), async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Bu buyruq faqat admin uchun.');
    ctx.session.mode = 'part_wait_meta';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;

    return ctx.reply(
      `🎞 Qism qoʻshish.\n\nAvval ${config.item} kodi va qism raqamini yuboring.\n\nFormat:\nkod | qism_raqami | ixtiyoriy qism nomi\n\nMisol:\npoytaxt | 1 | 1-qism\n\nKeyin video/document/postni forward qilasiz yoki yuborasiz.\n❌ Bekor qilish: /cancel`
    );
  });

  bot.hears(listButton(), async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const contents = await Content.find({ bot_key: config.key, is_active: true }).sort({ createdAt: -1 }).limit(20);
    if (!contents.length) return ctx.reply(`📭 Hozircha ${config.item} qoʻshilmagan.`);

    const lines = [];
    for (const [i, c] of contents.entries()) {
      const count = c.has_parts ? await ContentPart.countDocuments({ bot_key: config.key, content_id: c._id, is_active: true }) : 0;
      lines.push(
        `${i + 1}. ${c.has_parts ? '🎞' : config.mainEmoji} ${c.title}\n` +
          `   🔎 Kod: ${c.code} | ${c.has_parts ? `${count} qism` : 'qismsiz'} | 👁 ${c.has_parts ? c.search_count + ' qidiruv' : c.views + ' ko‘rish'}`
      );
    }

    return ctx.reply(`${config.listEmoji} Soʻnggi 20 ta ${config.item}:\n\n${lines.join('\n\n')}`);
  });

  bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const [users, activeUsers, blockedUsers, contents, singles, withParts, parts, subs, topContents, topParts] = await Promise.all([
      User.countDocuments({ bot_key: config.key }),
      User.countDocuments({ bot_key: config.key, is_blocked: { $ne: true } }),
      User.countDocuments({ bot_key: config.key, is_blocked: true }),
      Content.countDocuments({ bot_key: config.key, is_active: true }),
      Content.countDocuments({ bot_key: config.key, has_parts: false, is_active: true }),
      Content.countDocuments({ bot_key: config.key, has_parts: true, is_active: true }),
      ContentPart.countDocuments({ bot_key: config.key, is_active: true }),
      Subscription.countDocuments({ bot_key: config.key }),
      Content.find({ bot_key: config.key, is_active: true }).sort({ views: -1, search_count: -1, createdAt: -1 }).limit(5),
      ContentPart.find({ bot_key: config.key, is_active: true }).sort({ views: -1, createdAt: -1 }).limit(5)
    ]);

    const contentList = topContents.length
      ? topContents.map((c, i) => `${i + 1}. ${c.title} — ${c.has_parts ? `${c.search_count} qidiruv` : `${c.views} ko‘rish`}`).join('\n')
      : `Hali ${config.item} yoʻq.`;

    const partList = topParts.length
      ? topParts.map((p, i) => `${i + 1}. ${p.content_title || p.content_code_norm} ${p.part_no}-qism — ${p.views} marta`).join('\n')
      : 'Hali qism yoʻq.';

    return ctx.reply(
      `📊 ${config.title.toUpperCase()} STATISTIKASI\n\n` +
        `👥 Jami foydalanuvchi: ${users}\n` +
        `✅ Aktiv: ${activeUsers}\n` +
        `🚫 Botni bloklaganlar: ${blockedUsers}\n` +
        `${config.mainEmoji} Jami ${config.itemPlural}: ${contents}\n` +
        `📦 Qismsiz: ${singles}\n` +
        `🎞 Qismli: ${withParts}\n` +
        `🎬 Qismlar soni: ${parts}\n` +
        `🔒 Majburiy obuna: ${subs}\n\n` +
        `🔥 Top ${config.itemPlural}:\n${contentList}\n\n` +
        `🔥 Top qismlar:\n${partList}`
    );
  });

  bot.hears(deleteButton(), async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'delete_content';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.reply(`🗑 Oʻchirmoqchi boʻlgan ${config.item} kodi yoki nomini yuboring.\n\nAgar qismli bo‘lsa, qismlari ham yashiriladi.\n❌ Bekor qilish: /cancel`);
  });

  bot.hears('🧹 Qism oʻchirish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'delete_part';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.reply(
      `🧹 Oʻchirmoqchi boʻlgan qismni yuboring.\n\nFormat:\nkod | qism_raqami\n\nMisol:\npoytaxt | 1\n\n❌ Bekor qilish: /cancel`
    );
  });

  bot.hears('📢 Broadcast', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'broadcasting';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.reply('📢 Broadcast rejimi yoqildi. Matn, rasm, video, fayl, forward — hammasi boʻladi.\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('➕ Kanal qoʻshish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'add_channel';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.reply('➕ Kanal username yuboring. Masalan: @kanal_nomi yoki kanal_nomi\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('➕ Guruh qoʻshish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'add_group';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.reply('➕ Guruh username yuboring. Masalan: @guruh_nomi yoki guruh_nomi\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('📋 Obunalar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const subs = await Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 });
    if (!subs.length) return ctx.reply('📭 Hozircha majburiy obuna yoʻq.');

    const list = subs.map((s, i) => `${i + 1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.chat_username}`).join('\n');
    return ctx.reply(`📋 Majburiy obunalar:\n\n${list}\n\nJami: ${subs.length} ta`);
  });

  bot.hears('➖ Obuna oʻchirish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'delete_subscription';
    ctx.session.tempMessage = null;
    ctx.session.tempPart = null;
    return ctx.reply('➖ Oʻchirmoqchi boʻlgan kanal/guruh username yuboring. Masalan: @kanal_nomi\n\n❌ Bekor qilish: /cancel');
  });

  bot.on('text', async (ctx) => {
    await saveUser(ctx);

    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    if (text === '/cancel') {
      resetSession(ctx);
      return ctx.reply('❌ Jarayon bekor qilindi.', isAdmin(userId) ? adminKeyboard() : undefined);
    }

    if (isAdmin(userId)) {
      if (ctx.session.mode === 'add_channel') return addChannelOrGroup(ctx, text, 'channel');
      if (ctx.session.mode === 'add_group') return addChannelOrGroup(ctx, text, 'group');

      if (ctx.session.mode === 'delete_subscription') {
        const username = normalizeUsername(text);
        const result = await Subscription.deleteOne({ bot_key: config.key, chat_username: username });
        resetSession(ctx);
        if (result.deletedCount) return ctx.reply(`✅ ${username} o‘chirildi.`, adminKeyboard());
        return ctx.reply('❌ Bunday obuna topilmadi.', adminKeyboard());
      }

      if (ctx.session.mode === 'single_wait_meta' && ctx.session.tempMessage) {
        const { title, code, description } = parseMetaInput(text);
        const codeNorm = normalizeCode(code);
        if (!title || title.length < 2) return ctx.reply(`${config.itemTitle} nomi juda qisqa. Qayta yuboring:`);
        if (!isValidCode(code)) return ctx.reply('❌ Kod faqat lotin harflari, raqam, _ yoki - dan iborat bo‘lsin. Maksimum 32 belgi. Qayta yuboring:');

        const exists = await Content.findOne({ bot_key: config.key, code_norm: codeNorm, is_active: true });
        if (exists) return ctx.reply(`❌ “${code}” kodi band. Boshqa kod yuboring.`);

        try {
          await Content.create({
            ...ctx.session.tempMessage,
            title,
            title_norm: normalizeTitle(title),
            code,
            code_norm: codeNorm,
            description,
            has_parts: false,
            added_by: userId
          });
          resetSession(ctx);
          return ctx.reply(
            `✅ Qismsiz ${config.item} saqlandi!\n\n${config.mainEmoji} Nomi: ${title}\n🔎 Kod: ${code}\n\nFoydalanuvchi kod/nom yuborsa, post darrov yuboriladi.`,
            adminKeyboard()
          );
        } catch (error) {
          console.error(`${config.title} qismsiz kontent saqlash xatosi:`, error);
          if (error.code === 11000) return ctx.reply(`❌ “${code}” kodi band. Boshqa kod yuboring.`);
          return ctx.reply('❌ Saqlashda xatolik yuz berdi. Qayta urinib koʻring.');
        }
      }

      if (ctx.session.mode === 'parts_wait_meta') {
        const { title, code, description } = parseMetaInput(text);
        const codeNorm = normalizeCode(code);
        if (!title || title.length < 2) return ctx.reply(`${config.itemTitle} nomi juda qisqa. Qayta yuboring:`);
        if (!isValidCode(code)) return ctx.reply('❌ Kod faqat lotin harflari, raqam, _ yoki - dan iborat bo‘lsin. Maksimum 32 belgi. Qayta yuboring:');

        const exists = await Content.findOne({ bot_key: config.key, code_norm: codeNorm, is_active: true });
        if (exists) return ctx.reply(`❌ “${code}” kodi band. Boshqa kod yuboring.`);

        try {
          await Content.create({
            bot_key: config.key,
            source_chat_id: ctx.chat.id,
            source_message_id: ctx.message.message_id,
            message_type: 'other',
            title,
            title_norm: normalizeTitle(title),
            code,
            code_norm: codeNorm,
            description,
            has_parts: true,
            added_by: userId
          });
          resetSession(ctx);
          return ctx.reply(
            `✅ Qismli ${config.item} yaratildi!\n\n${config.mainEmoji} Nomi: ${title}\n🔎 Kod: ${code}\n\nEndi “🎞 Qism qoʻshish” orqali qismlarini joylang.`,
            adminKeyboard()
          );
        } catch (error) {
          console.error(`${config.title} qismli kontent yaratish xatosi:`, error);
          if (error.code === 11000) return ctx.reply(`❌ “${code}” kodi band. Boshqa kod yuboring.`);
          return ctx.reply('❌ Yaratishda xatolik yuz berdi. Qayta urinib koʻring.');
        }
      }

      if (ctx.session.mode === 'part_wait_meta') {
        const parsed = parsePartInput(text);
        if (!parsed || !parsed.contentQuery || !Number.isInteger(parsed.partNo) || parsed.partNo <= 0) {
          return ctx.reply(`❌ Format notoʻgʻri. Masalan:\npoytaxt | 1 | 1-qism`);
        }

        const matches = await findContentsByQuery(parsed.contentQuery, 2);
        if (!matches.length) return ctx.reply(`❌ Bunday ${config.item} topilmadi. Avval “${addButton()}” orqali qismli qilib yarating.`);
        if (matches.length > 1) return ctx.reply(`❌ Bir nechta ${config.item} topildi. Aniqroq kod yuboring.`);

        const content = matches[0];
        if (!content.has_parts) {
          return ctx.reply(`❌ Bu ${config.item} qismsiz qilib yaratilgan. Qism qo‘shish uchun uni o‘chirib, qayta “qismli” qilib yarating.`);
        }

        const exists = await ContentPart.findOne({ bot_key: config.key, content_id: content._id, part_no: parsed.partNo, is_active: true });
        if (exists) return ctx.reply(`❌ ${content.title} ichida ${parsed.partNo}-qism allaqachon bor.`);

        ctx.session.tempPart = {
          content_id: String(content._id),
          content_code_norm: content.code_norm,
          content_title: content.title,
          part_no: parsed.partNo,
          title: parsed.title || `${parsed.partNo}-qism`
        };
        ctx.session.mode = 'part_wait_message';

        return ctx.reply(
          `✅ ${config.itemTitle} tanlandi: ${content.title}\n🎞 Qism: ${parsed.partNo}\n\nEndi shu qism post/video/documentini yuboring yoki kanaldan forward qiling.\n✅ Caption/premium emoji saqlanadi.\n❌ Bekor qilish: /cancel`
        );
      }

      if (ctx.session.mode === 'delete_content') {
        const matches = await findContentsByQuery(text, 2);
        if (!matches.length) {
          resetSession(ctx);
          return ctx.reply(`❌ Bunday ${config.item} topilmadi.`, adminKeyboard());
        }
        if (matches.length > 1) return ctx.reply(`❌ Bir nechta ${config.item} topildi. Aniq kod yuboring:`);

        const content = matches[0];
        await Content.updateOne({ _id: content._id }, { $set: { is_active: false } });
        await ContentPart.updateMany({ bot_key: config.key, content_id: content._id }, { $set: { is_active: false } });
        resetSession(ctx);
        return ctx.reply(`✅ “${content.title}” yashirildi/o‘chirildi. Agar qismli bo‘lsa, qismlari ham yashirildi.`, adminKeyboard());
      }

      if (ctx.session.mode === 'delete_part') {
        const parsed = parsePartInput(text);
        if (!parsed || !parsed.contentQuery || !Number.isInteger(parsed.partNo) || parsed.partNo <= 0) {
          return ctx.reply(`❌ Format notoʻgʻri. Masalan:\npoytaxt | 1`);
        }

        const matches = await findContentsByQuery(parsed.contentQuery, 2);
        if (!matches.length) {
          resetSession(ctx);
          return ctx.reply(`❌ ${config.itemTitle} topilmadi.`, adminKeyboard());
        }
        if (matches.length > 1) return ctx.reply(`❌ Bir nechta ${config.item} topildi. Aniq kod yuboring:`);

        const content = matches[0];
        const result = await ContentPart.updateOne(
          { bot_key: config.key, content_id: content._id, part_no: parsed.partNo, is_active: true },
          { $set: { is_active: false } }
        );
        resetSession(ctx);

        if (result.modifiedCount) return ctx.reply(`✅ ${content.title} — ${parsed.partNo}-qism oʻchirildi.`, adminKeyboard());
        return ctx.reply('❌ Bunday aktiv qism topilmadi.', adminKeyboard());
      }

      if (ctx.session.mode === 'broadcasting') {
        const result = await broadcastMessage(ctx, adminKeyboard);
        resetSession(ctx);
        return result;
      }
    }

    const ok = await checkAllSubscriptions(userId);
    if (!ok && !isAdmin(userId)) return sendSubscriptionWarning(ctx);

    const matches = await findContentsByQuery(text, 8);
    if (!matches.length) {
      return ctx.reply(`❌ Bunday ${config.item} topilmadi.\n\n${config.itemTitle} nomi yoki kodini tekshirib qayta yuboring. Masalan: ${config.codeExamples}`);
    }

    if (matches.length > 1) return showContentChoices(ctx, matches);
    return deliverOrShowParts(ctx, matches[0], false, 0);
  });

  bot.on('message', async (ctx) => {
    await saveUser(ctx);

    if (!isAdmin(ctx.from.id)) {
      const ok = await checkAllSubscriptions(ctx.from.id);
      if (!ok) return sendSubscriptionWarning(ctx);
      return ctx.reply(`${config.mainEmoji} ${config.itemTitle} nomi yoki kodini yuboring. Masalan: ${config.codeExamples}`);
    }

    if (ctx.session.mode === 'broadcasting') {
      const result = await broadcastMessage(ctx, adminKeyboard);
      resetSession(ctx);
      return result;
    }

    if (ctx.session.mode === 'single_wait_message') {
      const stored = extractStoredMessage(ctx, config.key);
      if (!stored) return ctx.reply('❌ Postni qabul qilib bo‘lmadi. Qayta yuboring yoki /cancel bosing.');

      ctx.session.tempMessage = stored;
      ctx.session.mode = 'single_wait_meta';

      return ctx.reply(
        `${storedInfoText(stored)}\n\nEndi ${config.item} nomi va kodini yuboring.\n\nFormat:\nNomi | kodi | ixtiyoriy tavsif\n\nMisol:\nAvatar | avatar | Full HD\n\nKod yozmasangiz, nomdan avtomatik kod yasaladi.\n❌ Bekor qilish: /cancel`
      );
    }

    if (ctx.session.mode === 'part_wait_message' && ctx.session.tempPart) {
      const stored = extractStoredMessage(ctx, config.key);
      if (!stored) return ctx.reply('❌ Qism postini qabul qilib bo‘lmadi. Qayta yuboring yoki /cancel bosing.');

      const temp = ctx.session.tempPart;
      try {
        const content = await Content.findOne({ _id: temp.content_id, bot_key: config.key, is_active: true, has_parts: true });
        if (!content) {
          resetSession(ctx);
          return ctx.reply(`${config.itemTitle} topilmadi yoki qismli emas.`, adminKeyboard());
        }

        await ContentPart.create({
          ...stored,
          content_id: content._id,
          content_code_norm: content.code_norm,
          content_title: content.title,
          part_no: temp.part_no,
          title: temp.title,
          added_by: ctx.from.id
        });

        resetSession(ctx);
        return ctx.reply(
          `✅ Qism saqlandi!\n\n${config.mainEmoji} ${config.itemTitle}: ${content.title}\n🎞 Qism: ${temp.part_no}\n🔎 Kod: ${content.code}`,
          adminKeyboard()
        );
      } catch (error) {
        console.error(`${config.title} qism saqlash xatosi:`, error);
        if (error.code === 11000) return ctx.reply('❌ Bu qism allaqachon bor. Boshqa qism raqami kiriting yoki avval eskisini oʻchiring.');
        return ctx.reply('❌ Qism saqlashda xatolik yuz berdi. Qayta urinib koʻring.');
      }
    }
  });

  bot.catch((err, ctx) => {
    console.error(`❌ ${config.title} xatosi update ${ctx.update?.update_id}:`, err);
  });

  return { key: config.key, title: config.title, bot, config };
}


// =========================
// BOT FACTORY / BOT TAYYORLOVCHI BOT
// =========================
const activeBots = new Map();
let expressApp = null;
let serverStarted = false;

function cryptoKey() {
  return crypto.createHash('sha256').update(String(BOT_TOKEN_SECRET || 'change_me')).digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const enc = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { token_enc: enc.toString('base64'), token_iv: iv.toString('base64'), token_tag: tag.toString('base64') };
}

function decryptToken(record) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(record.token_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.token_tag, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(record.token_enc, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

function maskToken(token) {
  const clean = String(token || '');
  if (clean.length < 12) return '***';
  return `${clean.slice(0, 8)}...${clean.slice(-5)}`;
}

function getPreset(typeKey) {
  return TYPE_PRESETS[typeKey] || TYPE_PRESETS.kino || {
    key: 'kino',
    title: 'KinoBot',
    item: 'kino',
    itemTitle: 'Kino',
    itemPlural: 'kinolar',
    itemPluralTitle: 'Kinolar',
    mainEmoji: '🎬',
    addEmoji: '🎥',
    listEmoji: '🎞',
    codeExamples: 'avatar, kino7',
    welcomeLine: 'Kino nomi yoki kodini yuboring.'
  };
}

function buildManagedConfig(record) {
  const preset = getPreset(record.type_key);
  return {
    ...preset,
    key: record.bot_key || `m_${String(record._id)}`,
    title: record.title || preset.title,
    managed: true,
    ownerUserId: record.owner_user_id,
    telegramUsername: record.telegram_username
  };
}

async function activateBot(active, source = 'manual') {
  if (!active || !active.key || !active.bot) return false;
  if (activeBots.has(active.key)) return true;

  activeBots.set(active.key, active);

  if (URL) {
    if (!expressApp) throw new Error('Express app hali tayyor emas');
    const webhookPath = `/webhook/${active.key}/${active.bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;
    const callback = active.bot.webhookCallback(webhookPath);

    expressApp.post(webhookPath, (req, res) => {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(403).send('Forbidden');
      return callback(req, res);
    });

    await active.bot.telegram.setWebhook(fullUrl, { secret_token: WEBHOOK_SECRET, drop_pending_updates: true });
    console.log(`🌐 ${active.title} webhook o'rnatildi (${source}): ${fullUrl}`);
  } else {
    await active.bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await active.bot.launch();
    console.log(`🤖 ${active.title} polling rejimida ishga tushdi (${source})`);
  }

  return true;
}

async function startManagedRecord(record, source = 'db') {
  if (!record || record.status !== 'approved' || !record.is_enabled) return null;
  const token = decryptToken(record);
  const config = buildManagedConfig(record);
  const adminIds = Array.from(new Set([...GLOBAL_ADMIN_IDS, ...record.admin_ids.map(Number).filter(Boolean)]));
  const active = createContentBot(config, token, adminIds);
  if (!active) return null;
  await activateBot(active, source);
  return active;
}

function typeRows(prefix = 'factory:type') {
  const entries = Object.entries(TYPE_PRESETS).filter(([key]) => ['kino', 'multfilm', 'serial', 'dorama', 'anime', 'turkserial', 'kurs', 'kitob'].includes(key));
  const rows = [];
  for (const [key, preset] of entries) rows.push([Markup.button.callback(`${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title}`, `${prefix}:${key}`)]);
  return rows;
}

function createFactoryBot() {
  if (!hasUsableToken(FACTORYBOT_TOKEN)) {
    console.warn('⚠️ FactoryBot ishga tushmadi: FACTORYBOT_TOKEN .env ichida bo‘sh yoki noto‘g‘ri.');
    return null;
  }

  const bot = new Telegraf(FACTORYBOT_TOKEN);
  bot.use(session({ defaultSession: () => ({ mode: null, draft: {} }) }));

  function isOwner(userId) {
    return GLOBAL_ADMIN_IDS.includes(Number(userId));
  }

  function reset(ctx) {
    ctx.session.mode = null;
    ctx.session.draft = {};
  }

  function userKeyboard(ctx) {
    const rows = [
      ['🤖 Bot tayyorlash'],
      ['📋 Mening botlarim', '☎️ Admin bilan kelishish']
    ];
    if (ctx.from && isOwner(ctx.from.id)) rows.unshift(['🛂 Kutilayotgan soʻrovlar', '📊 Factory statistika']);
    return Markup.keyboard(rows).resize().oneTime(false);
  }

  async function notifyOwners(text, keyboard) {
    for (const adminId of GLOBAL_ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, text, keyboard);
      } catch (error) {
        console.error('Factory admin xabar yuborish xatosi:', adminId, error.message);
      }
    }
  }

  async function showMyBots(ctx) {
    const list = await ManagedBot.find({ owner_user_id: ctx.from.id }).sort({ createdAt: -1 }).limit(20);
    if (!list.length) return ctx.reply('📭 Sizda hali bot soʻrovi yoʻq.', userKeyboard(ctx));

    const lines = list.map((b, i) => {
      const preset = getPreset(b.type_key);
      const statusMap = { pending: '⏳ kutilmoqda', approved: '✅ aktiv', rejected: '❌ rad etilgan', disabled: '⏸ toʻxtatilgan' };
      return `${i + 1}. ${preset.mainEmoji || '🤖'} ${b.title} — @${b.telegram_username}\n   Turi: ${preset.itemTitle || b.type_key} | Holat: ${statusMap[b.status] || b.status}`;
    });

    return ctx.reply(`📋 Mening botlarim:\n\n${lines.join('\n\n')}`, userKeyboard(ctx));
  }

  async function showPending(ctx) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Bu bo‘lim faqat asosiy admin uchun.');
    const list = await ManagedBot.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(20);
    if (!list.length) return ctx.reply('✅ Kutilayotgan soʻrovlar yoʻq.', userKeyboard(ctx));

    for (const req of list) {
      const preset = getPreset(req.type_key);
      await ctx.reply(
        `🛂 Yangi bot soʻrovi\n\n` +
          `🤖 Bot: ${req.title} (@${req.telegram_username})\n` +
          `📦 Turi: ${preset.itemTitle || req.type_key}\n` +
          `👤 Mijoz: ${req.owner_first_name || ''} ${req.owner_username ? '@' + req.owner_username : ''}\n` +
          `🆔 Mijoz ID: ${req.owner_user_id}\n` +
          `👨‍💻 Admin IDlar: ${req.admin_ids.join(', ')}\n` +
          `🔐 Token: ${req.token_mask || '***'}\n\n` +
          `Narx va shartlarni ${OWNER_USERNAME} orqali kelishib, keyin tasdiqlang.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Ruxsat berish / ishga tushirish', `factory:approve:${String(req._id)}`)],
          [Markup.button.callback('❌ Rad etish', `factory:reject:${String(req._id)}`)]
        ])
      );
    }
  }

  bot.start(async (ctx) => {
    reset(ctx);
    return ctx.reply(
      `🏭 Bot tayyorlovchi botga xush kelibsiz!\n\n` +
        `Bu yerda KinoBot, MultfilmBot, SerialBot, DoramaBot va shunga o‘xshash kontent botlarni tayyorlash uchun soʻrov yuborasiz.\n\n` +
        `Jarayon:\n` +
        `1) BotFather’dan token olasiz\n` +
        `2) Tokenni shu botga kiritasiz\n` +
        `3) Bot turini tanlaysiz\n` +
        `4) Bot nomi va admin ID kiritasiz\n` +
        `5) ${OWNER_USERNAME} bilan narx/shart kelishilgach, admin ruxsat beradi\n\n` +
        `Ruxsat berilgandan keyin bot avtomatik ishga tushadi.`,
      userKeyboard(ctx)
    );
  });

  bot.command('cancel', async (ctx) => {
    reset(ctx);
    return ctx.reply('❌ Jarayon bekor qilindi.', userKeyboard(ctx));
  });

  bot.hears('☎️ Admin bilan kelishish', async (ctx) => {
    return ctx.reply(`Narx, muddat va ruxsat uchun admin bilan bog‘laning: ${OWNER_USERNAME}`, Markup.inlineKeyboard([[Markup.button.url('Admin bilan yozishish', `https://t.me/${OWNER_USERNAME.replace('@', '')}`)]]));
  });

  bot.hears('📋 Mening botlarim', showMyBots);
  bot.hears('🛂 Kutilayotgan soʻrovlar', showPending);

  bot.hears('📊 Factory statistika', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const [pending, approved, rejected, disabled, totalUsers, totalContents, totalParts] = await Promise.all([
      ManagedBot.countDocuments({ status: 'pending' }),
      ManagedBot.countDocuments({ status: 'approved' }),
      ManagedBot.countDocuments({ status: 'rejected' }),
      ManagedBot.countDocuments({ status: 'disabled' }),
      User.countDocuments(),
      Content.countDocuments({ is_active: true }),
      ContentPart.countDocuments({ is_active: true })
    ]);
    return ctx.reply(
      `📊 BOTFACTORY STATISTIKA\n\n` +
        `⏳ Kutilayotgan: ${pending}\n` +
        `✅ Aktiv/tasdiqlangan: ${approved}\n` +
        `❌ Rad etilgan: ${rejected}\n` +
        `⏸ Toʻxtatilgan: ${disabled}\n` +
        `👥 Barcha userlar: ${totalUsers}\n` +
        `📦 Barcha kontentlar: ${totalContents}\n` +
        `🎞 Barcha qismlar: ${totalParts}\n` +
        `🚀 Hozir ishga tushgan botlar: ${activeBots.size}`,
      userKeyboard(ctx)
    );
  });

  bot.hears('🤖 Bot tayyorlash', async (ctx) => {
    reset(ctx);
    ctx.session.mode = 'wait_token';
    return ctx.reply(
      `🤖 Yangi bot tayyorlash boshlandi.\n\n` +
        `BotFather’dan olingan bot tokenni yuboring.\n\n` +
        `⚠️ Faqat o‘zingiz yaratgan bot tokenini yuboring. Token admin tasdiqlamaguncha ishga tushmaydi va DB’da shifrlanadi.\n\n` +
        `❌ Bekor qilish: /cancel`
    );
  });

  bot.action(/^factory:type:([a-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const typeKey = ctx.match[1];
    if (!ctx.session.draft?.token_enc) return ctx.reply('❌ Sessiya tugagan. Qaytadan “🤖 Bot tayyorlash” bosing.');
    const preset = getPreset(typeKey);
    ctx.session.draft.type_key = typeKey;
    ctx.session.mode = 'wait_title';
    return ctx.editMessageText(
      `✅ Bot turi tanlandi: ${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title}\n\n` +
        `Endi bot uchun ko‘rinadigan nom kiriting. Masalan:\n${preset.title}\n\n` +
        `Telegramdagi nomdan foydalanish uchun “-” yuboring.\n❌ Bekor qilish: /cancel`
    );
  });

  bot.action(/^factory:approve:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin tasdiqlay oladi.');

    const req = await ManagedBot.findOne({ _id: ctx.match[1] });
    if (!req) return ctx.reply('❌ Soʻrov topilmadi.');
    if (req.status !== 'pending') return ctx.reply(`ℹ️ Bu soʻrov holati: ${req.status}`);

    req.status = 'approved';
    req.is_enabled = true;
    req.bot_key = req.bot_key || `m_${String(req._id)}`;
    req.approved_by = ctx.from.id;
    req.approved_at = new Date();
    await req.save();

    try {
      await startManagedRecord(req, 'factory_approve');
      await ctx.editMessageText(`✅ @${req.telegram_username} tasdiqlandi va ishga tushirildi.`);
      await bot.telegram.sendMessage(
        req.owner_user_id,
        `✅ Sizning @${req.telegram_username} botingiz tasdiqlandi va ishga tushdi!\n\n` +
          `Endi botga /start bosing. Admin panel ichidan kontent qo‘shasiz, qismli/qismsiz tanlaysiz, kanal/guruh obuna sozlaysiz.`
      );
    } catch (error) {
      console.error('Approve/start xatosi:', error);
      await ctx.reply(`⚠️ So‘rov tasdiqlandi, lekin botni ishga tushirishda xatolik: ${error.message}`);
    }
  });

  bot.action(/^factory:reject:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin rad eta oladi.');
    const req = await ManagedBot.findOne({ _id: ctx.match[1] });
    if (!req) return ctx.reply('❌ Soʻrov topilmadi.');
    req.status = 'rejected';
    req.is_enabled = false;
    req.rejected_by = ctx.from.id;
    req.rejected_at = new Date();
    await req.save();
    await ctx.editMessageText(`❌ @${req.telegram_username} so‘rovi rad etildi.`);
    try {
      await bot.telegram.sendMessage(req.owner_user_id, `❌ @${req.telegram_username} bot so‘rovingiz rad etildi. Batafsil kelishish uchun ${OWNER_USERNAME} ga yozing.`);
    } catch (_) {}
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text === '/cancel') {
      reset(ctx);
      return ctx.reply('❌ Jarayon bekor qilindi.', userKeyboard(ctx));
    }

    if (ctx.session.mode === 'wait_token') {
      if (!hasUsableToken(text)) return ctx.reply('❌ Token noto‘g‘ri ko‘rinadi. BotFather bergan tokenni to‘liq yuboring.');

      try {
        const tmp = new Telegraf(text);
        const me = await tmp.telegram.getMe();
        const exists = await ManagedBot.findOne({ telegram_bot_id: me.id, status: { $in: ['pending', 'approved', 'disabled'] } });
        if (exists) {
          reset(ctx);
          return ctx.reply(`ℹ️ @${me.username} bo‘yicha so‘rov/bot allaqachon mavjud. Holati: ${exists.status}`, userKeyboard(ctx));
        }

        ctx.session.draft = {
          ...encryptToken(text),
          token_mask: maskToken(text),
          telegram_bot_id: me.id,
          telegram_username: me.username,
          telegram_first_name: me.first_name
        };
        ctx.session.mode = 'wait_type';
        return ctx.reply(
          `✅ Token tekshirildi: @${me.username}\n\nEndi bot turini tanlang:`,
          Markup.inlineKeyboard(typeRows())
        );
      } catch (error) {
        console.error('Factory token tekshirish xatosi:', error.message);
        return ctx.reply('❌ Tokenni tekshirib bo‘lmadi. Token xato, bot o‘chirilgan yoki internet/API javob bermayapti. Qayta yuboring:');
      }
    }

    if (ctx.session.mode === 'wait_title') {
      if (!ctx.session.draft?.type_key) return ctx.reply('❌ Sessiya tugagan. Qaytadan boshlang.');
      const preset = getPreset(ctx.session.draft.type_key);
      const title = text === '-' ? (ctx.session.draft.telegram_first_name || preset.title) : text;
      if (!title || title.length < 2 || title.length > 48) return ctx.reply('❌ Nom 2–48 belgi bo‘lsin. Qayta yuboring:');
      ctx.session.draft.title = title;
      ctx.session.mode = 'wait_admin_ids';
      return ctx.reply(
        `✅ Nomi: ${title}\n\n` +
          `Endi bot admin IDlarini yuboring.\n\n` +
          `Masalan:\n6606638731\n\n` +
          `Bir nechta bo‘lsa vergul bilan:\n6606638731,901126203\n\n` +
          `Eslatma: sizning ID ham avtomatik adminlarga qo‘shiladi.\n❌ Bekor qilish: /cancel`
      );
    }

    if (ctx.session.mode === 'wait_admin_ids') {
      const ids = parseIds(text);
      if (!ids.length) return ctx.reply('❌ Kamida bitta admin ID yuboring. Faqat raqam bo‘lsin.');

      const draft = ctx.session.draft || {};
      if (!draft.telegram_bot_id || !draft.type_key || !draft.title) return ctx.reply('❌ Sessiya tugagan. Qaytadan boshlang.');
      const adminIds = Array.from(new Set([ctx.from.id, ...ids]));

      const rec = await ManagedBot.create({
        owner_user_id: ctx.from.id,
        owner_username: ctx.from.username || null,
        owner_first_name: ctx.from.first_name || null,
        telegram_bot_id: draft.telegram_bot_id,
        telegram_username: draft.telegram_username,
        telegram_first_name: draft.telegram_first_name,
        title: draft.title,
        type_key: draft.type_key,
        admin_ids: adminIds,
        token_enc: draft.token_enc,
        token_iv: draft.token_iv,
        token_tag: draft.token_tag,
        token_mask: draft.token_mask,
        status: 'pending',
        is_enabled: false
      });
      rec.bot_key = `m_${String(rec._id)}`;
      await rec.save();
      reset(ctx);

      const preset = getPreset(rec.type_key);
      await ctx.reply(
        `✅ Soʻrov qabul qilindi!\n\n` +
          `🤖 Bot: @${rec.telegram_username}\n` +
          `📦 Turi: ${preset.itemTitle || rec.type_key}\n` +
          `👨‍💻 Admin IDlar: ${adminIds.join(', ')}\n\n` +
          `Endi narx va shartlarni ${OWNER_USERNAME} bilan kelishing. Admin ruxsat bergach bot avtomatik ishga tushadi.`,
        userKeyboard(ctx)
      );

      await notifyOwners(
        `🛂 Yangi bot tayyorlash soʻrovi!\n\n` +
          `🤖 Bot: ${rec.title} (@${rec.telegram_username})\n` +
          `📦 Turi: ${preset.itemTitle || rec.type_key}\n` +
          `👤 Mijoz: ${rec.owner_first_name || ''} ${rec.owner_username ? '@' + rec.owner_username : ''}\n` +
          `🆔 Mijoz ID: ${rec.owner_user_id}\n` +
          `👨‍💻 Admin IDlar: ${adminIds.join(', ')}\n\n` +
          `Narxni kelishib, ruxsat bering yoki rad eting.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Ruxsat berish / ishga tushirish', `factory:approve:${String(rec._id)}`)],
          [Markup.button.callback('❌ Rad etish', `factory:reject:${String(rec._id)}`)]
        ])
      );
    }
  });

  bot.catch((err, ctx) => {
    console.error(`❌ FactoryBot xatosi update ${ctx.update?.update_id}:`, err);
  });

  return { key: 'factory', title: 'BotFactory', bot, config: { key: 'factory', title: 'BotFactory' } };
}

// =========================
// START: KO'P BOT + FACTORY BITTA SERVERDA
// =========================
async function start() {
  await mongoose.connect(MONGODB_URL);
  console.log('✅ MongoDB ulandi');

  if (URL) {
    expressApp = express();
    expressApp.use(express.json());

    expressApp.get('/', (req, res) => {
      res.send(`✅ BotFactory MultiBot server ishlamoqda. Aktiv botlar: ${Array.from(activeBots.values()).map((b) => b.title).join(', ') || 'hali yo‘q'}`);
    });

    expressApp.get('/status', async (req, res) => {
      try {
        const bots = [];
        for (const active of activeBots.values()) {
          const [users, subs, contents, singles, withParts, parts] = await Promise.all([
            User.countDocuments({ bot_key: active.key }),
            Subscription.countDocuments({ bot_key: active.key }),
            Content.countDocuments({ bot_key: active.key, is_active: true }),
            Content.countDocuments({ bot_key: active.key, has_parts: false, is_active: true }),
            Content.countDocuments({ bot_key: active.key, has_parts: true, is_active: true }),
            ContentPart.countDocuments({ bot_key: active.key, is_active: true })
          ]);
          bots.push({ key: active.key, title: active.title, users, contents, singles, with_parts: withParts, parts, subscriptions: subs });
        }
        const [pending, approved] = await Promise.all([
          ManagedBot.countDocuments({ status: 'pending' }),
          ManagedBot.countDocuments({ status: 'approved', is_enabled: true })
        ]);
        res.json({ status: 'online', mode: 'webhook', active_bots: bots.length, pending_requests: pending, approved_managed_bots: approved, bots, uptime: process.uptime() });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });
  }

  const factory = createFactoryBot();
  if (factory) await activateBot(factory, 'factory');

  for (const config of STATIC_BOT_CONFIGS) {
    const active = createContentBot(config);
    if (active) await activateBot(active, 'static_env');
  }

  const approvedManaged = await ManagedBot.find({ status: 'approved', is_enabled: true });
  for (const record of approvedManaged) {
    try {
      await startManagedRecord(record, 'approved_db');
    } catch (error) {
      console.error(`❌ Managed bot ishga tushmadi @${record.telegram_username}:`, error.message);
    }
  }

  if (activeBots.size === 0) {
    throw new Error('Ishga tushadigan bot topilmadi. FACTORYBOT_TOKEN yoki boshqa bot tokenlaridan kamida bittasini .env ga yozing.');
  }

  if (URL && expressApp && !serverStarted) {
    expressApp.listen(PORT, () => {
      serverStarted = true;
      console.log(`🚀 BotFactory MultiBot server ${PORT} portda ishga tushdi`);
      console.log(`🤖 Aktiv botlar: ${Array.from(activeBots.values()).map((b) => b.title).join(', ')}`);
    });
  }

  process.once('SIGINT', async () => {
    console.log('Botlar toʻxtatilmoqda...');
    for (const active of activeBots.values()) active.bot.stop('SIGINT');
    await mongoose.connection.close();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    console.log('Botlar toʻxtatilmoqda...');
    for (const active of activeBots.values()) active.bot.stop('SIGTERM');
    await mongoose.connection.close();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error('❌ Start xatosi:', error);
  process.exit(1);
});
