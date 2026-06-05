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
const MONGODB_URL = process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URI || process.env.FACTORY_MONGODB_URI || '';
const PORT = Number(process.env.PORT || 3000);
const URL = String(process.env.URL || process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change_me_webhook_secret';
const BOT_TOKEN_SECRET = process.env.BOT_TOKEN_SECRET || WEBHOOK_SECRET;
const FACTORYBOT_TOKEN = String(process.env.FACTORYBOT_TOKEN || process.env.FACTORY_BOT_TOKEN || process.env.BOTFACTORY_TOKEN || process.env.BOTFACTORY_BOT_TOKEN || process.env.BOTFACTORYBOT_TOKEN || process.env.FACTORY_TOKEN || '').trim();
const OWNER_USERNAME = String(process.env.OWNER_USERNAME || '@Qoryogdiyev').trim();

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => Number(String(id).trim()))
    .filter(Boolean);
}

const GLOBAL_ADMIN_IDS = parseIds(process.env.ADMIN_IDS || process.env.FACTORY_ADMIN_IDS || process.env.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_CHAT_ID);

if (!MONGODB_URL) throw new Error('MONGODB_URL/MONGODB_URI .env ichida berilmagan');
if (GLOBAL_ADMIN_IDS.length === 0) {
  throw new Error('ADMIN_IDS .env ichida berilmagan. Masalan: ADMIN_IDS=6606638731,901126203');
}

// BotFactory orqali boshqariladigan umumiy majburiy obuna kaliti.
// Bu obunalar barcha yaratilgan botlarda ishlaydi, tekshiruv esa faqat FactoryBot tokeni orqali qilinadi.
const GLOBAL_SUBSCRIPTION_BOT_KEY = '__global__';

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

    // Oylik tarif / abonent tizimi
    plan_key: { type: String, default: 'monthly', index: true },
    monthly_price: { type: Number, default: 0 },
    currency: { type: String, default: 'UZS' },
    payment_status: { type: String, enum: ['not_paid', 'paid', 'overdue'], default: 'not_paid', index: true },
    billing_started_at: Date,
    current_period_start: Date,
    current_period_end: Date,
    last_paid_at: Date,
    next_payment_due_at: Date,
    expired_at: Date,
    last_extended_by: Number,
    last_extended_at: Date,
    disabled_reason: String,

    status: { type: String, enum: ['pending', 'approved', 'rejected', 'disabled', 'expired'], default: 'pending', index: true },
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

const botPlanSchema = new mongoose.Schema(
  {
    type_key: { type: String, required: true, unique: true, index: true },
    title: String,
    monthly_price: { type: Number, default: 0 },
    currency: { type: String, default: 'UZS' },
    is_active: { type: Boolean, default: true },
    updated_by: Number
  },
  { timestamps: true, collection: 'multibot_bot_plans' }
);
const BotPlan = mongoose.model('BotPlan', botPlanSchema);

const factoryUserSchema = new mongoose.Schema(
  {
    user_id: { type: Number, required: true, unique: true, index: true },
    username: String,
    first_name: String,
    last_name: String,
    language_code: String,
    joined_at: { type: Date, default: Date.now },
    last_active_at: { type: Date, default: Date.now },
    starts: { type: Number, default: 0 },
    is_blocked: { type: Boolean, default: false }
  },
  { timestamps: true, collection: 'multibot_factory_users' }
);
const FactoryUser = mongoose.model('FactoryUser', factoryUserSchema);

const broadcastLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['global', 'single_bot'], default: 'global', index: true },
    sent_by: Number,
    source_chat_id: Number,
    source_message_id: Number,
    target_bot_keys: [String],
    total_targets: { type: Number, default: 0 },
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    per_bot_stats: { type: Array, default: [] },
    finished_at: Date
  },
  { timestamps: true, collection: 'multibot_broadcast_logs' }
);
const BroadcastLog = mongoose.model('BroadcastLog', broadcastLogSchema);


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
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Public kanal/guruh: @username yoki https://t.me/username
  let clean = raw
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^tg:\/\/resolve\?domain=/i, '')
    .replace(/^@/, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '')
    .trim();

  // Private kanal/guruh uchun Telegram chat ID: -1001234567890
  if (/^-?\d{6,}$/.test(clean)) return clean;

  // Invite linklar bilan getChatMember ishlamaydi. Admin @username yoki -100 chat_id kiritishi kerak.
  if (clean.startsWith('+') || clean.includes('/+')) return null;

  if (!clean || !/^[a-zA-Z0-9_]{5,32}$/.test(clean)) return null;
  return `@${clean}`;
}

function subJoinUrl(chatRef) {
  const ref = String(chatRef || '').trim();
  if (!ref) return null;
  if (ref.startsWith('@')) return `https://t.me/${ref.replace('@', '')}`;
  return null;
}

