'use strict';

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const { Telegraf, Markup, session, Telegram } = require('telegraf');
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
const FACTORYBOT_TOKEN = String(process.env.FACTORYBOT_TOKEN || process.env.FACTORY_BOT_TOKEN || process.env.BOTFACTORY_TOKEN || process.env.BOTFACTORY_BOT_TOKEN || process.env.BOTFACTORYBOT_TOKEN || process.env.FACTORY_TOKEN || process.env.BOT_FACTORY_TOKEN || process.env.BOTFACTORY_MAIN_TOKEN || process.env.FACTORY_MAIN_BOT_TOKEN || process.env.BOT_TOKEN_FACTORY || '').trim();
const OWNER_USERNAME = String(process.env.OWNER_USERNAME || '@Qoryogdiyev').trim();
const TRIAL_DAYS = Math.max(1, Number(process.env.FACTORY_TRIAL_DAYS || process.env.TRIAL_DAYS || 3));
const BUILDER_BOT_USERNAME = String(process.env.BUILDER_BOT_USERNAME || process.env.FACTORY_BUILDER_USERNAME || '@quruvchiuzbot').replace(/^@?/, '@');
const STANDARD_WATERMARK_TEXT = String(
  process.env.STANDARD_WATERMARK_TEXT ||
    `🤖 ${BUILDER_BOT_USERNAME} orqali tayyorlandi. Siz ham o‘z botingizni qurmoqchi bo‘lsangiz ${BUILDER_BOT_USERNAME} siz uchun.`
).trim();
const PLUS_PRICE_MULTIPLIER = Math.max(1, Number(process.env.FACTORY_PLUS_PRICE_MULTIPLIER || 2));

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => Number(String(id).trim()))
    .filter(Boolean);
}

const GLOBAL_ADMIN_IDS = parseIds(process.env.ADMIN_IDS || process.env.FACTORY_ADMIN_IDS || process.env.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_CHAT_ID);

if (!MONGODB_URL) {
  console.warn('⚠️ MONGODB_URL/MONGODB_URI topilmadi. FactoryBot /start javob beradi, lekin bot yaratish/saqlash MongoDB ulanganidan keyin ishlaydi.');
}
if (GLOBAL_ADMIN_IDS.length === 0) {
  GLOBAL_ADMIN_IDS.push(6606638731);
  console.warn('⚠️ ADMIN_IDS topilmadi. Vaqtinchalik admin sifatida 6606638731 ishlatiladi. Render env ichida ADMIN_TELEGRAM_IDS yoki ADMIN_IDS qoʻying.');
}

// BotFactory orqali boshqariladigan umumiy majburiy obuna kaliti.
// Bu obunalar barcha yaratilgan botlarda ishlaydi, tekshiruv esa faqat FactoryBot tokeni orqali qilinadi.
const GLOBAL_SUBSCRIPTION_BOT_KEY = '__global__';

// =========================
// MONGODB MODELLAR
// =========================
mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);
let mongoReady = false;
let mongoConnecting = false;
let managedBotsLoadedAfterMongo = false;

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

    // Public, private invite va zayavka kanal/guruhlari uchun kengaytirilgan maydonlar.
    title: String,
    chat_ref: { type: String, index: true },
    chat_id: { type: String, index: true },
    join_url: String,
    invite_link: String,
    is_private_link: { type: Boolean, default: false, index: true },
    requires_request: { type: Boolean, default: false, index: true },
    allow_join_request: { type: Boolean, default: true },
    note: String,

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

const joinRequestSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    first_name: String,
    last_name: String,
    chat_id: { type: String, required: true, index: true },
    chat_title: String,
    chat_username: String,
    invite_link: String,
    status: { type: String, enum: ['requested', 'approved', 'declined'], default: 'requested', index: true },
    requested_at: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: 'multibot_join_requests' }
);
joinRequestSchema.index({ bot_key: 1, user_id: 1, chat_id: 1 }, { unique: true });
const JoinRequest = mongoose.model('MultiBotJoinRequest', joinRequestSchema);

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
    tariff_key: { type: String, enum: ['standard', 'plus'], default: 'standard', index: true },
    trial_started_at: Date,
    trial_ends_at: Date,
    monthly_price: { type: Number, default: 0 },
    currency: { type: String, default: 'UZS' },
    payment_status: { type: String, enum: ['trial', 'not_paid', 'paid', 'overdue'], default: 'trial', index: true },
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


async function connectMongoOnce() {
  if (!MONGODB_URL) return false;
  if (mongoose.connection.readyState === 1) {
    mongoReady = true;
    return true;
  }
  if (mongoConnecting) return false;
  mongoConnecting = true;
  try {
    await mongoose.connect(MONGODB_URL, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 25,
      minPoolSize: 2,
      maxIdleTimeMS: 60000
    });
    mongoReady = true;
    console.log('✅ BotFactory MongoDB ulandi');
    return true;
  } catch (error) {
    mongoReady = false;
    console.error('❌ BotFactory MongoDB ulanish xatosi:', error.message);
    return false;
  } finally {
    mongoConnecting = false;
  }
}

async function waitForMongoReady(timeoutMs = 3000) {
  if (mongoReady && mongoose.connection.readyState === 1) return true;
  const started = Date.now();
  await connectMongoOnce();
  while (!(mongoReady && mongoose.connection.readyState === 1) && Date.now() - started < timeoutMs) {
    await sleep(250);
  }
  return mongoReady && mongoose.connection.readyState === 1;
}

async function requireMongo(ctx, actionText = 'Bu amal uchun maʼlumotlar bazasi ulanishi kerak') {
  const ok = await waitForMongoReady(3500);
  if (ok) return true;
  if (ctx) {
    await ctx.reply(
      `⏳ ${actionText}.

` +
      `Hozir MongoDB ulanmoqda yoki Render endi uygʻondi. 10–20 soniyadan keyin qayta urinib koʻring.
` +
      `Agar muammo davom etsa, admin bilan bogʻlaning: ${OWNER_USERNAME}`
    );
  }
  return false;
}

async function safeDbWrite(label, task) {
  if (!(mongoReady && mongoose.connection.readyState === 1)) return null;
  try {
    return await task();
  } catch (error) {
    console.error(`⚠️ ${label} DB xatosi:`, error.message);
    return null;
  }
}

async function syncApprovedManagedBots(source = 'approved_db_sync') {
  if (!(mongoReady && mongoose.connection.readyState === 1)) return 0;
  const now = new Date();
  const approvedManaged = await ManagedBot.find({
    status: 'approved',
    is_enabled: true,
    $or: [{ current_period_end: { $gt: now } }, { current_period_end: null }]
  }).sort({ updatedAt: -1 });

  let okCount = 0;
  for (const record of approvedManaged) {
    try {
      await startManagedRecord(record, source);
      okCount += 1;
    } catch (error) {
      console.error(`❌ Managed bot ishga tushmadi @${record.telegram_username}:`, error.message);
    }
  }
  return okCount;
}

async function afterMongoReadyStartup() {
  if (!(mongoReady && mongoose.connection.readyState === 1)) return;
  try {
    await seedDefaultPlans();
    await expireDueManagedBots();
    if (!managedBotsLoadedAfterMongo) {
      managedBotsLoadedAfterMongo = true;
      const count = await syncApprovedManagedBots('approved_db_startup');
      console.log(`✅ MongoDB’dan ${count} ta tasdiqlangan mijoz boti ishga tushirildi/resync qilindi.`);
    }
  } catch (error) {
    console.error('⚠️ BotFactory MongoDB startup vazifalari xatosi:', error.message);
  }
}

function startMongoBackgroundLoop() {
  const run = async () => {
    const ok = await connectMongoOnce();
    if (ok) await afterMongoReadyStartup();
  };
  run().catch((error) => console.error('Mongo background start xatosi:', error.message));
  setInterval(() => {
    if (!(mongoReady && mongoose.connection.readyState === 1)) {
      run().catch((error) => console.error('Mongo reconnect xatosi:', error.message));
    }
  }, 15000);
}


// =========================
// QO'SHIMCHA FACTORY BOT TURLARI UCHUN MODELLAR
// =========================
const botSettingSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, unique: true, index: true },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: 'multibot_bot_settings' }
);
const BotSetting = mongoose.model('BotSetting', botSettingSchema);

const formFieldSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    label: { type: String, required: true },
    key: { type: String, required: true },
    type: { type: String, enum: ['text', 'number', 'phone', 'url', 'location', 'photo', 'document'], default: 'text' },
    order: { type: Number, default: 1, index: true },
    required: { type: Boolean, default: true },
    placeholder: String,
    is_active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: 'multibot_form_fields' }
);
formFieldSchema.index({ bot_key: 1, key: 1 }, { unique: true, partialFilterExpression: { is_active: true } });
const FormField = mongoose.model('FormField', formFieldSchema);

const formSubmissionSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    first_name: String,
    answers: { type: Array, default: [] },
    secret_code: { type: String, required: true, index: true },
    secret_hash: String,
    status: { type: String, enum: ['new', 'sent_to_admin', 'approved', 'rejected', 'paid'], default: 'new', index: true },
    admin_note: String
  },
  { timestamps: true, collection: 'multibot_form_submissions' }
);
const FormSubmission = mongoose.model('FormSubmission', formSubmissionSchema);

const autoPostSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    title: { type: String, required: true },
    target_chat: { type: String, required: true },
    interval_minutes: { type: Number, default: 60 },
    next_send_at: { type: Date, index: true },
    last_sent_at: Date,
    sent_count: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true, index: true },
    ...storedMessageFields,
    added_by: Number
  },
  { timestamps: true, collection: 'multibot_auto_posts' }
);
const AutoPost = mongoose.model('AutoPost', autoPostSchema);

const vipRequestSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    first_name: String,
    secret_code: { type: String, required: true, index: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    approved_by: Number,
    invite_link: String,
    expires_at: Date,
    access_until: Date
  },
  { timestamps: true, collection: 'multibot_vip_requests' }
);
const VipRequest = mongoose.model('VipRequest', vipRequestSchema);

const vipMemberSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    first_name: String,
    channel_chat: String,
    access_until: { type: Date, index: true },
    is_active: { type: Boolean, default: true, index: true },
    removed_at: Date,
    last_request_id: mongoose.Schema.Types.ObjectId
  },
  { timestamps: true, collection: 'multibot_vip_members' }
);
vipMemberSchema.index({ bot_key: 1, user_id: 1, channel_chat: 1 }, { unique: true });
const VipMember = mongoose.model('VipMember', vipMemberSchema);

const giveawaySchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    title: { type: String, required: true },
    prize_name: String,
    description: String,
    rules: String,
    prize_photo_file_id: String,
    winners_count: { type: Number, default: 1 },
    winner_mode: {
      type: String,
      enum: ['top_referrals', 'random', 'admin'],
      default: 'top_referrals',
      index: true
    },
    referral_points: { type: Number, default: 5 },
    starts_at: { type: Date, default: Date.now, index: true },
    ends_at: { type: Date, required: true, index: true },
    duration_seconds: { type: Number, required: true },
    status: { type: String, enum: ['active', 'frozen', 'closed'], default: 'active', index: true },
    created_by: Number,
    creator_username: String,
    creator_name: String,
    manager_ids: { type: [Number], default: [] },
    frozen_at: Date,
    closed_at: Date,
    result_sent_at: Date,
    public_result_sent_at: Date,
    result_snapshot: { type: Array, default: [] },
    drawn_by: Number,
    drawn_at: Date,
    winner_user_ids: { type: [Number], default: [] },
    admin_selection_completed_at: Date
  },
  { timestamps: true, collection: 'multibot_giveaways' }
);
giveawaySchema.index({ bot_key: 1, status: 1, ends_at: 1 });
const Giveaway = mongoose.model('Giveaway', giveawaySchema);

const giveawayParticipantSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    giveaway_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    telegram_first_name: String,
    telegram_last_name: String,
    first_name: String, // eski konkurs yozuvlari bilan moslik
    full_name: String,
    onboarding_status: {
      type: String,
      enum: ['pending_name', 'pending_captcha', 'active'],
      default: 'pending_name',
      index: true
    },
    captcha_answer: String,
    captcha_options: { type: [String], default: [] },
    captcha_attempts: { type: Number, default: 0 },
    captcha_passed_at: Date,
    score: { type: Number, default: 0, index: true },
    referrer_user_id: { type: Number, default: null, index: true },
    referrer_awarded: { type: Boolean, default: false },
    referrals_confirmed: { type: Number, default: 0 },
    referral_visits: { type: Number, default: 0 },
    share_actions: { type: Number, default: 0 },
    source_code: { type: String, default: null, index: true },
    source_chat_id: String,
    source_chat_title: String,
    source_chat_username: String,
    source_chat_type: String,
    source_first_seen_at: Date,
    source_join_counted: { type: Boolean, default: false },
    joined_at: Date,
    group_invite_link: { type: String, default: null, index: true },
    group_invite_chat_id: { type: String, default: null, index: true },
    group_invite_created_at: Date,
    invite_join_detected_at: Date,
    referral_origin: { type: String, enum: ['bot_link', 'group_invite', 'direct'], default: 'direct' },
    last_seen_at: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: 'multibot_giveaway_participants' }
);
giveawayParticipantSchema.index({ bot_key: 1, giveaway_id: 1, user_id: 1 }, { unique: true });
giveawayParticipantSchema.index({ bot_key: 1, giveaway_id: 1, score: -1, joined_at: 1 });
giveawayParticipantSchema.index({ bot_key: 1, group_invite_link: 1 }, { sparse: true });
const GiveawayParticipant = mongoose.model('GiveawayParticipant', giveawayParticipantSchema);

const giveawaySourceSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    giveaway_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    source_code: { type: String, required: true, unique: true, index: true },
    chat_id: { type: String, required: true, index: true },
    chat_title: String,
    chat_username: String,
    chat_type: String,
    created_by: Number,
    owner_user_id: { type: Number, index: true },
    join_url: String,
    invite_link: String,
    is_active: { type: Boolean, default: true, index: true },
    is_required: { type: Boolean, default: true, index: true },
    source_role: { type: String, enum: ['host', 'sponsor', 'both'], default: 'both', index: true },
    publish_enabled: { type: Boolean, default: true, index: true },
    announcement_message_id: Number,
    announcement_chat_id: String,
    announcement_updated_at: Date,
    bot_can_post: { type: Boolean, default: false },
    bot_is_admin: { type: Boolean, default: false },
    linked_by_is_admin: { type: Boolean, default: false },
    last_error: String,
    last_verified_at: Date,
    posts_count: { type: Number, default: 0 },
    clicks_count: { type: Number, default: 0 },
    joins_count: { type: Number, default: 0 },
    last_posted_at: Date
  },
  { timestamps: true, collection: 'multibot_giveaway_sources' }
);
giveawaySourceSchema.index({ bot_key: 1, giveaway_id: 1, chat_id: 1 }, { unique: true });
const GiveawaySource = mongoose.model('GiveawaySource', giveawaySourceSchema);

const faqSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    keyword: { type: String, required: true },
    keyword_norm: { type: String, required: true, index: true },
    answer: { type: String, required: true },
    is_active: { type: Boolean, default: true, index: true },
    added_by: Number
  },
  { timestamps: true, collection: 'multibot_group_faqs' }
);
faqSchema.index({ bot_key: 1, keyword_norm: 1 }, { unique: true, partialFilterExpression: { is_active: true } });
const GroupFaq = mongoose.model('GroupFaq', faqSchema);

// =========================
// SUHBATCHI / GAP O‘RGANUVCHI BOT MODELLARI
// =========================
const chatLearningSettingsSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_id: { type: String, required: true, index: true },
    title: String,
    username: String,
    is_enabled: { type: Boolean, default: true, index: true },
    auto_learn: { type: Boolean, default: true },
    auto_reply: { type: Boolean, default: true },
    min_score: { type: Number, default: 0.38 },
    reply_chance: { type: Number, default: 1 },
    delete_service_messages: { type: Boolean, default: true },
    only_when_mentioned: { type: Boolean, default: false },
    learned_count: { type: Number, default: 0 },
    replies_sent: { type: Number, default: 0 },
    learned_by: Number
  },
  { timestamps: true, collection: 'multibot_chat_learning_settings' }
);
chatLearningSettingsSchema.index({ bot_key: 1, chat_id: 1 }, { unique: true });
const ChatLearningSetting = mongoose.model('ChatLearningSetting', chatLearningSettingsSchema);

const learnedReplySchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_id: { type: String, required: true, index: true },
    chat_title: String,
    question_text: { type: String, required: true },
    question_norm: { type: String, required: true, index: true },
    keywords: { type: [String], default: [], index: true },
    answer_text: String,
    answer_chat_id: Number,
    answer_message_id: Number,
    answer_type: { type: String, default: 'text' },
    learned_from_user_id: Number,
    learned_from_username: String,
    uses: { type: Number, default: 0 },
    last_used_at: Date,
    is_active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: 'multibot_learned_replies' }
);
learnedReplySchema.index({ bot_key: 1, chat_id: 1, is_active: 1, updatedAt: -1 });
learnedReplySchema.index({ bot_key: 1, chat_id: 1, question_norm: 1 });
const LearnedReply = mongoose.model('LearnedReply', learnedReplySchema);


const groupChatSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_id: { type: String, required: true, index: true },
    title: String,
    username: String,
    chat_type: String,
    added_by: Number,
    added_by_username: String,
    bot_is_admin: { type: Boolean, default: false },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    members_seen: { type: Number, default: 0 },
    messages_seen: { type: Number, default: 0 },
    deleted_messages: { type: Number, default: 0 },
    warnings_issued: { type: Number, default: 0 },
    bans_issued: { type: Number, default: 0 },
    last_active_at: { type: Date, default: Date.now },
    is_active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: 'multibot_group_chats' }
);
groupChatSchema.index({ bot_key: 1, chat_id: 1 }, { unique: true });
const GroupChat = mongoose.model('GroupChat', groupChatSchema);

const groupMemberSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_id: { type: String, required: true, index: true },
    user_id: { type: Number, required: true, index: true },
    username: String,
    first_name: String,
    last_name: String,
    warns: { type: Number, default: 0, index: true },
    messages_count: { type: Number, default: 0 },
    deleted_count: { type: Number, default: 0 },
    links_deleted: { type: Number, default: 0 },
    badwords_deleted: { type: Number, default: 0 },
    flood_deleted: { type: Number, default: 0 },
    reports_received: { type: Number, default: 0 },
    last_warn_reason: String,
    last_message_at: Date,
    muted_until: Date,
    status: { type: String, enum: ['active', 'muted', 'banned', 'left'], default: 'active', index: true },
    is_whitelisted: { type: Boolean, default: false },
    joined_at: Date,
    left_at: Date
  },
  { timestamps: true, collection: 'multibot_group_members' }
);
groupMemberSchema.index({ bot_key: 1, chat_id: 1, user_id: 1 }, { unique: true });
groupMemberSchema.index({ bot_key: 1, chat_id: 1, username: 1 });
const GroupMember = mongoose.model('GroupMember', groupMemberSchema);

const groupActionSchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_id: { type: String, required: true, index: true },
    actor_id: Number,
    target_id: Number,
    action: { type: String, required: true, index: true },
    reason: String,
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: 'multibot_group_actions' }
);
groupActionSchema.index({ bot_key: 1, chat_id: 1, createdAt: -1 });
const GroupAction = mongoose.model('GroupAction', groupActionSchema);

const groupAutoReplySchema = new mongoose.Schema(
  {
    bot_key: { type: String, required: true, index: true },
    chat_id: { type: String, required: true, index: true },
    keyword: { type: String, required: true },
    keyword_norm: { type: String, required: true, index: true },
    answer: { type: String, required: true },
    match_mode: { type: String, enum: ['exact', 'contains'], default: 'exact' },
    added_by: Number,
    is_active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: 'multibot_group_auto_replies' }
);
groupAutoReplySchema.index({ bot_key: 1, chat_id: 1, keyword_norm: 1 }, { unique: true, partialFilterExpression: { is_active: true } });
const GroupAutoReply = mongoose.model('GroupAutoReply', groupAutoReplySchema);


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

  let clean = raw
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^tg:\/\/resolve\?domain=/i, '')
    .replace(/^@/, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '')
    .trim();

  if (/^-?\d{6,}$/.test(clean)) return clean;
  if (clean.startsWith('+') || clean.includes('/+')) return null;
  if (!clean || !/^[a-zA-Z0-9_]{5,32}$/.test(clean)) return null;
  return `@${clean}`;
}

function looksLikePrivateInviteLink(text) {
  const raw = String(text || '').trim();
  return /^https?:\/\/t\.me\/(\+|joinchat\/)/i.test(raw) || /^t\.me\/(\+|joinchat\/)/i.test(raw);
}

function normalizeTelegramUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^t\.me\//i.test(raw)) return `https://${raw}`;
  if (/^@?[a-zA-Z0-9_]{5,32}$/.test(raw.replace(/^@/, ''))) return `https://t.me/${raw.replace(/^@/, '')}`;
  return raw;
}