function subLabel(sub) {
  const icon = sub?.type === 'group' ? '👥' : '📢';
  return `${icon} ${sub?.chat_username || 'nomaʼlum'}`;
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

    const [localSubs, globalSubs] = await Promise.all([
      Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 }),
      Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 })
    ]);

    const allSubs = [
      ...globalSubs.map((sub) => ({ sub, scope: 'global' })),
      ...localSubs.map((sub) => ({ sub, scope: 'local' }))
    ];

    if (allSubs.length === 0) return true;

    // Global obunalar barcha yaratilgan botlarda FactoryBot orqali tekshiriladi.
    // Shuning uchun mijoz botlarni kanal/guruhlarga admin qilish shart emas.
    const factoryActive = activeBots.get('factory');
    const factoryTelegram = factoryActive?.bot?.telegram || bot.telegram;

    for (const item of allSubs) {
      const { sub, scope } = item;
      try {
        const telegram = scope === 'global' ? factoryTelegram : bot.telegram;
        const member = await telegram.getChatMember(sub.chat_username, userId);
        if (['left', 'kicked'].includes(member.status)) return false;
      } catch (error) {
        console.error(`❌ ${config.title} ${scope === 'global' ? 'global' : 'local'} obuna tekshirish xatosi ${sub.chat_username}:`, error.message);
        return false;
      }
    }
    return true;
  }

  async function getSubscriptionKeyboard() {
    const [globalSubs, localSubs] = await Promise.all([
      Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 }),
      Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 })
    ]);

    const rows = [];
    for (const sub of globalSubs) {
      const url = subJoinUrl(sub.chat_username);
      if (url) rows.push([Markup.button.url(`🌐 ${subLabel(sub)}`, url)]);
      else rows.push([Markup.button.callback(`🌐 ${subLabel(sub)}`, 'noop')]);
    }
    for (const sub of localSubs) {
      const url = subJoinUrl(sub.chat_username);
      if (url) rows.push([Markup.button.url(subLabel(sub), url)]);
      else rows.push([Markup.button.callback(subLabel(sub), 'noop')]);
    }
    rows.push([Markup.button.callback('✅ Obunani tekshirish', 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
  }

  async function sendSubscriptionWarning(ctx) {
    const keyboard = await getSubscriptionKeyboard();
    return ctx.reply(
      '🔒 Botdan foydalanish uchun avval majburiy kanal/guruhlarga obuna boʻling.\n\n🌐 Umumiy obunalar BotFactory orqali barcha yaratilgan botlar uchun tekshiriladi. Obuna boʻlgach, “✅ Obunani tekshirish” tugmasini bosing.',
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

  if (config.managed) {
    bot.use(async (ctx, next) => {
      const rec = await ManagedBot.findOne({ bot_key: config.key });
      if (!rec) return;

      const expiredNow = await markRecordExpiredIfNeeded(rec);
      const allowed = !expiredNow && rec.status === 'approved' && rec.is_enabled;
      if (!allowed) {
        const ownerOrAdmin = ctx.from && (Number(ctx.from.id) === Number(rec.owner_user_id) || (rec.admin_ids || []).map(Number).includes(Number(ctx.from.id)) || GLOBAL_ADMIN_IDS.includes(Number(ctx.from.id)));
        if (ownerOrAdmin) {
          return ctx.reply(
            `⏳ @${rec.telegram_username} botining oylik muddati tugagan yoki admin tomonidan to‘xtatilgan.\n\n` +
              `Bot ichidagi kinolar/qismlar/userlar MongoDB’da saqlangan. Admin ruxsat/oylik to‘lovni tasdiqlagach bot yana shu joyidan ishlaydi.\n\n` +
              `Kelishish: ${OWNER_USERNAME}`
          );
        }
        return;
      }

      return next();
    });
  }

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

  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery('Bu yopiq/private chat. Admin bergan ko‘rsatma bo‘yicha obuna bo‘ling.');
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


function formatDate(date) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  } catch (_) {
    return new Date(date).toISOString();
  }
}

function formatMoney(amount, currency = 'UZS') {
  const n = Number(amount || 0);
  if (!n) return `0 ${currency}`;
  return `${n.toLocaleString('uz-UZ')} ${currency}`;
}

function addMonthsSafe(date, months = 1) {
  const d = new Date(date || Date.now());
  const day = d.getDate();
  const target = new Date(d);
  target.setMonth(target.getMonth() + months);
  if (target.getDate() !== day) target.setDate(0);
  return target;
}

function defaultPlanPrice(typeKey) {
  return Number(process.env[`${String(typeKey || '').toUpperCase()}_MONTHLY_PRICE`] || process.env.DEFAULT_MONTHLY_PRICE || 0);
}

async function getOrCreatePlan(typeKey) {
  const preset = getPreset(typeKey);
  const existing = await BotPlan.findOne({ type_key: typeKey });
  if (existing) return existing;
  return BotPlan.create({
    type_key: typeKey,
    title: preset.title || preset.itemTitle || typeKey,
    monthly_price: defaultPlanPrice(typeKey),
    currency: process.env.DEFAULT_CURRENCY || 'UZS',
    is_active: true
  });
}

async function seedDefaultPlans() {
  for (const [typeKey, preset] of Object.entries(TYPE_PRESETS)) {
    const existing = await BotPlan.findOne({ type_key: typeKey });
    if (!existing) {
      await BotPlan.create({
        type_key: typeKey,
        title: preset.title || preset.itemTitle || typeKey,
        monthly_price: defaultPlanPrice(typeKey),
        currency: process.env.DEFAULT_CURRENCY || 'UZS',
        is_active: true
      });
    } else if (!existing.title) {
      existing.title = preset.title || preset.itemTitle || typeKey;
      await existing.save();
    }
  }
}

function isBillingExpired(record, now = new Date()) {
  if (!record || record.status !== 'approved' || !record.is_enabled) return false;
  if (!record.current_period_end) return false;
  return new Date(record.current_period_end).getTime() <= now.getTime();
}

async function ensureBillingWindow(record) {
  if (!record || record.status !== 'approved' || !record.is_enabled) return record;
  if (record.current_period_end) return record;

  const plan = await getOrCreatePlan(record.type_key);
  const start = record.billing_started_at || record.approved_at || record.createdAt || new Date();
  record.billing_started_at = record.billing_started_at || start;
  record.current_period_start = record.current_period_start || start;
  record.current_period_end = addMonthsSafe(start, 1);
  record.next_payment_due_at = record.current_period_end;
  record.monthly_price = Number(record.monthly_price || plan.monthly_price || 0);
  record.currency = record.currency || plan.currency || 'UZS';
  record.payment_status = record.payment_status === 'not_paid' ? 'paid' : (record.payment_status || 'paid');
  await record.save();
  return record;
}

async function markRecordExpiredIfNeeded(record) {
  await ensureBillingWindow(record);
  if (!isBillingExpired(record)) return false;
  record.status = 'expired';
  record.is_enabled = false;
  record.payment_status = 'overdue';
  record.disabled_reason = 'billing_expired';
  record.expired_at = record.expired_at || new Date();
  await record.save();
  return true;
}

async function expireDueManagedBots() {
  const due = await ManagedBot.find({
    status: 'approved',
    is_enabled: true,
    current_period_end: { $lte: new Date() }
  });

  for (const rec of due) {
    await markRecordExpiredIfNeeded(rec);
    try {
      for (const adminId of GLOBAL_ADMIN_IDS) {
        const factory = activeBots.get('factory');
        if (factory?.bot) {
          await factory.bot.telegram.sendMessage(
            adminId,
            `⏳ Bot muddati tugadi: @${rec.telegram_username}\n` +
              `👤 Egasi: ${rec.owner_first_name || ''} ${rec.owner_username ? '@' + rec.owner_username : ''}\n` +
              `🆔 Egasi ID: ${rec.owner_user_id}\n` +
              `💰 Tarif: ${formatMoney(rec.monthly_price, rec.currency)} / oy\n` +
              `📅 Tugagan sana: ${formatDate(rec.current_period_end)}`,
            Markup.inlineKeyboard([[Markup.button.callback('✅ 1 oyga uzaytirish', `factory:extend:${String(rec._id)}`)]])
          );
        }
      }
    } catch (_) {}
  }
}

async function extendManagedBot(record, adminId, months = 1) {
  const plan = await getOrCreatePlan(record.type_key);
  const now = new Date();
  const base = record.current_period_end && new Date(record.current_period_end) > now ? new Date(record.current_period_end) : now;
  const newEnd = addMonthsSafe(base, months);

  record.status = 'approved';
  record.is_enabled = true;
  record.payment_status = 'paid';
  record.disabled_reason = null;
  record.expired_at = null;
  record.monthly_price = Number(plan.monthly_price || record.monthly_price || 0);
  record.currency = plan.currency || record.currency || 'UZS';
  record.billing_started_at = record.billing_started_at || now;
  record.current_period_start = base;
  record.current_period_end = newEnd;
  record.next_payment_due_at = newEnd;
  record.last_paid_at = now;
  record.last_extended_by = adminId;
  record.last_extended_at = now;
  if (!record.bot_key) record.bot_key = `m_${String(record._id)}`;
  await record.save();
  return record;
}

async function disableManagedBot(record, adminId, reason = 'admin_disabled') {
  record.status = 'disabled';
  record.is_enabled = false;
  record.disabled_reason = reason;
  record.rejected_by = adminId;
  await record.save();
  return record;
}

async function getBotStats(botKey) {
  const [users, activeUsers, blockedUsers, contents, singles, withParts, parts, subs, viewsAgg, partViewsAgg] = await Promise.all([
    User.countDocuments({ bot_key: botKey }),
    User.countDocuments({ bot_key: botKey, is_blocked: { $ne: true } }),
    User.countDocuments({ bot_key: botKey, is_blocked: true }),
    Content.countDocuments({ bot_key: botKey, is_active: true }),
    Content.countDocuments({ bot_key: botKey, has_parts: false, is_active: true }),
    Content.countDocuments({ bot_key: botKey, has_parts: true, is_active: true }),
    ContentPart.countDocuments({ bot_key: botKey, is_active: true }),
    Subscription.countDocuments({ bot_key: botKey }),
    Content.aggregate([{ $match: { bot_key: botKey, is_active: true } }, { $group: { _id: null, total: { $sum: '$views' }, searches: { $sum: '$search_count' } } }]),
    ContentPart.aggregate([{ $match: { bot_key: botKey, is_active: true } }, { $group: { _id: null, total: { $sum: '$views' } } }])
  ]);
  return {
    users,
    activeUsers,
    blockedUsers,
    contents,
    singles,
    withParts,
    parts,
    subscriptions: subs,
    contentViews: viewsAgg[0]?.total || 0,
    searches: viewsAgg[0]?.searches || 0,
    partViews: partViewsAgg[0]?.total || 0
  };
}

function botStatusLabel(record) {
  const map = {
    pending: '⏳ kutilmoqda',
    approved: record?.is_enabled ? '✅ aktiv' : '⏸ to‘xtatilgan',
    expired: '⏳ oylik to‘lov tugagan',
    rejected: '❌ rad etilgan',
    disabled: '⏸ admin to‘xtatgan'
  };
  return map[record.status] || record.status;
}

async function botDetailText(record) {
  const preset = getPreset(record.type_key);
  const stats = record.bot_key ? await getBotStats(record.bot_key) : null;
  return (
    `🤖 BOT MAʼLUMOTI\n\n` +
    `${preset.mainEmoji || '🤖'} Nomi: ${record.title}\n` +
    `🔗 Username: @${record.telegram_username}\n` +
    `📦 Turi: ${preset.itemTitle || record.type_key}\n` +
    `📌 Holat: ${botStatusLabel(record)}\n` +
    `👤 Egasi: ${record.owner_first_name || ''} ${record.owner_username ? '@' + record.owner_username : ''}\n` +
    `🆔 Egasi ID: ${record.owner_user_id}\n` +
    `👨‍💻 Admin IDlar: ${(record.admin_ids || []).join(', ') || '—'}\n\n` +
    `💰 Tarif: ${formatMoney(record.monthly_price, record.currency)} / oy\n` +
    `📅 Boshlangan: ${formatDate(record.billing_started_at)}\n` +
    `⏳ Keyingi to‘lov: ${formatDate(record.current_period_end)}\n` +
    `🧾 To‘lov holati: ${record.payment_status || '—'}\n\n` +
    (stats
      ? `📊 BOT STATISTIKASI\n` +
        `👥 Userlar: ${stats.users} | aktiv: ${stats.activeUsers} | blok: ${stats.blockedUsers}\n` +
        `📦 Kontent: ${stats.contents} | qismsiz: ${stats.singles} | qismli: ${stats.withParts}\n` +
        `🎞 Qismlar: ${stats.parts}\n` +
        `🔒 Majburiy obuna: ${stats.subscriptions}\n` +
        `👁 Ko‘rishlar: ${stats.contentViews + stats.partViews} | qidiruv: ${stats.searches}`
      : `📊 Bot hali tasdiqlanmagan yoki bot_key yo‘q.`)
  );
}

async function searchManagedBots(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const username = q.replace(/^@/, '').trim();
  const numeric = Number(q);
  const ors = [
    { telegram_username: new RegExp(escapeRegex(username), 'i') },
    { title: new RegExp(escapeRegex(q), 'i') },
    { owner_username: new RegExp(escapeRegex(username), 'i') }
  ];
  if (Number.isFinite(numeric) && numeric > 0) ors.push({ owner_user_id: numeric }, { telegram_bot_id: numeric });
  return ManagedBot.find({ $or: ors }).sort({ createdAt: -1 }).limit(10);
}

function botActionKeyboard(record) {
  const rows = [];
  if (record.status === 'pending') {
    rows.push([Markup.button.callback('✅ Ruxsat berish / 1 oy aktiv qilish', `factory:approve:${String(record._id)}`)]);
    rows.push([Markup.button.callback('❌ Rad etish', `factory:reject:${String(record._id)}`)]);
  } else {
    rows.push([Markup.button.callback('✅ 1 oyga uzaytirish', `factory:extend:${String(record._id)}`)]);
    if (record.status !== 'disabled') rows.push([Markup.button.callback('⏸ To‘xtatish', `factory:disable:${String(record._id)}`)]);
  }
  rows.push([Markup.button.callback('🔄 Yangilash', `factory:bot:${String(record._id)}`)]);
  return Markup.inlineKeyboard(rows);
}

async function startManagedRecord(record, source = 'db') {
  if (!record || record.status !== 'approved' || !record.is_enabled) return null;
  const expired = await markRecordExpiredIfNeeded(record);
  if (expired) return null;
  const token = decryptToken(record);
  const config = buildManagedConfig(record);
  const adminIds = Array.from(new Set([...GLOBAL_ADMIN_IDS, ...record.admin_ids.map(Number).filter(Boolean)]));
  const active = createContentBot(config, token, adminIds);
  if (!active) return null;
  await activateBot(active, source);
  return active;
}

function typeRows(prefix = 'factory:type') {
  const entries = Object.entries(TYPE_PRESETS).filter(([key]) => ['kino', 'multfilm', 'serial', 'dorama', 'anime', 'turkserial', 'kurs', 'kitob', 'fayl', 'music'].includes(key));
  const rows = [];
  for (const [key, preset] of entries) rows.push([Markup.button.callback(`${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title}`, `${prefix}:${key}`)]);
  return rows;
}


function isTelegramBlockedError(error) {
  const msg = String(error?.description || error?.message || '').toLowerCase();
  return msg.includes('bot was blocked') || msg.includes('blocked by the user') || msg.includes('user is deactivated') || msg.includes('chat not found') || msg.includes('forbidden');
}

function getLargestPhoto(msg) {
  if (!Array.isArray(msg?.photo) || !msg.photo.length) return null;
  return msg.photo[msg.photo.length - 1];
}

function getBroadcastMediaInfo(msg) {
  if (!msg) return { type: 'unknown' };
  if (msg.photo?.length) {
    const photo = getLargestPhoto(msg);
    return { type: 'photo', file_id: photo.file_id, width: photo.width, height: photo.height, file_size: photo.file_size };
  }
  if (msg.video) return { type: 'video', file_id: msg.video.file_id, file_name: msg.video.file_name, mime_type: msg.video.mime_type, duration: msg.video.duration, width: msg.video.width, height: msg.video.height, file_size: msg.video.file_size };
  if (msg.animation) return { type: 'animation', file_id: msg.animation.file_id, file_name: msg.animation.file_name, mime_type: msg.animation.mime_type, duration: msg.animation.duration, width: msg.animation.width, height: msg.animation.height, file_size: msg.animation.file_size };
  if (msg.document) return { type: 'document', file_id: msg.document.file_id, file_name: msg.document.file_name, mime_type: msg.document.mime_type, file_size: msg.document.file_size };
  if (msg.audio) return { type: 'audio', file_id: msg.audio.file_id, file_name: msg.audio.file_name, mime_type: msg.audio.mime_type, duration: msg.audio.duration, file_size: msg.audio.file_size };
  if (msg.voice) return { type: 'voice', file_id: msg.voice.file_id, mime_type: msg.voice.mime_type, duration: msg.voice.duration, file_size: msg.voice.file_size };
  if (msg.sticker) return { type: 'sticker', file_id: msg.sticker.file_id, file_unique_id: msg.sticker.file_unique_id, width: msg.sticker.width, height: msg.sticker.height, file_size: msg.sticker.file_size };
  if (msg.video_note) return { type: 'video_note', file_id: msg.video_note.file_id, duration: msg.video_note.duration, length: msg.video_note.length, file_size: msg.video_note.file_size };
  if (msg.text) return { type: 'text' };
  return { type: 'unknown' };
}

async function buildGlobalBroadcastPayload(ctx, sourceBot) {
  const msg = ctx.message;
  const media = getBroadcastMediaInfo(msg);
  const payload = {
    ...media,
    text: msg?.text || '',
    entities: msg?.entities || undefined,
    caption: msg?.caption || undefined,
    caption_entities: msg?.caption_entities || undefined
  };

  if (payload.file_id && sourceBot?.telegram?.getFileLink) {
    try {
      const link = await sourceBot.telegram.getFileLink(payload.file_id);
      payload.file_url = String(link);
    } catch (error) {
      console.error('Broadcast file link olish xatosi:', error.message);
      // Text/caption fallback baribir ishlashi uchun faqat log qilamiz.
    }
  }

  return payload;
}

function captionExtraFromPayload(payload) {
  return {
    caption: payload.caption || undefined,
    caption_entities: payload.caption_entities || undefined
  };
}

async function sendPayloadWithBot(targetBot, chatId, payload) {
  if (!payload || payload.type === 'unknown') throw new Error('Bu turdagi xabar broadcast uchun qo‘llab-quvvatlanmadi. Matn, rasm, video, fayl yoki forward yuboring.');

  if (payload.type === 'text') {
    return targetBot.telegram.sendMessage(chatId, payload.text || ' ', { entities: payload.entities || undefined });
  }

  const extra = captionExtraFromPayload(payload);
  const urlInput = payload.file_url ? { url: payload.file_url, filename: payload.file_name || undefined } : payload.file_id;
  if (!urlInput) {
    if (payload.caption) return targetBot.telegram.sendMessage(chatId, payload.caption, { entities: payload.caption_entities || undefined });
    throw new Error('Media faylni boshqa bot orqali yuborish uchun vaqtinchalik Telegram file link olinmadi. Qayta urinib ko‘ring.');
  }

  if (payload.type === 'photo') return targetBot.telegram.sendPhoto(chatId, payload.file_url || payload.file_id, extra);
  if (payload.type === 'video') return targetBot.telegram.sendVideo(chatId, urlInput, extra);
  if (payload.type === 'animation') return targetBot.telegram.sendAnimation(chatId, urlInput, extra);
  if (payload.type === 'document') return targetBot.telegram.sendDocument(chatId, urlInput, extra);
  if (payload.type === 'audio') return targetBot.telegram.sendAudio(chatId, urlInput, extra);
  if (payload.type === 'voice') return targetBot.telegram.sendVoice(chatId, payload.file_url || payload.file_id, extra);
  if (payload.type === 'sticker') return targetBot.telegram.sendSticker(chatId, payload.file_url || payload.file_id);
  if (payload.type === 'video_note') return targetBot.telegram.sendVideoNote(chatId, payload.file_url || payload.file_id);

  throw new Error(`Broadcast uchun qo‘llab-quvvatlanmagan xabar turi: ${payload.type}`);
}

async function ensureApprovedManagedBotsStarted() {
  await expireDueManagedBots();
  const approvedManaged = await ManagedBot.find({
    status: 'approved',
    is_enabled: true,
    $or: [{ current_period_end: { $gt: new Date() } }, { current_period_end: null }]
  });

  let started = 0;
  let failed = 0;
  for (const record of approvedManaged) {
    const key = record.bot_key || `m_${String(record._id)}`;
    if (activeBots.has(key)) continue;
    try {
      const active = await startManagedRecord(record, 'broadcast_autostart');
      if (active) started += 1;
    } catch (error) {
      failed += 1;
      console.error(`Broadcast oldidan @${record.telegram_username} ishga tushmadi:`, error.message);
    }
  }
  return { started, failed };
}

async function sendBroadcastToFactoryUsers(ctx, payload, sourceMessageId) {
  const users = await FactoryUser.find({ is_blocked: { $ne: true } }).select('user_id');
  const stats = { key: 'factory', title: 'BotFactory', total: users.length, success: 0, failed: 0 };

  for (const user of users) {
    try {
      // FactoryBot o‘z foydalanuvchilariga aynan asl xabarni copy qiladi.
      await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, sourceMessageId);
      stats.success += 1;
      await sleep(35);
    } catch (error) {
      stats.failed += 1;
      if (isTelegramBlockedError(error)) {
        await FactoryUser.updateOne({ user_id: user.user_id }, { $set: { is_blocked: true } });
      }
    }
  }

  return stats;
}

async function sendBroadcastToContentBotUsers(active, payload) {
  const stats = { key: active.key, title: active.title || active.config?.title || active.key, total: 0, success: 0, failed: 0 };
  const users = await User.find({ bot_key: active.key, is_blocked: { $ne: true } }).select('user_id');
  stats.total = users.length;

  for (const user of users) {
    try {
      // Turli botlar FactoryBot chatidagi xabarni copy qila olmaydi.
      // Shuning uchun xabar text/media payload sifatida qayta yuboriladi.
      await sendPayloadWithBot(active.bot, user.user_id, payload);
      stats.success += 1;
      await sleep(45);
    } catch (error) {
      stats.failed += 1;
      if (isTelegramBlockedError(error)) {
        await User.updateOne({ bot_key: active.key, user_id: user.user_id }, { $set: { is_blocked: true } });
      }
    }
  }

  return stats;
}

function createFactoryBot() {
  if (!hasUsableToken(FACTORYBOT_TOKEN)) {
    console.warn('⚠️ FactoryBot ishga tushmadi: FACTORYBOT_TOKEN .env ichida bo‘sh yoki noto‘g‘ri.');
    return null;
  }

  const bot = new Telegraf(FACTORYBOT_TOKEN);
  bot.use(session({ defaultSession: () => ({ mode: null, draft: {} }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await FactoryUser.updateOne(
        { user_id: ctx.from.id },
        {
          $set: {
            username: ctx.from.username || null,
            first_name: ctx.from.first_name || null,
            last_name: ctx.from.last_name || null,
            language_code: ctx.from.language_code || null,
            last_active_at: new Date(),
            is_blocked: false
          }
        },
        { upsert: true }
      );
    }
    return next();
  });

  function isOwner(userId) {
    return GLOBAL_ADMIN_IDS.includes(Number(userId));
  }

  function reset(ctx) {
    ctx.session.mode = null;
    ctx.session.draft = {};
  }

  function userKeyboard(ctx) {
    const rows = [
      ['🤖 Bot tayyorlash', '💰 Narxlar'],
      ['📋 Mening botlarim', '☎️ Admin bilan kelishish']
    ];
    if (ctx.from && isOwner(ctx.from.id)) {
      rows.unshift(['🛂 Kutilayotgan soʻrovlar', '⏳ Toʻlovi tugaganlar']);
      rows.unshift(['📊 Umumiy statistika', '🏭 Factory statistikasi']);
      rows.unshift(['🔍 Bot qidirish', '📋 Barcha botlar']);
      rows.unshift(['📣 Umumiy eʼlon', '💰 Tarif narxlari']);
      rows.unshift(['🌐 Global kanal qoʻshish', '🌐 Global guruh qoʻshish']);
      rows.unshift(['🌐 Global obunalar', '🌐 Global obuna oʻchirish']);
      rows.unshift(['✏️ Narx oʻzgartirish']);
    }
    return Markup.keyboard(rows).resize().oneTime(false);
  }

  function ownerTelegramUrl() {
    return `https://t.me/${OWNER_USERNAME.replace('@', '').trim() || 'Qoryogdiyev'}`;
  }

  function adminContactInlineKeyboard(extraRows = []) {
    return Markup.inlineKeyboard([
      ...extraRows,
      [Markup.button.url('💳 To‘lov/ruxsat uchun adminga murojaat qilish', ownerTelegramUrl())]
    ]);
  }

  function adminContactInlineRow(label = '💳 To‘lov uchun admin') {
    return [Markup.button.url(label, ownerTelegramUrl())];
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

  async function addGlobalSubscription(ctx, text, type) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    const username = normalizeUsername(text);
    if (!username) {
      return ctx.reply(
        '❌ Kanal/guruh noto‘g‘ri. Public kanal/guruh uchun @username yoki https://t.me/username yuboring.\n\n' +
          'Private guruh/kanal uchun -100... chat ID yuboring. Invite link (+...) bilan Telegram obunani tekshirishga ruxsat bermaydi.'
      );
    }

    try {
      await Subscription.updateOne(
        { bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY, chat_username: username },
        { $set: { type, added_by: ctx.from.id } },
        { upsert: true }
      );
      reset(ctx);
      const testHint = username.startsWith('@') ? `\n\n⚠️ FactoryBot o‘sha kanal/guruhda admin bo‘lishi kerak: ${username}` : '\n\n⚠️ Private chat ID bo‘lsa ham FactoryBot o‘sha chatda admin bo‘lishi kerak.';
      return ctx.reply(`✅ Global majburiy obuna qo‘shildi: ${subLabel({ chat_username: username, type })}\n\nEndi bu obuna barcha yaratilgan botlarda tekshiriladi. Mijoz botlarni kanal/guruhga qo‘shish shart emas.${testHint}`, userKeyboard(ctx));
    } catch (error) {
      console.error('Global obuna saqlash xatosi:', error);
      reset(ctx);
      return ctx.reply('❌ Global obunani saqlashda xatolik. Qayta urinib ko‘ring.', userKeyboard(ctx));
    }
  }

  async function showGlobalSubscriptions(ctx) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    const subs = await Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 });
    if (!subs.length) return ctx.reply('📭 Global majburiy obunalar yo‘q.', userKeyboard(ctx));
    const list = subs.map((sub, i) => `${i + 1}. ${subLabel(sub)} — ${sub.createdAt ? formatDate(sub.createdAt) : '—'}`).join('\n');
    return ctx.reply(
      `🌐 GLOBAL MAJBURIY OBUNALAR\n\n${list}\n\n` +
        `Bu ro‘yxat barcha yaratilgan botlarda ishlaydi. Tekshiruv FactoryBot tokeni orqali bajariladi.`,
      userKeyboard(ctx)
    );
  }

  async function removeGlobalSubscription(ctx, text) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    const username = normalizeUsername(text);
    if (!username) return ctx.reply('❌ O‘chirish uchun @username yoki -100... chat ID yuboring.');
    const result = await Subscription.deleteOne({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY, chat_username: username });
    reset(ctx);
    if (result.deletedCount) return ctx.reply(`✅ Global obuna o‘chirildi: ${username}`, userKeyboard(ctx));
    return ctx.reply('❌ Bunday global obuna topilmadi.', userKeyboard(ctx));
  }

  async function checkFactoryGlobalSubscriptions(userId) {
    if (isOwner(userId)) return true;
    const subs = await Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 });
    if (!subs.length) return true;
    for (const sub of subs) {
      try {
        const member = await bot.telegram.getChatMember(sub.chat_username, userId);
        if (['left', 'kicked'].includes(member.status)) return false;
      } catch (error) {
        console.error(`❌ FactoryBot global obuna tekshirish xatosi ${sub.chat_username}:`, error.message);
        return false;
      }
    }
    return true;
  }

  async function factoryGlobalSubscriptionKeyboard() {
    const subs = await Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 });
    const rows = [];
    for (const sub of subs) {
      const url = subJoinUrl(sub.chat_username);
      if (url) rows.push([Markup.button.url(`🌐 ${subLabel(sub)}`, url)]);
      else rows.push([Markup.button.callback(`🌐 ${subLabel(sub)}`, 'noop')]);
    }
    rows.push([Markup.button.callback('✅ Obunani tekshirish', 'factory_check_global_subscription')]);
    return Markup.inlineKeyboard(rows);
  }

  async function sendFactoryGlobalSubscriptionWarning(ctx) {
    const keyboard = await factoryGlobalSubscriptionKeyboard();
    return ctx.reply(
      '🔒 BotFactory’dan foydalanish uchun avval majburiy kanal/guruhlarga obuna bo‘ling.\n\nObuna bo‘lgach, “✅ Obunani tekshirish” tugmasini bosing.',
      keyboard
    );
  }

  // FactoryBotning o‘zida ham global majburiy obuna ishlaydi.
  // Adminlar cheklanmaydi, obunani tekshirish callbacklariga esa ruxsat beriladi.
  bot.use(async (ctx, next) => {
    if (!ctx.from || isOwner(ctx.from.id)) return next();
    const action = ctx.callbackQuery?.data || '';
    if (action === 'factory_check_global_subscription' || action === 'noop') return next();
    const ok = await checkFactoryGlobalSubscriptions(ctx.from.id);
    if (!ok) return sendFactoryGlobalSubscriptionWarning(ctx);
    return next();
  });

  bot.action('factory_check_global_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const ok = await checkFactoryGlobalSubscriptions(ctx.from.id);
    if (!ok) {
      const keyboard = await factoryGlobalSubscriptionKeyboard();
      return ctx.editMessageText('❌ Hali barcha global kanal/guruhlarga obuna bo‘lmagansiz.', keyboard);
    }
    try {
      await ctx.deleteMessage();
    } catch (_) {}
    return ctx.reply('✅ Obuna tasdiqlandi! BotFactory’dan foydalanishingiz mumkin.', userKeyboard(ctx));
  });

  async function showPlans(ctx) {
    await seedDefaultPlans();
    const plans = await BotPlan.find({ is_active: true }).sort({ type_key: 1 });
    const lines = plans.map((p, i) => `${i + 1}. ${getPreset(p.type_key).mainEmoji || '🤖'} ${p.title || p.type_key}: ${formatMoney(p.monthly_price, p.currency)} / oy`);
    await ctx.reply(`💰 BOT TARIF NARXLARI\n\nYaratish: bepul\nOylik to‘lov: admin tasdiqlagandan keyin bot ishlaydi.\n\n${lines.join('\n') || 'Tariflar topilmadi.'}`, userKeyboard(ctx));
    return ctx.reply(`💳 To‘lov/ruxsat uchun admin bilan kelishing: ${OWNER_USERNAME}`, adminContactInlineKeyboard());
  }

  async function showMyBots(ctx) {
    const list = await ManagedBot.find({ owner_user_id: ctx.from.id }).sort({ createdAt: -1 }).limit(20);
    if (!list.length) return ctx.reply('📭 Sizda hali bot soʻrovi yoʻq.', userKeyboard(ctx));

    const lines = list.map((b, i) => {
      const preset = getPreset(b.type_key);
      return (
        `${i + 1}. ${preset.mainEmoji || '🤖'} ${b.title} — @${b.telegram_username}\n` +
        `   Turi: ${preset.itemTitle || b.type_key} | Holat: ${botStatusLabel(b)}\n` +
        `   💰 ${formatMoney(b.monthly_price, b.currency)} / oy | ⏳ ${formatDate(b.current_period_end)}`
      );
    });

    await ctx.reply(`📋 Mening botlarim:\n\n${lines.join('\n\n')}\n\nTo‘lov/ruxsat uchun ${OWNER_USERNAME} ga yozing.`, userKeyboard(ctx));
    return ctx.reply('💳 To‘lov yoki ruxsatni uzaytirish uchun admin bilan bog‘laning:', adminContactInlineKeyboard());
  }

  async function showPending(ctx) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Bu bo‘lim faqat asosiy admin uchun.');
    const list = await ManagedBot.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(30);
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
          `💰 Tarif: ${formatMoney(req.monthly_price, req.currency)} / oy\n` +
          `🔐 Token: ${req.token_mask || '***'}\n\n` +
          `Yaratish bepul. Oylik to‘lov kelishilgach 1 oyga ruxsat bering.`,
        botActionKeyboard(req)
      );
    }
  }

  async function showExpired(ctx) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Bu bo‘lim faqat asosiy admin uchun.');
    await expireDueManagedBots();
    const list = await ManagedBot.find({ status: 'expired' }).sort({ current_period_end: 1 }).limit(30);
    if (!list.length) return ctx.reply('✅ Toʻlovi tugagan botlar yoʻq.', userKeyboard(ctx));

    for (const rec of list) {
      await ctx.reply(await botDetailText(rec), botActionKeyboard(rec));
    }
  }

  async function showAllBots(ctx) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Bu bo‘lim faqat asosiy admin uchun.');
    const list = await ManagedBot.find({}).sort({ createdAt: -1 }).limit(30);
    if (!list.length) return ctx.reply('📭 Hali yaratilgan botlar yo‘q.', userKeyboard(ctx));

    const lines = list.map((b, i) => `${i + 1}. @${b.telegram_username} — ${b.title} | ${getPreset(b.type_key).itemTitle || b.type_key} | ${botStatusLabel(b)} | ${formatDate(b.current_period_end)}`);
    return ctx.reply(`📋 SO‘NGGI 30 TA BOT\n\n${lines.join('\n')}\n\nTo‘liq ko‘rish uchun “🔍 Bot qidirish”dan foydalaning.`, userKeyboard(ctx));
  }

  async function showOverallStats(ctx) {
    if (!isOwner(ctx.from.id)) return;
    await expireDueManagedBots();
    const [total, pending, approved, expired, rejected, disabled, totalUsers, activeUsers, totalContents, totalParts, factoryUsers, broadcasts, globalSubs] = await Promise.all([
      ManagedBot.countDocuments(),
      ManagedBot.countDocuments({ status: 'pending' }),
      ManagedBot.countDocuments({ status: 'approved', is_enabled: true }),
      ManagedBot.countDocuments({ status: 'expired' }),
      ManagedBot.countDocuments({ status: 'rejected' }),
      ManagedBot.countDocuments({ status: 'disabled' }),
      User.countDocuments(),
      User.countDocuments({ is_blocked: { $ne: true } }),
      Content.countDocuments({ is_active: true }),
      ContentPart.countDocuments({ is_active: true }),
      FactoryUser.countDocuments(),
      BroadcastLog.countDocuments({ type: 'global' }),
      Subscription.countDocuments({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY })
    ]);

    return ctx.reply(
      `📊 UMUMIY STATISTIKA\n\n` +
        `🤖 Jami yaratilgan botlar: ${total}\n` +
        `✅ Aktiv: ${approved}\n` +
        `⏳ Kutilayotgan: ${pending}\n` +
        `💳 To‘lovi tugagan: ${expired}\n` +
        `⏸ To‘xtatilgan: ${disabled}\n` +
        `❌ Rad etilgan: ${rejected}\n\n` +
        `👥 Barcha kontent-bot userlari: ${totalUsers}\n` +
        `✅ Aktiv userlar: ${activeUsers}\n` +
        `📦 Barcha kontentlar: ${totalContents}\n` +
        `🎞 Barcha qismlar: ${totalParts}\n\n` +
        `🏭 FactoryBot userlari: ${factoryUsers}\n` +
        `📣 Umumiy eʼlonlar: ${broadcasts}\n` +
        `🌐 Global majburiy obunalar: ${globalSubs}\n` +
        `🚀 Runtime aktiv botlar: ${activeBots.size}`,
      userKeyboard(ctx)
    );
  }

  async function showFactoryStats(ctx) {
    if (!isOwner(ctx.from.id)) return;
    const [factoryUsers, blockedFactory, requestsToday, pending, active] = await Promise.all([
      FactoryUser.countDocuments(),
      FactoryUser.countDocuments({ is_blocked: true }),
      ManagedBot.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      ManagedBot.countDocuments({ status: 'pending' }),
      ManagedBot.countDocuments({ status: 'approved', is_enabled: true })
    ]);
    return ctx.reply(
      `🏭 FACTORYBOT STATISTIKASI\n\n` +
        `👥 Factory userlari: ${factoryUsers}\n` +
        `🚫 Bloklaganlar: ${blockedFactory}\n` +
        `🆕 Oxirgi 24 soatdagi so‘rovlar: ${requestsToday}\n` +
        `⏳ Kutilayotgan so‘rovlar: ${pending}\n` +
        `✅ Aktiv mijoz botlari: ${active}`,
      userKeyboard(ctx)
    );
  }

  async function sendGlobalBroadcast(ctx) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    if (!ctx.message?.message_id) return ctx.reply('❌ Eʼlon uchun matn, rasm, video, fayl yoki forward xabar yuboring.', userKeyboard(ctx));

    const autostart = await ensureApprovedManagedBotsStarted();
    const payload = await buildGlobalBroadcastPayload(ctx, bot);
    const contentTargets = Array.from(activeBots.values())
      .filter((active) => active.key !== 'factory' && active?.bot)
      .filter((active) => {
        if (!active.config?.managed) return true;
        return true; // managed status quyida DB orqali qayta tekshiriladi
      });

    const targetKeys = ['factory', ...contentTargets.map((a) => a.key)];
    const log = await BroadcastLog.create({
      type: 'global',
      sent_by: ctx.from.id,
      source_chat_id: ctx.chat.id,
      source_message_id: ctx.message.message_id,
      target_bot_keys: targetKeys
    });

    let totalTargets = 0;
    let success = 0;
    let failed = 0;
    const perBotStats = [];

    await ctx.reply(
      `📣 Umumiy eʼlon boshlandi.\n\n` +
        `🏭 BotFactory userlari: yuboriladi\n` +
        `🤖 Kontent/mijoz botlari: ${contentTargets.length} ta\n` +
        (autostart.started || autostart.failed ? `🔄 Auto-start: ${autostart.started} ta ishga tushdi, ${autostart.failed} ta xato\n` : '') +
        `\n⏳ Yuborish tugaguncha kuting...`
    );

    const factoryStats = await sendBroadcastToFactoryUsers(ctx, payload, ctx.message.message_id);
    perBotStats.push(factoryStats);
    totalTargets += factoryStats.total;
    success += factoryStats.success;
    failed += factoryStats.failed;

    for (const active of contentTargets) {
      if (active.config?.managed) {
        const rec = await ManagedBot.findOne({ bot_key: active.key });
        const expired = rec ? await markRecordExpiredIfNeeded(rec) : true;
        if (!rec || expired || rec.status !== 'approved' || !rec.is_enabled) {
          perBotStats.push({ key: active.key, title: active.title || active.key, total: 0, success: 0, failed: 0, skipped: true, reason: 'inactive_or_expired' });
          continue;
        }
      }

      const stats = await sendBroadcastToContentBotUsers(active, payload);
      perBotStats.push(stats);
      totalTargets += stats.total;
      success += stats.success;
      failed += stats.failed;
    }

    log.total_targets = totalTargets;
    log.success = success;
    log.failed = failed;
    log.per_bot_stats = perBotStats;
    log.finished_at = new Date();
    await log.save();

    reset(ctx);
    const lines = perBotStats.map((s) => {
      if (s.skipped) return `• ${s.title || s.key}: o‘tkazildi (${s.reason || 'inactive'})`;
      return `• ${s.title || s.key}: ${s.success}/${s.total} yuborildi, xato ${s.failed}`;
    }).join('\n');

    return ctx.reply(
      `✅ Umumiy eʼlon yakunlandi!\n\n` +
        `🎯 Jami target: ${totalTargets}\n` +
        `✅ Yuborildi: ${success}\n` +
        `❌ Xatolik: ${failed}\n\n` +
        `📋 Botlar bo‘yicha:\n${lines || '—'}`,
      userKeyboard(ctx)
    );
  }

  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery('Bu yopiq/private chat. Admin ko‘rsatmasi bo‘yicha obuna bo‘ling.');
  });

  bot.start(async (ctx) => {
    await FactoryUser.updateOne({ user_id: ctx.from.id }, { $inc: { starts: 1 }, $set: { last_active_at: new Date(), is_blocked: false } }, { upsert: true });
    reset(ctx);
    await ctx.reply(
      `🏭 Bot tayyorlovchi botga xush kelibsiz!\n\n` +
        `Yaratish bepul. Bot ishlashi uchun oylik tarif admin tomonidan tasdiqlanadi.\n\n` +
        `Jarayon:\n` +
        `1) BotFather’dan token olasiz\n` +
        `2) Tokenni shu botga kiritasiz\n` +
        `3) Bot turini tanlaysiz\n` +
        `4) Bot nomi va admin ID kiritasiz\n` +
        `5) ${OWNER_USERNAME} bilan narx/to‘lov kelishilgach admin 1 oyga ruxsat beradi\n\n` +
        `Har oy muddati tugaganda bot avtomatik to‘xtaydi. Admin yana ruxsat bersa, bot ichidagi barcha maʼlumotlar saqlangan holda davom etadi.`,
      userKeyboard(ctx)
    );
    return ctx.reply(
      `💳 To‘lov, narx yoki ruxsat bo‘yicha tez kelishish uchun admin bilan bog‘laning: ${OWNER_USERNAME}`,
      adminContactInlineKeyboard()
    );
  });

  bot.command('cancel', async (ctx) => {
    reset(ctx);
    return ctx.reply('❌ Jarayon bekor qilindi.', userKeyboard(ctx));
  });

  bot.hears('☎️ Admin bilan kelishish', async (ctx) => {
    return ctx.reply(
      `💳 Narx, muddat, to‘lov va ruxsat uchun admin bilan bog‘laning: ${OWNER_USERNAME}`,
      adminContactInlineKeyboard()
    );
  });

  bot.hears('💰 Narxlar', showPlans);
  bot.hears('💰 Tarif narxlari', showPlans);
  bot.hears('📋 Mening botlarim', showMyBots);
  bot.hears('🛂 Kutilayotgan soʻrovlar', showPending);
  bot.hears('⏳ Toʻlovi tugaganlar', showExpired);
  bot.hears('📋 Barcha botlar', showAllBots);
  bot.hears('📊 Umumiy statistika', showOverallStats);
  bot.hears('📊 Factory statistika', showOverallStats);
  bot.hears('🏭 Factory statistikasi', showFactoryStats);

  bot.hears('🔍 Bot qidirish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'search_bot';
    ctx.session.draft = {};
    return ctx.reply('🔍 Botni qidirish uchun bot username, egasi username, egasi ID yoki bot nomini yuboring.\n\nMasalan: @kinobot, kinobot, 6606638731\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('📣 Umumiy eʼlon', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'global_broadcast';
    ctx.session.draft = {};
    return ctx.reply('📣 Umumiy eʼlon rejimi yoqildi. Endi matn, rasm, video, fayl yoki forward xabar yuboring.\n\nBu eʼlon barcha aktiv yaratilgan botlarning foydalanuvchilariga o‘sha bot nomidan yuboriladi.\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('🌐 Global kanal qoʻshish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'global_add_channel';
    ctx.session.draft = {};
    return ctx.reply('🌐 Global kanal qo‘shish.\n\nKanal username/linkini yuboring: @kanal yoki https://t.me/kanal\n\nPrivate kanal bo‘lsa -100... chat ID yuboring. FactoryBot kanalga admin qilingan bo‘lishi kerak.\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('🌐 Global guruh qoʻshish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'global_add_group';
    ctx.session.draft = {};
    return ctx.reply('🌐 Global guruh qo‘shish.\n\nGuruh username/linkini yuboring: @guruh yoki https://t.me/guruh\n\nPrivate guruh bo‘lsa -100... chat ID yuboring. FactoryBot guruhda admin qilingan bo‘lishi kerak.\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('🌐 Global obunalar', showGlobalSubscriptions);

  bot.hears('🌐 Global obuna oʻchirish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'global_remove_subscription';
    ctx.session.draft = {};
    return ctx.reply('🌐 O‘chiriladigan global obuna username yoki chat ID yuboring.\n\nMasalan: @kanal yoki -1001234567890\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('✏️ Narx oʻzgartirish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'set_price';
    return ctx.reply(
      `✏️ Tarif narxini o‘zgartirish.\n\nFormat:\ntur | narx | valyuta\n\nMisol:\nkino | 50000 | UZS\ndorama | 70000 | UZS\n\nTur kalitlari: ${Object.keys(TYPE_PRESETS).join(', ')}\n\n❌ Bekor qilish: /cancel`
    );
  });

  bot.hears('🤖 Bot tayyorlash', async (ctx) => {
    reset(ctx);
    ctx.session.mode = 'wait_token';
    return ctx.reply(
      `🤖 Yangi bot tayyorlash boshlandi.\n\n` +
        `BotFather’dan olingan bot tokenni yuboring.\n\n` +
        `💳 To‘lov/ruxsat bo‘yicha savol bo‘lsa, pastdagi tugma orqali admin bilan bog‘laning.\n\n` +
        `⚠️ Faqat o‘zingiz yaratgan bot tokenini yuboring. Token DB’da shifrlanadi.\n\n` +
        `❌ Bekor qilish: /cancel`,
      adminContactInlineKeyboard()
    );
  });

  bot.action(/^factory:type:([a-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const typeKey = ctx.match[1];
    if (!ctx.session.draft?.token_enc) return ctx.reply('❌ Sessiya tugagan. Qaytadan “🤖 Bot tayyorlash” bosing.');
    const preset = getPreset(typeKey);
    const plan = await getOrCreatePlan(typeKey);
    ctx.session.draft.type_key = typeKey;
    ctx.session.draft.monthly_price = plan.monthly_price;
    ctx.session.draft.currency = plan.currency;
    ctx.session.mode = 'wait_title';
    return ctx.editMessageText(
      `✅ Bot turi tanlandi: ${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title}\n` +
        `💰 Oylik tarif: ${formatMoney(plan.monthly_price, plan.currency)} / oy\n\n` +
        `Endi bot uchun ko‘rinadigan nom kiriting. Masalan:\n${preset.title}\n\n` +
        `Telegramdagi nomdan foydalanish uchun “-” yuboring.\n❌ Bekor qilish: /cancel`
    );
  });

  bot.action(/^factory:bot:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    const rec = await ManagedBot.findOne({ _id: ctx.match[1] });
    if (!rec) return ctx.reply('❌ Bot topilmadi.');
    await markRecordExpiredIfNeeded(rec);
    return ctx.editMessageText(await botDetailText(rec), botActionKeyboard(rec));
  });

  bot.action(/^factory:approve:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin tasdiqlay oladi.');

    const req = await ManagedBot.findOne({ _id: ctx.match[1] });
    if (!req) return ctx.reply('❌ Soʻrov topilmadi.');
    if (!['pending', 'expired', 'disabled'].includes(req.status)) return ctx.reply(`ℹ️ Bu soʻrov holati: ${req.status}`);

    req.approved_by = ctx.from.id;
    req.approved_at = req.approved_at || new Date();
    await extendManagedBot(req, ctx.from.id, 1);

    try {
      await startManagedRecord(req, 'factory_approve');
      await ctx.editMessageText(`✅ @${req.telegram_username} 1 oyga tasdiqlandi va ishga tushirildi.\n\n⏳ Keyingi to‘lov: ${formatDate(req.current_period_end)}`);
      await bot.telegram.sendMessage(
        req.owner_user_id,
        `✅ Sizning @${req.telegram_username} botingiz 1 oyga tasdiqlandi va ishga tushdi!\n\n` +
          `⏳ Keyingi to‘lov sanasi: ${formatDate(req.current_period_end)}\n\n` +
          `Botga /start bosing. Qolgan boshqaruv bot ichidagi admin paneldan qilinadi.`
      );
    } catch (error) {
      console.error('Approve/start xatosi:', error);
      await ctx.reply(`⚠️ So‘rov tasdiqlandi, lekin botni ishga tushirishda xatolik: ${error.message}`);
    }
  });

  bot.action(/^factory:extend:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uzaytira oladi.');
    const rec = await ManagedBot.findOne({ _id: ctx.match[1] });
    if (!rec) return ctx.reply('❌ Bot topilmadi.');

    await extendManagedBot(rec, ctx.from.id, 1);
    try {
      await startManagedRecord(rec, 'factory_extend');
    } catch (error) {
      console.error('Extend/start xatosi:', error.message);
    }
    await ctx.editMessageText(`✅ @${rec.telegram_username} 1 oyga uzaytirildi.\n\n⏳ Keyingi to‘lov: ${formatDate(rec.current_period_end)}`);
    try {
      await bot.telegram.sendMessage(rec.owner_user_id, `✅ @${rec.telegram_username} botingiz uchun oylik ruxsat uzaytirildi.\n\n⏳ Keyingi to‘lov: ${formatDate(rec.current_period_end)}`);
    } catch (_) {}
  });

  bot.action(/^factory:disable:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin to‘xtata oladi.');
    const rec = await ManagedBot.findOne({ _id: ctx.match[1] });
    if (!rec) return ctx.reply('❌ Bot topilmadi.');
    await disableManagedBot(rec, ctx.from.id, 'admin_disabled');
    await ctx.editMessageText(`⏸ @${rec.telegram_username} admin tomonidan to‘xtatildi. DB maʼlumotlari saqlandi.`);
    try {
      await bot.telegram.sendMessage(rec.owner_user_id, `⏸ @${rec.telegram_username} botingiz admin tomonidan vaqtincha to‘xtatildi. Maʼlumotlar saqlangan. ${OWNER_USERNAME} bilan bog‘laning.`, adminContactInlineKeyboard());
    } catch (_) {}
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
      await bot.telegram.sendMessage(req.owner_user_id, `❌ @${req.telegram_username} bot so‘rovingiz rad etildi. Batafsil kelishish uchun ${OWNER_USERNAME} ga yozing.`, adminContactInlineKeyboard());
    } catch (_) {}
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text === '/cancel') {
      reset(ctx);
      return ctx.reply('❌ Jarayon bekor qilindi.', userKeyboard(ctx));
    }

    if (ctx.session.mode === 'global_broadcast') return sendGlobalBroadcast(ctx);

    if (ctx.session.mode === 'global_add_channel') return addGlobalSubscription(ctx, text, 'channel');
    if (ctx.session.mode === 'global_add_group') return addGlobalSubscription(ctx, text, 'group');
    if (ctx.session.mode === 'global_remove_subscription') return removeGlobalSubscription(ctx, text);

    if (ctx.session.mode === 'search_bot') {
      if (!isOwner(ctx.from.id)) return;
      const list = await searchManagedBots(text);
      reset(ctx);
      if (!list.length) return ctx.reply('❌ Bot topilmadi.', userKeyboard(ctx));
      for (const rec of list) await ctx.reply(await botDetailText(rec), botActionKeyboard(rec));
      return ctx.reply('✅ Qidiruv yakunlandi.', userKeyboard(ctx));
    }

    if (ctx.session.mode === 'set_price') {
      if (!isOwner(ctx.from.id)) return;
      const [typeKeyRaw, priceRaw, currencyRaw] = text.split('|').map((x) => String(x || '').trim());
      const typeKey = normalizeCode(typeKeyRaw);
      const price = Number(String(priceRaw || '').replace(/\s/g, ''));
      const currency = currencyRaw || 'UZS';
      if (!TYPE_PRESETS[typeKey]) return ctx.reply(`❌ Tur topilmadi. Kalitlar: ${Object.keys(TYPE_PRESETS).join(', ')}`);
      if (!Number.isFinite(price) || price < 0) return ctx.reply('❌ Narx noto‘g‘ri. Masalan: kino | 50000 | UZS');
      const preset = getPreset(typeKey);
      await BotPlan.updateOne(
        { type_key: typeKey },
        { $set: { title: preset.title || preset.itemTitle || typeKey, monthly_price: price, currency, is_active: true, updated_by: ctx.from.id } },
        { upsert: true }
      );
      reset(ctx);
      return ctx.reply(`✅ ${preset.title || typeKey} narxi yangilandi: ${formatMoney(price, currency)} / oy`, userKeyboard(ctx));
    }

    if (ctx.session.mode === 'wait_token') {
      if (!hasUsableToken(text)) return ctx.reply('❌ Token noto‘g‘ri ko‘rinadi. BotFather bergan tokenni to‘liq yuboring.');

      try {
        const tmp = new Telegraf(text);
        const me = await tmp.telegram.getMe();
        const exists = await ManagedBot.findOne({ telegram_bot_id: me.id, status: { $in: ['pending', 'approved', 'disabled', 'expired'] } });
        if (exists) {
          reset(ctx);
          return ctx.reply(`ℹ️ @${me.username} bo‘yicha so‘rov/bot allaqachon mavjud. Holati: ${botStatusLabel(exists)}`, userKeyboard(ctx));
        }

        ctx.session.draft = {
          ...encryptToken(text),
          token_mask: maskToken(text),
          telegram_bot_id: me.id,
          telegram_username: me.username,
          telegram_first_name: me.first_name
        };
        ctx.session.mode = 'wait_type';
        return ctx.reply(`✅ Token tekshirildi: @${me.username}\n\nEndi bot turini tanlang:`, Markup.inlineKeyboard([...typeRows(), adminContactInlineRow()]));
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
      const plan = await getOrCreatePlan(draft.type_key);

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
        monthly_price: Number(plan.monthly_price || 0),
        currency: plan.currency || 'UZS',
        payment_status: 'not_paid',
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
          `💰 Oylik tarif: ${formatMoney(rec.monthly_price, rec.currency)} / oy\n` +
          `👨‍💻 Admin IDlar: ${adminIds.join(', ')}\n\n` +
          `Yaratish bepul. Bot ishlashi uchun oylik to‘lov/ruxsat ${OWNER_USERNAME} orqali kelishiladi. Admin ruxsat bergach bot avtomatik ishga tushadi.`,
        userKeyboard(ctx)
      );
      await ctx.reply(
        `💳 To‘lov/ruxsatni tezlashtirish uchun admin bilan bog‘laning: ${OWNER_USERNAME}`,
        adminContactInlineKeyboard()
      );

      await notifyOwners(
        `🛂 Yangi bot tayyorlash soʻrovi!\n\n` +
          `🤖 Bot: ${rec.title} (@${rec.telegram_username})\n` +
          `📦 Turi: ${preset.itemTitle || rec.type_key}\n` +
          `💰 Tarif: ${formatMoney(rec.monthly_price, rec.currency)} / oy\n` +
          `👤 Mijoz: ${rec.owner_first_name || ''} ${rec.owner_username ? '@' + rec.owner_username : ''}\n` +
          `🆔 Mijoz ID: ${rec.owner_user_id}\n` +
          `👨‍💻 Admin IDlar: ${adminIds.join(', ')}\n\n` +
          `To‘lovni kelishib, 1 oyga ruxsat bering yoki rad eting.`,
        botActionKeyboard(rec)
      );
    }
  });

  bot.on('message', async (ctx) => {
    if (ctx.session.mode === 'global_broadcast') return sendGlobalBroadcast(ctx);
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
  await mongoose.connect(MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ MongoDB ulandi');
  await seedDefaultPlans();
  await expireDueManagedBots();

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
        const global_subscriptions = await Subscription.countDocuments({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY });
        res.json({ status: 'online', mode: 'webhook', active_bots: bots.length, pending_requests: pending, approved_managed_bots: approved, global_subscriptions, bots, uptime: process.uptime() });
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

  const approvedManaged = await ManagedBot.find({ status: 'approved', is_enabled: true, $or: [{ current_period_end: { $gt: new Date() } }, { current_period_end: null }] });
  for (const record of approvedManaged) {
    try {
      await startManagedRecord(record, 'approved_db');
    } catch (error) {
      console.error(`❌ Managed bot ishga tushmadi @${record.telegram_username}:`, error.message);
    }
  }

  setInterval(() => {
    expireDueManagedBots().catch((error) => console.error('Billing tekshirish xatosi:', error.message));
  }, 5 * 60 * 1000);

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