function parseRequestFlag(value) {
  const v = String(value || '').toLowerCase();
  return /(zayavka|so[‘'`ʼ]?rov|request|join request|private|invite|maxfiy|ha|yes|true|1)/i.test(v);
}

function parseSubscriptionInput(text, type = 'channel') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const parts = raw.split('|').map((x) => x.trim()).filter(Boolean);
  let title = '';
  let target = raw;
  let flag = '';
  if (parts.length >= 2) {
    title = parts[0];
    target = parts[1];
    flag = parts.slice(2).join(' ');
  }

  const normalizedPublic = normalizeUsername(target);
  const isPrivate = looksLikePrivateInviteLink(target);
  const url = normalizeTelegramUrl(target);
  const requiresRequest = parseRequestFlag(flag) || isPrivate;

  if (normalizedPublic) {
    return {
      chat_username: normalizedPublic,
      chat_ref: normalizedPublic,
      chat_id: /^-?\d{6,}$/.test(normalizedPublic) ? normalizedPublic : undefined,
      title: title || normalizedPublic,
      type,
      join_url: normalizedPublic.startsWith('@') ? `https://t.me/${normalizedPublic.replace('@', '')}` : undefined,
      is_private_link: false,
      requires_request: requiresRequest,
      allow_join_request: true
    };
  }

  if (isPrivate) {
    const fallbackTitle = title || (type === 'group' ? 'Maxfiy guruh' : 'Maxfiy kanal');
    return {
      chat_username: fallbackTitle,
      title: fallbackTitle,
      type,
      join_url: url,
      invite_link: url,
      is_private_link: true,
      requires_request: true,
      allow_join_request: true,
      note: 'Private invite/zayavka link. Tekshiruv chat_join_request orqali yoziladi.'
    };
  }
  return null;
}

function subJoinUrl(subOrRef) {
  if (subOrRef && typeof subOrRef === 'object') {
    if (subOrRef.join_url) return subOrRef.join_url;
    if (subOrRef.invite_link) return subOrRef.invite_link;
    const refObj = String(subOrRef.chat_ref || subOrRef.chat_username || '').trim();
    if (refObj.startsWith('@')) return `https://t.me/${refObj.replace('@', '')}`;
    return null;
  }
  const ref = String(subOrRef || '').trim();
  if (!ref) return null;
  if (/^https?:\/\/t\.me\//i.test(ref) || /^t\.me\//i.test(ref)) return normalizeTelegramUrl(ref);
  if (ref.startsWith('@')) return `https://t.me/${ref.replace('@', '')}`;
  return null;
}

function subLabel(sub) {
  const icon = sub?.type === 'group' ? '👥' : '📢';
  const label = sub?.title || sub?.chat_username || sub?.chat_ref || 'nomaʼlum';
  const req = sub?.requires_request ? ' · zayavka' : '';
  return `${icon} ${label}${req}`;
}

function subscriptionCheckRef(sub) {
  const ref = String(sub?.chat_ref || sub?.chat_id || sub?.chat_username || '').trim();
  if (/^-?\d{6,}$/.test(ref)) return ref;
  if (ref.startsWith('@')) return ref;
  return null;
}

async function recordJoinRequestForBot(botKey, req) {
  if (!(mongoReady && mongoose.connection.readyState === 1) || !botKey || !req?.from || !req?.chat) return null;
  const invite = req.invite_link?.invite_link || req.invite_link?.name || '';
  const chatId = String(req.chat.id || '');
  const chatUsername = req.chat.username ? `@${req.chat.username}` : '';
  const chatTitle = req.chat.title || chatUsername || chatId;
  const payload = {
    bot_key: botKey,
    user_id: req.from.id,
    username: req.from.username || null,
    first_name: req.from.first_name || null,
    last_name: req.from.last_name || null,
    chat_id: chatId,
    chat_title: chatTitle,
    chat_username: chatUsername || null,
    invite_link: invite || null,
    status: 'requested',
    requested_at: new Date()
  };
  const doc = await JoinRequest.findOneAndUpdate(
    { bot_key: botKey, user_id: req.from.id, chat_id: chatId },
    { $set: payload },
    { upsert: true, new: true }
  );
  const ors = [];
  if (invite) ors.push({ invite_link: invite }, { join_url: invite });
  if (chatUsername) ors.push({ chat_username: chatUsername }, { chat_ref: chatUsername });
  if (ors.length) {
    await Subscription.updateMany(
      { bot_key: botKey, $or: ors },
      { $set: { chat_id: chatId, chat_ref: chatId, title: chatTitle, requires_request: true } }
    ).catch(() => null);
  }
  return doc;
}

async function hasRecordedJoinRequest(sub, userId) {
  if (!(mongoReady && mongoose.connection.readyState === 1)) return false;
  const ors = [];
  if (sub?.chat_id) ors.push({ chat_id: String(sub.chat_id) });
  if (sub?.chat_ref && /^-?\d{6,}$/.test(String(sub.chat_ref))) ors.push({ chat_id: String(sub.chat_ref) });
  if (sub?.chat_ref && String(sub.chat_ref).startsWith('@')) ors.push({ chat_username: String(sub.chat_ref) });
  if (sub?.chat_username && String(sub.chat_username).startsWith('@')) ors.push({ chat_username: String(sub.chat_username) });
  if (sub?.invite_link) ors.push({ invite_link: String(sub.invite_link) });
  if (sub?.join_url) ors.push({ invite_link: String(sub.join_url) });
  if (!ors.length) return false;
  const req = await JoinRequest.findOne({ bot_key: sub.bot_key, user_id: Number(userId), status: { $in: ['requested', 'approved'] }, $or: ors });
  return !!req;
}

async function checkOneSubscription(sub, telegram, userId) {
  const ref = subscriptionCheckRef(sub);
  if (ref && telegram) {
    try {
      const member = await telegram.getChatMember(ref, userId);
      if (!['left', 'kicked'].includes(member.status)) return { ok: true, reason: 'member' };
    } catch (error) {
      console.error(`❌ Obuna getChatMember xatosi ${subLabel(sub)}:`, error.message);
    }
  }
  if (sub.requires_request || sub.is_private_link) {
    const requested = await hasRecordedJoinRequest(sub, userId);
    if (requested) return { ok: true, reason: 'join_request_recorded' };
    return { ok: false, reason: 'join_request_missing' };
  }
  return { ok: false, reason: ref ? 'not_joined' : 'not_checkable' };
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function makeSecretCode(prefix = 'REQ') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function secretHash(code) {
  return crypto.createHmac('sha256', cryptoKey()).update(String(code || '')).digest('hex');
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return ['1', 'true', 'ha', 'yes', 'on', 'yoqil', 'yoqilgan'].includes(v);
}

function safeJson(value, fallback = {}) {
  try {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

async function getBotSettings(botKey) {
  const doc = await BotSetting.findOne({ bot_key: botKey });
  return doc?.settings || {};
}

async function updateBotSettings(botKey, patch) {
  const current = await getBotSettings(botKey);
  const next = { ...current, ...patch };
  await BotSetting.updateOne({ bot_key: botKey }, { $set: { settings: next } }, { upsert: true });
  return next;
}

function parseKeyValueLines(text) {
  const obj = {};
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) obj[key] = value;
  }
  return obj;
}

function parseFieldLine(text) {
  const parts = String(text || '').split('|').map((x) => x.trim());
  const label = parts[0] || '';
  const type = (parts[1] || 'text').toLowerCase();
  const requiredRaw = parts[2] || 'ha';
  const order = Number(parts[3] || 0);
  const placeholder = parts.slice(4).join(' | ').trim();
  const key = slugifyCode(label || `field_${Date.now()}`) || `field_${Date.now()}`;
  return { label, key, type, required: !/^yo'q|yoq|no|0|false$/i.test(requiredRaw), order, placeholder };
}

function formAnswerToText(answer) {
  if (!answer) return '';
  if (answer.type === 'location' && answer.value?.latitude) return `${answer.value.latitude}, ${answer.value.longitude}`;
  if (answer.type === 'photo') return '[photo yuborilgan]';
  if (answer.type === 'document') return `[fayl: ${answer.value?.file_name || 'document'}]`;
  return String(answer.value ?? '');
}

function isLinkText(text) {
  return /(https?:\/\/|t\.me\/|telegram\.me\/|www\.|@\w{5,})/i.test(String(text || ''));
}

function nowPlusMinutes(mins) {
  return new Date(Date.now() + Number(mins || 0) * 60 * 1000);
}

function nowPlusDays(days) {
  return new Date(Date.now() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

async function safeDelete(ctx) {
  try { await ctx.deleteMessage(); } catch (_) {}
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


async function sendStoredMessageToChat(telegram, chatId, stored) {
  try {
    await telegram.copyMessage(chatId, stored.source_chat_id, stored.source_message_id);
    return true;
  } catch (error) {
    console.error('copyMessage to chat xatosi:', error.message);
  }

  const captionExtra = {
    caption: stored.caption || undefined,
    caption_entities: stored.caption_entities || undefined
  };
  if (stored.message_type === 'text') return telegram.sendMessage(chatId, stored.text || ' ', { entities: stored.entities || undefined });
  if (stored.message_type === 'photo') return telegram.sendPhoto(chatId, stored.file_id, captionExtra);
  if (stored.message_type === 'video') return telegram.sendVideo(chatId, stored.file_id, captionExtra);
  if (stored.message_type === 'animation') return telegram.sendAnimation(chatId, stored.file_id, captionExtra);
  if (stored.message_type === 'document') return telegram.sendDocument(chatId, stored.file_id, captionExtra);
  if (stored.message_type === 'audio') return telegram.sendAudio(chatId, stored.file_id, captionExtra);
  if (stored.message_type === 'voice') return telegram.sendVoice(chatId, stored.file_id, captionExtra);
  if (stored.message_type === 'sticker') return telegram.sendSticker(chatId, stored.file_id);
  throw new Error('Saqlangan xabar turi yuborilmadi');
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
    if (!(mongoReady && mongoose.connection.readyState === 1)) return;
    try {
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
    } catch (error) {
      console.error(`⚠️ ${config.title} user saqlash xatosi:`, error.message);
    }
  }

  async function checkAllSubscriptions(userId) {
    const globalResult = await checkGlobalSubscriptionsForUser(userId, bot.telegram);
    if (!globalResult.ok) return false;

    // Global obuna hamma yaratilgan botlarda majburiy ishlaydi.
    // Botning o‘z adminlari faqat o‘sha botning lokal obunalaridan ozod qilinadi.
    if (isAdmin(userId)) return true;

    const ready = await waitForMongoConnection(700);
    if (!ready) return false;

    const localSubs = await Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 });
    if (localSubs.length === 0) return true;

    for (const sub of localSubs) {
      const checked = await checkOneSubscription(sub, bot.telegram, userId);
      if (!checked.ok) return false;
    }
    return true;
  }

  async function getSubscriptionKeyboard() {
    const ready = await waitForMongoConnection(700);
    if (!ready) return Markup.inlineKeyboard([[Markup.button.callback('✅ Obunani tekshirish', 'check_subscription')]]);

    const [globalSubs, localSubs] = await Promise.all([
      Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 }),
      Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 })
    ]);

    const rows = [];
    for (const sub of globalSubs) {
      const url = subJoinUrl(sub);
      if (url) rows.push([Markup.button.url(`🌐 ${subLabel(sub)}`, url)]);
      else rows.push([Markup.button.callback(`🌐 ${subLabel(sub)}`, 'noop')]);
    }
    for (const sub of localSubs) {
      const url = subJoinUrl(sub);
      if (url) rows.push([Markup.button.url(subLabel(sub), url)]);
      else rows.push([Markup.button.callback(subLabel(sub), 'noop')]);
    }
    rows.push([Markup.button.callback('✅ Obunani tekshirish', 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
  }

  async function sendSubscriptionWarning(ctx) {
    const keyboard = await getSubscriptionKeyboard();
    return ctx.reply(
      '🔒 Botdan foydalanish uchun avval majburiy kanal/guruhlarga obuna bo‘ling yoki zayavka yuboring.\n\n🌐 Umumiy obunalar BotFactory orqali barcha yaratilgan botlar uchun tekshiriladi. Private/zayavka kanalda so‘rov yuborgan bo‘lsangiz, “✅ Obunani tekshirish” tugmasini bosing.',
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
  applyManagedPlanFeatures(bot, config, adminIds);
  const PAGE_SIZE = 3;

  bot.use(
    session({
      defaultSession: () => ({ mode: null, tempMessage: null, tempPart: null })
    })
  );
  attachGlobalSubscriptionGate(bot, config, adminIds);
  bot.on('chat_join_request', async (ctx) => {
    try {
      const req = ctx.chatJoinRequest || ctx.update?.chat_join_request;
      const doc = await recordJoinRequestForBot(config.key, req);
      if (doc?.user_id) {
        await bot.telegram.sendMessage(doc.user_id, `✅ ${doc.chat_title || 'kanal/guruh'} uchun zayavkangiz qabul qilindi. Endi botga qaytib “✅ Obunani tekshirish” tugmasini bosing.`).catch(() => null);
      }
    } catch (error) {
      console.error(`${config.title} chat_join_request saqlash xatosi:`, error.message);
    }
  });

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
    resetSession(ctx);

    if (isAdmin(ctx.from.id)) {
      return ctx.reply(`🏠 ${config.title || config.itemTitle} admin paneli:`, adminKeyboard());
    }

    const ok = await checkAllSubscriptions(ctx.from.id);
    if (!ok) return sendSubscriptionWarning(ctx);

    return ctx.reply(
      `${config.mainEmoji || '🤖'} ${config.title || config.itemTitle} botiga xush kelibsiz!

` +
        `${config.welcomeLine || ((config.itemTitle || 'Kontent') + ' nomi yoki kodini yuboring.')}\n` +
        `Masalan: ${config.codeExamples || 'kod'}`
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

  bot.hears('📍 Manba statistikasi', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    const g = await latestGiveaway();
    if (!g) return ctx.reply('📭 Konkurs yo‘q.');
    const sources = await GiveawaySource.find({ bot_key: config.key, giveaway_id: g._id }).sort({ joins_count: -1, clicks_count: -1, createdAt: 1 }).limit(50);
    const direct = await GiveawayParticipant.countDocuments({
      bot_key: config.key,
      giveaway_id: g._id,
      onboarding_status: 'active',
      $or: [{ source_code: null }, { source_code: { $exists: false } }]
    });
    if (!sources.length) return ctx.reply(`📍 MANBA STATISTIKASI\n\nHali kanal/guruhga maxsus konkurs posti yuborilmagan.\nTo‘g‘ridan-to‘g‘ri kirganlar: ${direct}`);
    return ctx.reply(
      `📍 MANBA STATISTIKASI\n\n` +
      sources.map((src, i) =>
        `${i + 1}. ${src.chat_title || src.chat_username || src.chat_id}\n` +
        `   👀 Bosilgan: ${src.clicks_count || 0} | ✅ Qo‘shilgan: ${src.joins_count || 0} | 📣 Post: ${src.posts_count || 0}\n` +
        `   🆔 ${src.chat_id}${src.chat_username ? ` | ${src.chat_username}` : ''}`
      ).join('\n\n') +
      `\n\n➡️ To‘g‘ridan-to‘g‘ri kirganlar: ${direct}`,
      adminKeyboard()
    );
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
// GLOBAL SUBSCRIPTION GATE FOR CREATED BOTS
// =========================
let factoryMembershipTelegram = null;
const GLOBAL_SUB_CACHE_TTL_MS = 15000;
const GLOBAL_MEMBER_CACHE_TTL_MS = 20000;
let globalSubscriptionsCache = { at: 0, subs: [] };
const globalMembershipCache = new Map();

async function waitForMongoConnection(timeoutMs = 700) {
  if (mongoReady && mongoose.connection.readyState === 1) return true;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(120);
    if (mongoReady && mongoose.connection.readyState === 1) return true;
  }
  return mongoReady && mongoose.connection.readyState === 1;
}

function getFactoryMembershipTelegram(fallbackTelegram = null) {
  try {
    const factoryActive = activeBots.get('factory');
    if (factoryActive?.bot?.telegram) return factoryActive.bot.telegram;
  } catch (_) {}

  if (hasUsableToken(FACTORYBOT_TOKEN)) {
    if (!factoryMembershipTelegram) factoryMembershipTelegram = new Telegram(FACTORYBOT_TOKEN);
    return factoryMembershipTelegram;
  }

  return fallbackTelegram;
}

async function getGlobalSubscriptionsForGate() {
  const now = Date.now();
  if (globalSubscriptionsCache.at && now - globalSubscriptionsCache.at < GLOBAL_SUB_CACHE_TTL_MS) {
    return { ready: true, subs: globalSubscriptionsCache.subs };
  }
  const ready = mongoReady && mongoose.connection.readyState === 1 ? true : await waitForMongoConnection(700);
  if (!ready) return { ready: false, subs: globalSubscriptionsCache.subs || [] };
  const subs = await Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 }).lean();
  globalSubscriptionsCache = { at: now, subs };
  return { ready: true, subs };
}

async function checkGlobalSubscriptionsForUser(userId, fallbackTelegram = null) {
  const { ready, subs } = await getGlobalSubscriptionsForGate();
  if (!ready) return { ok: false, reason: 'db_not_ready', subs: subs || [] };
  if (!subs.length) return { ok: true, reason: 'no_global_subscriptions', subs: [] };

  const telegram = getFactoryMembershipTelegram(fallbackTelegram);
  if (!telegram) return { ok: false, reason: 'factory_token_missing', subs };

  const now = Date.now();
  const checks = await Promise.all(subs.map(async (sub) => {
    const cacheKey = `${userId}:${String(sub._id || sub.chat_id || sub.chat_username)}`;
    const cached = globalMembershipCache.get(cacheKey);
    if (cached && now - cached.at < GLOBAL_MEMBER_CACHE_TTL_MS) return cached.value;
    const value = await checkOneSubscription(sub, telegram, userId);
    globalMembershipCache.set(cacheKey, { at: now, value });
    return value;
  }));
  const failed = checks.find((item) => !item.ok);
  if (failed) return { ok: false, reason: failed.reason || 'not_joined', subs };
  return { ok: true, reason: 'joined_or_requested', subs };
}

function globalSubscriptionKeyboardFromSubs(subs, checkAction = 'check_subscription') {
  const rows = [];
  for (const sub of subs || []) {
    const url = subJoinUrl(sub);
    if (url) rows.push([Markup.button.url(`🌐 ${subLabel(sub)}`, url)]);
    else rows.push([Markup.button.callback(`🌐 ${subLabel(sub)}`, 'noop')]);
  }
  rows.push([Markup.button.callback('✅ Obunani tekshirish', checkAction)]);
  return Markup.inlineKeyboard(rows);
}

async function sendCreatedBotGlobalSubscriptionWarning(ctx, result = null) {
  const info = result || await getGlobalSubscriptionsForGate();
  const subs = info.subs || [];
  const keyboard = globalSubscriptionKeyboardFromSubs(subs, 'check_subscription');
  const extra = info.reason === 'db_not_ready'
    ? '\n\n⏳ Obuna ro‘yxati bazadan yuklanmoqda. Bir necha soniyadan keyin “✅ Obunani tekshirish” tugmasini bosing.'
    : '';
  return ctx.reply(
    '🔒 Botdan foydalanish uchun avval majburiy kanal/guruhlarga obuna bo‘ling.\n\n' +
      '🌐 Bu global majburiy obuna barcha BotFactory orqali yaratilgan botlarda ishlaydi.\n' +
      'Obuna yoki zayavka yuborgach, “✅ Obunani tekshirish” tugmasini bosing.' + extra,
    keyboard
  );
}

function isSubscriptionCheckUpdate(ctx) {
  const data = ctx.callbackQuery?.data || '';
  return data === 'check_subscription' || data === 'factory_check_global_subscription' || data === 'noop';
}

function attachGlobalSubscriptionGate(bot, config, adminIds = []) {
  // Konkurs botida referral /start payload obunadan oldin DBga yozilishi kerak.
  // Shuning uchun global+lokal obuna tekshiruvi createGiveawayBot ichida boshqariladi.
  if (!config.managed || config.engine === 'giveaway') return;
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    // Global obuna faqat botning private chatida tekshiriladi.
    // Kanal/guruhga odam qo‘shilganda yoki guruhdagi oddiy xabarlarda ogohlantirish yuborilmaydi.
    if (ctx.chat && ctx.chat.type !== 'private') return next();
    if (isSubscriptionCheckUpdate(ctx)) return next();

    const userId = Number(ctx.from.id);
    // Global majburiy obuna yaratilgan bot egasi/adminlariga ham ko‘rsatiladi.
    // Faqat asosiy Factory adminlari bypass qilinadi.
    const bypassIds = new Set(GLOBAL_ADMIN_IDS.map(Number));
    if (bypassIds.has(userId)) return next();

    const result = await checkGlobalSubscriptionsForUser(userId, bot.telegram);
    if (result.ok) return next();
    return sendCreatedBotGlobalSubscriptionWarning(ctx, result);
  });
}

// =========================
// MANAGED BOT ACCESS MIDDLEWARE
// =========================
const managedAccessCache = new Map();

function attachManagedAccess(bot, config) {
  if (!config.managed) return;
  bot.use(async (ctx, next) => {
    let rec = null;
    const cached = managedAccessCache.get(config.key);
    if (cached && Date.now() - cached.at < 10000) rec = cached.rec;

    if (!rec) {
      const ready = mongoReady && mongoose.connection.readyState === 1 ? true : await waitForMongoConnection(700);
      if (!ready) {
        return ctx.reply('⏳ Bot bazaga ulanmoqda. Bir necha soniyadan keyin qayta urinib ko‘ring.');
      }
      rec = await ManagedBot.findOne({ bot_key: config.key });
      if (rec) managedAccessCache.set(config.key, { at: Date.now(), rec });
    }

    if (!rec) return next();
    const expiredNow = await markRecordExpiredIfNeeded(rec);
    const allowed = !expiredNow && rec.status === 'approved' && rec.is_enabled;
    if (!allowed) {
      managedAccessCache.delete(config.key);
      const userId = Number(ctx.from?.id || 0);
      const ownerOrAdmin = userId && (
        userId === Number(rec.owner_user_id) ||
        (rec.admin_ids || []).map(Number).includes(userId) ||
        GLOBAL_ADMIN_IDS.includes(userId)
      );
      if (ownerOrAdmin) {
        return ctx.reply(
          `⏳ @${rec.telegram_username} botining sinov/obuna muddati tugagan yoki bot to‘xtatilgan.\n\n` +
          `Barcha ma’lumotlar MongoDB’da saqlanadi. Admin obunani tiklagach bot shu joyidan davom etadi.\n\n` +
          `Kelishish: ${OWNER_USERNAME}`
        );
      }
      return;
    }
    return next();
  });
}

function createBaseBot(token, config, adminIds, sessionDefault = {}) {
  const bot = new Telegraf(token);
  applyManagedPlanFeatures(bot, config, adminIds);
  bot.use(session({ defaultSession: () => ({ mode: null, draft: {}, ...sessionDefault }) }));
  attachManagedAccess(bot, config);
  attachGlobalSubscriptionGate(bot, config, adminIds);
  bot.on('chat_join_request', async (ctx) => {
    try {
      const req = ctx.chatJoinRequest || ctx.update?.chat_join_request;
      const doc = await recordJoinRequestForBot(config.key, req);
      if (doc?.user_id) {
        await bot.telegram.sendMessage(doc.user_id, `✅ ${doc.chat_title || 'kanal/guruh'} uchun zayavkangiz qabul qilindi. Endi botga qaytib “✅ Obunani tekshirish” tugmasini bosing.`).catch(() => null);
      }
    } catch (error) {
      console.error(`${config.title} chat_join_request saqlash xatosi:`, error.message);
    }
  });
  return bot;
}

function commonAdminRows(extraRows = []) {
  return [
    ...extraRows,
    ['📊 Statistika', '📢 Broadcast'],
    ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
    ['📋 Obunalar', '➖ Obuna oʻchirish'],
    ['🏠 Bosh menyu']
  ];
}

async function handleCommonAdminText(ctx, config, utils, adminKeyboard) {
  const text = ctx.message.text.trim();
  if (ctx.session.mode === 'add_channel') return addSubscriptionForBot(ctx, config.key, text, 'channel', adminKeyboard);
  if (ctx.session.mode === 'add_group') return addSubscriptionForBot(ctx, config.key, text, 'group', adminKeyboard);
  if (ctx.session.mode === 'delete_subscription') {
    return deleteSubscriptionForBot(ctx, config.key, text, adminKeyboard);
  }
  return null;
}

async function addSubscriptionForBot(ctx, botKey, text, type, adminKeyboard) {
  const parsed = parseSubscriptionInput(text, type);
  if (!parsed) {
    return ctx.reply(
      '❌ Kanal/guruh notoʻgʻri. Qayta yuboring:\n\n' +
        'Public: @kanal yoki https://t.me/kanal\n' +
        'Private/zayavka: Kanal nomi | https://t.me/+invite | zayavka\n' +
        'Aniq tekshiruv uchun: Kanal nomi | -1001234567890 | zayavka'
    );
  }
  try {
    await Subscription.updateOne(
      { bot_key: botKey, chat_username: parsed.chat_username },
      { $set: { ...parsed, added_by: ctx.from.id } },
      { upsert: true }
    );
    ctx.session.mode = null;
    ctx.session.draft = {};
    const hint = parsed.requires_request
      ? '\n\n⚠️ Zayavka/private obuna tekshiruvi ishlashi uchun shu bot kanal/guruhda admin bo‘lsin va chat_join_request update olsin. User zayavka yuborsa, bot DB’da yozib qo‘yadi va ruxsat beradi.'
      : '\n\n⚠️ Tekshiruv uchun bot o‘sha kanal/guruhda admin bo‘lgani yaxshi.';
    return ctx.reply(`✅ ${subLabel(parsed)} majburiy obunaga qo‘shildi.${hint}`, adminKeyboard());
  } catch (error) {
    if (error.code === 11000) return ctx.reply(`❌ ${parsed.chat_username} allaqachon roʻyxatda bor.`);
    console.error(error);
    return ctx.reply('❌ Saqlashda xatolik. Qayta urinib koʻring.');
  }
}

async function deleteSubscriptionForBot(ctx, botKey, text, adminKeyboard) {
  const q = String(text || '').trim();
  const parsed = parseSubscriptionInput(q, 'channel');
  const ors = [];
  if (parsed?.chat_username) ors.push({ chat_username: parsed.chat_username });
  if (parsed?.chat_ref) ors.push({ chat_ref: parsed.chat_ref });
  if (parsed?.join_url) ors.push({ join_url: parsed.join_url }, { invite_link: parsed.join_url });
  const norm = normalizeUsername(q);
  if (norm) ors.push({ chat_username: norm }, { chat_ref: norm }, { chat_id: norm });
  if (q) ors.push({ chat_username: q }, { title: new RegExp(escapeRegex(q), 'i') });
  if (!ors.length) return ctx.reply('❌ O‘chirish uchun nom, @username, -100... yoki invite link yuboring.');
  const result = await Subscription.deleteOne({ bot_key: botKey, $or: ors });
  ctx.session.mode = null;
  ctx.session.draft = {};
  if (result.deletedCount) return ctx.reply('✅ Obuna o‘chirildi.', adminKeyboard());
  return ctx.reply('❌ Bunday obuna topilmadi.', adminKeyboard());
}

function registerCommonAdminHandlers(bot, config, utils, adminKeyboard, options = {}) {
  bot.hears('🏠 Bosh menyu', async (ctx) => ctx.reply('🏠 Admin menyu:', adminKeyboard()));
  bot.hears('📢 Broadcast', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'broadcasting';
    ctx.session.draft = {};
    return ctx.reply('📢 Broadcast rejimi yoqildi. Matn, rasm, video, fayl yoki forward yuboring.\n\n❌ Bekor qilish: /cancel');
  });
  bot.hears('➕ Kanal qoʻshish', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'add_channel';
    ctx.session.draft = {};
    return ctx.reply('➕ Majburiy obuna uchun kanal yuboring.\n\nFormatlar:\n@kanal\nhttps://t.me/kanal\nKanal nomi | https://t.me/+privateInvite | zayavka\nKanal nomi | -1001234567890 | zayavka\n\n❌ Bekor qilish: /cancel');
  });
  bot.hears('➕ Guruh qoʻshish', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'add_group';
    ctx.session.draft = {};
    return ctx.reply('➕ Majburiy obuna uchun guruh yuboring.\n\nFormatlar:\n@guruh\nhttps://t.me/guruh\nGuruh nomi | https://t.me/+privateInvite | zayavka\nGuruh nomi | -1001234567890 | zayavka\n\n❌ Bekor qilish: /cancel');
  });
  bot.hears('📋 Obunalar', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    const subs = await Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 });
    if (!subs.length) return ctx.reply('📭 Hozircha majburiy obuna yoʻq.');
    return ctx.reply(`📋 Majburiy obunalar:\n\n${subs.map((s, i) => `${i + 1}. ${subLabel(s)}${s.join_url ? `\n   🔗 ${s.join_url}` : ''}${s.chat_ref ? `\n   🆔 ${s.chat_ref}` : ''}`).join('\n')}`);
  });
  bot.hears('➖ Obuna oʻchirish', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'delete_subscription';
    ctx.session.draft = {};
    return ctx.reply('➖ O‘chiriladigan obuna nomi, @username, -100... yoki invite link yuboring.\n\n❌ Bekor qilish: /cancel');
  });
  bot.action('check_subscription', async (ctx) => {
    if (typeof options.onSubscriptionSuccess === 'function') {
      await ctx.answerCbQuery().catch(() => null);
      await utils.saveUser(ctx);
      const ok = await utils.checkAllSubscriptions(ctx.from.id);
      if (!ok && !utils.isAdmin(ctx.from.id)) {
        const keyboard = await utils.getSubscriptionKeyboard();
        try {
          return await ctx.editMessageText('❌ Hali barcha kanal/guruhlarga obuna bo‘lmagansiz.', keyboard);
        } catch (_) {
          return ctx.reply('❌ Hali barcha kanal/guruhlarga obuna bo‘lmagansiz.', keyboard);
        }
      }
      try { await ctx.deleteMessage(); } catch (_) {}
      if (utils.isAdmin(ctx.from.id)) return ctx.reply('✅ Tasdiqlandi! Admin panel:', adminKeyboard());
      return options.onSubscriptionSuccess(ctx);
    }
    return utils.handleSubscriptionCallback(ctx, adminKeyboard, '✅ Obuna tasdiqlandi!');
  });
  bot.action('noop', async (ctx) => ctx.answerCbQuery('Private chat uchun admin bergan ko‘rsatma bo‘yicha obuna bo‘ling.'));
}

// =========================
// VIP / MAXFIY KANALGA VAQTLIK LINK BOT
// =========================
function createVipBot(config, tokenOverride = null, adminIdsOverride = null) {
  const token = String(tokenOverride || process.env[config.tokenEnv] || '').trim();
  if (!hasUsableToken(token)) return null;
  const adminIds = adminIdsOverride || parseIds(process.env[`${config.key.toUpperCase()}_ADMIN_IDS`] || process.env.ADMIN_IDS);
  const bot = createBaseBot(token, config, adminIds);
  const utils = createSharedUtils(bot, config, adminIds);

  function adminKeyboard() {
    return Markup.keyboard(commonAdminRows([
      ['⚙️ VIP sozlamalar', '📋 VIP soʻrovlar'],
      ['👥 VIP aʼzolar', '💳 Toʻlov matni']
    ])).resize().oneTime(false);
  }

  async function settingsText() {
    const st = await getBotSettings(config.key);
    return `⚙️ VIP SOZLAMALAR\n\n` +
      `🔐 Maxfiy kanal/guruh: ${st.vip_chat || 'kiritilmagan'}\n` +
      `💰 Narx matni: ${st.price_text || 'kiritilmagan'}\n` +
      `⏳ Dostup muddati: ${Number(st.access_days || 30)} kun\n` +
      `🔗 Link yashash muddati: ${Number(st.link_minutes || 30)} daqiqa\n` +
      `👨‍💻 To‘lov/admin username: ${st.admin_contact || OWNER_USERNAME}\n\n` +
      `Sozlash uchun tugmalardan foydalaning.`;
  }

  async function expireVipMembers() {
    const expired = await VipMember.find({ bot_key: config.key, is_active: true, access_until: { $lte: new Date() } }).limit(50);
    for (const member of expired) {
      try {
        if (member.channel_chat) {
          await bot.telegram.banChatMember(member.channel_chat, member.user_id);
          await bot.telegram.unbanChatMember(member.channel_chat, member.user_id, { only_if_banned: true }).catch(() => null);
        }
      } catch (error) {
        console.error(`${config.title} VIP chiqarish xatosi:`, error.message);
      }
      member.is_active = false;
      member.removed_at = new Date();
      await member.save();
      try { await bot.telegram.sendMessage(member.user_id, '⏳ VIP obunangiz muddati tugadi. Uzaytirish uchun admin bilan bog‘laning.'); } catch (_) {}
    }
  }
  const timer = setInterval(() => expireVipMembers().catch((e) => console.error('VIP expire xatosi:', e.message)), 10 * 60 * 1000);
  timer.unref?.();

  bot.start(async (ctx) => {
    await utils.saveUser(ctx, true);
    if (utils.isAdmin(ctx.from.id)) return ctx.reply(`💎 ${config.title} admin paneli`, adminKeyboard());
    const ok = await utils.checkAllSubscriptions(ctx.from.id);
    if (!ok) return utils.sendSubscriptionWarning(ctx);
    const st = await getBotSettings(config.key);
    return ctx.reply(
      `💎 VIP obuna botiga xush kelibsiz!\n\n${st.price_text || 'VIP kanalga kirish uchun so‘rov yuboring. Admin tasdiqlagach vaqtlik maxfiy link beriladi.'}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('💎 VIPga kirish uchun soʻrov', 'vip:req')],
        [Markup.button.url('☎️ Admin bilan toʻlovni kelishish', `https://t.me/${String(st.admin_contact || OWNER_USERNAME).replace('@', '')}`)]
      ])
    );
  });

  bot.hears('⚙️ VIP sozlamalar', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    return ctx.reply(await settingsText(), Markup.inlineKeyboard([
      [Markup.button.callback('🔐 Maxfiy kanal/guruh', 'vipset:chat')],
      [Markup.button.callback('💰 Narx/toʻlov matni', 'vipset:pay')],
      [Markup.button.callback('⏳ Dostup kunlari', 'vipset:days'), Markup.button.callback('🔗 Link daqiqasi', 'vipset:link')],
      [Markup.button.callback('👨‍💻 Admin username', 'vipset:admin')]
    ]));
  });
  bot.hears('💳 Toʻlov matni', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    ctx.session.mode = 'vip_set_pay';
    return ctx.reply('💳 Foydalanuvchiga ko‘rinadigan to‘lov/narx matnini yuboring.\n\n❌ Bekor qilish: /cancel');
  });
  bot.hears('📋 VIP soʻrovlar', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    const list = await VipRequest.find({ bot_key: config.key }).sort({ createdAt: -1 }).limit(15);
    if (!list.length) return ctx.reply('📭 VIP so‘rovlar yo‘q.');
    for (const r of list) {
      await ctx.reply(`💎 VIP SOʻROV\n\n👤 ${r.first_name || ''} ${r.username ? '@' + r.username : ''}\n🆔 ${r.user_id}\n🔐 Shifr: ${r.secret_code}\n📌 Holat: ${r.status}\n🕒 ${formatDate(r.createdAt)}`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ Link berish', `vip:approve:${String(r._id)}`), Markup.button.callback('❌ Rad etish', `vip:reject:${String(r._id)}`)]]));
    }
  });
  bot.hears('👥 VIP aʼzolar', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    const list = await VipMember.find({ bot_key: config.key, is_active: true }).sort({ access_until: 1 }).limit(30);
    if (!list.length) return ctx.reply('📭 Aktiv VIP aʼzolar yo‘q.');
    return ctx.reply(`👥 VIP AʼZOLAR\n\n${list.map((m, i) => `${i + 1}. ${m.first_name || ''} ${m.username ? '@' + m.username : ''} — ${formatDate(m.access_until)}`).join('\n')}`);
  });
  bot.hears('📊 Statistika', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    const [users, active, blocked, reqs, pending, members, subs] = await Promise.all([
      User.countDocuments({ bot_key: config.key }), User.countDocuments({ bot_key: config.key, is_blocked: { $ne: true } }), User.countDocuments({ bot_key: config.key, is_blocked: true }),
      VipRequest.countDocuments({ bot_key: config.key }), VipRequest.countDocuments({ bot_key: config.key, status: 'pending' }), VipMember.countDocuments({ bot_key: config.key, is_active: true }), Subscription.countDocuments({ bot_key: config.key })
    ]);
    return ctx.reply(`📊 VIP BOT STATISTIKASI\n\n👥 Userlar: ${users}\n✅ Aktiv: ${active}\n🚫 Blok: ${blocked}\n📋 So‘rovlar: ${reqs}\n⏳ Kutilayotgan: ${pending}\n💎 Aktiv VIP: ${members}\n🔒 Majburiy obuna: ${subs}`);
  });
  registerCommonAdminHandlers(bot, config, utils, adminKeyboard);

  bot.action(/^vipset:(chat|pay|days|link|admin)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!utils.isAdmin(ctx.from.id)) return;
    const map = { chat: 'vip_set_chat', pay: 'vip_set_pay', days: 'vip_set_days', link: 'vip_set_link', admin: 'vip_set_admin' };
    ctx.session.mode = map[ctx.match[1]];
    const prompts = {
      chat: '🔐 Maxfiy kanal/guruh username yoki chat ID yuboring. Masalan: @vipkanal yoki -1001234567890. Bot o‘sha kanal/guruhda invite link yaratishga admin bo‘lishi shart.',
      pay: '💳 Narx/to‘lov matnini yuboring.',
      days: '⏳ Dostup necha kun bo‘lsin? Masalan: 30',
      link: '🔗 Invite link necha daqiqa ishlasin? Masalan: 30',
      admin: '👨‍💻 To‘lov uchun admin username yuboring. Masalan: @Qoryogdiyev'
    };
    return ctx.reply(`${prompts[ctx.match[1]]}\n\n❌ Bekor qilish: /cancel`);
  });

  bot.action('vip:req', async (ctx) => {
    await ctx.answerCbQuery();
    await utils.saveUser(ctx);
    const ok = await utils.checkAllSubscriptions(ctx.from.id);
    if (!ok) return utils.sendSubscriptionWarning(ctx);
    const st = await getBotSettings(config.key);
    const secret = makeSecretCode('VIP');
    const req = await VipRequest.create({ bot_key: config.key, user_id: ctx.from.id, username: ctx.from.username || null, first_name: ctx.from.first_name || null, secret_code: secret });
    const adminText = `💎 YANGI VIP SOʻROV\n\n👤 ${ctx.from.first_name || ''} ${ctx.from.username ? '@' + ctx.from.username : ''}\n🆔 User ID: ${ctx.from.id}\n🔐 Maxfiy shifr: ${secret}\n\nFoydalanuvchi to‘lov qilganda shu shifrni yuboradi.`;
    for (const id of adminIds) {
      try { await bot.telegram.sendMessage(id, adminText, Markup.inlineKeyboard([[Markup.button.callback('✅ Link berish', `vip:approve:${String(req._id)}`), Markup.button.callback('❌ Rad etish', `vip:reject:${String(req._id)}`)]])); } catch (_) {}
    }
    return ctx.reply(
      `✅ So‘rov yuborildi!\n\n🔐 Sizning maxfiy shifringiz: ${secret}\n\nTo‘lov/admin bilan kelishganda aynan shu shifrni yuboring — admin bu so‘rov sizniki ekanini biladi.`,
      Markup.inlineKeyboard([[Markup.button.url('💳 Admin bilan toʻlov qilish', `https://t.me/${String(st.admin_contact || OWNER_USERNAME).replace('@', '')}`)]])
    );
  });

  bot.action(/^vip:approve:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!utils.isAdmin(ctx.from.id)) return;
    const req = await VipRequest.findOne({ _id: ctx.match[1], bot_key: config.key });
    if (!req) return ctx.reply('❌ So‘rov topilmadi.');
    const st = await getBotSettings(config.key);
    const chat = st.vip_chat;
    if (!chat) return ctx.reply('❌ Avval “⚙️ VIP sozlamalar”dan maxfiy kanal/guruhni kiriting.');
    try {
      const expireDate = Math.floor(nowPlusMinutes(Number(st.link_minutes || 30)).getTime() / 1000);
      const invite = await bot.telegram.createChatInviteLink(chat, { expire_date: expireDate, member_limit: 1, creates_join_request: false, name: `VIP ${req.user_id} ${req.secret_code}` });
      const accessUntil = nowPlusDays(Number(st.access_days || 30));
      req.status = 'approved'; req.approved_by = ctx.from.id; req.invite_link = invite.invite_link; req.expires_at = new Date(expireDate * 1000); req.access_until = accessUntil; await req.save();
      await VipMember.updateOne({ bot_key: config.key, user_id: req.user_id, channel_chat: chat }, { $set: { username: req.username, first_name: req.first_name, access_until: accessUntil, is_active: true, removed_at: null, last_request_id: req._id } }, { upsert: true });
      await bot.telegram.sendMessage(req.user_id, `✅ VIP ruxsat tasdiqlandi!\n\n🔗 Vaqtlik maxfiy link: ${invite.invite_link}\n⏳ Link tugashi: ${formatDate(req.expires_at)}\n💎 Dostup muddati: ${formatDate(accessUntil)}`);
      return ctx.editMessageText(`✅ Link yuborildi.\n\n👤 ${req.first_name || ''} ${req.username ? '@' + req.username : ''}\n🔐 ${req.secret_code}\n⏳ ${formatDate(accessUntil)}`);
    } catch (error) {
      console.error('VIP approve xatosi:', error);
      return ctx.reply(`❌ Link yaratishda xatolik: ${error.message}\n\nBot maxfiy kanal/guruhda admin bo‘lishi va invite link yaratish huquqiga ega bo‘lishi kerak.`);
    }
  });
  bot.action(/^vip:reject:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!utils.isAdmin(ctx.from.id)) return;
    const req = await VipRequest.findOne({ _id: ctx.match[1], bot_key: config.key });
    if (!req) return ctx.reply('❌ So‘rov topilmadi.');
    req.status = 'rejected'; await req.save();
    try { await bot.telegram.sendMessage(req.user_id, '❌ VIP so‘rovingiz rad etildi. Admin bilan bog‘laning.'); } catch (_) {}
    return ctx.editMessageText(`❌ So‘rov rad etildi: ${req.secret_code}`);
  });

  bot.command('cancel', async (ctx) => { ctx.session.mode = null; ctx.session.draft = {}; return ctx.reply('❌ Jarayon bekor qilindi.', utils.isAdmin(ctx.from.id) ? adminKeyboard() : undefined); });
  bot.on('text', async (ctx) => {
    await utils.saveUser(ctx);
    const text = ctx.message.text.trim();
    if (text === '/cancel') { ctx.session.mode = null; ctx.session.draft = {}; return ctx.reply('❌ Jarayon bekor qilindi.', utils.isAdmin(ctx.from.id) ? adminKeyboard() : undefined); }
    if (utils.isAdmin(ctx.from.id)) {
      const common = await handleCommonAdminText(ctx, config, utils, adminKeyboard); if (common) return common;
      if (ctx.session.mode === 'broadcasting') { const r = await utils.broadcastMessage(ctx, adminKeyboard); ctx.session.mode = null; return r; }
      if (ctx.session.mode === 'vip_set_chat') { const parsed = parseSubscriptionInput(text, 'channel'); const v = parsed?.chat_ref || parsed?.chat_id || normalizeUsername(text); if (!v) return ctx.reply('❌ VIP link yaratish uchun @username yoki -100... chat ID kerak. Private invite link majburiy obunada ishlaydi, lekin yangi invite link yaratish uchun botga kanal/guruh chat ID kerak.'); await updateBotSettings(config.key, { vip_chat: v, vip_chat_title: parsed?.title || v }); ctx.session.mode = null; return ctx.reply('✅ Maxfiy kanal/guruh saqlandi. Bot o‘sha kanal/guruhda invite link yaratish huquqi bilan admin bo‘lsin.', adminKeyboard()); }
      if (ctx.session.mode === 'vip_set_pay') { await updateBotSettings(config.key, { price_text: text }); ctx.session.mode = null; return ctx.reply('✅ To‘lov/narx matni saqlandi.', adminKeyboard()); }
      if (ctx.session.mode === 'vip_set_days') { const n = Number(text); if (!Number.isFinite(n) || n < 1) return ctx.reply('❌ Kun noto‘g‘ri. Masalan: 30'); await updateBotSettings(config.key, { access_days: n }); ctx.session.mode = null; return ctx.reply('✅ Dostup muddati saqlandi.', adminKeyboard()); }
      if (ctx.session.mode === 'vip_set_link') { const n = Number(text); if (!Number.isFinite(n) || n < 1) return ctx.reply('❌ Daqiqa noto‘g‘ri. Masalan: 30'); await updateBotSettings(config.key, { link_minutes: n }); ctx.session.mode = null; return ctx.reply('✅ Link muddati saqlandi.', adminKeyboard()); }
      if (ctx.session.mode === 'vip_set_admin') { await updateBotSettings(config.key, { admin_contact: text.startsWith('@') ? text : `@${text}` }); ctx.session.mode = null; return ctx.reply('✅ Admin username saqlandi.', adminKeyboard()); }
    }
    const ok = await utils.checkAllSubscriptions(ctx.from.id); if (!ok && !utils.isAdmin(ctx.from.id)) return utils.sendSubscriptionWarning(ctx);
    return ctx.reply('💎 VIPga kirish uchun /start bosing va “VIPga kirish” tugmasini tanlang.');
  });
  bot.on('message', async (ctx) => {
    await utils.saveUser(ctx);
    if (utils.isAdmin(ctx.from.id) && ctx.session.mode === 'broadcasting') { const r = await utils.broadcastMessage(ctx, adminKeyboard); ctx.session.mode = null; return r; }
  });
  bot.catch((err, ctx) => console.error(`❌ ${config.title} xatosi update ${ctx.update?.update_id}:`, err));
  return { key: config.key, title: config.title, bot, config };
}

// =========================
// KONKURS / GIVEAWAY BOT
// =========================
function createGiveawayBot(config, tokenOverride = null, adminIdsOverride = null) {
  const token = String(tokenOverride || process.env[config.tokenEnv] || '').trim();
  if (!hasUsableToken(token)) return null;

  const adminIds = adminIdsOverride || parseIds(process.env[`${config.key.toUpperCase()}_ADMIN_IDS`] || process.env.ADMIN_IDS);
  const bot = createBaseBot(token, config, adminIds, {
    mode: null,
    draft: {},
    giveawayId: null,
    participantGiveawayId: null
  });
  const utils = createSharedUtils(bot, config, adminIds);
  const contestSourcesCache = new Map();
  const contestMembershipCache = new Map();
  const sourceContestCache = new Map();
  const CONTEST_SOURCE_CACHE_MS = 10000;
  const CONTEST_MEMBER_CACHE_MS = 15000;

  function invalidateContestCaches(giveawayId) {
    contestSourcesCache.delete(String(giveawayId));
    sourceContestCache.clear();
    for (const key of contestMembershipCache.keys()) {
      if (key.includes(`:${String(giveawayId)}:`)) contestMembershipCache.delete(key);
    }
  }

  async function cachedContestSources(giveawayId) {
    const key = String(giveawayId);
    const cached = contestSourcesCache.get(key);
    if (cached && Date.now() - cached.at < CONTEST_SOURCE_CACHE_MS) return cached.sources;
    const sources = await GiveawaySource.find({
      bot_key: config.key,
      giveaway_id: giveawayId,
      is_active: { $ne: false },
      is_required: { $ne: false },
      $or: [
        { source_role: { $in: ['sponsor', 'both'] } },
        { source_role: { $exists: false } }
      ]
    }).sort({ createdAt: 1 }).lean();
    contestSourcesCache.set(key, { at: Date.now(), sources });
    return sources;
  }

  // Rasmli/bot captcha olib tashlandi: konkursga qo‘shilish obuna tekshiruvidan keyin bir bosishda bajariladi.
  const contestCountCache = new Map();
  const contestRefreshTimers = new Map();
  const CONTEST_COUNT_CACHE_MS = 2500;


  const USER_BUTTONS = {
    rating: '🏆 Reyting',
    invite: '👥 Do‘stlarni taklif qilish',
    profile: '👤 Profil',
    rules: '📜 Qoida'
  };

  const MANAGER_BUTTONS = {
    create: '🎮 Konkurs yaratish',
    mine: '📂 Mening konkurslarim',
    active: '⏱ Aktiv konkurs',
    participants: '👥 Qatnashchilar',
    connectHost: '🏠 Konkurs joyini ulash',
    connectSponsor: '🤝 Homiy kanal/guruh',
    chats: '📋 Ulangan joylar',
    publish: '📣 E’lonlarni yuborish',
    remove: '🗑 Ulanishni o‘chirish',
    results: '🏁 Natijalar',
    finish: '🧊 Hozir yakunlash',
    sources: '📍 Manba statistikasi',
    extraWinner: '➕ Qo‘shimcha g‘olib'
  };

  function fullAdminKeyboard() {
    return Markup.keyboard([
      [MANAGER_BUTTONS.create, MANAGER_BUTTONS.mine],
      [MANAGER_BUTTONS.active, MANAGER_BUTTONS.participants],
      [MANAGER_BUTTONS.connectHost, MANAGER_BUTTONS.connectSponsor],
      [MANAGER_BUTTONS.chats, MANAGER_BUTTONS.publish],
      [MANAGER_BUTTONS.remove, MANAGER_BUTTONS.sources],
      [MANAGER_BUTTONS.results, MANAGER_BUTTONS.finish],
      [MANAGER_BUTTONS.extraWinner, '📊 Umumiy statistika'],
      ['📢 Broadcast', '🏠 Bosh menyu']
    ]).resize().oneTime(false);
  }

  function managerKeyboard() {
    return Markup.keyboard([
      [MANAGER_BUTTONS.create, MANAGER_BUTTONS.mine],
      [MANAGER_BUTTONS.active, MANAGER_BUTTONS.participants],
      [MANAGER_BUTTONS.connectHost, MANAGER_BUTTONS.connectSponsor],
      [MANAGER_BUTTONS.chats, MANAGER_BUTTONS.publish],
      [MANAGER_BUTTONS.remove, MANAGER_BUTTONS.sources],
      [MANAGER_BUTTONS.results, MANAGER_BUTTONS.finish],
      [MANAGER_BUTTONS.extraWinner, '👤 Ishtirokchi rejimi']
    ]).resize().oneTime(false);
  }

  function publicKeyboard() {
    return Markup.keyboard([
      [MANAGER_BUTTONS.create, MANAGER_BUTTONS.mine],
      ['🔎 Faol konkurslar', 'ℹ️ Qanday ishlaydi?']
    ]).resize().oneTime(false);
  }

  function userKeyboard() {
    return Markup.keyboard([
      [USER_BUTTONS.rating, USER_BUTTONS.invite],
      [USER_BUTTONS.profile, USER_BUTTONS.rules],
      [MANAGER_BUTTONS.create, MANAGER_BUTTONS.mine]
    ]).resize().oneTime(false);
  }

  function roleKeyboard(userId) {
    return utils.isAdmin(userId) ? fullAdminKeyboard() : managerKeyboard();
  }

  function resetFlow(ctx, keepGiveaway = false) {
    ctx.session.mode = null;
    ctx.session.draft = {};
    ctx.session.connectRole = null;
    if (!keepGiveaway) ctx.session.giveawayId = null;
  }

  function saveUserFast(ctx, incrementStart = false) {
    utils.saveUser(ctx, incrementStart).catch((error) => console.error(`${config.title} user save:`, error.message));
  }

  function parseDurationInput(raw) {
    const value = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
    const match = value.match(/^(\d+(?:\.\d+)?)(m|min|daq|h|soat|d|kun|w|hafta)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = match[2].toLowerCase();
    let seconds = 0;
    if (['m', 'min', 'daq'].includes(unit)) seconds = amount * 60;
    else if (['h', 'soat'].includes(unit)) seconds = amount * 3600;
    else if (['d', 'kun'].includes(unit)) seconds = amount * 86400;
    else if (['w', 'hafta'].includes(unit)) seconds = amount * 604800;
    seconds = Math.round(seconds);
    if (seconds < 60 || seconds > 365 * 86400) return null;
    return seconds;
  }

  function formatRemaining(endDate) {
    const diff = Math.max(0, new Date(endDate).getTime() - Date.now());
    if (diff <= 0) return '00:00:00';
    let sec = Math.floor(diff / 1000);
    const days = Math.floor(sec / 86400); sec %= 86400;
    const hours = Math.floor(sec / 3600); sec %= 3600;
    const mins = Math.floor(sec / 60); sec %= 60;
    return `${days ? `${days} kun ` : ''}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function shuffled(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function winnerModeLabel(mode) {
    if (mode === 'random') return '🎲 Tasodifiy';
    if (mode === 'admin') return '🧑‍⚖️ Konkurs egasi tanlaydi';
    return '👥 Eng ko‘p do‘st taklif qilgan';
  }

  function makeSourceCode() {
    return crypto.randomBytes(6).toString('base64url');
  }

  function extractStartContext(ctx) {
    const payload = String(ctx.startPayload || ctx.message?.text?.split(/\s+/)[1] || '').trim();
    const out = { payload, referralId: null, sourceCode: null, giveawayId: null, action: 'join' };
    let match = payload.match(/^r_([a-f0-9]{24})_(\d+)$/i);
    if (match) {
      out.giveawayId = match[1];
      out.referralId = Number(match[2]);
      return out;
    }
    match = payload.match(/^ref_(\d+)$/i);
    if (match) {
      out.referralId = Number(match[1]);
      return out;
    }
    match = payload.match(/^g_([a-f0-9]{24})$/i);
    if (match) {
      out.giveawayId = match[1];
      return out;
    }
    match = payload.match(/^(src|rating|rules|invite)_([A-Za-z0-9_-]{4,24})$/i);
    if (match) {
      out.action = match[1] === 'src' ? 'join' : match[1];
      out.sourceCode = match[2];
    }
    return out;
  }

  async function activeGiveaway(ownerId = null) {
    const q = { bot_key: config.key, status: 'active' };
    if (ownerId) q.created_by = Number(ownerId);
    return Giveaway.findOne(q).sort({ createdAt: -1 });
  }

  async function latestGiveaway(ownerId = null) {
    const q = { bot_key: config.key };
    if (ownerId) q.created_by = Number(ownerId);
    return Giveaway.findOne(q).sort({ createdAt: -1 });
  }

  async function getGiveawayById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
    return Giveaway.findOne({ _id: id, bot_key: config.key });
  }

  function canManage(userId, giveaway) {
    if (!giveaway) return false;
    const id = Number(userId);
    return utils.isAdmin(id) || Number(giveaway.created_by) === id || (giveaway.manager_ids || []).map(Number).includes(id);
  }

  async function managerGiveaway(ctx, statuses = null) {
    let g = await getGiveawayById(ctx.session.giveawayId);
    if (g && !canManage(ctx.from.id, g)) g = null;
    if (g && statuses && ![].concat(statuses).includes(g.status)) g = null;
    if (!g) {
      const q = { bot_key: config.key, created_by: Number(ctx.from.id) };
      if (statuses) q.status = { $in: [].concat(statuses) };
      g = await Giveaway.findOne(q).sort({ createdAt: -1 });
    }
    if (!g && utils.isAdmin(ctx.from.id)) {
      const q = { bot_key: config.key };
      if (statuses) q.status = { $in: [].concat(statuses) };
      g = await Giveaway.findOne(q).sort({ createdAt: -1 });
    }
    if (g) ctx.session.giveawayId = String(g._id);
    return g;
  }

  async function participantGiveaway(ctx) {
    let g = await getGiveawayById(ctx.session.participantGiveawayId || ctx.session.giveawayId);
    if (g) return g;
    const p = await GiveawayParticipant.findOne({ bot_key: config.key, user_id: Number(ctx.from.id) }).sort({ last_seen_at: -1, createdAt: -1 });
    if (p) {
      g = await getGiveawayById(p.giveaway_id);
      if (g) ctx.session.participantGiveawayId = String(g._id);
    }
    return g;
  }

  async function resolveGiveawayFromStart(meta, ctx) {
    if (meta.sourceCode) {
      const source = await GiveawaySource.findOne({ bot_key: config.key, source_code: meta.sourceCode, is_active: { $ne: false } });
      if (source) {
        const g = await getGiveawayById(source.giveaway_id);
        if (g) return { giveaway: g, source };
      }
    }
    if (meta.giveawayId) {
      const g = await getGiveawayById(meta.giveawayId);
      if (g) return { giveaway: g, source: null };
    }
    const g = await participantGiveaway(ctx);
    return { giveaway: g, source: null };
  }

  async function participantFor(giveawayId, userId) {
    return GiveawayParticipant.findOne({ bot_key: config.key, giveaway_id: giveawayId, user_id: Number(userId) });
  }

  async function rankingRows(giveawayId, limit = 10) {
    return GiveawayParticipant.find({ bot_key: config.key, giveaway_id: giveawayId, onboarding_status: 'active' })
      .sort({ referrals_confirmed: -1, score: -1, joined_at: 1, createdAt: 1 }).limit(limit);
  }

  async function userRank(giveawayId, participant) {
    if (!participant || participant.onboarding_status !== 'active') return null;
    const better = await GiveawayParticipant.countDocuments({
      bot_key: config.key,
      giveaway_id: giveawayId,
      onboarding_status: 'active',
      $or: [
        { referrals_confirmed: { $gt: participant.referrals_confirmed || 0 } },
        { referrals_confirmed: participant.referrals_confirmed || 0, score: { $gt: participant.score || 0 } },
        { referrals_confirmed: participant.referrals_confirmed || 0, score: participant.score || 0, joined_at: { $lt: participant.joined_at || participant.createdAt } }
      ]
    });
    return better + 1;
  }

  function rankingText(list) {
    if (!list.length) return 'Hali reytingda ishtirokchi yo‘q.';
    return list.map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const name = p.full_name || p.telegram_first_name || `User ${p.user_id}`;
      return `${medal} ${name}${p.username ? ` (@${p.username})` : ''} — 👥 ${p.referrals_confirmed || 0} · ⭐ ${p.score || 0}`;
    }).join('\n');
  }

  let cachedBotInfo = null;
  async function getBotInfo() {
    if (cachedBotInfo) return cachedBotInfo;
    cachedBotInfo = await bot.telegram.getMe();
    return cachedBotInfo;
  }

  async function getBotUsername() {
    const info = await getBotInfo();
    return String(info.username || config.telegramUsername || '').replace(/^@/, '');
  }

  function parseContestTarget(raw) {
    const parts = String(raw || '').split('|').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return null;
    let target = parts.find((p) => /^-100\d+$/.test(p) || /^@?[A-Za-z0-9_]{5,32}$/.test(p) || /^https?:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/?$/i.test(p));
    let inviteLink = parts.find((p) => /^https?:\/\/t\.me\/(\+|joinchat\/)/i.test(p)) || '';
    if (!target && parts.length === 1) target = parts[0];
    if (!target) return null;
    if (/^https?:\/\/t\.me\//i.test(target)) target = `@${target.replace(/^https?:\/\/t\.me\//i, '').replace(/\/$/, '')}`;
    if (!target.startsWith('@') && !/^-100\d+$/.test(target)) target = `@${target.replace(/^@/, '')}`;
    return { target, inviteLink };
  }

  function sourceLabel(source) {
    const title = String(source.chat_title || '').trim();
    const username = String(source.chat_username || '').replace(/^@/, '').trim();
    if (title && username) return `${title} (@${username})`;
    if (title) return title;
    if (username) return `@${username}`;
    return 'Kanal/guruh';
  }

  function sourceRoleLabel(source) {
    const role = source?.source_role || 'both';
    if (role === 'host') return '🏠 Konkurs joyi';
    if (role === 'sponsor') return '🤝 Homiy';
    return '🔁 Konkurs joyi + homiy';
  }

  function sourceJoinUrl(source) {
    if (source.join_url) return source.join_url;
    if (source.invite_link) return source.invite_link;
    if (source.chat_username) return `https://t.me/${String(source.chat_username).replace(/^@/, '')}`;
    return null;
  }

  async function verifyChatPermissions(chat, actorId) {
    const botInfo = await getBotInfo();
    const [botMember, actorMember] = await Promise.all([
      bot.telegram.getChatMember(chat.id, botInfo.id).catch(() => null),
      bot.telegram.getChatMember(chat.id, actorId).catch(() => null)
    ]);
    const botIsAdmin = !!botMember && ['administrator', 'creator'].includes(botMember.status);
    const actorIsAdmin = utils.isAdmin(actorId) || (!!actorMember && ['administrator', 'creator'].includes(actorMember.status));
    const canPost = chat.type === 'channel'
      ? botIsAdmin && botMember?.can_post_messages !== false
      : !!botMember && !['left', 'kicked'].includes(botMember.status);
    return { botMember, actorMember, botIsAdmin, actorIsAdmin, canPost };
  }

  async function connectContestChat(g, raw, actorId, role = 'host') {
    if (!g || !canManage(actorId, g)) throw new Error('Bu konkursni boshqarish huquqi yo‘q');
    const parsed = parseContestTarget(raw);
    if (!parsed) throw new Error('Kanal/guruhni @username yoki -100... ID bilan yuboring');
    let chat;
    try {
      chat = await bot.telegram.getChat(parsed.target);
    } catch (error) {
      throw new Error(`Kanal/guruh topilmadi. Botni avval u yerga qo‘shing. Telegram: ${error.description || error.message}`);
    }
    if (!['channel', 'group', 'supergroup'].includes(chat.type)) throw new Error('Faqat kanal yoki guruh ulash mumkin');
    const permissions = await verifyChatPermissions(chat, actorId);
    if (!permissions.actorIsAdmin) throw new Error('Siz bu kanal/guruhda admin yoki egasi bo‘lishingiz kerak');
    if (!permissions.botIsAdmin) throw new Error('Yaratilgan konkurs botini kanal/guruhga admin qilib qo‘ying');
    if (!permissions.canPost) throw new Error('Botga xabar joylash huquqini bering');

    let joinUrl = chat.username ? `https://t.me/${chat.username}` : parsed.inviteLink;
    if (!joinUrl) {
      try {
        const link = await bot.telegram.createChatInviteLink(chat.id, { name: `Konkurs ${String(g._id).slice(-6)} ${role}` });
        joinUrl = link.invite_link;
      } catch (_) {}
    }
    if (!joinUrl) {
      throw new Error('Private kanal/guruh uchun botga taklif havolasi yaratish huquqini bering yoki -100... | https://t.me/+invite formatida yuboring');
    }

    let source = await GiveawaySource.findOne({ bot_key: config.key, giveaway_id: g._id, chat_id: String(chat.id) });
    let normalizedRole = ['host', 'sponsor', 'both'].includes(role) ? role : 'host';
    if (source?.source_role && source.source_role !== normalizedRole) normalizedRole = 'both';
    const values = {
      chat_title: chat.title || chat.username || 'Kanal/guruh',
      chat_username: chat.username ? `@${chat.username}` : null,
      chat_type: chat.type,
      created_by: actorId,
      owner_user_id: Number(g.created_by),
      join_url: joinUrl || null,
      invite_link: joinUrl && /t\.me\/(\+|joinchat\/)/i.test(joinUrl) ? joinUrl : null,
      is_active: true,
      source_role: normalizedRole,
      is_required: normalizedRole === 'sponsor' || normalizedRole === 'both',
      publish_enabled: normalizedRole === 'host' || normalizedRole === 'both',
      bot_can_post: permissions.canPost,
      bot_is_admin: permissions.botIsAdmin,
      linked_by_is_admin: permissions.actorIsAdmin,
      last_error: null,
      last_verified_at: new Date()
    };
    if (!source) {
      source = await GiveawaySource.create({
        bot_key: config.key,
        giveaway_id: g._id,
        source_code: makeSourceCode(),
        chat_id: String(chat.id),
        ...values
      });
    } else {
      Object.assign(source, values);
      await source.save();
    }
    invalidateContestCaches(g._id);
    return source;
  }

  async function sourceStartLink(source, action = 'src') {
    const username = await getBotUsername();
    return `https://t.me/${username}?start=${action}_${source.source_code}`;
  }

  async function participantCount(giveawayId, force = false) {
    const key = String(giveawayId);
    const cached = contestCountCache.get(key);
    if (!force && cached && Date.now() - cached.at < CONTEST_COUNT_CACHE_MS) return cached.count;
    const count = await GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: giveawayId, onboarding_status: 'active' });
    contestCountCache.set(key, { at: Date.now(), count });
    return count;
  }

  function invalidateParticipantCount(giveawayId) {
    contestCountCache.delete(String(giveawayId));
  }

  function contestPublicText(g, source = null) {
    return (
      `🎮 ${g.title}

` +
      `🎁 Sovrin: ${g.prize_name || 'Maxsus sovrin'}
` +
      `${g.description ? `✨ ${g.description}
` : ''}` +
      `🏆 G‘oliblar: ${g.winners_count} ta
` +
      `🎯 Aniqlash: ${winnerModeLabel(g.winner_mode)}
` +
      `⭐ Har bir haqiqiy do‘st: +${g.referral_points || 5} ball
` +
      `⏳ Tugashiga: ${formatRemaining(g.ends_at)}
` +
      `👤 Tashkilotchi: ${g.creator_name || g.creator_username || `ID ${g.created_by}`}

` +
      `👇 Homiylarga obuna bo‘ling va “Konkursga qo‘shilish” tugmasini bosing.` +
      (source ? `

📍 ${sourceLabel(source)}` : '')
    );
  }

  async function contestSubscriptionButtonRows(g) {
    const rows = [];
    const seen = new Set();
    const [globalInfo, sponsors] = await Promise.all([
      getGlobalSubscriptionsForGate().catch(() => ({ subs: [] })),
      cachedContestSources(g._id).catch(() => [])
    ]);
    const items = [
      ...(globalInfo.subs || []).map((sub) => ({ label: subLabel(sub), url: subJoinUrl(sub), prefix: '🌐' })),
      ...sponsors.map((source) => ({ label: sourceLabel(source), url: sourceJoinUrl(source), prefix: '📢' }))
    ];
    for (const item of items.slice(0, 12)) {
      const key = `${item.label}|${item.url || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.url) rows.push([Markup.button.url(`${item.prefix} ${item.label}`.slice(0, 60), item.url)]);
    }
    return rows;
  }

  async function contestPublicKeyboard(source, g, count = null) {
    const joined = count == null ? await participantCount(g._id) : count;
    const rows = await contestSubscriptionButtonRows(g);
    rows.push([Markup.button.callback(`🎉 Konkursga qo‘shilish (${joined})`, `gw:j:${source.source_code}`)]);
    rows.push([
      Markup.button.callback('🏆 Reyting', `gw:r:${source.source_code}`),
      Markup.button.callback('📜 Qoidalar', `gw:q:${source.source_code}`)
    ]);
    rows.push([Markup.button.url('👥 Shaxsiy taklif havolam', await sourceStartLink(source, 'invite'))]);
    return Markup.inlineKeyboard(rows);
  }

  async function postContestToSource(source, g) {
    if (!source?.is_active) throw new Error('Ulanish o‘chirilgan');
    if (source.publish_enabled === false) throw new Error('Bu joy uchun e’lon yuborish o‘chirilgan');
    const count = await participantCount(g._id);
    const keyboard = await contestPublicKeyboard(source, g, count);
    const text = contestPublicText(g, source);
    try {
      let sent;
      if (g.prize_photo_file_id) sent = await bot.telegram.sendPhoto(source.chat_id, g.prize_photo_file_id, { caption: text, ...keyboard });
      else sent = await bot.telegram.sendMessage(source.chat_id, text, keyboard);
      await GiveawaySource.updateOne({ _id: source._id }, {
        $inc: { posts_count: 1 },
        $set: {
          last_posted_at: new Date(),
          bot_can_post: true,
          bot_is_admin: true,
          last_error: null,
          last_verified_at: new Date(),
          announcement_message_id: sent.message_id,
          announcement_chat_id: String(source.chat_id),
          announcement_updated_at: new Date()
        }
      });
      source.announcement_message_id = sent.message_id;
      source.announcement_chat_id = String(source.chat_id);
      return sent;
    } catch (error) {
      await GiveawaySource.updateOne({ _id: source._id }, { $set: { last_error: error.description || error.message, bot_can_post: false, last_verified_at: new Date() } }).catch(() => null);
      throw error;
    }
  }

  async function publishContestEverywhere(g) {
    const sources = await GiveawaySource.find({
      bot_key: config.key,
      giveaway_id: g._id,
      is_active: { $ne: false },
      publish_enabled: { $ne: false },
      source_role: { $in: ['host', 'both'] }
    }).sort({ createdAt: 1 });
    if (!sources.length) return { total: 0, success: 0, failed: 0, errors: [] };
    const settled = await Promise.allSettled(sources.map((source) => postContestToSource(source, g)));
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === 'rejected') errors.push(`${sourceLabel(sources[index])}: ${result.reason?.description || result.reason?.message || 'xatolik'}`);
    });
    return { total: sources.length, success: settled.filter((x) => x.status === 'fulfilled').length, failed: errors.length, errors };
  }

  async function refreshContestAnnouncements(g, immediate = false) {
    const key = String(g._id);
    if (!immediate && contestRefreshTimers.has(key)) return;
    const runner = async () => {
      contestRefreshTimers.delete(key);
      const count = await participantCount(g._id, true).catch(() => 0);
      const sources = await GiveawaySource.find({
        bot_key: config.key,
        giveaway_id: g._id,
        is_active: { $ne: false },
        announcement_message_id: { $exists: true, $ne: null },
        source_role: { $in: ['host', 'both'] }
      }).lean();
      await Promise.allSettled(sources.map(async (source) => {
        const keyboard = await contestPublicKeyboard(source, g, count);
        return bot.telegram.editMessageReplyMarkup(
          source.announcement_chat_id || source.chat_id,
          Number(source.announcement_message_id),
          undefined,
          keyboard.reply_markup
        );
      }));
    };
    if (immediate) return runner();
    const timer = setTimeout(() => runner().catch(() => null), 800);
    timer.unref?.();
    contestRefreshTimers.set(key, timer);
  }

  async function checkSingleContestSourceMembership(userId, source) {
    if (!source?.chat_id) return { ok: false, reason: 'source_missing' };
    const cacheKey = `${userId}:clicked:${String(source._id || source.chat_id)}`;
    const cached = contestMembershipCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CONTEST_MEMBER_CACHE_MS) return { ok: cached.ok };
    try {
      const member = await bot.telegram.getChatMember(source.chat_id, userId);
      const ok = !['left', 'kicked'].includes(member.status);
      contestMembershipCache.set(cacheKey, { at: Date.now(), ok });
      return { ok };
    } catch (error) {
      contestMembershipCache.set(cacheKey, { at: Date.now(), ok: false });
      return { ok: false, reason: error.description || error.message };
    }
  }

  async function checkContestSubscriptions(userId, g) {
    const [globalResult, sources] = await Promise.all([
      checkGlobalSubscriptionsForUser(userId, bot.telegram),
      cachedContestSources(g._id)
    ]);
    const missing = [];
    if (!globalResult.ok) {
      const globalItems = (globalResult.subs || []).map((sub) => ({ kind: 'global', label: subLabel(sub), url: subJoinUrl(sub) }));
      if (globalItems.length) missing.push(...globalItems);
      else missing.push({ kind: 'global', label: globalResult.reason === 'factory_token_missing' ? 'Global obuna tekshiruv boti sozlanmagan' : 'Global obunalar yuklanmoqda', url: null });
    }
    if (sources.length) {
      const now = Date.now();
      const checks = await Promise.all(sources.map(async (source) => {
        const cacheKey = `${userId}:${String(g._id)}:${String(source._id || source.chat_id)}`;
        const cached = contestMembershipCache.get(cacheKey);
        if (cached && now - cached.at < CONTEST_MEMBER_CACHE_MS) return { source, ok: cached.ok };
        try {
          const member = await bot.telegram.getChatMember(source.chat_id, userId);
          const ok = !['left', 'kicked'].includes(member.status);
          contestMembershipCache.set(cacheKey, { at: now, ok });
          return { source, ok };
        } catch (error) {
          contestMembershipCache.set(cacheKey, { at: now, ok: false });
          return { source, ok: false, error };
        }
      }));
      for (const item of checks) {
        if (!item.ok) missing.push({ kind: 'contest', label: sourceLabel(item.source), url: sourceJoinUrl(item.source) });
      }
    }
    return { ok: missing.length === 0, missing, sources };
  }

  async function sendContestSubscriptionWarning(ctx, g, result = null) {
    const check = result || await checkContestSubscriptions(ctx.from.id, g);
    const rows = [];
    const seen = new Set();
    for (const item of check.missing) {
      const key = `${item.label}|${item.url || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.url) rows.push([Markup.button.url(`📢 ${item.label}`.slice(0, 60), item.url)]);
      else rows.push([Markup.button.callback(`📢 ${item.label}`.slice(0, 60), 'noop')]);
    }
    rows.push([Markup.button.callback('✅ Obunani tekshirish', `gw:subcheck:${String(g._id)}`)]);
    return ctx.reply(
      `🔒 “${g.title}” konkursida qatnashish uchun quyidagi kanal/guruhlarga obuna bo‘ling.\n\n` +
      `Obuna bo‘lgach “✅ Obunani tekshirish” tugmasini bosing.`,
      Markup.inlineKeyboard(rows)
    );
  }

  function snapshotWinnerRows(g, snapshot) {
    const ids = new Set((g.winner_user_ids || []).map(Number));
    return snapshot.filter((p) => ids.has(Number(p.user_id)));
  }

  async function adminSelectionKeyboard(g, page = 0) {
    const pageSize = 8;
    const selected = new Set((g.winner_user_ids || []).map(Number));
    const total = await GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: g._id, onboarding_status: 'active' });
    const participants = await GiveawayParticipant.find({ bot_key: config.key, giveaway_id: g._id, onboarding_status: 'active' })
      .sort({ referrals_confirmed: -1, score: -1, joined_at: 1 }).skip(page * pageSize).limit(pageSize);
    const rows = participants.map((p) => [Markup.button.callback(
      `${selected.has(Number(p.user_id)) ? '✅' : '👤'} ${(p.full_name || p.telegram_first_name || p.user_id).slice(0, 28)} · ${p.referrals_confirmed || 0}`,
      `gw:pick:${String(g._id)}:${p.user_id}:${page}`
    )]);
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `gw:pickpage:${String(g._id)}:${page - 1}`));
    if ((page + 1) * pageSize < total) nav.push(Markup.button.callback('Keyingi ➡️', `gw:pickpage:${String(g._id)}:${page + 1}`));
    if (nav.length) rows.push(nav);
    rows.push([Markup.button.callback(`🏁 Yakunlash (${selected.size}/${g.winners_count})`, `gw:pickdone:${String(g._id)}`)]);
    return Markup.inlineKeyboard(rows);
  }

  async function extraWinnerKeyboard(g, page = 0) {
    const pageSize = 8;
    const total = await GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: g._id, onboarding_status: 'active' });
    const list = await GiveawayParticipant.find({ bot_key: config.key, giveaway_id: g._id, onboarding_status: 'active' })
      .sort({ referrals_confirmed: -1, score: -1, joined_at: 1 })
      .skip(page * pageSize)
      .limit(pageSize)
      .lean();
    const existing = new Set((g.winner_user_ids || []).map(Number));
    const rows = list.map((p) => [Markup.button.callback(
      `${existing.has(Number(p.user_id)) ? '🏅' : '👤'} ${(p.full_name || p.telegram_first_name || p.user_id).slice(0, 28)} · ${p.referrals_confirmed || 0}`,
      `gw:extra:${String(g._id)}:${p.user_id}:${page}`
    )]);
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `gw:extrapage:${String(g._id)}:${page - 1}`));
    if ((page + 1) * pageSize < total) nav.push(Markup.button.callback('Keyingi ➡️', `gw:extrapage:${String(g._id)}:${page + 1}`));
    if (nav.length) rows.push(nav);
    return Markup.inlineKeyboard(rows);
  }

  async function announceExtraWinner(g, participant) {
    const text =
      `🎁 QO‘SHIMCHA G‘OLIB!\n\n🎮 ${g.title}\n🏅 ${participant.full_name || participant.telegram_first_name || participant.user_id}` +
      `${participant.username ? ` (@${participant.username})` : ''}\n👥 Taklif qilganlar: ${participant.referrals_confirmed || 0}\n⭐ Ball: ${participant.score || 0}\n\n🎉 Tabriklaymiz!`;
    const sources = await GiveawaySource.find({ bot_key: config.key, giveaway_id: g._id, is_active: { $ne: false }, publish_enabled: { $ne: false }, source_role: { $in: ['host', 'both'] } }).lean();
    await Promise.allSettled(sources.map((source) => bot.telegram.sendMessage(source.chat_id, text)));
    await bot.telegram.sendMessage(participant.user_id, `🎉 Tabriklaymiz! Siz “${g.title}” konkursida qo‘shimcha g‘olib sifatida tanlandingiz.`).catch(() => null);
  }

  async function publishContestResultEverywhere(g, snapshot) {
    if (!g || g.public_result_sent_at) return;
    const winners = snapshotWinnerRows(g, snapshot);
    if (!winners.length) return;
    const text =
      `🏁 KONKURS YAKUNLANDI!\n\n🎮 ${g.title}\n🎁 ${g.prize_name || '—'}\n🎯 ${winnerModeLabel(g.winner_mode)}\n\n` +
      `🏅 G‘OLIBLAR:\n${winners.map((p, i) => `${i + 1}. ${p.full_name || p.user_id}${p.username ? ` (@${p.username})` : ''} — 👥 ${p.referrals_confirmed || 0}`).join('\n')}\n\n` +
      `🎉 G‘oliblarni tabriklaymiz!`;
    const sources = await GiveawaySource.find({
      bot_key: config.key,
      giveaway_id: g._id,
      is_active: { $ne: false },
      publish_enabled: { $ne: false },
      source_role: { $in: ['host', 'both'] }
    }).lean();
    const settled = await Promise.allSettled(sources.map((source) => bot.telegram.sendMessage(source.chat_id, text)));
    if (settled.some((r) => r.status === 'fulfilled')) {
      await Giveaway.updateOne({ _id: g._id }, { $set: { public_result_sent_at: new Date() } }).catch(() => null);
      g.public_result_sent_at = new Date();
    }
  }

  async function notifyManagersResult(g, snapshot, finalAdminSelection = false) {
    const winners = snapshotWinnerRows(g, snapshot);
    const winnerText = winners.length
      ? winners.map((p, i) => `${i + 1}. ${p.full_name || p.user_id}${p.username ? ` (@${p.username})` : ''} — ${p.referrals_confirmed || 0} do‘st / ${p.score || 0} ball`).join('\n')
      : (g.winner_mode === 'admin' ? '🧑‍⚖️ Tashkilotchi tanlovi kutilmoqda.' : 'Qatnashchi yo‘q.');
    const total = await GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: g._id, onboarding_status: 'active' });
    const text =
      `⏰ KONKURS VAQTI TUGADI\n\n🎁 ${g.title}\n🏆 ${g.prize_name || '—'}\n🎯 ${winnerModeLabel(g.winner_mode)}\n` +
      `👥 Qatnashchi: ${total}\n🧊 ${formatDate(g.frozen_at || new Date())}\n\n🏅 G‘OLIBLAR:\n${winnerText}\n\n📊 TOP 10:\n${rankingText(snapshot.slice(0, 10))}`;
    const recipients = Array.from(new Set([Number(g.created_by), ...(g.manager_ids || []).map(Number), ...adminIds.map(Number)].filter(Boolean)));
    for (const id of recipients) {
      try {
        if (g.winner_mode === 'admin' && !finalAdminSelection && winners.length < Number(g.winners_count || 1)) {
          await bot.telegram.sendMessage(id, text, await adminSelectionKeyboard(g, 0));
        } else await bot.telegram.sendMessage(id, text);
      } catch (_) {}
    }
  }

  async function freezeGiveaway(g, force = false) {
    if (!g) return null;
    if (g.status !== 'active') return g;
    if (!force && new Date(g.ends_at).getTime() > Date.now()) return g;
    const participants = await GiveawayParticipant.find({ bot_key: config.key, giveaway_id: g._id, onboarding_status: 'active' })
      .sort({ referrals_confirmed: -1, score: -1, joined_at: 1, createdAt: 1 }).limit(5000);
    const snapshot = participants.map((p, index) => ({
      rank: index + 1,
      user_id: p.user_id,
      username: p.username || null,
      full_name: p.full_name || p.telegram_first_name || '',
      score: p.score || 0,
      referrals_confirmed: p.referrals_confirmed || 0,
      source_chat_title: p.source_chat_title || null,
      source_chat_id: p.source_chat_id || null
    }));
    const winnerCount = Math.max(1, Number(g.winners_count || 1));
    let winnerIds = [];
    if (g.winner_mode === 'random') winnerIds = shuffled(snapshot).slice(0, winnerCount).map((p) => p.user_id);
    else if (g.winner_mode === 'top_referrals') winnerIds = snapshot.slice(0, winnerCount).map((p) => p.user_id);
    const now = new Date();
    const updated = await Giveaway.findOneAndUpdate({ _id: g._id, bot_key: config.key, status: 'active' }, {
      $set: { status: 'frozen', frozen_at: now, drawn_at: g.winner_mode === 'admin' ? null : now, result_snapshot: snapshot, winner_user_ids: winnerIds }
    }, { new: true });
    const frozen = updated || await Giveaway.findById(g._id);
    if (frozen) {
      const claimed = await Giveaway.findOneAndUpdate({ _id: frozen._id, $or: [{ result_sent_at: null }, { result_sent_at: { $exists: false } }] }, { $set: { result_sent_at: new Date() } }, { new: true });
      if (claimed) {
        await notifyManagersResult(claimed, snapshot);
        if (claimed.winner_mode !== 'admin') await publishContestResultEverywhere(claimed, snapshot);
      }
    }
    return frozen;
  }

  async function ensureGiveawayState(g) {
    if (!g) return null;
    if (!g.ends_at || !Number.isFinite(new Date(g.ends_at).getTime())) {
      const start = g.starts_at || g.createdAt || new Date();
      g.starts_at = start;
      g.duration_seconds = Number(g.duration_seconds || 7 * 86400);
      g.ends_at = new Date(new Date(start).getTime() + g.duration_seconds * 1000);
      g.referral_points = Math.max(1, Number(g.referral_points || 5));
      await g.save();
    }
    if (g.status === 'active' && new Date(g.ends_at).getTime() <= Date.now()) return freezeGiveaway(g);
    return g;
  }

  async function showManagerHome(ctx, g = null) {
    const contest = await ensureGiveawayState(g || await managerGiveaway(ctx));
    if (!contest) return ctx.reply('📭 Sizda hali konkurs yo‘q. “🎮 Konkurs yaratish” tugmasini bosing.', roleKeyboard(ctx.from.id));
    ctx.session.giveawayId = String(contest._id);
    const [participants, sources] = await Promise.all([
      GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: contest._id, onboarding_status: 'active' }),
      GiveawaySource.countDocuments({ bot_key: config.key, giveaway_id: contest._id, is_active: { $ne: false } })
    ]);
    return ctx.reply(
      `⚙️ KONKURS BOSHQARUVI\n\n🎮 ${contest.title}\n🎁 ${contest.prize_name || '—'}\n📌 ${contest.status}\n` +
      `👥 Qatnashchi: ${participants}\n📢 Ulangan kanal/guruh: ${sources}\n⏳ ${contest.status === 'active' ? formatRemaining(contest.ends_at) : 'yakunlangan'}\n\n` +
      `Siz faqat o‘zingiz yaratgan konkursni boshqarasiz. Bot egasi barcha konkurslarni ko‘ra oladi.`,
      roleKeyboard(ctx.from.id)
    );
  }

  async function showContest(ctx, g, manager = false) {
    const contest = await ensureGiveawayState(g);
    if (!contest) return ctx.reply('📭 Konkurs topilmadi.');
    if (contest.status !== 'active') return showResults(ctx, contest, manager);
    const count = await GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: contest._id, onboarding_status: 'active' });
    const text =
      `🎮 ${contest.title}\n\n🎁 Sovrin: ${contest.prize_name || '—'}\n${contest.description ? `✨ ${contest.description}\n` : ''}` +
      `👥 Qatnashchilar: ${count}\n🏆 G‘oliblar: ${contest.winners_count}\n🎯 ${winnerModeLabel(contest.winner_mode)}\n` +
      `⭐ Referral: +${contest.referral_points || 5}\n⏳ ${formatRemaining(contest.ends_at)}\n📅 ${formatDate(contest.ends_at)}`;
    const keyboard = manager ? roleKeyboard(ctx.from.id) : userKeyboard();
    if (contest.prize_photo_file_id) {
      try { return await ctx.replyWithPhoto(contest.prize_photo_file_id, { caption: text, ...keyboard }); } catch (_) {}
    }
    return ctx.reply(text, keyboard);
  }

  async function showResults(ctx, g, manager = false) {
    if (!g) return ctx.reply('📭 Konkurs topilmadi.');
    const ready = g.status === 'active' ? await freezeGiveaway(g, true) : g;
    const list = Array.isArray(ready.result_snapshot) && ready.result_snapshot.length
      ? ready.result_snapshot.slice(0, 10)
      : (await rankingRows(ready._id, 10)).map((p, i) => ({ ...p.toObject(), rank: i + 1 }));
    const winners = snapshotWinnerRows(ready, Array.isArray(ready.result_snapshot) ? ready.result_snapshot : list);
    return ctx.reply(
      `🏁 KONKURS NATIJASI\n\n🎁 ${ready.title}\n🎯 ${winnerModeLabel(ready.winner_mode)}\n\n` +
      `🏅 G‘OLIBLAR:\n${winners.length ? winners.map((p, i) => `${i + 1}. ${p.full_name || p.user_id} — 👥 ${p.referrals_confirmed || 0} / ⭐ ${p.score || 0}`).join('\n') : 'Hali tanlanmagan'}\n\n` +
      `📊 TOP 10:\n${rankingText(list)}`,
      manager ? roleKeyboard(ctx.from.id) : userKeyboard()
    );
  }

  async function ensureParticipant(ctx, g, referralId = null, sourceCode = null) {
    let participant = await participantFor(g._id, ctx.from.id);
    let source = null;
    if (sourceCode) source = await GiveawaySource.findOne({ bot_key: config.key, giveaway_id: g._id, source_code: sourceCode, is_active: { $ne: false } });
    if (participant) {
      participant.username = ctx.from.username || null;
      participant.telegram_first_name = ctx.from.first_name || participant.telegram_first_name || null;
      participant.telegram_last_name = ctx.from.last_name || null;
      participant.last_seen_at = new Date();
      if (!participant.onboarding_status) participant.onboarding_status = 'active';
      if (source && !participant.source_code) {
        participant.source_code = source.source_code;
        participant.source_chat_id = source.chat_id;
        participant.source_chat_title = source.chat_title;
        participant.source_chat_username = source.chat_username;
        participant.source_chat_type = source.chat_type;
        participant.source_first_seen_at = new Date();
        await GiveawaySource.updateOne({ _id: source._id }, { $inc: { clicks_count: 1 } });
      }
      await participant.save();
      return participant;
    }
    let validReferrer = null;
    if (referralId && Number(referralId) !== Number(ctx.from.id)) {
      validReferrer = await GiveawayParticipant.findOne({ bot_key: config.key, giveaway_id: g._id, user_id: Number(referralId), onboarding_status: 'active' });
    }
    if (source) await GiveawaySource.updateOne({ _id: source._id }, { $inc: { clicks_count: 1 } });
    try {
      participant = await GiveawayParticipant.create({
        bot_key: config.key,
        giveaway_id: g._id,
        user_id: ctx.from.id,
        username: ctx.from.username || null,
        telegram_first_name: ctx.from.first_name || null,
        telegram_last_name: ctx.from.last_name || null,
        referrer_user_id: validReferrer?.user_id || null,
        source_code: source?.source_code || null,
        source_chat_id: source?.chat_id || null,
        source_chat_title: source?.chat_title || null,
        source_chat_username: source?.chat_username || null,
        source_chat_type: source?.chat_type || null,
        source_first_seen_at: source ? new Date() : null,
        onboarding_status: 'pending_name',
        last_seen_at: new Date()
      });
      if (validReferrer) GiveawayParticipant.updateOne({ _id: validReferrer._id }, { $inc: { referral_visits: 1 } }).catch(() => null);
      return participant;
    } catch (error) {
      if (error.code === 11000) return participantFor(g._id, ctx.from.id);
      throw error;
    }
  }

  async function askName(ctx, participant) {
    ctx.session.mode = 'gw_wait_name';
    ctx.session.participantGiveawayId = String(participant.giveaway_id);
    return ctx.reply('👋 1-bosqich\n\nIsm va familiyangizni yozib yuboring.\nMasalan: Abdurahmon Qoryog‘diyev');
  }

  async function sendCaptcha(ctx, participant) {
    // Eski DB yozuvlarida pending_captcha qolgan bo‘lsa, captcha ko‘rsatmasdan davom ettiramiz.
    const g = await getGiveawayById(participant.giveaway_id);
    if (!g) return ctx.reply('📭 Konkurs topilmadi.');
    if (!participant.full_name) {
      participant.full_name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || `User ${participant.user_id}`;
    }
    return activateParticipant(ctx, g, participant);
  }

  async function rewardReferrer(g, participant) {
    if (!participant.referrer_user_id || participant.referrer_awarded) return;
    const referrer = await GiveawayParticipant.findOne({ bot_key: config.key, giveaway_id: g._id, user_id: participant.referrer_user_id, onboarding_status: 'active' });
    if (!referrer || Number(referrer.user_id) === Number(participant.user_id)) return;
    const points = Math.max(1, Number(g.referral_points || 5));
    await GiveawayParticipant.updateOne({ _id: referrer._id }, { $inc: { score: points, referrals_confirmed: 1 } });
    participant.referrer_awarded = true;
    await participant.save();
    bot.telegram.sendMessage(referrer.user_id, `🎉 Taklif qilgan do‘stingiz konkursga qo‘shildi!\n⭐ +${points} ball`).catch(() => null);
  }

  async function activateParticipant(ctx, g, participant, options = {}) {
    const wasActive = participant.onboarding_status === 'active';
    participant.onboarding_status = 'active';
    participant.full_name = participant.full_name || [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || `User ${participant.user_id}`;
    participant.captcha_passed_at = null;
    participant.joined_at = participant.joined_at || new Date();
    participant.captcha_answer = null;
    participant.captcha_options = [];
    if (participant.source_code && !participant.source_join_counted) {
      participant.source_join_counted = true;
      await GiveawaySource.updateOne({ bot_key: config.key, giveaway_id: g._id, source_code: participant.source_code }, { $inc: { joins_count: 1 } }).catch(() => null);
    }
    await participant.save();
    if (!wasActive) await rewardReferrer(g, participant);
    ctx.session.mode = null;
    ctx.session.participantGiveawayId = String(g._id);
    if (!wasActive) {
      invalidateParticipantCount(g._id);
      refreshContestAnnouncements(g).catch(() => null);
    }
    if (options.silent) return participant;
    return ctx.reply(
      `🎊 Tabriklaymiz, ${participant.full_name}!

✅ “${g.title}” konkursida muvaffaqiyatli qatnashyapsiz.
` +
      `⭐ Ball: ${participant.score || 0}
⏳ ${formatRemaining(g.ends_at)}

📜 ${g.rules}`,
      userKeyboard()
    );
  }

  async function continueOnboarding(ctx, g, meta = null) {
    const contest = await ensureGiveawayState(g);
    if (!contest) return showPublicHome(ctx);
    if (contest.status !== 'active') return showResults(ctx, contest, false);
    const context = meta || extractStartContext(ctx);
    ctx.session.participantGiveawayId = String(contest._id);
    const participant = await ensureParticipant(ctx, contest, context.referralId, context.sourceCode);
    const subscription = await checkContestSubscriptions(ctx.from.id, contest);
    if (context.sourceCode) {
      const clickedSource = await GiveawaySource.findOne({ bot_key: config.key, giveaway_id: contest._id, source_code: context.sourceCode, is_active: { $ne: false } }).lean();
      if (clickedSource) {
        const sourceCheck = await checkSingleContestSourceMembership(ctx.from.id, clickedSource);
        if (!sourceCheck.ok) {
          subscription.ok = false;
          subscription.missing = [{ kind: 'source', label: sourceLabel(clickedSource), url: sourceJoinUrl(clickedSource) }, ...(subscription.missing || [])];
        }
      }
    }
    if (!subscription.ok && !utils.isAdmin(ctx.from.id)) return sendContestSubscriptionWarning(ctx, contest, subscription);
    if (context.action === 'invite' && participant.onboarding_status === 'active') return showInvite(ctx, contest);
    if (participant.onboarding_status === 'active') {
      if (context.action === 'rating') return showRating(ctx, contest);
      if (context.action === 'rules') return showRules(ctx, contest);
      return showContest(ctx, contest, false);
    }
    if (participant.full_name || participant.onboarding_status === 'pending_captcha') {
      return activateParticipant(ctx, contest, participant);
    }
    return askName(ctx, participant);
  }

  async function showRating(ctx, g = null) {
    const contest = await ensureGiveawayState(g || await participantGiveaway(ctx));
    if (!contest) return showPublicHome(ctx);
    const participant = await participantFor(contest._id, ctx.from.id);
    if (!participant || participant.onboarding_status !== 'active') return continueOnboarding(ctx, contest);
    const [top, rank] = await Promise.all([rankingRows(contest._id, 10), userRank(contest._id, participant)]);
    return ctx.reply(`🏆 TOP 10\n\n${rankingText(top)}\n\n👤 Siz: ${rank || '—'}-o‘rin\n⭐ ${participant.score || 0} ball\n⏳ ${contest.status === 'active' ? formatRemaining(contest.ends_at) : 'yakunlangan'}`, userKeyboard());
  }

  async function ensureGroupInviteLink(contest, participant) {
    const host = await GiveawaySource.findOne({
      bot_key: config.key,
      giveaway_id: contest._id,
      is_active: { $ne: false },
      chat_type: { $in: ['group', 'supergroup'] },
      $or: [
        { source_role: { $in: ['host', 'both'] } },
        { source_role: { $exists: false } }
      ]
    }).sort({ createdAt: 1 }).lean();
    if (!host) return null;
    if (participant.group_invite_link && String(participant.group_invite_chat_id) === String(host.chat_id)) {
      return { url: participant.group_invite_link, source: host };
    }
    try {
      const invite = await bot.telegram.createChatInviteLink(host.chat_id, {
        name: `Konkurs ${String(contest._id).slice(-6)} ref ${participant.user_id}`
      });
      participant.group_invite_link = invite.invite_link;
      participant.group_invite_chat_id = String(host.chat_id);
      participant.group_invite_created_at = new Date();
      await participant.save();
      return { url: invite.invite_link, source: host };
    } catch (_) {
      return null;
    }
  }

  async function showInvite(ctx, g = null) {
    const contest = await ensureGiveawayState(g || await participantGiveaway(ctx));
    if (!contest || contest.status !== 'active') return ctx.reply('⏰ Konkurs yakunlangan.', userKeyboard());
    const participant = await participantFor(contest._id, ctx.from.id);
    if (!participant || participant.onboarding_status !== 'active') return continueOnboarding(ctx, contest);
    GiveawayParticipant.updateOne({ _id: participant._id }, { $inc: { share_actions: 1 } }).catch(() => null);
    const username = await getBotUsername();
    const botLink = `https://t.me/${username}?start=r_${String(contest._id)}_${ctx.from.id}`;
    // Xavfsizlik uchun maxfiy host guruhga avtomatik invite link tarqatilmaydi.
    // Referral faqat bot start-link orqali hisoblanadi, homiy kanal/guruhlar esa faqat obuna tekshiruv uchun ishlaydi.
    const groupInvite = null;
    const preferred = botLink;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(preferred)}&text=${encodeURIComponent(`🎁 ${contest.title}
Konkursda qatnashing!`)}`;
    return ctx.reply(
      `👥 DO‘STLARNI TAKLIF QILING

Har bir haqiqiy do‘st uchun ⭐ +${contest.referral_points || 5} ball.

` +
      `${groupInvite ? `🔗 Guruhga shaxsiy invite:
${groupInvite.url}

` : ''}` +
      `🤖 Bot referral havolasi:
${botLink}

✅ ${participant.referrals_confirmed || 0} do‘st
⭐ ${participant.score || 0} ball`,
      Markup.inlineKeyboard([[Markup.button.url('📤 Telegramda ulashish', shareUrl)], [Markup.button.callback('🏆 Reyting', `gw:rating:${String(contest._id)}`)]])
    );
  }

  async function showProfile(ctx, g = null) {
    const contest = await ensureGiveawayState(g || await participantGiveaway(ctx));
    if (!contest) return showPublicHome(ctx);
    const participant = await participantFor(contest._id, ctx.from.id);
    if (!participant || participant.onboarding_status !== 'active') return continueOnboarding(ctx, contest);
    const rank = await userRank(contest._id, participant);
    return ctx.reply(
      `👤 PROFIL\n\n🪪 ${participant.full_name || '—'}\n🏆 ${rank || '—'}-o‘rin\n⭐ ${participant.score || 0} ball\n` +
      `👀 Kirganlar: ${participant.referral_visits || 0}\n✅ Hisoblangan: ${participant.referrals_confirmed || 0}\n📍 ${participant.source_chat_title || 'To‘g‘ridan-to‘g‘ri'}\n⏳ ${contest.status === 'active' ? formatRemaining(contest.ends_at) : 'yakunlangan'}`,
      userKeyboard()
    );
  }

  async function showRules(ctx, g = null) {
    const contest = await ensureGiveawayState(g || await participantGiveaway(ctx));
    if (!contest) return showPublicHome(ctx);
    return ctx.reply(`📜 ${contest.title} QOIDALARI\n\n${contest.rules}\n\n🎁 ${contest.prize_name || '—'}\n🏆 ${contest.winners_count} ta\n⏳ ${contest.status === 'active' ? formatRemaining(contest.ends_at) : 'yakunlangan'}`, userKeyboard());
  }

  async function showPublicHome(ctx) {
    const myCount = await Giveaway.countDocuments({ bot_key: config.key, created_by: Number(ctx.from.id) });
    return ctx.reply(
      `🎮 ${config.title}\n\nBu ommaviy konkurs platformasi. Har bir foydalanuvchi o‘z kanal/guruhi uchun mustaqil konkurs yaratishi va faqat o‘z konkursini boshqarishi mumkin.\n\n` +
      `📂 Sizning konkurslaringiz: ${myCount} ta\n🤖 Bot egasi barcha konkurslar ustidan to‘liq nazoratga ega.`,
      myCount || utils.isAdmin(ctx.from.id) ? roleKeyboard(ctx.from.id) : publicKeyboard()
    );
  }

  async function listMyContests(ctx, allForAdmin = false) {
    const q = { bot_key: config.key };
    if (!(allForAdmin && utils.isAdmin(ctx.from.id))) q.created_by = Number(ctx.from.id);
    const list = await Giveaway.find(q).sort({ createdAt: -1 }).limit(20);
    if (!list.length) return ctx.reply('📭 Hali konkurs yo‘q.', publicKeyboard());
    const rows = list.map((g) => [Markup.button.callback(`${g.status === 'active' ? '🟢' : g.status === 'frozen' ? '🧊' : '⚪'} ${g.title}`.slice(0, 60), `gw:manage:${String(g._id)}`)]);
    return ctx.reply(allForAdmin && utils.isAdmin(ctx.from.id) ? '📂 Barcha konkurslar:' : '📂 Sizning konkurslaringiz:', Markup.inlineKeyboard(rows));
  }

  async function listPublicContests(ctx) {
    const list = await Giveaway.find({ bot_key: config.key, status: 'active', ends_at: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(15);
    if (!list.length) return ctx.reply('📭 Hozir faol konkurs yo‘q.', publicKeyboard());
    const username = await getBotUsername();
    const rows = list.map((g) => [Markup.button.url(`🎮 ${g.title}`.slice(0, 60), `https://t.me/${username}?start=g_${String(g._id)}`)]);
    return ctx.reply('🔎 Faol konkurslar:', Markup.inlineKeyboard(rows));
  }

  async function listConnectedChats(ctx, g, removeMode = false) {
    const sources = await GiveawaySource.find({ bot_key: config.key, giveaway_id: g._id, is_active: { $ne: false } }).sort({ createdAt: 1 });
    if (!sources.length) return ctx.reply('📭 Bu konkursga kanal/guruh ulanmagan.', roleKeyboard(ctx.from.id));
    const rows = sources.map((source) => [Markup.button.callback(
      `${removeMode ? '🗑' : source.bot_can_post ? '✅' : '⚠️'} ${sourceRoleLabel(source)} · ${sourceLabel(source)}`.slice(0, 60),
      removeMode ? `gw:srcdel:${String(source._id)}` : `gw:srcinfo:${String(source._id)}`
    )]);
    return ctx.reply(
      `${removeMode ? '🗑 O‘chiriladigan joyni tanlang' : `📋 “${g.title}” uchun ulangan joylar`}\n\nID o‘rniga Telegram’dan olingan haqiqiy nom ko‘rsatiladi.`,
      Markup.inlineKeyboard(rows)
    );
  }

  async function showSourceStats(ctx, g) {
    const sources = await GiveawaySource.find({ bot_key: config.key, giveaway_id: g._id }).sort({ joins_count: -1, clicks_count: -1 });
    const direct = await GiveawayParticipant.countDocuments({ bot_key: config.key, giveaway_id: g._id, source_code: null, onboarding_status: 'active' });
    if (!sources.length) return ctx.reply(`📍 Hali manba yo‘q.\nTo‘g‘ridan-to‘g‘ri: ${direct}`);
    return ctx.reply(
      `📍 MANBA STATISTIKASI — ${g.title}\n\n` +
      sources.map((s, i) => `${i + 1}. ${sourceLabel(s)}\n   👆 ${s.clicks_count || 0} klik · ✅ ${s.joins_count || 0} qo‘shildi · 📣 ${s.posts_count || 0} post${s.last_error ? `\n   ⚠️ ${s.last_error}` : ''}`).join('\n\n') +
      `\n\n🚪 To‘g‘ridan-to‘g‘ri: ${direct}`,
      roleKeyboard(ctx.from.id)
    );
  }

  async function finalizeGiveaway(ctx, photoFileId = null) {
    const d = ctx.session.draft || {};
    if (!d.title || !d.prize_name || !d.winners_count || !d.duration_seconds || !d.rules) {
      resetFlow(ctx);
      return ctx.reply('❌ Ma’lumotlar to‘liq emas. Qaytadan yarating.', roleKeyboard(ctx.from.id));
    }
    const now = new Date();
    await Giveaway.updateMany({ bot_key: config.key, created_by: Number(ctx.from.id), status: 'active' }, { $set: { status: 'closed', closed_at: now } });
    const g = await Giveaway.create({
      bot_key: config.key,
      title: d.title,
      prize_name: d.prize_name,
      description: d.description || '',
      rules: d.rules,
      prize_photo_file_id: photoFileId || null,
      winners_count: Number(d.winners_count),
      winner_mode: d.winner_mode || 'top_referrals',
      referral_points: Math.max(1, Number(d.referral_points || 5)),
      starts_at: now,
      ends_at: new Date(now.getTime() + Number(d.duration_seconds) * 1000),
      duration_seconds: Number(d.duration_seconds),
      status: 'active',
      created_by: Number(ctx.from.id),
      creator_username: ctx.from.username ? `@${ctx.from.username}` : null,
      creator_name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      manager_ids: [Number(ctx.from.id)]
    });
    resetFlow(ctx, true);
    ctx.session.giveawayId = String(g._id);
    await ctx.reply(
      `✅ KONKURS YARATILDI!\n\n🎮 ${g.title}\n🎁 ${g.prize_name}\n🏆 ${g.winners_count} ta\n⏳ ${formatDate(g.ends_at)}\n\n` +
      `Endi “➕ Kanal/guruh ulash” orqali aynan shu konkursga joylarni ulang, keyin “📣 E’lonlarni yuborish”ni bosing.`,
      roleKeyboard(ctx.from.id)
    );
    return showManagerHome(ctx, g);
  }

  bot.start(async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    saveUserFast(ctx, true);
    const meta = extractStartContext(ctx);
    if (meta.payload) {
      const resolved = await resolveGiveawayFromStart(meta, ctx);
      if (resolved.giveaway) return continueOnboarding(ctx, resolved.giveaway, meta);
    }
    const bypass = GLOBAL_ADMIN_IDS.includes(Number(ctx.from.id));
    if (!bypass) {
      const globalResult = await checkGlobalSubscriptionsForUser(ctx.from.id, bot.telegram);
      if (!globalResult.ok) return sendCreatedBotGlobalSubscriptionWarning(ctx, globalResult);
    }
    return showPublicHome(ctx);
  });

  bot.action('noop', async (ctx) => {
    return ctx.answerCbQuery('Bu kanal uchun ochiq havola topilmadi. Konkurs tashkilotchisi linkni qayta ulashi kerak.', { show_alert: true }).catch(() => null);
  });

  bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery('Tekshirilmoqda...').catch(() => null);
    const bypass = GLOBAL_ADMIN_IDS.includes(Number(ctx.from.id));
    if (!bypass) {
      const result = await checkGlobalSubscriptionsForUser(ctx.from.id, bot.telegram);
      if (!result.ok) return sendCreatedBotGlobalSubscriptionWarning(ctx, result);
    }
    try { await ctx.deleteMessage(); } catch (_) {}
    return showPublicHome(ctx);
  });

  bot.hears([MANAGER_BUTTONS.create, '🎮 Yangi konkurs', '🎁 Konkurs yaratish'], async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    saveUserFast(ctx);
    resetFlow(ctx);
    ctx.session.mode = 'gw_create_title';
    return ctx.reply('🎮 1/8 — Konkurs nomini yuboring.\n\nMisol: SUPER TEXNO KONKURS\n\n❌ /cancel');
  });

  bot.hears(MANAGER_BUTTONS.mine, (ctx) => listMyContests(ctx, utils.isAdmin(ctx.from.id)));
  bot.hears('🔎 Faol konkurslar', listPublicContests);
  bot.hears('ℹ️ Qanday ishlaydi?', (ctx) => ctx.reply('1️⃣ Konkurs yarating.\n2️⃣ Botni o‘z kanal/guruhingizga admin qiling.\n3️⃣ Kanal/guruhni konkursga ulang.\n4️⃣ E’lonlarni yuboring.\n5️⃣ Natijani kuzating.\n\nHar bir user faqat o‘z konkursini boshqaradi.', publicKeyboard()));
  bot.hears('👤 Ishtirokchi rejimi', showPublicHome);

  bot.hears(MANAGER_BUTTONS.active, async (ctx) => {
    const g = await managerGiveaway(ctx, ['active', 'frozen', 'closed']);
    if (!g) return showPublicHome(ctx);
    return showManagerHome(ctx, g);
  });

  bot.hears(MANAGER_BUTTONS.results, async (ctx) => {
    const g = await managerGiveaway(ctx, ['active', 'frozen', 'closed']);
    if (!g) return ctx.reply('📭 Konkurs yo‘q.');
    if (g.status === 'active' && new Date(g.ends_at) > new Date()) {
      const top = await rankingRows(g._id, 10);
      return ctx.reply(`📊 HOZIRGI NATIJA\n\n${rankingText(top)}\n\n⏳ ${formatRemaining(g.ends_at)}`, roleKeyboard(ctx.from.id));
    }
    return showResults(ctx, g, true);
  });

  bot.hears(MANAGER_BUTTONS.finish, async (ctx) => {
    const g = await managerGiveaway(ctx, ['active']);
    if (!g) return ctx.reply('📭 Aktiv konkurs yo‘q.');
    const frozen = await freezeGiveaway(g, true);
    return ctx.reply(`✅ “${frozen.title}” natijasi muzlatildi.`, roleKeyboard(ctx.from.id));
  });

  bot.hears(MANAGER_BUTTONS.extraWinner, async (ctx) => {
    const g = await managerGiveaway(ctx, ['frozen', 'closed']);
    if (!g) return ctx.reply('📭 Qo‘shimcha g‘olib tanlash uchun konkursni avval yakunlang yoki vaqt tugashini kuting.');
    return ctx.reply(`➕ “${g.title}” uchun qo‘shimcha g‘olibni tanlang:`, await extraWinnerKeyboard(g, 0));
  });

  bot.hears(MANAGER_BUTTONS.participants, async (ctx) => {
    const g = await managerGiveaway(ctx);
    if (!g) return ctx.reply('📭 Konkurs yo‘q.');
    const list = await GiveawayParticipant.find({ bot_key: config.key, giveaway_id: g._id }).sort({ referrals_confirmed: -1, score: -1 }).limit(50);
    if (!list.length) return ctx.reply('📭 Qatnashchilar yo‘q.');
    return ctx.reply(`👥 ${g.title}\n\n${list.map((p, i) => `${i + 1}. ${p.full_name || p.telegram_first_name || 'Noma’lum'}${p.username ? ` @${p.username}` : ''}\n   👥 ${p.referrals_confirmed || 0} · ⭐ ${p.score || 0} · ${p.onboarding_status}`).join('\n\n')}`, roleKeyboard(ctx.from.id));
  });

  async function beginConnect(ctx, role) {
    const g = await managerGiveaway(ctx, ['active']);
    if (!g) return ctx.reply('📭 Avval aktiv konkurs yarating.');
    ctx.session.mode = 'gw_connect_chat';
    ctx.session.connectRole = role;
    ctx.session.giveawayId = String(g._id);
    const roleText = role === 'sponsor' ? 'faqat obuna tekshiriladigan HAMKOR/HOMIY kanal-guruh' : 'eʼlon chiqadigan TARG‘IBOT joyi yoki asosiy konkurs guruhi';
    return ctx.reply(
      `➕ “${g.title}” uchun ${roleText} ulang.

` +
      `1. Konkurs botini kanal/guruhga admin qiling.
2. O‘zingiz ham u yerda admin bo‘ling.
3. @username yoki -100... ID yuboring.

` +
      `Private joy uchun: -1001234567890 | https://t.me/+invite

MUHIM:
• 🏠 Konkurs joyi — eʼlon yuboriladi.
• 🤝 Homiy — eʼlon yuborilmaydi, faqat obuna tekshiriladi.
• Maxfiy guruh invite-linklari foydalanuvchilarga tarqatilmaydi.

Bot haqiqiy nomni Telegram’dan o‘zi oladi.`
    );
  }

  bot.hears(MANAGER_BUTTONS.connectHost, (ctx) => beginConnect(ctx, 'host'));
  bot.hears(MANAGER_BUTTONS.connectSponsor, (ctx) => beginConnect(ctx, 'sponsor'));

  bot.hears(MANAGER_BUTTONS.chats, async (ctx) => {
    const g = await managerGiveaway(ctx);
    if (!g) return ctx.reply('📭 Konkurs yo‘q.');
    return listConnectedChats(ctx, g, false);
  });

  bot.hears(MANAGER_BUTTONS.remove, async (ctx) => {
    const g = await managerGiveaway(ctx);
    if (!g) return ctx.reply('📭 Konkurs yo‘q.');
    return listConnectedChats(ctx, g, true);
  });

  bot.hears(MANAGER_BUTTONS.publish, async (ctx) => {
    const g = await managerGiveaway(ctx, ['active']);
    if (!g) return ctx.reply('📭 Aktiv konkurs yo‘q.');
    const result = await publishContestEverywhere(g);
    if (!result.total) return ctx.reply('📭 Eʼlon yuboriladigan targ‘ibot joyi ulanmagan. “🏠 Konkurs joyini ulash” orqali eʼlon chiqadigan guruh/kanalni ulang. “🤝 Homiy kanal/guruh” esa faqat obuna tekshiruv uchun ishlaydi.');
    return ctx.reply(
      `📣 E’LON YUBORISH YAKUNLANDI\n\n✅ ${result.success} ta\n❌ ${result.failed} ta\n` +
      `${result.errors.length ? `\nXatolar:\n${result.errors.slice(0, 10).join('\n')}` : ''}`,
      roleKeyboard(ctx.from.id)
    );
  });

  bot.hears(MANAGER_BUTTONS.sources, async (ctx) => {
    const g = await managerGiveaway(ctx);
    if (!g) return ctx.reply('📭 Konkurs yo‘q.');
    return showSourceStats(ctx, g);
  });

  bot.hears('📊 Umumiy statistika', async (ctx) => {
    if (!utils.isAdmin(ctx.from.id)) return;
    const [users, contests, active, participants, managers, sources] = await Promise.all([
      User.countDocuments({ bot_key: config.key }),
      Giveaway.countDocuments({ bot_key: config.key }),
      Giveaway.countDocuments({ bot_key: config.key, status: 'active' }),
      GiveawayParticipant.countDocuments({ bot_key: config.key, onboarding_status: 'active' }),
      Giveaway.distinct('created_by', { bot_key: config.key }),
      GiveawaySource.countDocuments({ bot_key: config.key, is_active: { $ne: false } })
    ]);
    return ctx.reply(`📊 UMUMIY STATISTIKA\n\n👥 Userlar: ${users}\n👨‍💼 Konkurs boshqaruvchilari: ${managers.length}\n🎮 Konkurslar: ${contests}\n🟢 Aktiv: ${active}\n✅ Qatnashchilar: ${participants}\n📢 Ulangan joylar: ${sources}`, fullAdminKeyboard());
  });


  async function contestForChat(chatId) {
    const sources = await GiveawaySource.find({
      bot_key: config.key,
      chat_id: String(chatId),
      is_active: { $ne: false },
      $or: [
        { source_role: { $in: ['host', 'both'] } },
        { source_role: { $exists: false } }
      ]
    }).sort({ createdAt: -1 }).limit(10).lean();
    for (const source of sources) {
      const g = await ensureGiveawayState(await getGiveawayById(source.giveaway_id));
      if (g && g.status === 'active') return { giveaway: g, source };
    }
    return { giveaway: null, source: null };
  }

  async function groupRankingCommand(ctx) {
    if (ctx.chat?.type === 'private') return showRating(ctx);
    const { giveaway } = await contestForChat(ctx.chat.id);
    if (!giveaway) return ctx.reply('📭 Bu guruhda aktiv konkurs yo‘q.');
    const top = await rankingRows(giveaway._id, 10);
    return ctx.reply(`🏆 ${giveaway.title} — TOP 10\n\n${rankingText(top)}\n\n⏳ ${formatRemaining(giveaway.ends_at)}`);
  }

  async function groupStatsCommand(ctx) {
    if (ctx.chat?.type === 'private') return showPublicHome(ctx);
    const { giveaway } = await contestForChat(ctx.chat.id);
    if (!giveaway) return ctx.reply('📭 Bu guruhda aktiv konkurs yo‘q.');
    const [participants, sources, referrals] = await Promise.all([
      participantCount(giveaway._id, true),
      GiveawaySource.countDocuments({ bot_key: config.key, giveaway_id: giveaway._id, is_active: { $ne: false } }),
      GiveawayParticipant.aggregate([
        { $match: { bot_key: config.key, giveaway_id: giveaway._id, onboarding_status: 'active' } },
        { $group: { _id: null, total: { $sum: '$referrals_confirmed' } } }
      ])
    ]);
    return ctx.reply(
      `📊 ${giveaway.title}\n\n👥 Qatnashchilar: ${participants}\n🤝 Ulangan kanal/guruhlar: ${sources}\n` +
      `👤 Taklif orqali qo‘shilganlar: ${referrals[0]?.total || 0}\n🏆 G‘oliblar: ${giveaway.winners_count}\n⏳ ${formatRemaining(giveaway.ends_at)}`
    );
  }

  bot.command('reyting', groupRankingCommand);
  bot.command('top', groupRankingCommand);
  bot.command('statistika', groupStatsCommand);
  bot.command('stat', groupStatsCommand);

  const handleGroupContestCommand = async (ctx) => {
    if (ctx.chat?.type === 'private') return showPublicHome(ctx);
    if (!ctx.from) return;
    let member;
    try { member = await bot.telegram.getChatMember(ctx.chat.id, ctx.from.id); } catch (_) { return; }
    if (!utils.isAdmin(ctx.from.id) && !['administrator', 'creator'].includes(member.status)) return;
    const g = await activeGiveaway(ctx.from.id) || (utils.isAdmin(ctx.from.id) ? await activeGiveaway() : null);
    if (!g) return ctx.reply('📭 Sizda aktiv konkurs yo‘q. Botning private chatida konkurs yarating.');
    try {
      const source = await connectContestChat(g, String(ctx.chat.id), ctx.from.id, 'host');
      await postContestToSource(source, g);
      try { await ctx.deleteMessage(); } catch (_) {}
    } catch (error) {
      return ctx.reply(`❌ ${error.description || error.message}`);
    }
  };
  bot.command('konkurs', handleGroupContestCommand);
  bot.command('contest', handleGroupContestCommand);


  async function resolveSourceContestByCode(code) {
    const cacheKey = String(code);
    const cached = sourceContestCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5000) return cached.value;
    const source = await GiveawaySource.findOne({ bot_key: config.key, source_code: code, is_active: { $ne: false } });
    if (!source) return { source: null, giveaway: null };
    const giveaway = await ensureGiveawayState(await getGiveawayById(source.giveaway_id));
    const value = { source, giveaway };
    sourceContestCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  function missingSubscriptionAlert(check) {
    const names = (check.missing || []).map((x) => x.label).filter(Boolean).slice(0, 6);
    return `🔒 Avval homiy kanal/guruhlarga obuna bo‘ling:\n${names.map((x) => `• ${x}`).join('\n')}\n\nSo‘ng “Konkursga qo‘shilish”ni yana bosing.`.slice(0, 190);
  }

  bot.action(/^gw:j:([A-Za-z0-9_-]{4,24})$/, async (ctx) => {
    saveUserFast(ctx);
    const { source, giveaway } = await resolveSourceContestByCode(ctx.match[1]);
    if (!source || !giveaway) return ctx.answerCbQuery('Konkurs topilmadi yoki yakunlangan.', { show_alert: true }).catch(() => null);
    if (giveaway.status !== 'active') return ctx.answerCbQuery('⏰ Konkurs yakunlangan.', { show_alert: true }).catch(() => null);
    const [check, currentSourceCheck] = await Promise.all([
      checkContestSubscriptions(ctx.from.id, giveaway),
      checkSingleContestSourceMembership(ctx.from.id, source)
    ]);
    if (!currentSourceCheck.ok) {
      check.ok = false;
      check.missing = [{ label: sourceLabel(source), url: sourceJoinUrl(source) }, ...(check.missing || [])];
    }
    if (!check.ok && !utils.isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery(missingSubscriptionAlert(check), { show_alert: true }).catch(() => null);
    }
    const participant = await ensureParticipant(ctx, giveaway, null, source.source_code);
    participant.full_name = participant.full_name || [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || `User ${ctx.from.id}`;
    participant.referral_origin = participant.referrer_user_id ? (participant.referral_origin || 'bot_link') : 'direct';
    await activateParticipant(ctx, giveaway, participant, { silent: true });
    const count = await participantCount(giveaway._id, true);
    refreshContestAnnouncements(giveaway).catch(() => null);
    return ctx.answerCbQuery(`✅ Konkursga qo‘shildingiz!\n👥 Jami qatnashchi: ${count}\n🏆 Reyting va havolangizni bot private chatidan olishingiz mumkin.`, { show_alert: true }).catch(() => null);
  });

  bot.action(/^gw:r:([A-Za-z0-9_-]{4,24})$/, async (ctx) => {
    const { giveaway } = await resolveSourceContestByCode(ctx.match[1]);
    if (!giveaway) return ctx.answerCbQuery('Konkurs topilmadi.', { show_alert: true }).catch(() => null);
    const top = await rankingRows(giveaway._id, 5);
    const text = top.length
      ? top.map((p, i) => `${i + 1}. ${p.full_name || p.telegram_first_name || p.user_id} — ${p.referrals_confirmed || 0}`).join('\n')
      : 'Hali qatnashchi yo‘q.';
    return ctx.answerCbQuery(`🏆 TOP 5\n${text}`.slice(0, 195), { show_alert: true }).catch(() => null);
  });

  bot.action(/^gw:q:([A-Za-z0-9_-]{4,24})$/, async (ctx) => {
    const { giveaway } = await resolveSourceContestByCode(ctx.match[1]);
    if (!giveaway) return ctx.answerCbQuery('Konkurs topilmadi.', { show_alert: true }).catch(() => null);
    return ctx.answerCbQuery(`📜 ${giveaway.rules || 'Qoidalar kiritilmagan.'}`.slice(0, 195), { show_alert: true }).catch(() => null);
  });

  bot.action(/^gw:manage:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const g = await getGiveawayById(ctx.match[1]);
    if (!canManage(ctx.from.id, g)) return ctx.answerCbQuery('Bu konkurs sizga tegishli emas', { show_alert: true }).catch(() => null);
    ctx.session.giveawayId = String(g._id);
    return showManagerHome(ctx, g);
  });

  bot.action(/^gw:srcinfo:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const source = await GiveawaySource.findOne({ _id: ctx.match[1], bot_key: config.key });
    const g = source ? await getGiveawayById(source.giveaway_id) : null;
    if (!source || !canManage(ctx.from.id, g)) return;
    return ctx.reply(
      `📢 ${sourceLabel(source)}

🎯 Vazifasi: ${sourceRoleLabel(source)}
📌 Turi: ${source.chat_type || '—'}
🔗 ${sourceJoinUrl(source) || 'link yo‘q'}\n` +
      `✅ Bot admin: ${source.bot_is_admin ? 'ha' : 'yo‘q'}\n📣 Post huquqi: ${source.bot_can_post ? 'ha' : 'yo‘q'}\n` +
      `👆 Klik: ${source.clicks_count || 0}\n✅ Qo‘shildi: ${source.joins_count || 0}\n📤 Post: ${source.posts_count || 0}${source.last_error ? `\n⚠️ ${source.last_error}` : ''}`
    );
  });

  bot.action(/^gw:srcdel:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const source = await GiveawaySource.findOne({ _id: ctx.match[1], bot_key: config.key });
    const g = source ? await getGiveawayById(source.giveaway_id) : null;
    if (!source || !canManage(ctx.from.id, g)) return ctx.answerCbQuery('Ruxsat yo‘q', { show_alert: true }).catch(() => null);
    source.is_active = false;
    source.last_error = 'manager_removed';
    await source.save();
    invalidateContestCaches(g._id);
    return ctx.editMessageText(`✅ ${sourceLabel(source)} “${g.title}” konkursidan uzildi.`);
  });

  bot.action(/^gw:subcheck:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery('Tekshirilmoqda...').catch(() => null);
    const g = await ensureGiveawayState(await getGiveawayById(ctx.match[1]));
    if (!g) return ctx.reply('📭 Konkurs topilmadi.');
    const check = await checkContestSubscriptions(ctx.from.id, g);
    if (!check.ok && !GLOBAL_ADMIN_IDS.includes(Number(ctx.from.id))) return sendContestSubscriptionWarning(ctx, g, check);
    try { await ctx.deleteMessage(); } catch (_) {}
    return continueOnboarding(ctx, g, { action: 'join', referralId: null, sourceCode: null });
  });

  bot.action(/^gw:rating:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    return showRating(ctx, await getGiveawayById(ctx.match[1]));
  });

  bot.action(/^gw:mode:(top_referrals|random|admin)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    if (ctx.session.mode !== 'gw_create_mode') return;
    ctx.session.draft.winner_mode = ctx.match[1];
    ctx.session.mode = 'gw_create_duration';
    return ctx.editMessageText(`✅ ${winnerModeLabel(ctx.match[1])}\n\n⏳ 5/8 — Muddatni yuboring.\n12h, 3d yoki 2w`);
  });

  bot.action(/^gw:cap:([a-f0-9]{24}):([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery('Bot tekshiruvi olib tashlangan. Davom etyapmiz…').catch(() => null);
    const g = await ensureGiveawayState(await getGiveawayById(ctx.match[1]));
    if (!g) return;
    const participant = await participantFor(g._id, ctx.from.id);
    if (!participant) return;
    return activateParticipant(ctx, g, participant);
  });

  bot.action(/^gw:extrapage:([a-f0-9]{24}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const g = await getGiveawayById(ctx.match[1]);
    if (!canManage(ctx.from.id, g) || !['frozen', 'closed'].includes(g.status)) return;
    return ctx.editMessageReplyMarkup((await extraWinnerKeyboard(g, Number(ctx.match[2]))).reply_markup);
  });

  bot.action(/^gw:extra:([a-f0-9]{24}):(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('Tanlanmoqda…').catch(() => null);
    const g = await getGiveawayById(ctx.match[1]);
    if (!canManage(ctx.from.id, g) || !['frozen', 'closed'].includes(g.status)) return;
    const participant = await GiveawayParticipant.findOne({ bot_key: config.key, giveaway_id: g._id, user_id: Number(ctx.match[2]), onboarding_status: 'active' });
    if (!participant) return ctx.reply('❌ Qatnashchi topilmadi.');
    const ids = new Set((g.winner_user_ids || []).map(Number));
    if (ids.has(Number(participant.user_id))) return ctx.answerCbQuery('Bu foydalanuvchi allaqachon g‘olib.', { show_alert: true }).catch(() => null);
    ids.add(Number(participant.user_id));
    g.winner_user_ids = Array.from(ids);
    g.public_result_sent_at = null;
    await g.save();
    await announceExtraWinner(g, participant);
    return ctx.editMessageText(`✅ ${participant.full_name || participant.user_id} qo‘shimcha g‘olib sifatida tanlandi va ulangan kanal/guruhlarga e’lon qilindi.`);
  });

  bot.action(/^gw:pickpage:([a-f0-9]{24}):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const g = await getGiveawayById(ctx.match[1]);
    if (!canManage(ctx.from.id, g) || g.winner_mode !== 'admin' || g.status !== 'frozen') return;
    return ctx.editMessageReplyMarkup((await adminSelectionKeyboard(g, Number(ctx.match[2]))).reply_markup);
  });

  bot.action(/^gw:pick:([a-f0-9]{24}):(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const g = await getGiveawayById(ctx.match[1]);
    if (!canManage(ctx.from.id, g) || g.winner_mode !== 'admin' || g.status !== 'frozen') return;
    const userId = Number(ctx.match[2]);
    const page = Number(ctx.match[3]);
    const selected = new Set((g.winner_user_ids || []).map(Number));
    if (selected.has(userId)) selected.delete(userId);
    else if (selected.size < Number(g.winners_count || 1)) selected.add(userId);
    else return ctx.answerCbQuery(`Limit: ${g.winners_count}`, { show_alert: true }).catch(() => null);
    g.winner_user_ids = Array.from(selected);
    await g.save();
    return ctx.editMessageReplyMarkup((await adminSelectionKeyboard(g, page)).reply_markup);
  });

  bot.action(/^gw:pickdone:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    const g = await getGiveawayById(ctx.match[1]);
    if (!canManage(ctx.from.id, g) || g.winner_mode !== 'admin' || g.status !== 'frozen') return;
    if ((g.winner_user_ids || []).length !== Number(g.winners_count || 1)) return ctx.answerCbQuery(`Aniq ${g.winners_count} ta tanlang`, { show_alert: true }).catch(() => null);
    g.drawn_by = ctx.from.id;
    g.drawn_at = new Date();
    g.admin_selection_completed_at = new Date();
    await g.save();
    const finalSnapshot = Array.isArray(g.result_snapshot) ? g.result_snapshot : [];
    await notifyManagersResult(g, finalSnapshot, true);
    await publishContestResultEverywhere(g, finalSnapshot);
    return ctx.editMessageText(`✅ “${g.title}” g‘oliblari tasdiqlandi va ulangan kanal/guruhlarga e’lon qilindi.`);
  });

  bot.hears(USER_BUTTONS.rating, (ctx) => showRating(ctx));
  bot.hears(USER_BUTTONS.invite, (ctx) => showInvite(ctx));
  bot.hears(USER_BUTTONS.profile, (ctx) => showProfile(ctx));
  bot.hears(USER_BUTTONS.rules, (ctx) => showRules(ctx));

  bot.command('cancel', async (ctx) => {
    resetFlow(ctx);
    return ctx.reply('❌ Jarayon bekor qilindi.', publicKeyboard());
  });

  bot.on('photo', async (ctx) => {
    saveUserFast(ctx);
    if (utils.isAdmin(ctx.from.id) && ctx.session.mode === 'broadcasting') {
      const result = await utils.broadcastMessage(ctx, fullAdminKeyboard);
      resetFlow(ctx);
      return result;
    }
    if (ctx.session.mode === 'gw_create_photo') {
      const photo = getLargestPhoto(ctx.message);
      if (!photo?.file_id) return ctx.reply('❌ Rasm olinmadi. Qayta yuboring yoki /skip yozing.');
      return finalizeGiveaway(ctx, photo.file_id);
    }
  });

  bot.on('text', async (ctx) => {
    saveUserFast(ctx);
    const text = String(ctx.message.text || '').trim();
    if (!text || text.startsWith('/start')) return;
    if (text === '/cancel') {
      resetFlow(ctx);
      return ctx.reply('❌ Jarayon bekor qilindi.', publicKeyboard());
    }

    if (utils.isAdmin(ctx.from.id) && text === '📢 Broadcast') {
      ctx.session.mode = 'broadcasting';
      return ctx.reply('📢 Barcha bot foydalanuvchilariga yuboriladigan xabarni yuboring yoki forward qiling.');
    }
    if (utils.isAdmin(ctx.from.id) && ctx.session.mode === 'broadcasting') {
      const result = await utils.broadcastMessage(ctx, fullAdminKeyboard);
      resetFlow(ctx);
      return result;
    }

    if (ctx.session.mode === 'gw_connect_chat') {
      const g = await getGiveawayById(ctx.session.giveawayId);
      if (!canManage(ctx.from.id, g)) return ctx.reply('❌ Ruxsat yo‘q.');
      try {
        const source = await connectContestChat(g, text, ctx.from.id, ctx.session.connectRole || 'host');
        resetFlow(ctx, true);
        ctx.session.giveawayId = String(g._id);
        return ctx.reply(
          `✅ Ulandi: ${sourceLabel(source)}\n🎯 ${sourceRoleLabel(source)}\n\n🔗 ${sourceJoinUrl(source) || 'Private link yaratilmadi'}\n` +
          `📣 Post huquqi: ${source.bot_can_post ? 'tayyor' : 'yo‘q'}\n\nEndi “📣 E’lonlarni yuborish”ni bosing.`,
          roleKeyboard(ctx.from.id)
        );
      } catch (error) {
        return ctx.reply(`❌ Ulanmadi: ${error.description || error.message}\n\nBot va siz kanal/guruhda admin ekanini tekshiring.`);
      }
    }

    if (ctx.session.mode === 'gw_create_title') {
      if (text.length < 3) return ctx.reply('❌ Nom juda qisqa.');
      ctx.session.draft.title = text.slice(0, 120);
      ctx.session.mode = 'gw_create_prize';
      return ctx.reply('🎁 2/8 — Sovrin nomini yuboring.');
    }
    if (ctx.session.mode === 'gw_create_prize') {
      ctx.session.draft.prize_name = text.slice(0, 160);
      ctx.session.mode = 'gw_create_winners';
      return ctx.reply('🏆 3/8 — Nechta g‘olib? Masalan: 3');
    }
    if (ctx.session.mode === 'gw_create_winners') {
      const count = Number(text);
      if (!Number.isInteger(count) || count < 1 || count > 100) return ctx.reply('❌ 1–100 oralig‘ida son kiriting.');
      ctx.session.draft.winners_count = count;
      ctx.session.mode = 'gw_create_mode';
      return ctx.reply('🎯 4/8 — G‘olib qanday aniqlansin?', Markup.inlineKeyboard([
        [Markup.button.callback('👥 Eng ko‘p taklif', 'gw:mode:top_referrals')],
        [Markup.button.callback('🎲 Tasodifiy', 'gw:mode:random')],
        [Markup.button.callback('🧑‍⚖️ O‘zim tanlayman', 'gw:mode:admin')]
      ]));
    }
    if (ctx.session.mode === 'gw_create_duration') {
      const seconds = parseDurationInput(text);
      if (!seconds) return ctx.reply('❌ Masalan: 12h, 3d, 2w');
      ctx.session.draft.duration_seconds = seconds;
      ctx.session.mode = 'gw_create_points';
      return ctx.reply('⭐ 6/8 — Har bir do‘st uchun ball. Tavsiya: 5');
    }
    if (ctx.session.mode === 'gw_create_points') {
      const points = Number(text);
      if (!Number.isInteger(points) || points < 1 || points > 1000) return ctx.reply('❌ 1–1000 oralig‘ida son.');
      ctx.session.draft.referral_points = points;
      ctx.session.mode = 'gw_create_description';
      return ctx.reply('✨ 7/8 — Qisqa tavsif yuboring.');
    }
    if (ctx.session.mode === 'gw_create_description') {
      ctx.session.draft.description = text.slice(0, 900);
      ctx.session.mode = 'gw_create_rules';
      return ctx.reply('📜 8/8 — Qoidalarni yuboring.');
    }
    if (ctx.session.mode === 'gw_create_rules') {
      ctx.session.draft.rules = text.slice(0, 3000);
      ctx.session.mode = 'gw_create_photo';
      return ctx.reply('🖼 Sovrin rasmini yuboring yoki /skip yozing.');
    }
    if (ctx.session.mode === 'gw_create_photo' && text.toLowerCase() === '/skip') return finalizeGiveaway(ctx, null);

    if (ctx.chat?.type !== 'private') return;
    const g = await participantGiveaway(ctx);
    if (!g) return;
    const participant = await participantFor(g._id, ctx.from.id);
    if (!participant) return;
    if (participant.onboarding_status === 'pending_name') {
      const cleanName = text.replace(/\s+/g, ' ').trim();
      if (cleanName.length < 3 || cleanName.length > 80) return ctx.reply('❌ Ism va familiyangizni to‘g‘ri kiriting.');
      participant.full_name = cleanName;
      await participant.save();
      return activateParticipant(ctx, g, participant);
    }
    if (participant.onboarding_status === 'pending_captcha') return activateParticipant(ctx, g, participant);
  });

  bot.on('message', async (ctx) => {
    saveUserFast(ctx);
    if (utils.isAdmin(ctx.from?.id) && ctx.session.mode === 'broadcasting') {
      const result = await utils.broadcastMessage(ctx, fullAdminKeyboard);
      resetFlow(ctx);
      return result;
    }
  });


  bot.on('chat_member', async (ctx) => {
    try {
      const update = ctx.chatMember || ctx.update?.chat_member;
      if (!update?.new_chat_member?.user || update.new_chat_member.user.is_bot) return;
      const oldStatus = update.old_chat_member?.status;
      const newStatus = update.new_chat_member?.status;
      const joined = ['left', 'kicked'].includes(oldStatus) && ['member', 'restricted', 'administrator', 'creator'].includes(newStatus);
      if (!joined) return;
      const usedLink = update.invite_link?.invite_link;
      if (!usedLink) return;
      const referrer = await GiveawayParticipant.findOne({ bot_key: config.key, group_invite_link: usedLink, onboarding_status: 'active' });
      if (!referrer) return;
      const g = await ensureGiveawayState(await getGiveawayById(referrer.giveaway_id));
      if (!g || g.status !== 'active' || Number(referrer.user_id) === Number(update.new_chat_member.user.id)) return;
      const source = await GiveawaySource.findOne({ bot_key: config.key, giveaway_id: g._id, chat_id: String(update.chat.id), is_active: { $ne: false } });
      await GiveawayParticipant.findOneAndUpdate(
        { bot_key: config.key, giveaway_id: g._id, user_id: Number(update.new_chat_member.user.id) },
        {
          $setOnInsert: {
            bot_key: config.key,
            giveaway_id: g._id,
            user_id: Number(update.new_chat_member.user.id),
            onboarding_status: 'pending_name',
            referrer_user_id: Number(referrer.user_id),
            referral_origin: 'group_invite',
            source_code: source?.source_code || null,
            source_chat_id: String(update.chat.id),
            source_chat_title: update.chat.title || source?.chat_title || null,
            source_chat_username: source?.chat_username || null,
            source_chat_type: update.chat.type,
            source_first_seen_at: new Date()
          },
          $set: {
            username: update.new_chat_member.user.username || null,
            telegram_first_name: update.new_chat_member.user.first_name || null,
            telegram_last_name: update.new_chat_member.user.last_name || null,
            full_name: [update.new_chat_member.user.first_name, update.new_chat_member.user.last_name].filter(Boolean).join(' '),
            invite_join_detected_at: new Date(),
            last_seen_at: new Date()
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      console.error(`${config.title} invite tracking:`, error.message);
    }
  });

  const freezeTimer = setInterval(async () => {
    try {
      const due = await Giveaway.find({ bot_key: config.key, status: 'active', ends_at: { $lte: new Date() } }).limit(25);
      await Promise.allSettled(due.map((g) => freezeGiveaway(g)));
    } catch (error) {
      console.error(`${config.title} auto-freeze:`, error.message);
    }
  }, 20 * 1000);
  freezeTimer.unref?.();

  bot.catch((err, ctx) => console.error(`❌ ${config.title} update ${ctx.update?.update_id}:`, err));
  return { key: config.key, title: config.title, bot, config };
}


// =========================
// KANAL EGALARI UCHUN CUSTOM INPUT + AUTPOST BOT
// =========================

function createChatLearningBot(config, tokenOverride = null, adminIdsOverride = null) {
  const token = String(tokenOverride || process.env[config.tokenEnv] || '').trim();
  if (!hasUsableToken(token)) return null;

  const adminIds = adminIdsOverride || parseIds(process.env[`${config.key.toUpperCase()}_ADMIN_IDS`] || process.env.ADMIN_IDS);
  const bot = createBaseBot(token, config, adminIds, { mode: null });
  const utils = createSharedUtils(bot, config, adminIds);

  const STOP_WORDS = new Set('va yoki bilan uchun ham hali juda agar chunki nima kim qachon qayer qanaqa qaysi shu bunaqa mana ekan emas yoq bor bir ikki men sen u biz siz ular the a an is are be to of in on at from'.split(/\s+/));
  const settingsCache = new Map();
  const repliesCache = new Map();
  const adminCache = new Map();
  const lastReplyAt = new Map();
  const SETTINGS_TTL = 15000;
  const REPLIES_TTL = 12000;
  const ADMIN_TTL = 60000;
  const GROUP_TYPES = new Set(['group', 'supergroup']);

  function adminKeyboard() {
    return Markup.keyboard([
      ['/learn_on', '/learn_off'],
      ['/reply_on', '/reply_off'],
      ['/learnstats', '/forgetall'],
      ['/settings', '/help']
    ]).resize();
  }

  function normText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[@#][\w_]+/g, ' ')
      .replace(/[“”"'`´’‘]/g, '')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokensOf(text) {
    return normText(text).split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w)).slice(0, 24);
  }

  function messageText(msg) {
    return String(msg?.text || msg?.caption || '').trim();
  }

  function isCommandText(text) {
    return /^\/[a-z0-9_]+(@[A-Za-z0-9_]+)?/i.test(String(text || '').trim());
  }

  async function isChatAdmin(ctx, userId = ctx.from?.id) {
    const chatId = String(ctx.chat?.id || '');
    if (!chatId || !userId) return false;
    if (utils.isAdmin(userId)) return true;
    const key = `${chatId}:${userId}`;
    const cached = adminCache.get(key);
    if (cached && Date.now() - cached.at < ADMIN_TTL) return cached.value;
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
      const value = ['creator', 'administrator'].includes(member.status);
      adminCache.set(key, { at: Date.now(), value });
      return value;
    } catch (_) {
      adminCache.set(key, { at: Date.now(), value: false });
      return false;
    }
  }

  async function getGroupSettings(ctx) {
    const chatId = String(ctx.chat.id);
    const cached = settingsCache.get(chatId);
    if (cached && Date.now() - cached.at < SETTINGS_TTL) return cached.doc;
    let doc = await ChatLearningSetting.findOne({ bot_key: config.key, chat_id: chatId });
    if (!doc) {
      doc = await ChatLearningSetting.create({
        bot_key: config.key,
        chat_id: chatId,
        title: ctx.chat.title || '',
        username: ctx.chat.username || '',
        learned_by: ctx.from?.id || null
      });
    }
    settingsCache.set(chatId, { at: Date.now(), doc });
    return doc;
  }

  function invalidateGroup(chatId) {
    settingsCache.delete(String(chatId));
    repliesCache.delete(String(chatId));
  }

  async function getRecentReplies(ctx, force = false) {
    const chatId = String(ctx.chat.id);
    const cached = repliesCache.get(chatId);
    if (!force && cached && Date.now() - cached.at < REPLIES_TTL) return cached.items;
    const items = await LearnedReply.find({ bot_key: config.key, chat_id: chatId, is_active: { $ne: false } })
      .sort({ updatedAt: -1 })
      .limit(250)
      .lean();
    repliesCache.set(chatId, { at: Date.now(), items });
    return items;
  }

  function similarity(queryTokens, queryNorm, item) {
    if (!queryTokens.length) return 0;
    const itemTokens = Array.isArray(item.keywords) && item.keywords.length ? item.keywords : tokensOf(item.question_norm || item.question_text);
    if (!itemTokens.length) return 0;
    let hit = 0;
    const set = new Set(itemTokens);
    for (const t of queryTokens) if (set.has(t)) hit += 1;
    let score = hit / Math.max(queryTokens.length, itemTokens.length);
    const q = String(item.question_norm || '').trim();
    if (q && queryNorm.includes(q)) score += 0.28;
    if (q && q.includes(queryNorm) && queryNorm.length >= 4) score += 0.22;
    return Math.min(1, score);
  }

  async function learnFromReply(ctx, settings) {
    const msg = ctx.message;
    const question = messageText(msg.reply_to_message);
    const answer = messageText(msg);
    if (!settings.auto_learn || !question || !answer) return false;
    if (isCommandText(answer) || answer.length < 2 || question.length < 2) return false;
    if (answer.length > 1200 || question.length > 500) return false;

    const questionNorm = normText(question);
    const keywords = tokensOf(question);
    if (!questionNorm || keywords.length < 1) return false;

    await LearnedReply.findOneAndUpdate(
      { bot_key: config.key, chat_id: String(ctx.chat.id), question_norm: questionNorm, is_active: { $ne: false } },
      {
        $set: {
          chat_title: ctx.chat.title || '',
          question_text: question,
          question_norm: questionNorm,
          keywords,
          answer_text: answer,
          answer_chat_id: ctx.chat.id,
          answer_message_id: msg.message_id,
          answer_type: msg.text ? 'text' : 'caption',
          learned_from_user_id: ctx.from.id,
          learned_from_username: ctx.from.username || null
        },
        $setOnInsert: { bot_key: config.key, chat_id: String(ctx.chat.id), is_active: true }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await ChatLearningSetting.updateOne({ _id: settings._id }, { $inc: { learned_count: 1 }, $set: { title: ctx.chat.title || settings.title } }).catch(() => null);
    invalidateGroup(ctx.chat.id);
    return true;
  }

  async function autoAnswer(ctx, settings) {
    if (!settings.auto_reply || !settings.is_enabled) return false;
    const text = messageText(ctx.message);
    if (!text || isCommandText(text) || text.length < 2 || text.length > 400) return false;
    if (settings.only_when_mentioned) {
      const me = await bot.telegram.getMe().catch(() => null);
      const username = me?.username ? `@${me.username}`.toLowerCase() : '';
      if (username && !text.toLowerCase().includes(username)) return false;
    }
    const cooldownKey = String(ctx.chat.id);
    const last = lastReplyAt.get(cooldownKey) || 0;
    if (Date.now() - last < 2500) return false;
    if (Number(settings.reply_chance || 1) < 1 && Math.random() > Number(settings.reply_chance)) return false;

    const queryNorm = normText(text);
    const queryTokens = tokensOf(text);
    if (!queryTokens.length) return false;
    const replies = await getRecentReplies(ctx);
    let best = null;
    let bestScore = 0;
    for (const item of replies) {
      const score = similarity(queryTokens, queryNorm, item);
      if (score > bestScore) { bestScore = score; best = item; }
    }
    const minScore = Math.max(0.15, Math.min(0.9, Number(settings.min_score || 0.38)));
    if (!best || bestScore < minScore) return false;
    lastReplyAt.set(cooldownKey, Date.now());
    try {
      await ctx.reply(best.answer_text, { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true });
      LearnedReply.updateOne({ _id: best._id }, { $inc: { uses: 1 }, $set: { last_used_at: new Date() } }).catch(() => null);
      ChatLearningSetting.updateOne({ _id: settings._id }, { $inc: { replies_sent: 1 } }).catch(() => null);
      return true;
    } catch (_) { return false; }
  }

  bot.start(async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    return ctx.reply(
      `🧠 ${config.title}\n\nMen guruhda reply qilingan savol-javoblarni o‘rganaman va keyingi o‘xshash gaplarga avtomatik javob beraman.\n\nIshlatish:\n1) Botni guruhga qo‘shing.\n2) Guruhda kimdir savolga reply qilib javob yozsa, men uni o‘rganaman.\n3) Keyingi o‘xshash savolga tez javob qaytaraman.`,
      adminKeyboard()
    );
  });

  bot.command(['learn_on', 'learn_off', 'reply_on', 'reply_off', 'forgetall', 'learnstats', 'settings', 'help'], async (ctx) => {
    if (!GROUP_TYPES.has(ctx.chat?.type)) return ctx.reply('Bu bot asosan guruhlarda ishlaydi. Botni guruhga admin qilib qo‘shing.');
    const admin = await isChatAdmin(ctx);
    if (!admin && !['learnstats', 'help'].includes(ctx.command)) return ctx.reply('❌ Bu buyruq faqat guruh adminlari uchun.');
    const settings = await getGroupSettings(ctx);
    if (ctx.command === 'learn_on') { settings.auto_learn = true; await settings.save(); invalidateGroup(ctx.chat.id); return ctx.reply('✅ O‘rganish yoqildi. Reply qilingan savol-javoblar bazaga saqlanadi.'); }
    if (ctx.command === 'learn_off') { settings.auto_learn = false; await settings.save(); invalidateGroup(ctx.chat.id); return ctx.reply('⏸ O‘rganish o‘chirildi.'); }
    if (ctx.command === 'reply_on') { settings.auto_reply = true; await settings.save(); invalidateGroup(ctx.chat.id); return ctx.reply('✅ Avto-javob yoqildi.'); }
    if (ctx.command === 'reply_off') { settings.auto_reply = false; await settings.save(); invalidateGroup(ctx.chat.id); return ctx.reply('⏸ Avto-javob o‘chirildi.'); }
    if (ctx.command === 'forgetall') {
      await LearnedReply.updateMany({ bot_key: config.key, chat_id: String(ctx.chat.id), is_active: { $ne: false } }, { $set: { is_active: false } });
      invalidateGroup(ctx.chat.id);
      return ctx.reply('🗑 Bu guruhdagi o‘rganilgan javoblar tozalandi.');
    }
    const total = await LearnedReply.countDocuments({ bot_key: config.key, chat_id: String(ctx.chat.id), is_active: { $ne: false } });
    return ctx.reply(
      `🧠 Suhbatchi holati\n\nGuruh: ${ctx.chat.title || ctx.chat.id}\n📚 O‘rganilgan: ${total}\n✍️ O‘rganish: ${settings.auto_learn ? 'yoqilgan' : 'o‘chiq'}\n💬 Avto-javob: ${settings.auto_reply ? 'yoqilgan' : 'o‘chiq'}\n🎯 Moslik chegarasi: ${settings.min_score || 0.38}\n\nBuyruqlar:\n/learn_on /learn_off\n/reply_on /reply_off\n/forgetall /learnstats`,
      adminKeyboard()
    );
  });

  bot.on('message', async (ctx, next) => {
    if (!GROUP_TYPES.has(ctx.chat?.type) || !ctx.from || ctx.from.is_bot) return next?.();
    const msg = ctx.message;
    if (msg.new_chat_members || msg.left_chat_member) return next?.();
    if (msg.reply_to_message) {
      const settings = await getGroupSettings(ctx);
      const learned = await learnFromReply(ctx, settings);
      if (learned) return next?.();
    }
    const settings = await getGroupSettings(ctx);
    await autoAnswer(ctx, settings);
    return next?.();
  });

  return { key: config.key, title: config.title, bot, config };
}


function createChannelFormBot(config, tokenOverride = null, adminIdsOverride = null) {
  const token = String(tokenOverride || process.env[config.tokenEnv] || '').trim();
  if (!hasUsableToken(token)) return null;
  const adminIds = adminIdsOverride || parseIds(process.env[`${config.key.toUpperCase()}_ADMIN_IDS`] || process.env.ADMIN_IDS);
  const bot = createBaseBot(token, config, adminIds, { formIndex: 0, formAnswers: [] });
  const utils = createSharedUtils(bot, config, adminIds);
  function adminKeyboard() { return Markup.keyboard(commonAdminRows([['📝 Forma sozlash', '👁 Forma koʻrish'], ['➕ Input qoʻshish', '✏️ Input tahrirlash'], ['🔀 Input tartibi', '🗑 Input oʻchirish'], ['📨 Soʻrovlar', '💳 Toʻlov/admin matni'], ['📣 Autopost qoʻshish', '📋 Autopostlar'], ['🎯 Autopost kanal', '🗑 Autopost oʻchirish']])).resize().oneTime(false); }
  async function askField(ctx) { const fields = await FormField.find({bot_key:config.key,is_active:true}).sort({order:1,createdAt:1}); const i=ctx.session.formIndex||0; if(i>=fields.length) return finishForm(ctx, fields); const f=fields[i]; const required = f.required ? 'majburiy' : 'ixtiyoriy'; return ctx.reply(`📝 ${i+1}/${fields.length}. ${f.label}\n${f.placeholder || ''}\n\nTur: ${f.type} | ${required}${f.type==='location'?'\n📍 Telegram lokatsiya yuboring.':''}${f.type==='photo'?'\n🖼 Rasm yuboring.':''}${f.type==='document'?'\n📄 Fayl yuboring.':''}`); }
  async function finishForm(ctx, fields) { const st=await getBotSettings(config.key); const secret=makeSecretCode('REQ'); const answers = ctx.session.formAnswers || []; const sub = await FormSubmission.create({bot_key:config.key,user_id:ctx.from.id,username:ctx.from.username||null,first_name:ctx.from.first_name||null,answers,secret_code:secret,secret_hash:secretHash(secret),status:'sent_to_admin'}); const lines=answers.map((a,i)=>`${i+1}. ${a.label}: ${formAnswerToText(a)}`).join('\n'); const msg=`📨 YANGI ARIZA\n\n👤 ${ctx.from.first_name || ''} ${ctx.from.username ? '@'+ctx.from.username : ''}\n🆔 ${ctx.from.id}\n🔐 Shifr: ${secret}\n\n${lines}\n\nMijoz to‘lovda aynan shu shifrni yuborsa, ariza shu ekanini isbotlaydi.`; for(const id of adminIds){ try{ await bot.telegram.sendMessage(id,msg,Markup.inlineKeyboard([[Markup.button.callback('✅ Tasdiqlash',`form:ok:${String(sub._id)}`),Markup.button.callback('❌ Rad etish',`form:no:${String(sub._id)}`)]])); }catch(_){} } ctx.session.mode=null; ctx.session.formIndex=0; ctx.session.formAnswers=[]; return ctx.reply(`✅ Arizangiz adminga yuborildi!\n\n🔐 Maxfiy shifr: ${secret}\n\nTo‘lov/admin bilan yozishganda shu shifrni yuboring.`, Markup.inlineKeyboard([[Markup.button.url('💳 Adminga toʻlov/yuborish', `https://t.me/${String(st.admin_contact || OWNER_USERNAME).replace('@','')}`)]])); }
  async function autoPostTick() { const due = await AutoPost.find({bot_key:config.key,is_active:true,next_send_at:{$lte:new Date()}}).limit(10); for(const p of due){ try{ await sendStoredMessageToChat(bot.telegram,p.target_chat,p); p.last_sent_at=new Date(); p.sent_count+=1; p.next_send_at=nowPlusMinutes(p.interval_minutes); await p.save(); } catch(e){ console.error(`${config.title} autopost xatosi:`, e.message); p.next_send_at=nowPlusMinutes(Math.max(5, p.interval_minutes)); await p.save(); } } }
  const timer=setInterval(()=>autoPostTick().catch(e=>console.error('autopost tick:',e.message)),60*1000); timer.unref?.();
  bot.start(async(ctx)=>{ await utils.saveUser(ctx,true); if(utils.isAdmin(ctx.from.id)) return ctx.reply('📢 Kanal ariza/autopost admin paneli',adminKeyboard()); const ok=await utils.checkAllSubscriptions(ctx.from.id); if(!ok) return utils.sendSubscriptionWarning(ctx); const st=await getBotSettings(config.key); return ctx.reply(`${st.welcome_text || 'Ariza yuborish uchun tugmani bosing.'}`, Markup.inlineKeyboard([[Markup.button.callback('📝 Ariza yuborish','form:start')],[Markup.button.url('☎️ Admin bilan bogʻlanish',`https://t.me/${String(st.admin_contact||OWNER_USERNAME).replace('@','')}`)]])); });
  bot.hears('📝 Forma sozlash', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; return ctx.reply('📝 Forma sozlash uchun input qo‘shing/tahrirlang.\n\nInput formati:\nLabel | type | required | order | placeholder\n\nType: text, number, phone, url, location, photo, document\nMisol:\nKanal nomi | text | ha | 1 | Kanalingiz nomini yozing', adminKeyboard()); });
  bot.hears('👁 Forma koʻrish', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; const fields=await FormField.find({bot_key:config.key,is_active:true}).sort({order:1,createdAt:1}); if(!fields.length) return ctx.reply('📭 Forma inputlari yo‘q.'); return ctx.reply(`👁 FORMADAGI INPUTLAR\n\n${fields.map(f=>`${f.order}. ${f.label}\n   key: ${f.key} | type: ${f.type} | ${f.required?'majburiy':'ixtiyoriy'}`).join('\n\n')}`); });
  bot.hears('➕ Input qoʻshish', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='field_add'; return ctx.reply('➕ Input qo‘shish.\n\nFormat:\nLabel | type | required | order | placeholder\n\nMisol:\nObunachilar soni | number | ha | 2 | Masalan: 15000\n\n❌ Bekor qilish: /cancel'); });
  bot.hears('✏️ Input tahrirlash', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='field_edit'; return ctx.reply('✏️ Input tahrirlash.\n\nFormat:\nkey | yangi label | type | required | order | placeholder\n\nKeyni “👁 Forma ko‘rish”dan olasiz.\nMisol:\nobunachilar_soni | Obunachilar soni | number | ha | 2 | Masalan: 15000'); });
  bot.hears('🔀 Input tartibi', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='field_order'; return ctx.reply('🔀 Tartib o‘zgartirish.\n\nFormat:\nkey | order\n\nMisol:\nlink | 3'); });
  bot.hears('🗑 Input oʻchirish', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='field_delete'; return ctx.reply('🗑 O‘chiriladigan input key yoki label yuboring.'); });
  bot.hears('💳 Toʻlov/admin matni', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='set_form_settings'; return ctx.reply('💳 Sozlamalarni yuboring. Har qatorda key: value\n\nadmin: @username\nwelcome: Ariza yuborish uchun tugmani bosing\npayment: To‘lov uchun admin bilan bog‘laning'); });
  bot.hears('📨 Soʻrovlar', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; const list=await FormSubmission.find({bot_key:config.key}).sort({createdAt:-1}).limit(15); if(!list.length) return ctx.reply('📭 So‘rovlar yo‘q.'); for(const sub of list){ await ctx.reply(`📨 ARIZA\n\n👤 ${sub.first_name||''} ${sub.username?'@'+sub.username:''}\n🆔 ${sub.user_id}\n🔐 ${sub.secret_code}\n📌 ${sub.status}\n🕒 ${formatDate(sub.createdAt)}\n\n${sub.answers.map((a,i)=>`${i+1}. ${a.label}: ${formAnswerToText(a)}`).join('\n')}`); } });
  bot.hears('🎯 Autopost kanal', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='set_autopost_target'; return ctx.reply('🎯 Autopost yuboriladigan kanal/guruh username yoki chat ID yuboring. Bot u yerda admin bo‘lishi kerak.'); });
  bot.hears('📣 Autopost qoʻshish', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='autopost_wait_message'; return ctx.reply('📣 Autopost uchun yuboriladigan postni yuboring yoki forward qiling. Keyin nom va interval so‘raladi.'); });
  bot.hears('📋 Autopostlar', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; const list=await AutoPost.find({bot_key:config.key,is_active:true}).sort({createdAt:-1}).limit(20); if(!list.length) return ctx.reply('📭 Autopost yo‘q.'); return ctx.reply(`📋 AUTOPOSTLAR\n\n${list.map((p,i)=>`${i+1}. ${p.title}\n   target: ${p.target_chat} | interval: ${p.interval_minutes} daq | yuborildi: ${p.sent_count} | keyingi: ${formatDate(p.next_send_at)}`).join('\n\n')}`); });
  bot.hears('🗑 Autopost oʻchirish', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; ctx.session.mode='autopost_delete'; return ctx.reply('🗑 O‘chiriladigan autopost nomini yuboring.'); });
  bot.hears('📊 Statistika', async(ctx)=>{ if(!utils.isAdmin(ctx.from.id)) return; const [users,active,blocked,fields,subs,forms,autos]=await Promise.all([User.countDocuments({bot_key:config.key}),User.countDocuments({bot_key:config.key,is_blocked:{$ne:true}}),User.countDocuments({bot_key:config.key,is_blocked:true}),FormField.countDocuments({bot_key:config.key,is_active:true}),Subscription.countDocuments({bot_key:config.key}),FormSubmission.countDocuments({bot_key:config.key}),AutoPost.countDocuments({bot_key:config.key,is_active:true})]); return ctx.reply(`📊 KANAL BOT STATISTIKASI\n\n👥 Userlar: ${users}\n✅ Aktiv: ${active}\n🚫 Blok: ${blocked}\n🧩 Inputlar: ${fields}\n📨 Arizalar: ${forms}\n📣 Autopostlar: ${autos}\n🔒 Majburiy obuna: ${subs}`); });
  registerCommonAdminHandlers(bot, config, utils, adminKeyboard);
  bot.action('form:start', async(ctx)=>{ await ctx.answerCbQuery(); await utils.saveUser(ctx); const ok=await utils.checkAllSubscriptions(ctx.from.id); if(!ok) return utils.sendSubscriptionWarning(ctx); const fields=await FormField.countDocuments({bot_key:config.key,is_active:true}); if(!fields) return ctx.reply('📭 Forma hali sozlanmagan. Admin bilan bog‘laning.'); ctx.session.mode='form_answer'; ctx.session.formIndex=0; ctx.session.formAnswers=[]; return askField(ctx); });
  bot.action(/^form:(ok|no):([a-f0-9]{24})$/, async(ctx)=>{ await ctx.answerCbQuery(); if(!utils.isAdmin(ctx.from.id)) return; const sub=await FormSubmission.findOne({_id:ctx.match[2],bot_key:config.key}); if(!sub) return ctx.reply('Topilmadi.'); sub.status=ctx.match[1]==='ok'?'approved':'rejected'; await sub.save(); try{ await bot.telegram.sendMessage(sub.user_id, ctx.match[1]==='ok'?'✅ Arizangiz tasdiqlandi. Admin bilan aloqada bo‘ling.':'❌ Arizangiz rad etildi.'); }catch(_){} return ctx.editMessageText(`${ctx.match[1]==='ok'?'✅':'❌'} Ariza holati yangilandi: ${sub.secret_code}`); });
  bot.command('cancel',async(ctx)=>{ctx.session.mode=null;ctx.session.draft={};ctx.session.formAnswers=[];ctx.session.formIndex=0;return ctx.reply('❌ Jarayon bekor qilindi.',utils.isAdmin(ctx.from.id)?adminKeyboard():undefined);});
  async function handleFormAnswer(ctx) { const fields=await FormField.find({bot_key:config.key,is_active:true}).sort({order:1,createdAt:1}); const i=ctx.session.formIndex||0; const f=fields[i]; if(!f) return finishForm(ctx, fields); let value=null; if(f.type==='location'){ if(!ctx.message.location) return ctx.reply('📍 Iltimos, Telegram lokatsiya yuboring.'); value={latitude:ctx.message.location.latitude,longitude:ctx.message.location.longitude}; } else if(f.type==='photo'){ if(!ctx.message.photo?.length) return ctx.reply('🖼 Iltimos, rasm yuboring.'); const ph=getLargestPhoto(ctx.message); value={file_id:ph.file_id,file_unique_id:ph.file_unique_id}; } else if(f.type==='document'){ if(!ctx.message.document) return ctx.reply('📄 Iltimos, fayl/document yuboring.'); value={file_id:ctx.message.document.file_id,file_name:ctx.message.document.file_name}; } else { const t=ctx.message.text?.trim(); if(f.required && !t) return ctx.reply('❌ Bu maydon majburiy. Javob yuboring.'); if(f.type==='number' && t && !Number.isFinite(Number(t.replace(/\s/g,'')))) return ctx.reply('❌ Raqam kiriting.'); if(f.type==='url' && t && !/^https?:\/\//i.test(t)) return ctx.reply('❌ Link http:// yoki https:// bilan boshlansin.'); value=t || ''; } ctx.session.formAnswers.push({key:f.key,label:f.label,type:f.type,value}); ctx.session.formIndex=i+1; return askField(ctx); }
  bot.on(['photo','document','video','animation','audio','voice','sticker','location'], async(ctx)=>{ await utils.saveUser(ctx); if(ctx.session.mode==='form_answer') return handleFormAnswer(ctx); if(utils.isAdmin(ctx.from.id) && ctx.session.mode==='broadcasting'){const r=await utils.broadcastMessage(ctx,adminKeyboard);ctx.session.mode=null;return r;} if(utils.isAdmin(ctx.from.id)&&ctx.session.mode==='autopost_wait_message'){ const stored=extractStoredMessage(ctx,config.key); ctx.session.draft={stored}; ctx.session.mode='autopost_wait_meta'; return ctx.reply('✅ Post qabul qilindi.\n\nEndi format yuboring:\nNomi | interval_daqiqa | target_chat ixtiyoriy\n\nMisol:\nKunlik reklama | 1440 | @kanal'); } });
  bot.on('text', async(ctx)=>{ await utils.saveUser(ctx); const text=ctx.message.text.trim(); if(text==='/cancel'){ctx.session.mode=null;ctx.session.draft={};ctx.session.formAnswers=[];ctx.session.formIndex=0;return ctx.reply('❌ Jarayon bekor qilindi.',utils.isAdmin(ctx.from.id)?adminKeyboard():undefined);} if(ctx.session.mode==='form_answer') return handleFormAnswer(ctx); if(utils.isAdmin(ctx.from.id)){ const common=await handleCommonAdminText(ctx,config,utils,adminKeyboard); if(common) return common; if(ctx.session.mode==='broadcasting'){const r=await utils.broadcastMessage(ctx,adminKeyboard);ctx.session.mode=null;return r;} if(ctx.session.mode==='autopost_wait_message'){ const stored=extractStoredMessage(ctx,config.key); ctx.session.draft={stored}; ctx.session.mode='autopost_wait_meta'; return ctx.reply('✅ Text-post qabul qilindi.\n\nEndi format yuboring:\nNomi | interval_daqiqa | target_chat ixtiyoriy\n\nMisol:\nKunlik reklama | 1440 | @kanal'); } if(ctx.session.mode==='field_add'){ const f=parseFieldLine(text); if(!f.label) return ctx.reply('❌ Label kiritilmadi.'); if(!['text','number','phone','url','location','photo','document'].includes(f.type)) return ctx.reply('❌ Type noto‘g‘ri.'); if(!f.order) f.order=(await FormField.countDocuments({bot_key:config.key}))+1; await FormField.create({bot_key:config.key,...f}); ctx.session.mode=null; return ctx.reply('✅ Input qo‘shildi.',adminKeyboard()); } if(ctx.session.mode==='field_edit'){ const parts=text.split('|').map(x=>x.trim()); const key=parts[0]; const f=parseFieldLine(parts.slice(1).join('|')); const doc=await FormField.findOne({bot_key:config.key,key,is_active:true}); if(!doc) return ctx.reply('❌ Input topilmadi.'); Object.assign(doc,{label:f.label||doc.label,type:f.type||doc.type,required:f.required,order:f.order||doc.order,placeholder:f.placeholder}); await doc.save(); ctx.session.mode=null; return ctx.reply('✅ Input tahrirlandi.',adminKeyboard()); } if(ctx.session.mode==='field_order'){ const [key,ordRaw]=text.split('|').map(x=>x.trim()); const ord=Number(ordRaw); if(!key||!Number.isFinite(ord)) return ctx.reply('❌ Format: key | order'); await FormField.updateOne({bot_key:config.key,key,is_active:true},{$set:{order:ord}}); ctx.session.mode=null; return ctx.reply('✅ Tartib yangilandi.',adminKeyboard()); } if(ctx.session.mode==='field_delete'){ const q=normalizeTitle(text); const res=await FormField.updateOne({bot_key:config.key,is_active:true,$or:[{key:text},{label:new RegExp(escapeRegex(text),'i')},{label:new RegExp(escapeRegex(q),'i')}]},{$set:{is_active:false}}); ctx.session.mode=null; return ctx.reply(res.modifiedCount?'✅ Input o‘chirildi.':'❌ Input topilmadi.',adminKeyboard()); } if(ctx.session.mode==='set_form_settings'){ const kv=parseKeyValueLines(text); const patch={}; if(kv.admin) patch.admin_contact=kv.admin.startsWith('@')?kv.admin:`@${kv.admin}`; if(kv.welcome) patch.welcome_text=kv.welcome; if(kv.payment) patch.payment_text=kv.payment; await updateBotSettings(config.key,patch); ctx.session.mode=null; return ctx.reply('✅ Sozlamalar saqlandi.',adminKeyboard()); } if(ctx.session.mode==='set_autopost_target'){ const v=normalizeUsername(text); if(!v) return ctx.reply('❌ Chat noto‘g‘ri. @kanal yoki -100... yuboring.'); await updateBotSettings(config.key,{autopost_target:v}); ctx.session.mode=null; return ctx.reply('✅ Autopost target saqlandi.',adminKeyboard()); } if(ctx.session.mode==='autopost_wait_meta'){ const [title,intervalRaw,targetRaw]=text.split('|').map(x=>x.trim()); const interval=Number(intervalRaw); const st=await getBotSettings(config.key); const target=normalizeUsername(targetRaw||st.autopost_target); if(!title||!Number.isFinite(interval)||interval<1||!target) return ctx.reply('❌ Format noto‘g‘ri yoki target yo‘q. Misol: Kunlik post | 1440 | @kanal'); await AutoPost.create({...ctx.session.draft.stored,bot_key:config.key,title,target_chat:target,interval_minutes:interval,next_send_at:nowPlusMinutes(interval),added_by:ctx.from.id,is_active:true}); ctx.session.mode=null; ctx.session.draft={}; return ctx.reply('✅ Autopost saqlandi.',adminKeyboard()); } if(ctx.session.mode==='autopost_delete'){ const res=await AutoPost.updateOne({bot_key:config.key,is_active:true,title:new RegExp(escapeRegex(text),'i')},{$set:{is_active:false}}); ctx.session.mode=null; return ctx.reply(res.modifiedCount?'✅ Autopost o‘chirildi.':'❌ Topilmadi.',adminKeyboard()); } } const ok=await utils.checkAllSubscriptions(ctx.from.id); if(!ok&&!utils.isAdmin(ctx.from.id)) return utils.sendSubscriptionWarning(ctx); return ctx.reply('📝 Ariza yuborish uchun /start bosing.'); });
  bot.catch((err, ctx) => console.error(`❌ ${config.title} xatosi update ${ctx.update?.update_id}:`, err));
  return { key: config.key, title: config.title, bot, config };
}

// =========================
// ULTIMATE GURUH MANAGER / ANTISPAM / MODERATSIYA BOT
// =========================
function createGroupToolsBot(config, tokenOverride = null, adminIdsOverride = null) {
  const token = String(tokenOverride || process.env[config.tokenEnv] || '').trim();
  if (!hasUsableToken(token)) return null;

  const adminIds = (adminIdsOverride || parseIds(process.env[`${config.key.toUpperCase()}_ADMIN_IDS`] || process.env.ADMIN_IDS)).map(Number);
  const bot = createBaseBot(token, config, adminIds, { mode: null, draft: {} });
  const utils = createSharedUtils(bot, config, adminIds);

  const DEFAULT_GROUP_SETTINGS = Object.freeze({
    clean_join: true,
    clean_leave: true,
    clean_service: true,
    anti_link: true,
    warn_on_link: true,
    anti_forward: false,
    anti_flood: true,
    flood_limit: 6,
    flood_window_sec: 8,
    warn_limit: 3,
    mute_minutes: 60,
    warning_delete_seconds: 12,
    welcome_enabled: false,
    welcome_text: '👋 Xush kelibsiz, {name}!',
    rules_text: '📜 Guruh qoidalari hali yozilmagan.',
    badwords: [],
    allow_domains: [],
    delete_commands: false,
    admin_log: true
  });

  const settingsCache = new Map();
  const adminCache = new Map();
  const floodCache = new Map();
  const whitelistCache = new Map();
  const autoReplyCache = new Map();
  const botMeCache = { value: null, id: 0, at: 0 };
  const SETTINGS_TTL = 30_000;
  const ADMIN_TTL = 30_000;

  const isGroupChat = (ctx) => ['group', 'supergroup'].includes(ctx.chat?.type);
  const htmlEscape = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const mentionHtml = (userId, name) => `<a href="tg://user?id=${Number(userId)}">${htmlEscape(name || 'Foydalanuvchi')}</a>`;
  const commandPayload = (ctx) => String(ctx.message?.text || '').replace(/^\/\w+(?:@\w+)?\s*/u, '').trim();

  function defaultSettings(custom = {}) {
    return {
      ...DEFAULT_GROUP_SETTINGS,
      ...(custom || {}),
      badwords: Array.isArray(custom?.badwords) ? custom.badwords : [],
      allow_domains: Array.isArray(custom?.allow_domains) ? custom.allow_domains : []
    };
  }

  async function getBotUsername() {
    if (config.telegramUsername && botMeCache.value) return botMeCache.value;
    if (botMeCache.value && Date.now() - botMeCache.at < 10 * 60_000) return botMeCache.value;
    try {
      const me = await bot.telegram.getMe();
      botMeCache.value = me.username || String(config.telegramUsername || '').replace(/^@/, '');
      botMeCache.id = Number(me.id || 0);
      botMeCache.at = Date.now();
      return me.username;
    } catch (_) {
      return '';
    }
  }

  async function upsertGroup(ctx, extra = {}) {
    if (!isGroupChat(ctx) || !(mongoReady && mongoose.connection.readyState === 1)) return null;
    const chatId = String(ctx.chat.id);
    const patch = {
      title: ctx.chat.title || null,
      username: ctx.chat.username ? `@${ctx.chat.username}` : null,
      chat_type: ctx.chat.type,
      last_active_at: new Date(),
      is_active: true,
      ...extra
    };
    try {
      return await GroupChat.findOneAndUpdate(
        { bot_key: config.key, chat_id: chatId },
        { $set: patch, $setOnInsert: { added_by: ctx.from?.id || null, added_by_username: ctx.from?.username || null, settings: defaultSettings() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      console.error(`${config.title} guruh saqlash:`, error.message);
      return null;
    }
  }

  async function getGroupSettings(chatId, chatMeta = null) {
    const key = String(chatId);
    const cached = settingsCache.get(key);
    if (cached && Date.now() - cached.at < SETTINGS_TTL) return cached.value;
    let value = defaultSettings();
    if (mongoReady && mongoose.connection.readyState === 1) {
      try {
        let doc = await GroupChat.findOne({ bot_key: config.key, chat_id: key }).lean();
        if (!doc && chatMeta) {
          doc = await GroupChat.findOneAndUpdate(
            { bot_key: config.key, chat_id: key },
            {
              $set: {
                title: chatMeta.title || null,
                username: chatMeta.username ? `@${chatMeta.username}` : null,
                chat_type: chatMeta.type || 'supergroup',
                last_active_at: new Date(),
                is_active: true
              },
              $setOnInsert: { settings: defaultSettings() }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          ).lean();
        }
        value = defaultSettings(doc?.settings || {});
      } catch (error) {
        console.error(`${config.title} settings:`, error.message);
      }
    }
    settingsCache.set(key, { at: Date.now(), value });
    return value;
  }

  async function patchGroupSettings(chatId, patch) {
    const key = String(chatId);
    const current = await getGroupSettings(key);
    const next = defaultSettings({ ...current, ...patch });
    if (!(mongoReady && mongoose.connection.readyState === 1)) throw new Error('MongoDB ulanmagan');
    await GroupChat.updateOne(
      { bot_key: config.key, chat_id: key },
      { $set: { settings: next, last_active_at: new Date(), is_active: true } },
      { upsert: true }
    );
    settingsCache.set(key, { at: Date.now(), value: next });
    return next;
  }

  async function isChatAdmin(chatId, userId) {
    const uid = Number(userId);
    if (!uid) return false;
    if (adminIds.includes(uid) || GLOBAL_ADMIN_IDS.includes(uid)) return true;
    const key = `${chatId}:${uid}`;
    const cached = adminCache.get(key);
    if (cached && Date.now() - cached.at < ADMIN_TTL) return cached.value;
    let value = false;
    try {
      const member = await bot.telegram.getChatMember(chatId, uid);
      value = ['creator', 'administrator'].includes(member.status);
    } catch (_) {}
    adminCache.set(key, { at: Date.now(), value });
    return value;
  }

  async function requireGroupAdmin(ctx) {
    if (!isGroupChat(ctx)) {
      await ctx.reply('ℹ️ Bu buyruq faqat guruh ichida ishlaydi.');
      return false;
    }
    if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) {
      await ctx.reply('⛔ Bu buyruq faqat guruh administratorlari uchun.');
      return false;
    }
    return true;
  }

  function deleteMessageLater(chatId, messageId, seconds = 12) {
    if (!messageId || !seconds) return;
    const timer = setTimeout(() => bot.telegram.deleteMessage(chatId, messageId).catch(() => null), Math.max(2, Number(seconds)) * 1000);
    timer.unref?.();
  }

  async function tempReply(ctx, text, settings, extra = {}) {
    try {
      const sent = await ctx.reply(text, extra);
      deleteMessageLater(ctx.chat.id, sent.message_id, settings?.warning_delete_seconds ?? 12);
      return sent;
    } catch (_) {
      return null;
    }
  }

  async function saveGroupMember(ctx, user = ctx.from, patch = {}, increments = {}) {
    if (!isGroupChat(ctx) || !user || user.is_bot || !(mongoReady && mongoose.connection.readyState === 1)) return;
    const update = {
      $set: {
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        last_message_at: new Date(),
        ...patch
      },
      $setOnInsert: { status: 'active', joined_at: new Date() }
    };
    if (Object.keys(increments).length) update.$inc = increments;
    GroupMember.updateOne(
      { bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(user.id) },
      update,
      { upsert: true }
    ).catch((error) => console.error(`${config.title} member save:`, error.message));
  }

  async function resolveTarget(ctx) {
    const replyUser = ctx.message?.reply_to_message?.from;
    const payload = commandPayload(ctx);
    if (replyUser && !replyUser.is_bot) {
      return { user: replyUser, reason: payload || '', source: 'reply' };
    }
    const [rawTarget, ...rest] = payload.split(/\s+/).filter(Boolean);
    if (!rawTarget) return null;
    let member = null;
    if (/^\d{5,}$/.test(rawTarget)) {
      member = await GroupMember.findOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(rawTarget) }).lean();
      if (!member) member = { user_id: Number(rawTarget), first_name: `ID ${rawTarget}` };
    } else if (/^@[a-zA-Z0-9_]{5,32}$/.test(rawTarget)) {
      member = await GroupMember.findOne({ bot_key: config.key, chat_id: String(ctx.chat.id), username: new RegExp(`^${escapeRegex(rawTarget.slice(1))}$`, 'i') }).lean();
    }
    if (!member) return null;
    return {
      user: {
        id: Number(member.user_id),
        username: member.username || rawTarget.replace(/^@/, ''),
        first_name: member.first_name || member.username || rawTarget,
        last_name: member.last_name || ''
      },
      reason: rest.join(' '),
      source: 'argument'
    };
  }

  async function targetIsProtected(ctx, targetId) {
    if (Number(targetId) === Number(ctx.from.id)) return 'O‘zingizga bu amalni qo‘llay olmaysiz.';
    if (!botMeCache.id) { try { const me = await bot.telegram.getMe(); botMeCache.id = Number(me.id || 0); botMeCache.value = me.username || botMeCache.value; botMeCache.at = Date.now(); } catch (_) {} }
    if (Number(targetId) === Number(botMeCache.id)) return 'Botga bu amalni qo‘llab bo‘lmaydi.';
    if (await isChatAdmin(ctx.chat.id, targetId)) return 'Guruh administratoriga bu amalni qo‘llab bo‘lmaydi.';
    return null;
  }

  async function logAction(ctx, action, targetId = null, reason = '', meta = {}) {
    if (!(mongoReady && mongoose.connection.readyState === 1) || !isGroupChat(ctx)) return;
    GroupAction.create({
      bot_key: config.key,
      chat_id: String(ctx.chat.id),
      actor_id: ctx.from?.id || null,
      target_id: targetId ? Number(targetId) : null,
      action,
      reason: String(reason || '').slice(0, 500),
      meta
    }).catch(() => null);
  }

  async function banUser(ctx, target, reason = 'Qoidabuzarlik', actorLabel = 'Admin') {
    await bot.telegram.banChatMember(ctx.chat.id, target.id);
    await GroupMember.updateOne(
      { bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(target.id) },
      { $set: { status: 'banned', last_warn_reason: reason }, $setOnInsert: { first_name: target.first_name || null, username: target.username || null } },
      { upsert: true }
    ).catch(() => null);
    GroupChat.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id) }, { $inc: { bans_issued: 1 } }).catch(() => null);
    await logAction(ctx, 'ban', target.id, reason, { actor_label: actorLabel });
  }

  async function applyWarning(ctx, target, reason = 'Guruh qoidalarini buzish', automatic = false) {
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    const protectedReason = await targetIsProtected(ctx, target.id);
    if (protectedReason) {
      if (!automatic) await ctx.reply(`⛔ ${protectedReason}`);
      return { ok: false, warns: 0 };
    }
    if (!(mongoReady && mongoose.connection.readyState === 1)) {
      if (!automatic) await ctx.reply('⏳ Baza vaqtincha ulanmagan. Qayta urinib ko‘ring.');
      return { ok: false, warns: 0 };
    }
    const member = await GroupMember.findOneAndUpdate(
      { bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(target.id) },
      {
        $set: {
          username: target.username || null,
          first_name: target.first_name || null,
          last_name: target.last_name || null,
          last_warn_reason: reason,
          status: 'active'
        },
        $inc: { warns: 1 },
        $setOnInsert: { joined_at: new Date() }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    GroupChat.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id) }, { $inc: { warnings_issued: 1 } }).catch(() => null);
    await logAction(ctx, automatic ? 'auto_warn' : 'warn', target.id, reason, { warns: member.warns });

    const displayName = [target.first_name, target.last_name].filter(Boolean).join(' ') || target.username || String(target.id);
    if (member.warns >= Number(settings.warn_limit || 3)) {
      try {
        await banUser(ctx, target, `${reason}; ${member.warns}/${settings.warn_limit} ogohlantirish`, automatic ? 'Avtomatik himoya' : 'Admin');
        const msg = await ctx.reply(
          `🚫 ${mentionHtml(target.id, displayName)} guruhdan bloklandi.\n\nSabab: ${htmlEscape(reason)}\nOgohlantirish: ${member.warns}/${settings.warn_limit}`,
          { parse_mode: 'HTML' }
        );
        deleteMessageLater(ctx.chat.id, msg.message_id, 30);
      } catch (error) {
        await ctx.reply(`❌ Ban berilmadi. Botga “Foydalanuvchilarni bloklash” admin huquqini bering.\n${error.description || error.message}`);
      }
      return { ok: true, warns: member.warns, banned: true };
    }

    const msg = await ctx.reply(
      `⚠️ ${mentionHtml(target.id, displayName)} ogohlantirildi.\n\nSabab: ${htmlEscape(reason)}\nOgohlantirish: ${member.warns}/${settings.warn_limit}`,
      { parse_mode: 'HTML' }
    );
    deleteMessageLater(ctx.chat.id, msg.message_id, settings.warning_delete_seconds);
    return { ok: true, warns: member.warns, banned: false };
  }

  function parseDuration(value, fallbackMinutes = 60) {
    const raw = String(value || '').trim().toLowerCase();
    const m = raw.match(/^(\d+)(s|m|h|d|w)?$/);
    if (!m) return fallbackMinutes * 60;
    const n = Math.max(1, Number(m[1]));
    const unit = m[2] || 'm';
    const mult = unit === 's' ? 1 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : unit === 'w' ? 604800 : 60;
    return n * mult;
  }

  function mutePermissions(allowed) {
    return {
      can_send_messages: allowed,
      can_send_audios: allowed,
      can_send_documents: allowed,
      can_send_photos: allowed,
      can_send_videos: allowed,
      can_send_video_notes: allowed,
      can_send_voice_notes: allowed,
      can_send_polls: allowed,
      can_send_other_messages: allowed,
      can_add_web_page_previews: allowed,
      can_invite_users: allowed
    };
  }

  function extractTextAndCaption(message) {
    return String(message?.text || message?.caption || '').trim();
  }

  function messageHasLink(message, settings) {
    const text = extractTextAndCaption(message);
    const entities = [...(message?.entities || []), ...(message?.caption_entities || [])];
    const entityHasLink = entities.some((entity) => ['url', 'text_link'].includes(entity.type));
    const regexHasLink = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|telegram\.dog\/|tg:\/\/)/i.test(text);
    if (!(entityHasLink || regexHasLink)) return false;
    const allowed = (settings.allow_domains || []).map((x) => String(x).toLowerCase()).filter(Boolean);
    if (allowed.length && allowed.some((domain) => text.toLowerCase().includes(domain))) return false;
    return true;
  }

  function isForwarded(message) {
    return Boolean(message?.forward_origin || message?.forward_from || message?.forward_from_chat || message?.forward_sender_name || message?.is_automatic_forward);
  }

  function isFlood(chatId, userId, settings) {
    if (settings.anti_flood === false) return false;
    const key = `${chatId}:${userId}`;
    const now = Date.now();
    const windowMs = Math.max(2, Number(settings.flood_window_sec || 8)) * 1000;
    const limit = Math.max(3, Number(settings.flood_limit || 6));
    const recent = (floodCache.get(key) || []).filter((time) => now - time <= windowMs);
    recent.push(now);
    floodCache.set(key, recent);
    return recent.length > limit;
  }

  function settingsText(settings) {
    return [
      '⚙️ <b>GURUH MANAGER SOZLAMALARI</b>',
      '',
      `🔗 Anti-link: <b>${settings.anti_link !== false ? 'ON' : 'OFF'}</b>`,
      `⚠️ Link uchun warn: <b>${settings.warn_on_link !== false ? 'ON' : 'OFF'}</b>`,
      `🧹 Kirdi xabari: <b>${settings.clean_join !== false ? 'o‘chiriladi' : 'qoladi'}</b>`,
      `🚪 Chiqdi xabari: <b>${settings.clean_leave !== false ? 'o‘chiriladi' : 'qoladi'}</b>`,
      `📨 Forward himoyasi: <b>${settings.anti_forward === true ? 'ON' : 'OFF'}</b>`,
      `⚡ Flood himoyasi: <b>${settings.anti_flood !== false ? 'ON' : 'OFF'}</b> (${settings.flood_limit}/${settings.flood_window_sec}s)`,
      `👋 Salomlashuv: <b>${settings.welcome_enabled ? 'ON' : 'OFF'}</b>`,
      `🚫 Warn limiti: <b>${settings.warn_limit}</b>`,
      `🔇 Standart mute: <b>${settings.mute_minutes} daqiqa</b>`,
      `🧾 Taqiqlangan so‘zlar: <b>${(settings.badwords || []).length}</b>`,
      `✅ Ruxsatli domenlar: <b>${(settings.allow_domains || []).length}</b>`
    ].join('\n');
  }

  function settingsKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔗 Anti-link', 'gm:t:anti_link'), Markup.button.callback('⚠️ Link warn', 'gm:t:warn_on_link')],
      [Markup.button.callback('🧹 Kirdi', 'gm:t:clean_join'), Markup.button.callback('🚪 Chiqdi', 'gm:t:clean_leave')],
      [Markup.button.callback('📨 Forward', 'gm:t:anti_forward'), Markup.button.callback('⚡ Flood', 'gm:t:anti_flood')],
      [Markup.button.callback('👋 Salomlashuv', 'gm:t:welcome_enabled'), Markup.button.callback('🔄 Yangilash', 'gm:settings')]
    ]);
  }

  function helpText() {
    return [
      '🛡 <b>ULTIMATE GROUP MANAGER</b>',
      '',
      '<b>Asosiy moderatsiya:</b>',
      '• /warn — reply yoki /warn @username sabab',
      '• /warnings — o‘zingiz yoki reply qilingan user warnlari',
      '• /clearwarn — reply/ID/@username warnlarini tozalash',
      '• /ban — reply/ID/@username bloklash',
      '• /unban ID — blokdan chiqarish',
      '• /kick — guruhdan chiqarish, qayta kira oladi',
      '• /mute 10m — vaqtincha yozishni cheklash',
      '• /unmute — cheklovni olib tashlash',
      '• /del — reply qilingan xabarni o‘chirish',
      '• /pin va /unpin — xabarni mahkamlash/olib tashlash',
      '',
      '<b>Sozlamalar:</b>',
      '• /settings — shu guruh sozlamalari',
      '• /setwarnlimit 3',
      '• /setflood 6 8 — 8 soniyada 6 xabar',
      '• /setwelcome matn ({name}, {username})',
      '• /welcome on|off',
      '• /setrules matn',
      '• /badword add so‘z | /badword del so‘z | /badword list',
      '• /allowdomain t.me | /deldomain t.me | /domains',
      '• /trust va /untrust — reply userga link ruxsati',
      '• /filter kalit | avtomatik javob',
      '• /stopfilter kalit | /filters',
      '',
      '<b>Foydali:</b>',
      '• /rules, /admins, /id, /groupstats, /report (reply)',
      '',
      'ℹ️ Buyruqlar reply orqali ishlatilsa eng ishonchli. Botga xabar o‘chirish, ban/restrict va pin huquqlarini bering.'
    ].join('\n');
  }

  async function showSettings(ctx, edit = false) {
    if (!(await requireGroupAdmin(ctx))) return;
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    const opts = { parse_mode: 'HTML', ...settingsKeyboard() };
    if (edit && ctx.callbackQuery?.message) {
      return ctx.editMessageText(settingsText(settings), opts).catch(() => ctx.answerCbQuery('Yangilandi'));
    }
    return ctx.reply(settingsText(settings), opts);
  }

  bot.start(async (ctx) => {
    utils.saveUser(ctx, true).catch(() => null);
    if (isGroupChat(ctx)) {
      upsertGroup(ctx).catch(() => null);
      return ctx.reply('🛡 Guruh Manager ishga tushdi. Sozlash uchun /settings, buyruqlar uchun /help yozing.');
    }
    const username = await getBotUsername();
    const rows = [];
    if (username) rows.push([Markup.button.url('➕ Guruhga qo‘shish', `https://t.me/${username}?startgroup=true`)]);
    rows.push([Markup.button.url('👨‍💼 Yordam / admin', `https://t.me/${String(OWNER_USERNAME).replace(/^@/, '')}`)]);
    return ctx.reply(
      '🛡 <b>Ultimate Group Manager Bot</b>\n\nBu bot faqat Telegram guruhlarini boshqarish uchun ishlaydi. Uni guruhga qo‘shib, quyidagi admin huquqlarini bering:\n\n✅ Xabarlarni o‘chirish\n✅ Foydalanuvchilarni cheklash/ban\n✅ Xabarlarni pin qilish\n\nHar bir guruh administratori o‘z guruhini /settings orqali alohida sozlaydi.',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
    );
  });

  bot.command('help', async (ctx) => ctx.reply(helpText(), { parse_mode: 'HTML' }));
  bot.command('commands', async (ctx) => ctx.reply(helpText(), { parse_mode: 'HTML' }));
  bot.command('settings', async (ctx) => showSettings(ctx));

  bot.action('gm:settings', async (ctx) => {
    await ctx.answerCbQuery();
    return showSettings(ctx, true);
  });
  bot.action(/^gm:t:(anti_link|warn_on_link|clean_join|clean_leave|anti_forward|anti_flood|welcome_enabled)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await requireGroupAdmin(ctx))) return;
    const key = ctx.match[1];
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    await patchGroupSettings(ctx.chat.id, { [key]: !Boolean(settings[key]) });
    return showSettings(ctx, true);
  });

  bot.command('warn', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki /warn @username sabab / /warn ID sabab formatida yuboring.');
    return applyWarning(ctx, resolved.user, resolved.reason || 'Admin ogohlantirishi');
  });

  bot.command('warnings', async (ctx) => {
    if (!isGroupChat(ctx)) return ctx.reply('ℹ️ Bu buyruq guruhda ishlaydi.');
    let target = null;
    const resolved = await resolveTarget(ctx);
    if (resolved) target = resolved.user;
    else target = ctx.from;
    const member = await GroupMember.findOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(target.id) }).lean();
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    return ctx.reply(`⚠️ ${target.first_name || target.username || target.id}: ${member?.warns || 0}/${settings.warn_limit} ogohlantirish.${member?.last_warn_reason ? `\nOxirgi sabab: ${member.last_warn_reason}` : ''}`);
  });

  bot.command('clearwarn', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki ID/@username yuboring.');
    await GroupMember.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(resolved.user.id) }, { $set: { warns: 0, last_warn_reason: null } }, { upsert: true });
    await logAction(ctx, 'clear_warn', resolved.user.id);
    return ctx.reply('✅ Ogohlantirishlar tozalandi.');
  });

  bot.command('ban', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki /ban ID/@username sabab yuboring.');
    const protectedReason = await targetIsProtected(ctx, resolved.user.id);
    if (protectedReason) return ctx.reply(`⛔ ${protectedReason}`);
    try {
      await banUser(ctx, resolved.user, resolved.reason || 'Admin qarori');
      return ctx.reply(`🚫 User bloklandi. ${resolved.reason ? `Sabab: ${resolved.reason}` : ''}`);
    } catch (error) {
      return ctx.reply(`❌ Ban berilmadi. Botning admin huquqlarini tekshiring.\n${error.description || error.message}`);
    }
  });

  bot.command('unban', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ /unban ID yoki avval ma’lum bo‘lgan @username yuboring.');
    try {
      await bot.telegram.unbanChatMember(ctx.chat.id, resolved.user.id, { only_if_banned: true });
      await GroupMember.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(resolved.user.id) }, { $set: { status: 'active' } });
      await logAction(ctx, 'unban', resolved.user.id);
      return ctx.reply('✅ User blokdan chiqarildi.');
    } catch (error) {
      return ctx.reply(`❌ Unban xatosi: ${error.description || error.message}`);
    }
  });

  bot.command('kick', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki ID/@username yuboring.');
    const protectedReason = await targetIsProtected(ctx, resolved.user.id);
    if (protectedReason) return ctx.reply(`⛔ ${protectedReason}`);
    try {
      await bot.telegram.banChatMember(ctx.chat.id, resolved.user.id, { until_date: Math.floor(Date.now() / 1000) + 60 });
      await bot.telegram.unbanChatMember(ctx.chat.id, resolved.user.id);
      await logAction(ctx, 'kick', resolved.user.id, resolved.reason || 'Admin qarori');
      return ctx.reply('👢 User guruhdan chiqarildi. Qayta kirishi mumkin.');
    } catch (error) {
      return ctx.reply(`❌ Kick xatosi: ${error.description || error.message}`);
    }
  });

  bot.command('mute', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling. Misol: reply + /mute 10m sabab');
    const protectedReason = await targetIsProtected(ctx, resolved.user.id);
    if (protectedReason) return ctx.reply(`⛔ ${protectedReason}`);
    const payload = commandPayload(ctx);
    const tokens = payload.split(/\s+/).filter(Boolean);
    const durationRaw = resolved.source === 'reply' ? tokens[0] : tokens[1];
    const seconds = parseDuration(durationRaw, (await getGroupSettings(ctx.chat.id, ctx.chat)).mute_minutes || 60);
    const until = Math.floor(Date.now() / 1000) + Math.max(30, seconds);
    try {
      await bot.telegram.restrictChatMember(ctx.chat.id, resolved.user.id, { permissions: mutePermissions(false), until_date: until });
      await GroupMember.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(resolved.user.id) }, { $set: { status: 'muted', muted_until: new Date(until * 1000) } }, { upsert: true });
      await logAction(ctx, 'mute', resolved.user.id, resolved.reason || '', { until });
      return ctx.reply(`🔇 User ${Math.ceil(seconds / 60)} daqiqaga cheklab qo‘yildi.`);
    } catch (error) {
      return ctx.reply(`❌ Mute xatosi: ${error.description || error.message}`);
    }
  });

  bot.command('unmute', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki ID/@username yuboring.');
    try {
      await bot.telegram.restrictChatMember(ctx.chat.id, resolved.user.id, { permissions: mutePermissions(true) });
      await GroupMember.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(resolved.user.id) }, { $set: { status: 'active', muted_until: null } });
      await logAction(ctx, 'unmute', resolved.user.id);
      return ctx.reply('🔊 User cheklovi olib tashlandi.');
    } catch (error) {
      return ctx.reply(`❌ Unmute xatosi: ${error.description || error.message}`);
    }
  });

  bot.command('del', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const targetMessage = ctx.message?.reply_to_message;
    if (!targetMessage) return ctx.reply('❌ O‘chiriladigan xabarni reply qiling.');
    await bot.telegram.deleteMessage(ctx.chat.id, targetMessage.message_id).catch(() => null);
    await safeDelete(ctx);
    return logAction(ctx, 'delete_message', targetMessage.from?.id || null);
  });

  bot.command('pin', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const targetMessage = ctx.message?.reply_to_message;
    if (!targetMessage) return ctx.reply('❌ Pin qilinadigan xabarni reply qiling.');
    try {
      await bot.telegram.pinChatMessage(ctx.chat.id, targetMessage.message_id, { disable_notification: true });
      await safeDelete(ctx);
    } catch (error) {
      return ctx.reply(`❌ Pin xatosi: ${error.description || error.message}`);
    }
  });

  bot.command('unpin', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    try {
      if (ctx.message?.reply_to_message) await bot.telegram.unpinChatMessage(ctx.chat.id, ctx.message.reply_to_message.message_id);
      else await bot.telegram.unpinAllChatMessages(ctx.chat.id);
      await safeDelete(ctx);
    } catch (error) {
      return ctx.reply(`❌ Unpin xatosi: ${error.description || error.message}`);
    }
  });

  bot.command('setwarnlimit', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const n = Math.max(1, Math.min(10, Number(commandPayload(ctx))));
    if (!Number.isFinite(n)) return ctx.reply('❌ Misol: /setwarnlimit 3');
    await patchGroupSettings(ctx.chat.id, { warn_limit: n });
    return ctx.reply(`✅ Warn limiti ${n} ta qilindi.`);
  });

  bot.command('setflood', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const [limitRaw, secondsRaw] = commandPayload(ctx).split(/\s+/);
    const limit = Math.max(3, Math.min(30, Number(limitRaw)));
    const seconds = Math.max(2, Math.min(60, Number(secondsRaw)));
    if (!Number.isFinite(limit) || !Number.isFinite(seconds)) return ctx.reply('❌ Misol: /setflood 6 8');
    await patchGroupSettings(ctx.chat.id, { flood_limit: limit, flood_window_sec: seconds, anti_flood: true });
    return ctx.reply(`✅ Flood himoyasi: ${seconds} soniyada ${limit} ta xabar.`);
  });

  bot.command('setwelcome', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const text = commandPayload(ctx) || ctx.message?.reply_to_message?.text || '';
    if (!text) return ctx.reply('❌ Misol: /setwelcome Assalomu alaykum, {name}!');
    await patchGroupSettings(ctx.chat.id, { welcome_text: text, welcome_enabled: true });
    return ctx.reply('✅ Salomlashuv matni saqlandi.');
  });

  bot.command('welcome', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const raw = commandPayload(ctx).toLowerCase();
    if (!['on', 'off'].includes(raw)) return ctx.reply('❌ /welcome on yoki /welcome off');
    await patchGroupSettings(ctx.chat.id, { welcome_enabled: raw === 'on' });
    return ctx.reply(`✅ Salomlashuv ${raw === 'on' ? 'yoqildi' : 'o‘chirildi'}.`);
  });

  bot.command('setrules', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const text = commandPayload(ctx) || ctx.message?.reply_to_message?.text || '';
    if (!text) return ctx.reply('❌ Misol: /setrules Guruh qoidalari...');
    await patchGroupSettings(ctx.chat.id, { rules_text: text });
    return ctx.reply('✅ Guruh qoidalari saqlandi.');
  });

  bot.command('rules', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    return ctx.reply(settings.rules_text || DEFAULT_GROUP_SETTINGS.rules_text);
  });

  bot.command('badword', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const [action, ...rest] = commandPayload(ctx).split(/\s+/);
    const word = normalizeTitle(rest.join(' '));
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    let words = [...(settings.badwords || [])];
    if (action === 'list') return ctx.reply(words.length ? `🚫 Taqiqlangan so‘zlar:\n${words.map((w, i) => `${i + 1}. ${w}`).join('\n')}` : '📭 Taqiqlangan so‘z yo‘q.');
    if (!word || !['add', 'del'].includes(action)) return ctx.reply('❌ /badword add so‘z | /badword del so‘z | /badword list');
    if (action === 'add' && !words.includes(word)) words.push(word);
    if (action === 'del') words = words.filter((item) => item !== word);
    await patchGroupSettings(ctx.chat.id, { badwords: words });
    return ctx.reply(`✅ “${word}” ${action === 'add' ? 'qo‘shildi' : 'o‘chirildi'}.`);
  });

  bot.command('allowdomain', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const domain = commandPayload(ctx).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) return ctx.reply('❌ Misol: /allowdomain example.com');
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    const list = Array.from(new Set([...(settings.allow_domains || []), domain]));
    await patchGroupSettings(ctx.chat.id, { allow_domains: list });
    return ctx.reply(`✅ ${domain} ruxsatli domenlarga qo‘shildi.`);
  });

  bot.command('deldomain', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const domain = commandPayload(ctx).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    await patchGroupSettings(ctx.chat.id, { allow_domains: (settings.allow_domains || []).filter((item) => item !== domain) });
    return ctx.reply(`✅ ${domain || 'Domen'} ro‘yxatdan olib tashlandi.`);
  });

  bot.command('domains', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    return ctx.reply((settings.allow_domains || []).length ? `✅ Ruxsatli domenlar:\n${settings.allow_domains.join('\n')}` : '📭 Ruxsatli domenlar yo‘q.');
  });

  bot.command('trust', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki ID/@username yuboring.');
    await GroupMember.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(resolved.user.id) }, { $set: { is_whitelisted: true } }, { upsert: true });
    whitelistCache.delete(`${ctx.chat.id}:${resolved.user.id}`);
    return ctx.reply('✅ User uchun link/anti-spam istisnosi yoqildi.');
  });

  bot.command('untrust', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx);
    if (!resolved) return ctx.reply('❌ Userni reply qiling yoki ID/@username yuboring.');
    await GroupMember.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(resolved.user.id) }, { $set: { is_whitelisted: false } }, { upsert: true });
    whitelistCache.delete(`${ctx.chat.id}:${resolved.user.id}`);
    return ctx.reply('✅ User istisnosi o‘chirildi.');
  });

  bot.command('filter', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const [keyword, ...answerParts] = commandPayload(ctx).split('|').map((x) => x.trim());
    const answer = answerParts.join(' | ').trim();
    if (!keyword || !answer) return ctx.reply('❌ Misol: /filter narx | Narxlar admin bilan kelishiladi.');
    const keywordNorm = normalizeTitle(keyword);
    await GroupAutoReply.findOneAndUpdate(
      { bot_key: config.key, chat_id: String(ctx.chat.id), keyword_norm: keywordNorm },
      { $set: { keyword, answer, is_active: true, added_by: ctx.from.id, match_mode: 'exact' } },
      { upsert: true, new: true }
    );
    autoReplyCache.delete(`${ctx.chat.id}:${keywordNorm}`);
    return ctx.reply('✅ Avtomatik javob saqlandi.');
  });

  bot.command('stopfilter', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const keyword = normalizeTitle(commandPayload(ctx));
    if (!keyword) return ctx.reply('❌ Misol: /stopfilter narx');
    const result = await GroupAutoReply.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id), keyword_norm: keyword, is_active: true }, { $set: { is_active: false } });
    autoReplyCache.delete(`${ctx.chat.id}:${keyword}`);
    return ctx.reply(result.modifiedCount ? '✅ Avtomatik javob o‘chirildi.' : '❌ Topilmadi.');
  });

  bot.command('filters', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const list = await GroupAutoReply.find({ bot_key: config.key, chat_id: String(ctx.chat.id), is_active: true }).sort({ createdAt: -1 }).limit(50).lean();
    return ctx.reply(list.length ? `🤖 Avtomatik javoblar:\n\n${list.map((item, i) => `${i + 1}. ${item.keyword} → ${item.answer}`).join('\n')}` : '📭 Avtomatik javob yo‘q.');
  });

  bot.command('report', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const targetMessage = ctx.message?.reply_to_message;
    if (!targetMessage || !targetMessage.from) return ctx.reply('❌ Shikoyat qilinadigan xabarni reply qiling.');
    const reason = commandPayload(ctx) || 'Sabab ko‘rsatilmagan';
    await saveGroupMember(ctx, targetMessage.from, {}, { reports_received: 1 });
    await logAction(ctx, 'report', targetMessage.from.id, reason, { message_id: targetMessage.message_id });
    const admins = await bot.telegram.getChatAdministrators(ctx.chat.id).catch(() => []);
    const adminMentions = admins.filter((a) => !a.user.is_bot).slice(0, 5).map((a) => mentionHtml(a.user.id, a.user.first_name)).join(', ');
    const sent = await ctx.reply(`🚨 Adminlarga shikoyat yuborildi. ${adminMentions}\nSabab: ${htmlEscape(reason)}`, { parse_mode: 'HTML' });
    deleteMessageLater(ctx.chat.id, sent.message_id, 20);
    deleteMessageLater(ctx.chat.id, ctx.message.message_id, 3);
  });

  bot.command('admins', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const admins = await bot.telegram.getChatAdministrators(ctx.chat.id).catch(() => []);
    if (!admins.length) return ctx.reply('❌ Adminlar ro‘yxatini olib bo‘lmadi.');
    return ctx.reply(`👮 <b>Guruh administratorlari</b>\n\n${admins.filter((a) => !a.user.is_bot).map((a, i) => `${i + 1}. ${mentionHtml(a.user.id, a.user.first_name)} — ${a.status}`).join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.command('id', async (ctx) => {
    const replied = ctx.message?.reply_to_message?.from;
    return ctx.reply(`🆔 Guruh ID: <code>${ctx.chat.id}</code>\n👤 Sizning ID: <code>${ctx.from.id}</code>${replied ? `\n↩️ Reply user ID: <code>${replied.id}</code>` : ''}`, { parse_mode: 'HTML' });
  });

  bot.command('groupstats', async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const chatId = String(ctx.chat.id);
    const [group, members, warned, banned, actions] = await Promise.all([
      GroupChat.findOne({ bot_key: config.key, chat_id: chatId }).lean(),
      GroupMember.countDocuments({ bot_key: config.key, chat_id: chatId }),
      GroupMember.countDocuments({ bot_key: config.key, chat_id: chatId, warns: { $gt: 0 } }),
      GroupMember.countDocuments({ bot_key: config.key, chat_id: chatId, status: 'banned' }),
      GroupAction.countDocuments({ bot_key: config.key, chat_id: chatId })
    ]);
    return ctx.reply(
      `📊 GURUH STATISTIKASI\n\n👥 Kuzatilgan a’zolar: ${members}\n⚠️ Warn olganlar: ${warned}\n🚫 Bloklanganlar: ${banned}\n🧹 O‘chirilgan xabarlar: ${group?.deleted_messages || 0}\n⚠️ Berilgan warnlar: ${group?.warnings_issued || 0}\n📋 Moderatsiya amallari: ${actions}`
    );
  });

  bot.on('my_chat_member', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const update = ctx.myChatMember || ctx.update?.my_chat_member;
    const status = update?.new_chat_member?.status;
    const isActive = ['member', 'administrator'].includes(status);
    const isAdmin = status === 'administrator';
    await upsertGroup(ctx, { bot_is_admin: isAdmin, is_active: isActive }).catch(() => null);
    if (isActive) {
      const text = isAdmin
        ? '✅ Guruh Manager ulandi va admin huquqlarini oldi.\n\n⚙️ /settings — sozlash\n📖 /help — barcha buyruqlar'
        : '⚠️ Guruh Manager qo‘shildi, lekin to‘liq ishlashi uchun botga admin huquqi bering: xabarlarni o‘chirish, userlarni ban/restrict qilish va pin.';
      await ctx.reply(text).catch(() => null);
    }
  });

  bot.on('new_chat_members', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    upsertGroup(ctx).catch(() => null);
    GroupChat.updateOne(
      { bot_key: config.key, chat_id: String(ctx.chat.id) },
      { $inc: { members_seen: (ctx.message.new_chat_members || []).filter((u) => !u.is_bot).length } }
    ).catch(() => null);
    for (const member of ctx.message.new_chat_members || []) {
      if (!member.is_bot) saveGroupMember(ctx, member, { status: 'active', joined_at: new Date(), left_at: null }).catch(() => null);
    }
    if (settings.clean_join !== false) await safeDelete(ctx);
    if (settings.welcome_enabled) {
      for (const member of ctx.message.new_chat_members || []) {
        if (member.is_bot) continue;
        const text = String(settings.welcome_text || DEFAULT_GROUP_SETTINGS.welcome_text)
          .replace(/\{name\}/g, member.first_name || 'do‘st')
          .replace(/\{username\}/g, member.username ? `@${member.username}` : '');
        const sent = await ctx.reply(text).catch(() => null);
        if (sent) deleteMessageLater(ctx.chat.id, sent.message_id, 60);
      }
    }
  });

  bot.on('left_chat_member', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    const member = ctx.message.left_chat_member;
    if (member && !member.is_bot) saveGroupMember(ctx, member, { status: 'left', left_at: new Date() }).catch(() => null);
    if (settings.clean_leave !== false) await safeDelete(ctx);
  });

  bot.on('message', async (ctx) => {
    if (!isGroupChat(ctx) || !ctx.message || !ctx.from || ctx.from.is_bot) return;
    utils.saveUser(ctx).catch(() => null);
    saveGroupMember(ctx, ctx.from, {}, { messages_count: 1 }).catch(() => null);
    GroupChat.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id) }, { $inc: { messages_seen: 1 }, $set: { last_active_at: new Date(), title: ctx.chat.title || null } }, { upsert: true }).catch(() => null);

    const text = extractTextAndCaption(ctx.message);
    if (text.startsWith('/')) return;
    const settings = await getGroupSettings(ctx.chat.id, ctx.chat);
    const isAdmin = await isChatAdmin(ctx.chat.id, ctx.from.id);
    if (isAdmin) return;

    const whitelistKey = `${ctx.chat.id}:${ctx.from.id}`;
    let whitelistState = whitelistCache.get(whitelistKey);
    if (!whitelistState || Date.now() - whitelistState.at > 30_000) {
      const memberRecord = await GroupMember.findOne({ bot_key: config.key, chat_id: String(ctx.chat.id), user_id: Number(ctx.from.id) }).select('is_whitelisted').lean().catch(() => null);
      whitelistState = { at: Date.now(), value: Boolean(memberRecord?.is_whitelisted) };
      whitelistCache.set(whitelistKey, whitelistState);
    }
    if (whitelistState.value) return;

    let violation = null;
    let statField = null;
    if (settings.anti_link !== false && messageHasLink(ctx.message, settings)) {
      violation = 'Ruxsatsiz link/reklama yuborildi';
      statField = 'links_deleted';
    } else if (settings.anti_forward === true && isForwarded(ctx.message)) {
      violation = 'Forward/reklama xabari yuborildi';
      statField = 'deleted_count';
    } else {
      const norm = normalizeTitle(text);
      const badword = (settings.badwords || []).find((word) => word && norm.includes(normalizeTitle(word)));
      if (badword) {
        violation = `Taqiqlangan so‘z ishlatildi: ${badword}`;
        statField = 'badwords_deleted';
      } else if (isFlood(ctx.chat.id, ctx.from.id, settings)) {
        violation = 'Juda tez ko‘p xabar yuborildi (flood)';
        statField = 'flood_deleted';
      }
    }

    if (violation) {
      await safeDelete(ctx);
      GroupChat.updateOne({ bot_key: config.key, chat_id: String(ctx.chat.id) }, { $inc: { deleted_messages: 1 } }).catch(() => null);
      const increments = { deleted_count: 1 };
      if (statField) increments[statField] = 1;
      saveGroupMember(ctx, ctx.from, {}, increments).catch(() => null);
      if (settings.warn_on_link !== false || statField !== 'links_deleted') {
        await applyWarning(ctx, ctx.from, violation, true);
      } else {
        await tempReply(ctx, `🛡 ${ctx.from.first_name || 'Foydalanuvchi'}, ${violation.toLowerCase()}.`, settings);
      }
      return;
    }

    if (text) {
      const norm = normalizeTitle(text);
      const replyCacheKey = `${ctx.chat.id}:${norm}`;
      let cachedReply = autoReplyCache.get(replyCacheKey);
      if (!cachedReply || Date.now() - cachedReply.at > 30_000) {
        const exact = await GroupAutoReply.findOne({ bot_key: config.key, chat_id: String(ctx.chat.id), keyword_norm: norm, is_active: true }).lean().catch(() => null);
        cachedReply = { at: Date.now(), value: exact?.answer || null };
        autoReplyCache.set(replyCacheKey, cachedReply);
      }
      if (cachedReply.value) return ctx.reply(cachedReply.value);
    }
  });

  bot.catch((err, ctx) => console.error(`❌ ${config.title} xatosi update ${ctx.update?.update_id}:`, err));
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
    telegramUsername: record.telegram_username,
    tariffKey: record.tariff_key || 'standard'
  };
}

function managedWebhookPath(botKey) {
  return `/webhook/${encodeURIComponent(String(botKey || ''))}`;
}

async function ensureActiveManagedBot(botKey, source = 'lazy_webhook') {
  const key = String(botKey || '').trim();
  if (!key) return null;
  if (activeBots.has(key)) return activeBots.get(key);
  if (!(mongoReady && mongoose.connection.readyState === 1)) return null;

  const record = await ManagedBot.findOne({ bot_key: key, status: 'approved', is_enabled: true });
  if (!record) return null;
  try {
    await startManagedRecord(record, source);
  } catch (error) {
    console.error(`❌ Lazy managed bot start xatosi ${key}:`, error.message);
  }
  return activeBots.get(key) || null;
}

async function syncActiveBotWebhook(active, source = 'manual') {
  if (!active || !active.key || !active.bot) return false;

  if (URL) {
    const webhookPath = managedWebhookPath(active.key);
    const fullUrl = `${URL}${webhookPath}`;
    await active.bot.telegram.setWebhook(fullUrl, {
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: false,
      allowed_updates: ['message', 'channel_post', 'callback_query', 'chat_member', 'my_chat_member', 'chat_join_request']
    });
    console.log(`🌐 ${active.title} webhook o'rnatildi (${source}): ${fullUrl}`);
  } else {
    await active.bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await active.bot.launch();
    console.log(`🤖 ${active.title} polling rejimida ishga tushdi (${source})`);
  }

  return true;
}

async function activateBot(active, source = 'manual') {
  if (!active || !active.key || !active.bot) return false;

  const already = activeBots.get(active.key);
  if (already) {
    // Render qayta deploy yoki Telegram webhook boshqa joyga ketib qolgan bo‘lsa,
    // har safar tasdiqlash/uzaytirishda webhookni qayta sinxron qilamiz.
    await syncActiveBotWebhook(already, `${source}_resync`);
    return true;
  }

  try {
    await syncActiveBotWebhook(active, source);
    activeBots.set(active.key, active);
    return true;
  } catch (error) {
    activeBots.delete(active.key);
    try { active.bot.stop?.('activation_failed'); } catch (_) {}
    throw error;
  }
}

async function handleRuntimeWebhook(req, res) {
  if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const botKey = String(req.params.botKey || '').trim();
  let active = activeBots.get(botKey);
  if (!active) active = await ensureActiveManagedBot(botKey, 'incoming_webhook');
  if (!active || !active.bot) {
    // Telegram qayta-qayta xato deb yubormasligi uchun 200 qaytaramiz,
    // lekin logda sabab ko‘rinadi.
    console.error(`⚠️ Webhook keldi, lekin aktiv bot topilmadi: ${botKey}. MongoDB: ${mongoReady ? 'connected' : 'connecting'}`);
    return res.status(200).json({ ok: true, ignored: true, reason: 'bot_not_active' });
  }

  try {
    await active.bot.handleUpdate(req.body, res);
    if (!res.headersSent) res.sendStatus(200);
  } catch (error) {
    console.error(`❌ ${active.title || botKey} webhook update xatosi:`, error);
    if (!res.headersSent) res.sendStatus(200);
  }
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

function addDaysSafe(date, days = 3) {
  const d = new Date(date || Date.now());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function normalizeTariffKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'plus' ? 'plus' : 'standard';
}

function tariffTitle(key) {
  return normalizeTariffKey(key) === 'plus' ? 'Plus — toza bot' : 'Standard — marketingli';
}

function tariffDescription(key) {
  return normalizeTariffKey(key) === 'plus'
    ? '✅ Plus: bot xabarlari toza bo‘ladi, reklama/watermark qo‘shilmaydi.'
    : `✅ Standard: har bir foydalanuvchi xabari ostida ${BUILDER_BOT_USERNAME} reklama matni chiqadi.`;
}

function tariffPrice(basePrice, tariffKey) {
  const base = Number(basePrice || 0);
  if (normalizeTariffKey(tariffKey) === 'plus') {
    const fixed = Number(process.env.FACTORY_PLUS_MONTHLY_PRICE || process.env.PLUS_MONTHLY_PRICE || 0);
    return fixed > 0 ? fixed : Math.round(base * PLUS_PRICE_MULTIPLIER);
  }
  return base;
}

function tariffRows(basePrice = 0, currency = 'UZS') {
  return [
    [Markup.button.callback(`Standard • ${formatMoney(tariffPrice(basePrice, 'standard'), currency)} / oy`, 'factory:tariff:standard')],
    [Markup.button.callback(`Plus • ${formatMoney(tariffPrice(basePrice, 'plus'), currency)} / oy`, 'factory:tariff:plus')]
  ];
}

function shouldWatermarkRecord(recordOrConfig) {
  if (!recordOrConfig) return false;
  return normalizeTariffKey(recordOrConfig.tariff_key || recordOrConfig.tariffKey || 'standard') === 'standard';
}

function footerLineUrlFromSub(sub) {
  const url = subJoinUrl(sub);
  const label = (sub?.title || sub?.chat_username || '').trim();
  if (url && label) return `${label}: ${url}`;
  if (url) return url;
  return label || '';
}

async function buildManagedBotFooter(config) {
  const lines = [];
  const username = String(config.telegramUsername || config.telegram_username || '').replace(/^@/, '').trim();
  if (username) lines.push(`🤖 Bot: @${username} — https://t.me/${username}`);

  try {
    if (mongoReady && mongoose.connection.readyState === 1 && config.key) {
      const subs = await Subscription.find({ bot_key: config.key }).sort({ createdAt: 1 }).limit(6);
      const publicLines = subs.map(footerLineUrlFromSub).filter(Boolean);
      if (publicLines.length) lines.push(`📌 Kanal/guruhlar:\n${publicLines.map((x) => `• ${x}`).join('\n')}`);
    }
  } catch (_) {}

  const tariff = await getManagedTariffKey(config.key, config.tariffKey || 'standard');
  if (tariff === 'standard' && STANDARD_WATERMARK_TEXT) lines.push(STANDARD_WATERMARK_TEXT);
  return lines.join('\n\n').trim();
}

function appendFooterText(text, footer, maxLen = 4096) {
  const base = String(text || '').trim();
  const f = String(footer || '').trim();
  if (!f || base.includes(f)) return text;
  const sep = base ? '\n\n' : '';
  const allowedBase = Math.max(0, maxLen - sep.length - f.length);
  const safeBase = base.length > allowedBase ? `${base.slice(0, Math.max(0, allowedBase - 1))}…` : base;
  return `${safeBase}${sep}${f}`.trim();
}

function appendWatermarkText(text, maxLen = 4096) {
  return appendFooterText(text, STANDARD_WATERMARK_TEXT, maxLen);
}

async function getManagedTariffKey(botKey, fallback = 'standard') {
  const key = String(botKey || '').trim();
  if (!key) return normalizeTariffKey(fallback);
  try {
    if (mongoReady && mongoose.connection.readyState === 1) {
      const rec = await ManagedBot.findOne({ bot_key: key }).select('tariff_key');
      if (rec?.tariff_key) return normalizeTariffKey(rec.tariff_key);
    }
  } catch (_) {}
  return normalizeTariffKey(fallback);
}

function applyManagedPlanFeatures(bot, config, adminIds = []) {
  if (!bot || !config?.managed || bot.__managedPlanFeaturesApplied) return;
  bot.__managedPlanFeaturesApplied = true;
  const original = {
    sendMessage: bot.telegram.sendMessage.bind(bot.telegram),
    sendPhoto: bot.telegram.sendPhoto.bind(bot.telegram),
    sendVideo: bot.telegram.sendVideo.bind(bot.telegram),
    sendAnimation: bot.telegram.sendAnimation.bind(bot.telegram),
    sendDocument: bot.telegram.sendDocument.bind(bot.telegram),
    sendAudio: bot.telegram.sendAudio.bind(bot.telegram),
    sendVoice: bot.telegram.sendVoice.bind(bot.telegram),
    copyMessage: bot.telegram.copyMessage.bind(bot.telegram)
  };
  const excluded = new Set([...(GLOBAL_ADMIN_IDS || []), ...(adminIds || [])].map(Number).filter(Boolean));
  const isPrivateUserChat = (chatId) => /^\d+$/.test(String(chatId || ''));
  const shouldAddFooter = (chatId) => {
    if (!isPrivateUserChat(chatId)) return false;
    if (excluded.has(Number(chatId))) return false;
    return true;
  };
  const footerFor = async (chatId) => shouldAddFooter(chatId) ? await buildManagedBotFooter(config) : '';
  const withCaption = async (chatId, extra = {}) => {
    const nextExtra = { ...(extra || {}) };
    const footer = await footerFor(chatId);
    if (footer) nextExtra.caption = appendFooterText(nextExtra.caption || '', footer, 1024);
    return nextExtra;
  };

  bot.telegram.sendMessage = async (chatId, text, extra = {}) => {
    const footer = await footerFor(chatId);
    const finalText = footer ? appendFooterText(text, footer, 4096) : text;
    return original.sendMessage(chatId, finalText, extra);
  };
  bot.telegram.sendPhoto = async (chatId, photo, extra = {}) => original.sendPhoto(chatId, photo, await withCaption(chatId, extra));
  bot.telegram.sendVideo = async (chatId, video, extra = {}) => original.sendVideo(chatId, video, await withCaption(chatId, extra));
  bot.telegram.sendAnimation = async (chatId, animation, extra = {}) => original.sendAnimation(chatId, animation, await withCaption(chatId, extra));
  bot.telegram.sendDocument = async (chatId, doc, extra = {}) => original.sendDocument(chatId, doc, await withCaption(chatId, extra));
  bot.telegram.sendAudio = async (chatId, audio, extra = {}) => original.sendAudio(chatId, audio, await withCaption(chatId, extra));
  bot.telegram.sendVoice = async (chatId, voice, extra = {}) => original.sendVoice(chatId, voice, await withCaption(chatId, extra));
  bot.telegram.copyMessage = async (chatId, fromChatId, messageId, extra = {}) => {
    const sent = await original.copyMessage(chatId, fromChatId, messageId, extra);
    const footer = await footerFor(chatId);
    if (footer) {
      try { await original.sendMessage(chatId, footer); } catch (_) {}
    }
    return sent;
  };
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
              `🏷 Tarif: ${tariffTitle(rec.tariff_key)}\n` +
          `💰 Oylik narx: ${formatMoney(rec.monthly_price, rec.currency)} / oy\n` +
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
  record.monthly_price = Number(tariffPrice(plan.monthly_price || record.monthly_price || 0, record.tariff_key || 'standard'));
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
  const [users, activeUsers, blockedUsers, contents, singles, withParts, parts, subs, viewsAgg, partViewsAgg, formFields, formSubs, autoPosts, vipReqs, vipMembers, giveaways, giveawayParts, faqs] = await Promise.all([
    User.countDocuments({ bot_key: botKey }),
    User.countDocuments({ bot_key: botKey, is_blocked: { $ne: true } }),
    User.countDocuments({ bot_key: botKey, is_blocked: true }),
    Content.countDocuments({ bot_key: botKey, is_active: true }),
    Content.countDocuments({ bot_key: botKey, has_parts: false, is_active: true }),
    Content.countDocuments({ bot_key: botKey, has_parts: true, is_active: true }),
    ContentPart.countDocuments({ bot_key: botKey, is_active: true }),
    Subscription.countDocuments({ bot_key: botKey }),
    Content.aggregate([{ $match: { bot_key: botKey, is_active: true } }, { $group: { _id: null, total: { $sum: '$views' }, searches: { $sum: '$search_count' } } }]),
    ContentPart.aggregate([{ $match: { bot_key: botKey, is_active: true } }, { $group: { _id: null, total: { $sum: '$views' } } }]),
    FormField.countDocuments({ bot_key: botKey, is_active: true }),
    FormSubmission.countDocuments({ bot_key: botKey }),
    AutoPost.countDocuments({ bot_key: botKey, is_active: true }),
    VipRequest.countDocuments({ bot_key: botKey }),
    VipMember.countDocuments({ bot_key: botKey, is_active: true }),
    Giveaway.countDocuments({ bot_key: botKey }),
    GiveawayParticipant.countDocuments({ bot_key: botKey }),
    GroupFaq.countDocuments({ bot_key: botKey, is_active: true })
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
    partViews: partViewsAgg[0]?.total || 0,
    formFields,
    formSubmissions: formSubs,
    autoPosts,
    vipRequests: vipReqs,
    vipMembers,
    giveaways,
    giveawayParticipants: giveawayParts,
    faqs
  };
}

function botStatusLabel(record) {
  if (record?.status === 'approved' && record?.is_enabled && record?.payment_status === 'trial') {
    return `🎁 ${TRIAL_DAYS} kunlik sinov aktiv (${formatDate(record.current_period_end)})`;
  }
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
    `💰 Oylik narx: ${formatMoney(record.monthly_price, record.currency)} / oy
` +
    `🏷 Tarif: ${tariffTitle(record.tariff_key)}
` +
    `🎁 Sinov: ${formatDate(record.trial_started_at)} — ${formatDate(record.trial_ends_at)}
` +
    `📅 Boshlangan: ${formatDate(record.billing_started_at)}
` +
    `⏳ Keyingi to‘lov: ${formatDate(record.current_period_end)}
` +
    `🧾 To‘lov holati: ${record.payment_status || '—'}

` +
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
  const preset = getPreset(record.type_key);
  const engine = preset.engine || 'content';
  let active = null;
  if (engine === 'vip') active = createVipBot(config, token, adminIds);
  else if (engine === 'giveaway') active = createGiveawayBot(config, token, adminIds);
  else if (engine === 'channel_form') active = createChannelFormBot(config, token, adminIds);
  else if (engine === 'group_tools') active = createGroupToolsBot(config, token, adminIds);
  else if (engine === 'chat_learning') active = createChatLearningBot(config, token, adminIds);
  else active = createContentBot(config, token, adminIds);
  if (!active) return null;
  await activateBot(active, source);
  return active;
}

function typeRows(prefix = 'factory:type') {
  const entries = Object.entries(TYPE_PRESETS).filter(([, preset]) => preset && preset.title);
  const rows = [];
  for (const [key, preset] of entries) {
    const engineLabel = preset.engine === 'vip' ? 'VIP' : preset.engine === 'giveaway' ? 'Konkurs' : preset.engine === 'channel_form' ? 'Kanal' : preset.engine === 'group_tools' ? 'Guruh' : preset.engine === 'chat_learning' ? 'Suhbatchi' : 'Media';
    rows.push([Markup.button.callback(`${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title} • ${engineLabel}`, `${prefix}:${key}`)]);
  }
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
      await safeDbWrite('FactoryUser activity', () => FactoryUser.updateOne(
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
      ));
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
    const parsed = parseSubscriptionInput(text, type);
    if (!parsed) {
      return ctx.reply(
        '❌ Kanal/guruh noto‘g‘ri. Qayta yuboring:\n\n' +
          'Public: @kanal yoki https://t.me/kanal\n' +
          'Private/zayavka: Kanal nomi | https://t.me/+invite | zayavka\n' +
          'Aniq tekshiruv: Kanal nomi | -1001234567890 | zayavka'
      );
    }

    try {
      await Subscription.updateOne(
        { bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY, chat_username: parsed.chat_username },
        { $set: { ...parsed, added_by: ctx.from.id } },
        { upsert: true }
      );
      reset(ctx);
      const testHint = parsed.requires_request
        ? '\n\n⚠️ Zayavka/private link ishlashi uchun FactoryBot shu kanal/guruhda admin bo‘lsin. User zayavka yuborsa, FactoryBot buni DB’da yozadi va tekshiruvda ruxsat beradi.'
        : '\n\n⚠️ Tekshiruv uchun FactoryBot o‘sha kanal/guruhda admin bo‘lishi kerak.';
      return ctx.reply(`✅ Global majburiy obuna qo‘shildi: ${subLabel(parsed)}\n\nEndi bu obuna BotFactory va barcha yaratilgan botlarda tekshiriladi.${testHint}`, userKeyboard(ctx));
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
    const list = subs.map((sub, i) => `${i + 1}. ${subLabel(sub)} — ${sub.createdAt ? formatDate(sub.createdAt) : '—'}${sub.join_url ? `\n   🔗 ${sub.join_url}` : ''}${sub.chat_ref ? `\n   🆔 ${sub.chat_ref}` : ''}`).join('\n');
    return ctx.reply(
      `🌐 GLOBAL MAJBURIY OBUNALAR\n\n${list}\n\n` +
        `Bu ro‘yxat barcha yaratilgan botlarda ishlaydi. Tekshiruv FactoryBot tokeni orqali bajariladi.`,
      userKeyboard(ctx)
    );
  }

  async function removeGlobalSubscription(ctx, text) {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    const q = String(text || '').trim();
    const parsed = parseSubscriptionInput(q, 'channel');
    const ors = [];
    if (parsed?.chat_username) ors.push({ chat_username: parsed.chat_username });
    if (parsed?.chat_ref) ors.push({ chat_ref: parsed.chat_ref });
    if (parsed?.join_url) ors.push({ join_url: parsed.join_url }, { invite_link: parsed.join_url });
    const norm = normalizeUsername(q);
    if (norm) ors.push({ chat_username: norm }, { chat_ref: norm }, { chat_id: norm });
    if (q) ors.push({ chat_username: q }, { title: new RegExp(escapeRegex(q), 'i') });
    if (!ors.length) return ctx.reply('❌ O‘chirish uchun nom, @username, -100... yoki invite link yuboring.');
    const result = await Subscription.deleteOne({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY, $or: ors });
    reset(ctx);
    if (result.deletedCount) return ctx.reply('✅ Global obuna o‘chirildi.', userKeyboard(ctx));
    return ctx.reply('❌ Bunday global obuna topilmadi.', userKeyboard(ctx));
  }

  async function checkFactoryGlobalSubscriptions(userId) {
    if (isOwner(userId)) return true;
    const ready = await waitForMongoConnection(700);
    if (!ready) return false;
    const subs = await Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 });
    if (!subs.length) return true;
    for (const sub of subs) {
      const checked = await checkOneSubscription(sub, bot.telegram, userId);
      if (!checked.ok) return false;
    }
    return true;
  }

  async function factoryGlobalSubscriptionKeyboard() {
    if (!(mongoReady && mongoose.connection.readyState === 1)) return Markup.inlineKeyboard([[Markup.button.callback('✅ Obunani tekshirish', 'factory_check_global_subscription')]]);
    const subs = await Subscription.find({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY }).sort({ createdAt: 1 });
    const rows = [];
    for (const sub of subs) {
      const url = subJoinUrl(sub);
      if (url) rows.push([Markup.button.url(`🌐 ${subLabel(sub)}`, url)]);
      else rows.push([Markup.button.callback(`🌐 ${subLabel(sub)}`, 'noop')]);
    }
    rows.push([Markup.button.callback('✅ Obunani tekshirish', 'factory_check_global_subscription')]);
    return Markup.inlineKeyboard(rows);
  }

  async function sendFactoryGlobalSubscriptionWarning(ctx) {
    const keyboard = await factoryGlobalSubscriptionKeyboard();
    return ctx.reply(
      '🔒 BotFactory’dan foydalanish uchun avval majburiy kanal/guruhlarga obuna bo‘ling yoki zayavka yuboring.\n\nObuna/zayavkadan keyin “✅ Obunani tekshirish” tugmasini bosing.',
      keyboard
    );
  }

  // FactoryBotning o‘zida ham global majburiy obuna ishlaydi.
  // Adminlar cheklanmaydi, obunani tekshirish callbacklariga esa ruxsat beriladi.
  bot.use(async (ctx, next) => {
    if (!ctx.from || isOwner(ctx.from.id)) return next();
    // Factory global obunasi faqat FactoryBot private chatida ishlaydi.
    // Kanal/guruh update'lariga javob yozilmaydi.
    if (ctx.chat && ctx.chat.type !== 'private') return next();
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
    if (!(await requireMongo(ctx, 'Tariflarni koʻrish uchun maʼlumotlar bazasi kerak'))) return;
    await seedDefaultPlans();
    const plans = await BotPlan.find({ is_active: true }).sort({ type_key: 1 });
    const lines = plans.map((p, i) => {
      const base = Number(p.monthly_price || 0);
      return `${i + 1}. ${getPreset(p.type_key).mainEmoji || '🤖'} ${p.title || p.type_key}
` +
        `   🏷 Standard: ${formatMoney(tariffPrice(base, 'standard'), p.currency)} / oy — marketingli
` +
        `   💎 Plus: ${formatMoney(tariffPrice(base, 'plus'), p.currency)} / oy — toza`;
    });
    return ctx.reply(
      `💰 BOT TARIF NARXLARI

` +
        `🎁 Yaratish: bepul ${TRIAL_DAYS} kun sinov
` +
        `✅ Sinov muddati tugaguncha bot ishlaydi.
` +
        `💳 Keyin admin obunani 1 oyga uzaytiradi/tiklaydi.

` +
        `🏷 Standard — xabar ostida ${BUILDER_BOT_USERNAME} marketingi chiqadi.
` +
        `💎 Plus — xabarlar toza, reklamasiz bo‘ladi.

` +
        `${lines.join('\n\n') || 'Tariflar topilmadi.'}`,
      userKeyboard(ctx)
    );
  }

  async function showMyBots(ctx) {
    const list = await ManagedBot.find({ owner_user_id: ctx.from.id }).sort({ createdAt: -1 }).limit(20);
    if (!list.length) return ctx.reply('📭 Sizda hali bot soʻrovi yoʻq.', userKeyboard(ctx));

    const lines = list.map((b, i) => {
      const preset = getPreset(b.type_key);
      return (
        `${i + 1}. ${preset.mainEmoji || '🤖'} ${b.title} — @${b.telegram_username}
` +
        `   Turi: ${preset.itemTitle || b.type_key} | Holat: ${botStatusLabel(b)}
` +
        `   🏷 ${tariffTitle(b.tariff_key)} | 💰 ${formatMoney(b.monthly_price, b.currency)} / oy | ⏳ ${formatDate(b.current_period_end)}`
      );
    });

    return ctx.reply(`📋 Mening botlarim:

${lines.join('\n\n')}\n\nObunani tiklash/uzaytirish uchun ${OWNER_USERNAME} ga yozing.`, userKeyboard(ctx));
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
          `🏷 Tarif: ${tariffTitle(req.tariff_key)}\n` +
          `💰 Oylik narx: ${formatMoney(req.monthly_price, req.currency)} / oy\n` +
          `🔐 Token: ${req.token_mask || '***'}\n\n` +
          `Yaratish bepul, yangi botlar ${TRIAL_DAYS} kun sinov bilan avtomatik ishlaydi. Kerak bo‘lsa 1 oyga uzaytiring yoki rad/to‘xtating.`,
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
    const [total, pending, approved, expired, rejected, disabled, totalUsers, activeUsers, totalContents, totalParts, formSubs, autoPosts, vipReqs, vipMembers, giveaways, giveawayParts, faqs, factoryUsers, broadcasts, globalSubs] = await Promise.all([
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
      FormSubmission.countDocuments(),
      AutoPost.countDocuments({ is_active: true }),
      VipRequest.countDocuments(),
      VipMember.countDocuments({ is_active: true }),
      Giveaway.countDocuments(),
      GiveawayParticipant.countDocuments(),
      GroupFaq.countDocuments({ is_active: true }),
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
    await safeDbWrite('FactoryUser /start', () => FactoryUser.updateOne({ user_id: ctx.from.id }, { $inc: { starts: 1 }, $set: { last_active_at: new Date(), is_blocked: false } }, { upsert: true }));
    reset(ctx);
    return ctx.reply(
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
  });

  bot.command('cancel', async (ctx) => {
    reset(ctx);
    return ctx.reply('❌ Jarayon bekor qilindi.', userKeyboard(ctx));
  });

  bot.hears('☎️ Admin bilan kelishish', async (ctx) => {
    return ctx.reply(`Narx, muddat va ruxsat uchun admin bilan bog‘laning: ${OWNER_USERNAME}`, Markup.inlineKeyboard([[Markup.button.url('Admin bilan yozishish', `https://t.me/${OWNER_USERNAME.replace('@', '')}`)]]));
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
    return ctx.reply('🌐 Global majburiy kanal yuboring.\n\nFormatlar:\n@kanal\nhttps://t.me/kanal\nKanal nomi | https://t.me/+privateInvite | zayavka\nKanal nomi | -1001234567890 | zayavka\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('🌐 Global guruh qoʻshish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'global_add_group';
    ctx.session.draft = {};
    return ctx.reply('🌐 Global majburiy guruh yuboring.\n\nFormatlar:\n@guruh\nhttps://t.me/guruh\nGuruh nomi | https://t.me/+privateInvite | zayavka\nGuruh nomi | -1001234567890 | zayavka\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('🌐 Global obunalar', showGlobalSubscriptions);

  bot.hears('🌐 Global obuna oʻchirish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'global_remove_subscription';
    ctx.session.draft = {};
    return ctx.reply('🌐 O‘chiriladigan global obuna nomi, @username, -100... yoki invite link yuboring.\n\n❌ Bekor qilish: /cancel');
  });

  bot.hears('✏️ Narx oʻzgartirish', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Faqat asosiy admin uchun.');
    ctx.session.mode = 'set_price';
    return ctx.reply(
      `✏️ Tarif narxini o‘zgartirish.\n\nFormat:\ntur | narx | valyuta\n\nMisol:\nkino | 50000 | UZS\ndorama | 70000 | UZS\n\nTur kalitlari: ${Object.keys(TYPE_PRESETS).join(', ')}\n\n❌ Bekor qilish: /cancel`
    );
  });

  bot.hears('🤖 Bot tayyorlash', async (ctx) => {
    if (!(await requireMongo(ctx, 'Bot yaratish uchun maʼlumotlar bazasi kerak'))) return;
    reset(ctx);
    ctx.session.mode = 'wait_token';
    return ctx.reply(
      `🤖 Yangi bot tayyorlash boshlandi.

` +
        `BotFather’dan olingan bot tokenni yuboring.

` +
        `⚠️ Faqat o‘zingiz yaratgan bot tokenini yuboring. Token DB’da shifrlanadi.

` +
        `❌ Bekor qilish: /cancel`
    );
  });

  bot.action(/^factory:type:([a-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const typeKey = ctx.match[1];
    if (!ctx.session.draft?.token_enc) return ctx.reply('❌ Sessiya tugagan. Qaytadan “🤖 Bot tayyorlash” bosing.');
    const preset = getPreset(typeKey);
    const plan = await getOrCreatePlan(typeKey);
    ctx.session.draft.type_key = typeKey;
    ctx.session.draft.base_monthly_price = Number(plan.monthly_price || 0);
    ctx.session.draft.currency = plan.currency || 'UZS';
    ctx.session.mode = 'wait_tariff';
    return ctx.editMessageText(
      `✅ Bot turi tanlandi: ${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title}

` +
        `Endi tarifni tanlang:

` +
        `🏷 Standard — arzon, xabarlar ostida ${BUILDER_BOT_USERNAME} marketingi chiqadi.
` +
        `💎 Plus — bot xabarlari toza, reklamasiz bo‘ladi.`,
      Markup.inlineKeyboard(tariffRows(plan.monthly_price, plan.currency))
    );
  });

  bot.action(/^factory:tariff:(standard|plus)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.draft?.token_enc || !ctx.session.draft?.type_key) return ctx.reply('❌ Sessiya tugagan. Qaytadan “🤖 Bot tayyorlash” bosing.');
    const tariffKey = normalizeTariffKey(ctx.match[1]);
    const preset = getPreset(ctx.session.draft.type_key);
    const currency = ctx.session.draft.currency || 'UZS';
    const price = tariffPrice(ctx.session.draft.base_monthly_price, tariffKey);
    ctx.session.draft.tariff_key = tariffKey;
    ctx.session.draft.monthly_price = price;
    ctx.session.draft.currency = currency;
    ctx.session.mode = 'wait_title';
    return ctx.editMessageText(
      `✅ Tarif tanlandi: ${tariffTitle(tariffKey)}
` +
        `💰 Oylik narx: ${formatMoney(price, currency)} / oy
` +
        `🎁 ${TRIAL_DAYS} kun sinov bepul.

` +
        `${tariffDescription(tariffKey)}

` +
        `Endi bot uchun ko‘rinadigan nom kiriting. Masalan:
${preset.title}

` +
        `Telegramdagi nomdan foydalanish uchun “-” yuboring.
❌ Bekor qilish: /cancel`
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
    if (!['pending', 'approved', 'expired', 'disabled'].includes(req.status)) return ctx.reply(`ℹ️ Bu soʻrov holati: ${req.status}`);

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
      await bot.telegram.sendMessage(rec.owner_user_id, `⏸ @${rec.telegram_username} botingiz admin tomonidan vaqtincha to‘xtatildi. Maʼlumotlar saqlangan. ${OWNER_USERNAME} bilan bog‘laning.`);
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
      await bot.telegram.sendMessage(req.owner_user_id, `❌ @${req.telegram_username} bot so‘rovingiz rad etildi. Batafsil kelishish uchun ${OWNER_USERNAME} ga yozing.`);
    } catch (_) {}
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text === '/cancel') {
      reset(ctx);
      return ctx.reply('❌ Jarayon bekor qilindi.', userKeyboard(ctx));
    }

    if (ctx.session.mode === 'global_broadcast') { if (!(await requireMongo(ctx, 'Umumiy eʼlon uchun DB kerak'))) return; return sendGlobalBroadcast(ctx); }

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
      if (!(await requireMongo(ctx, 'Tokenni tekshirish va soʻrovni saqlash uchun DB kerak'))) return;
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
        return ctx.reply(`✅ Token tekshirildi: @${me.username}\n\nEndi bot turini tanlang:`, Markup.inlineKeyboard(typeRows()));
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
      const tariffKey = normalizeTariffKey(draft.tariff_key || 'standard');
      const now = new Date();
      const trialEnd = addDaysSafe(now, TRIAL_DAYS);
      const monthlyPrice = Number(draft.monthly_price ?? tariffPrice(plan.monthly_price, tariffKey) ?? 0);

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
        tariff_key: tariffKey,
        trial_started_at: now,
        trial_ends_at: trialEnd,
        billing_started_at: now,
        current_period_start: now,
        current_period_end: trialEnd,
        next_payment_due_at: trialEnd,
        monthly_price: monthlyPrice,
        currency: draft.currency || plan.currency || 'UZS',
        payment_status: 'trial',
        status: 'approved',
        is_enabled: true,
        approved_at: now,
        approved_by: 0,
        price_note: `${TRIAL_DAYS} kunlik bepul sinov`
      });
      rec.bot_key = `m_${String(rec._id)}`;
      await rec.save();
      try { await startManagedRecord(rec, 'factory_trial_created'); } catch (error) { console.error('Trial bot start xatosi:', error.message); }
      reset(ctx);

      const preset = getPreset(rec.type_key);
      await ctx.reply(
        `✅ Bot yaratildi va ${TRIAL_DAYS} kunlik bepul sinov boshlandi!

` +
          `🤖 Bot: @${rec.telegram_username}
` +
          `📦 Turi: ${preset.itemTitle || rec.type_key}
` +
          `🏷 Tarif: ${tariffTitle(rec.tariff_key)}
` +
          `💰 Oylik narx: ${formatMoney(rec.monthly_price, rec.currency)} / oy
` +
          `👨‍💻 Admin IDlar: ${adminIds.join(', ')}

` +
          `🎁 Sinov tugash sanasi: ${formatDate(rec.current_period_end)}

` +
          `Bot hoziroq ishga tushdi. Sinov tugamasidan oldin yoki tugagach obunani tiklash/uzaytirish uchun admin bilan kelishing.`,
        Markup.inlineKeyboard([[Markup.button.url('💳 Toʻlov/ruxsat uchun admin bilan kelishish', `https://t.me/${String(OWNER_USERNAME).replace('@', '')}`)]])
      );
      await ctx.reply('🏠 Bosh menyu:', userKeyboard(ctx));

      await notifyOwners(
        `🎁 Yangi bot yaratildi — sinov muddati boshlandi!\n\n` +
          `🤖 Bot: ${rec.title} (@${rec.telegram_username})\n` +
          `📦 Turi: ${preset.itemTitle || rec.type_key}\n` +
          `🏷 Tarif: ${tariffTitle(rec.tariff_key)}\n` +
          `💰 Oylik narx: ${formatMoney(rec.monthly_price, rec.currency)} / oy\n` +
          `👤 Mijoz: ${rec.owner_first_name || ''} ${rec.owner_username ? '@' + rec.owner_username : ''}\n` +
          `🆔 Mijoz ID: ${rec.owner_user_id}\n` +
          `👨‍💻 Admin IDlar: ${adminIds.join(', ')}\n\n` +
          `🎁 Sinov tugashi: ${formatDate(rec.current_period_end)}

` +
          `Mijoz to‘lov bo‘yicha yozsa, admin 1 oyga uzaytirishi yoki kerak bo‘lsa to‘xtatishi mumkin.`,
        botActionKeyboard(rec)
      );
    }
  });

  bot.on('message', async (ctx) => {
    if (ctx.session.mode === 'global_broadcast') return sendGlobalBroadcast(ctx);
  });

  bot.on('chat_join_request', async (ctx) => {
    try {
      const req = ctx.chatJoinRequest || ctx.update?.chat_join_request;
      const doc = await recordJoinRequestForBot(GLOBAL_SUBSCRIPTION_BOT_KEY, req);
      if (doc?.user_id) {
        await bot.telegram.sendMessage(doc.user_id, `✅ ${doc.chat_title || 'global kanal/guruh'} uchun zayavkangiz yozib olindi. Endi BotFactoryga qaytib “✅ Obunani tekshirish” tugmasini bosing.`).catch(() => null);
      }
    } catch (error) {
      console.error('FactoryBot chat_join_request saqlash xatosi:', error.message);
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
  if (URL) {
    expressApp = express();
    expressApp.use(express.json({ limit: '20mb' }));

    // Barcha yaratilgan botlar uchun yagona barqaror webhook router.
    // Oldingi versiyalardagi /webhook/:botKey/:secret yo‘li ham qo‘llab-quvvatlanadi.
    expressApp.post('/webhook/:botKey', handleRuntimeWebhook);
    expressApp.post('/webhook/:botKey/:legacySecret', handleRuntimeWebhook);

    expressApp.get('/', (_req, res) => {
      res.send(`✅ BotFactory server ishlamoqda. MongoDB: ${mongoReady ? 'ulangan' : 'ulanmoqda'}. Aktiv botlar: ${Array.from(activeBots.values()).map((b) => b.title).join(', ') || 'hali yo‘q'}`);
    });

    expressApp.get('/status', async (_req, res) => {
      try {
        const bots = [];
        if (mongoReady && mongoose.connection.readyState === 1) {
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
          const [pending, approved, global_subscriptions] = await Promise.all([
            ManagedBot.countDocuments({ status: 'pending' }),
            ManagedBot.countDocuments({ status: 'approved', is_enabled: true }),
            Subscription.countDocuments({ bot_key: GLOBAL_SUBSCRIPTION_BOT_KEY })
          ]);
          return res.json({ status: 'online', mode: 'webhook', mongo: 'connected', active_bots: bots.length, pending_requests: pending, approved_managed_bots: approved, global_subscriptions, bots, uptime: process.uptime() });
        }
        return res.json({ status: 'online', mode: 'webhook', mongo: 'connecting', active_bots: activeBots.size, bots: Array.from(activeBots.values()).map((b) => ({ key: b.key, title: b.title })), uptime: process.uptime() });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message, mongo: mongoReady ? 'connected' : 'connecting' });
      }
    });
  }

  const factory = createFactoryBot();
  if (factory) await activateBot(factory, 'factory');

  for (const config of STATIC_BOT_CONFIGS) {
    const active = createContentBot(config);
    if (active) await activateBot(active, 'static_env');
  }

  startMongoBackgroundLoop();

  setInterval(() => {
    if (mongoReady && mongoose.connection.readyState === 1) {
      expireDueManagedBots().catch((error) => console.error('Billing tekshirish xatosi:', error.message));
      syncApprovedManagedBots('periodic_webhook_resync').catch((error) => console.error('Managed bot webhook sync xatosi:', error.message));
    }
  }, 2 * 60 * 1000);

  if (activeBots.size === 0) {
    console.error('❌ Ishga tushadigan bot topilmadi. FACTORYBOT_TOKEN yoki boshqa bot tokenlaridan kamida bittasini Render env ichiga yozing.');
  }

  if (URL && expressApp && !serverStarted) {
    expressApp.listen(PORT, () => {
      serverStarted = true;
      console.log(`🚀 BotFactory server ${PORT} portda ishga tushdi`);
      console.log(`🤖 Aktiv botlar: ${Array.from(activeBots.values()).map((b) => b.title).join(', ') || 'hali yoʻq'}`);
      console.log(`🗄 MongoDB: ${MONGODB_URL ? 'background ulanish rejimida' : 'URL berilmagan'}`);
    });
  }

  process.once('SIGINT', async () => {
    console.log('Botlar toʻxtatilmoqda...');
    for (const active of activeBots.values()) active.bot.stop('SIGINT');
    if (mongoose.connection.readyState !== 0) await mongoose.connection.close().catch(() => {});
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    console.log('Botlar toʻxtatilmoqda...');
    for (const active of activeBots.values()) active.bot.stop('SIGTERM');
    if (mongoose.connection.readyState !== 0) await mongoose.connection.close().catch(() => {});
    process.exit(0);
  });
}

start().catch((error) => {
  console.error('❌ Start xatosi:', error);
});
