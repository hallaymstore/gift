'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v2: cloudinary } = require('cloudinary');

mongoose.set('bufferCommands', true);
mongoose.set('bufferTimeoutMS', Number(process.env.MONGO_BUFFER_TIMEOUT_MS || 60000));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/social_garant_market';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_EXPECTED_USERNAME = String(process.env.BOT_EXPECTED_USERNAME || '').replace(/^@/, '').trim();
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const ADMIN_TELEGRAM_IDS = new Set(String(process.env.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_ID || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean));
const AUTO_SET_WEBHOOK = String(process.env.AUTO_SET_WEBHOOK || 'false').toLowerCase() === 'true';
const TELEGRAM_POLLING = String(process.env.TELEGRAM_POLLING || 'false').toLowerCase() === 'true';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB || 6);
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 2;
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || process.env.SOCIAL_DEFAULT_CURRENCY || 'UZS';

function cleanPublicUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw || raw.includes('your-domain.com') || raw.includes('localhost') || raw.includes('127.0.0.1')) return '';
  if (!/^https:\/\//i.test(raw)) return '';
  return raw;
}
function detectPublicUrl() {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  return '';
}
const PUBLIC_URL = cleanPublicUrl(process.env.PUBLIC_URL) || cleanPublicUrl(detectPublicUrl());
const WEBAPP_URL = cleanPublicUrl(process.env.WEBAPP_URL) || PUBLIC_URL;

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
function normalizeTelegramUsername(value) {
  return String(value || '').trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
}
const REQUESTED_ADMIN_USERNAME = 'Qoryogdiyev';
const ENV_ADMIN_TELEGRAM_USERNAME = normalizeTelegramUsername(firstEnv('SOCIAL_ADMIN_TELEGRAM_USERNAME', 'ADMIN_TELEGRAM_USERNAME', 'ADMIN_USERNAME'));
// User-facing garant admin contact. Kept fixed so channel posts always show the requested admin.
const ADMIN_TELEGRAM_USERNAME = REQUESTED_ADMIN_USERNAME || ENV_ADMIN_TELEGRAM_USERNAME;
const ADMIN_TELEGRAM_URL = `https://t.me/${ADMIN_TELEGRAM_USERNAME}`;
const DEFAULT_TRADE_CHAT_URL = 'https://t.me/youtube_savdolarr';
const DEFAULT_CHANNEL_URL = 'https://t.me/akkaunt_savdoolar';
const GROUP_CHAT_URL = cleanPublicUrl(firstEnv('SOCIAL_GROUP_CHAT_URL', 'GROUP_CHAT_URL', 'SOCIAL_TRADE_CHAT_URL')) || DEFAULT_TRADE_CHAT_URL || ADMIN_TELEGRAM_URL;
const CHANNEL_URL = cleanPublicUrl(firstEnv('SOCIAL_CHANNEL_URL', 'CHANNEL_URL', 'SOCIAL_POST_CHANNEL_URL')) || DEFAULT_CHANNEL_URL;
function telegramTargetFromUrl(url) {
  const raw = String(url || '').trim();
  const m = raw.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{4,})/i);
  if (m) return '@' + m[1];
  if (/^-?\d+$/.test(raw)) return raw;
  if (/^@[a-zA-Z0-9_]{4,}$/.test(raw)) return raw;
  return '';
}
const CHANNEL_CHAT_ID = firstEnv('SOCIAL_CHANNEL_CHAT_ID', 'CHANNEL_CHAT_ID') || telegramTargetFromUrl(CHANNEL_URL);
const BRAND_NAME = firstEnv('SOCIAL_BRAND_NAME', 'BRAND_NAME') || 'Garant Market';
const BRAND_SUBTITLE = firstEnv('SOCIAL_BRAND_SUBTITLE', 'BRAND_SUBTITLE') || 'Ijtimoiy tarmoq hisoblari savdosi va garant bitimlar';

let databaseReady = false;
let databaseError = '';
let databaseConnecting = false;
let httpServerStarted = false;
function isDbReady() { return mongoose.connection.readyState === 1; }
function dbStatus() {
  return {
    ready: isDbReady(),
    state: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || String(mongoose.connection.readyState),
    error: databaseError || '',
  };
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 900, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) return cb(new Error('Faqat PNG, JPG yoki WEBP rasm qabul qilinadi.'));
    cb(null, true);
  },
});

function asyncHandler(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function normalizeNumber(value) { const n = Number(String(value ?? '').replace(/\s/g, '').replace(/,/g, '.')); return Number.isFinite(n) ? n : 0; }
function parseBoolean(value, fallback = false) { if (value === undefined || value === null || value === '') return fallback; return ['true', '1', 'yes', 'on', 'ha'].includes(String(value).toLowerCase()); }
function safeJsonParse(value, fallback) { try { if (typeof value === 'string') return JSON.parse(value); return value ?? fallback; } catch { return fallback; } }
function formatMoney(amount, currency = DEFAULT_CURRENCY) { return `${Number(amount || 0).toLocaleString('uz-UZ')} ${currency}`; }
function ensureObjectId(id, fieldName = 'ID') { if (!mongoose.Types.ObjectId.isValid(String(id || ''))) { const err = new Error(`${fieldName} noto‘g‘ri.`); err.status = 400; throw err; } return id; }
function randomCode(prefix = 'SG') { return `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function userFullName(user, fallback = '') { return [user?.first_name, user?.last_name].filter(Boolean).join(' ') || fallback || 'Telegram foydalanuvchi'; }
function isAdminTelegramId(id) { return ADMIN_TELEGRAM_IDS.has(String(id || '').trim()); }
function isConfiguredCloudinary() { return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForDatabaseReady(timeoutMs = Number(process.env.SOCIAL_DB_WAIT_MS || 90000)) {
  if (isDbReady()) return true;
  if (!databaseConnecting) connectMongoWithRetry().catch(() => {});
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isDbReady()) return true;
    await sleep(350);
  }
  return isDbReady();
}
async function requirePersistentDatabase(res) {
  const ok = await waitForDatabaseReady();
  if (ok) return true;
  res.status(503).json({
    success: false,
    message: 'MongoDB hali ulanmoqda yoki uzilgan. Maʼlumotlar o‘chib ketmasligi uchun yozuvlar faqat doimiy MongoDB bazaga saqlanadi. Render logs va MONGODB_URI ni tekshirib, bir necha soniyadan keyin qayta urinib ko‘ring.',
    database: dbStatus()
  });
  return false;
}

async function uploadToCloudinary(file, folder) {
  if (!file) return null;
  if (!isConfiguredCloudinary()) {
    const ext = (file.mimetype || 'image/png').split('/')[1] || 'png';
    return {
      url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      publicId: `local-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`,
      local: true,
    };
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' }, (error, result) => {
      if (error) return reject(error);
      resolve({ url: result.secure_url, publicId: result.public_id, local: false });
    });
    stream.end(file.buffer);
  });
}

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN) return { ok: false, reason: 'BOT_TOKEN sozlanmagan.' };
  if (!initData) return { ok: false, reason: 'Telegram initData yo‘q.' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'Telegram hash yo‘q.' };
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(hash, 'hex'))) return { ok: false, reason: 'Telegram imzo mos kelmadi.' };
  } catch { return { ok: false, reason: 'Telegram imzo formati noto‘g‘ri.' }; }
  return { ok: true, user: safeJsonParse(params.get('user'), null), raw: Object.fromEntries(params.entries()) };
}

const formFieldSchema = new mongoose.Schema({
  key: { type: String, default: '', trim: true },
  label: { type: String, default: '', trim: true },
  type: { type: String, default: 'text', enum: ['text', 'number', 'select', 'textarea', 'url', 'tel'] },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: '', trim: true },
  options: [{ type: String, trim: true }],
}, { _id: false });

const imageSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  local: Boolean,
}, { _id: false });

const serviceSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, default: 'accounts', enum: ['accounts', 'guarantee', 'promotion', 'gaming', 'support', 'other'] },
  platform: { type: String, default: 'other', trim: true },
  iconKey: { type: String, default: '', trim: true },
  iconEmoji: { type: String, default: '', trim: true },
  badge: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  priceFrom: { type: Number, default: 0 },
  currency: { type: String, default: DEFAULT_CURRENCY },
  requiredFields: [{ type: String, trim: true }],
  customFields: [formFieldSchema],
  images: [imageSchema],
  active: { type: Boolean, default: true },
  autoPost: { type: Boolean, default: true },
  channelMessageId: { type: String, default: '' },
  channelPostedAt: { type: Date, default: null },
  sort: { type: Number, default: 100 },
}, { timestamps: true });

const requestSchema = new mongoose.Schema({
  requestNo: { type: String, unique: true, index: true },
  requestType: { type: String, enum: ['SELL_ACCOUNT', 'BUY_ACCOUNT', 'GUARANT_DEAL', 'SERVICE_ORDER'], default: 'GUARANT_DEAL', index: true },
  platform: { type: String, default: 'other', index: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialService', default: null },
  serviceTitle: { type: String, default: '' },
  dealSide: { type: String, default: '' },
  accountType: { type: String, default: '' },
  accountLink: { type: String, default: '' },
  accountUsername: { type: String, default: '' },
  niche: { type: String, default: '' },
  audienceSize: { type: String, default: '' },
  monetization: { type: String, default: '' },
  country: { type: String, default: '' },
  price: { type: Number, default: 0 },
  currency: { type: String, default: DEFAULT_CURRENCY },
  sellerName: { type: String, default: '' },
  sellerPhone: { type: String, default: '' },
  sellerTelegram: { type: String, default: '' },
  buyerName: { type: String, default: '' },
  buyerPhone: { type: String, default: '' },
  buyerTelegram: { type: String, default: '' },
  telegramUserId: { type: String, default: '', index: true },
  telegramUsername: { type: String, default: '' },
  telegramFullName: { type: String, default: '' },
  transferMethod: { type: String, default: '' },
  paymentProvider: { type: String, default: '' },
  paymentStatus: { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
  paymentScreenshot: imageSchema,
  contactName: { type: String, default: '' },
  contactPhone: { type: String, default: '' },
  contactTelegram: { type: String, default: '' },
  referralCode: { type: String, default: '', index: true },
  referredBy: { type: String, default: '', index: true },
  startParam: { type: String, default: '' },
  proofImages: [imageSchema],
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  note: { type: String, default: '' },
  status: { type: String, enum: ['NEW', 'REVIEWING', 'WAITING_PAYMENT', 'IN_GUARANT', 'DONE', 'CANCELLED'], default: 'NEW', index: true },
  adminNote: { type: String, default: '' },
}, { timestamps: true });

const marketplaceItemSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  platform: { type: String, default: 'other', index: true },
  category: { type: String, default: 'accounts', index: true },
  iconKey: { type: String, default: '', trim: true },
  iconEmoji: { type: String, default: '', trim: true },
  badge: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  accountLink: { type: String, default: '', trim: true },
  accountUsername: { type: String, default: '', trim: true },
  audienceSize: { type: String, default: '', trim: true },
  niche: { type: String, default: '', trim: true },
  country: { type: String, default: '', trim: true },
  monetization: { type: String, default: '', trim: true },
  price: { type: Number, default: 0 },
  oldPrice: { type: Number, default: 0 },
  currency: { type: String, default: DEFAULT_CURRENCY },
  images: [imageSchema],
  sourceRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialRequest', default: null },
  ownerName: { type: String, default: '', trim: true },
  ownerTelegram: { type: String, default: '', trim: true },
  ownerTelegramId: { type: String, default: '', trim: true },
  ownerChatUrl: { type: String, default: '', trim: true },
  channelAutoPost: { type: Boolean, default: true },
  channelMessageId: { type: String, default: '' },
  channelPostedAt: { type: Date, default: null },
  approved: { type: Boolean, default: true, index: true },
  status: { type: String, enum: ['AVAILABLE', 'RESERVED', 'SOLD', 'HIDDEN'], default: 'AVAILABLE', index: true },
  soldAt: { type: Date, default: null },
  soldNote: { type: String, default: '' },
  sort: { type: Number, default: 100 },
}, { timestamps: true });

const visitorSchema = new mongoose.Schema({
  telegramUserId: { type: String, unique: true, sparse: true, index: true },
  username: { type: String, default: '', index: true },
  fullName: { type: String, default: '' },
  referralCode: { type: String, default: '', unique: true, sparse: true, index: true },
  referredBy: { type: String, default: '', index: true },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  visits: { type: Number, default: 0 },
  bonusBalance: { type: Number, default: 0 },
  bonusNote: { type: String, default: '' },
}, { timestamps: true });

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  referralBonus: { type: Number, default: 0 },
  referralBonusText: { type: String, default: 'Referral orqali do‘st taklif qiling. Bonus shartlarini admin belgilaydi.' },
  tradeChatUrl: { type: String, default: '' },
  channelUrl: { type: String, default: '' },
  channelChatId: { type: String, default: '' },
  paymentInstructions: { type: String, default: 'To‘lov ilovasiga o‘ting, to‘lovni yuboring, keyin mini appga qaytib chek rasmini yuklang.' },
  paymentPaynetUrl: { type: String, default: '' },
  paymentClickUrl: { type: String, default: '' },
  paymentUzumUrl: { type: String, default: '' },
  paymentXaznaUrl: { type: String, default: '' },
  paymentPaymeUrl: { type: String, default: '' },
  paymentOtherUrl: { type: String, default: '' },
  marketplaceTitle: { type: String, default: 'Marketplace' },
}, { timestamps: true });

const SocialService = mongoose.model('SocialService', serviceSchema);
const SocialRequest = mongoose.model('SocialRequest', requestSchema);
const MarketplaceItem = mongoose.model('MarketplaceItem', marketplaceItemSchema);
const SocialVisitor = mongoose.model('SocialVisitor', visitorSchema);
const SocialSettings = mongoose.model('SocialSettings', settingsSchema);

const DEFAULT_SERVICES = [
  { title: 'Garant bitim xizmati', iconKey: 'shield', iconEmoji: '🛡', category: 'guarantee', platform: 'all', badge: 'Xavfsiz', description: 'Sotuvchi va xaridor uchun admin nazoratidagi garant bitim.', priceFrom: 0, sort: 5, requiredFields: ['Hisob havolasi', 'Bitim summasi', 'Kontakt'] },
  { title: 'YouTube kanal savdosi', iconKey: 'youtube', iconEmoji: '▶️', category: 'accounts', platform: 'youtube', badge: 'Talabgir', description: 'YouTube kanal sotish yoki sotib olish uchun tekshiruv va garant.', priceFrom: 0, sort: 10, requiredFields: ['Kanal havolasi', 'Obunachi', 'Narx'] },
  { title: 'Instagram akkaunt savdosi', iconKey: 'instagram', iconEmoji: '📸', category: 'accounts', platform: 'instagram', badge: 'Tezkor', description: 'Instagram profil/sahifa savdosi uchun qisqa so‘rov va admin aloqa.', priceFrom: 0, sort: 20, requiredFields: ['Username', 'Follower', 'Narx'] },
  { title: 'TikTok akkaunt savdosi', iconKey: 'tiktok', iconEmoji: '🎵', category: 'accounts', platform: 'tiktok', badge: 'Trend', description: 'TikTok akkaunt, auditoriya va aktivlik bo‘yicha savdo so‘rovi.', priceFrom: 0, sort: 30, requiredFields: ['Profil link', 'Follower', 'Narx'] },
  { title: 'Telegram kanal/guruh savdosi', iconKey: 'telegram', iconEmoji: '✈️', category: 'accounts', platform: 'telegram', badge: 'Kanal', description: 'Telegram kanal, guruh yoki reklama kanalini garant orqali savdo qilish.', priceFrom: 0, sort: 40, requiredFields: ['Kanal linki', 'Aʼzo', 'Narx'] },
  { title: 'PUBG Mobile hisob savdosi', iconKey: 'pubg', iconEmoji: '🎮', category: 'gaming', platform: 'pubg', badge: 'Gaming', description: 'PUBG hisob ID, level va skinlar bo‘yicha garantli kelishuv.', priceFrom: 0, sort: 50, requiredFields: ['Hisob ID', 'Level', 'Narx'] },
  { title: 'Reklama kanallari savdosi', iconKey: 'ads', iconEmoji: '📣', category: 'promotion', platform: 'ads', badge: 'Reklama', description: 'Reklama kanal sotish/sotib olish yoki post joylash bo‘yicha buyurtma.', priceFrom: 0, sort: 60, requiredFields: ['Kanal turi', 'Auditoriya', 'Byudjet'] },
  { title: 'Hisob tekshirish va maslahat', iconKey: 'verify', iconEmoji: '✅', category: 'support', platform: 'all', badge: 'Tekshiruv', description: 'Akkaunt xavfsizligi, ko‘rsatkichlari va savdoga tayyorligini tekshirish.', priceFrom: 0, sort: 70, requiredFields: ['Hisob turi', 'Muammo', 'Kontakt'] },
];


const DEFAULT_SETTINGS = {
  referralBonus: 0,
  referralBonusText: 'Referral orqali do‘st taklif qiling. Bonus shartlarini admin belgilaydi.',
  tradeChatUrl: GROUP_CHAT_URL || DEFAULT_TRADE_CHAT_URL,
  channelUrl: CHANNEL_URL || DEFAULT_CHANNEL_URL,
  channelChatId: CHANNEL_CHAT_ID || telegramTargetFromUrl(CHANNEL_URL || DEFAULT_CHANNEL_URL),
  paymentInstructions: 'To‘lov ilovasiga o‘ting, to‘lovni yuboring, keyin mini appga qaytib chek rasmini yuklang. Chek admin Telegramiga yuboriladi.',
  paymentPaynetUrl: firstEnv('SOCIAL_PAYMENT_PAYNET_URL', 'PAYMENT_PAYNET_URL') || "https://app.paynet.uz/qr-online/00020101021140440012qr-online.uz01186r0vBrkobM1uBpXqv40202115204531153038605802UZ5910AO'PAYNET'6008Tashkent610610002164280002uz0106PAYNET0208Toshkent80520012qr-online.uz03097120207070419marketing@paynet.uz63042E24",
  paymentClickUrl: firstEnv('SOCIAL_PAYMENT_CLICK_URL', 'PAYMENT_CLICK_URL') || 'https://my.click.uz/clickp2p/64FF6DA1B8F00B46B2936F561CCF73B01A05A23D2130A2B7F7A9E217A12F0BBD',
  paymentUzumUrl: firstEnv('SOCIAL_PAYMENT_UZUM_URL', 'PAYMENT_UZUM_URL') || 'https://b.2u.uz/ttc?qr=Nzk5MzoyMDQzNTUwMzowMUtTUE1XM0gwSE03RTFUNzRDTU5XRkZLNzpkMUhZYmhKWDZ3UGVQYVkxcW9mU3pVTmRHcVU9',
  paymentXaznaUrl: firstEnv('SOCIAL_PAYMENT_XAZNA_URL', 'PAYMENT_XAZNA_URL') || 'https://pay.xazna.uz/p2p/e07e655f-886e-4942-b325-846d8a0c2ce9',
  paymentPaymeUrl: firstEnv('SOCIAL_PAYMENT_PAYME_URL', 'PAYMENT_PAYME_URL'),
  paymentOtherUrl: firstEnv('SOCIAL_PAYMENT_OTHER_URL', 'PAYMENT_OTHER_URL'),
  marketplaceTitle: 'Marketplace',
};

const LOCAL_STORE_DIR = process.env.SOCIAL_LOCAL_STORE_DIR || path.join(__dirname, '.data');
const LOCAL_STORE_FILE = process.env.SOCIAL_LOCAL_STORE_FILE || path.join(LOCAL_STORE_DIR, 'social-store.json');
let localStoreCache = null;

function nowIso() { return new Date().toISOString(); }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function localId(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`; }
function withLocalDates(doc) { const now = nowIso(); return { ...doc, createdAt: doc.createdAt || now, updatedAt: now }; }
function localDefaultServices() {
  return DEFAULT_SERVICES.slice().sort((a, b) => (a.sort || 100) - (b.sort || 100)).map((service, index) => ({
    ...deepClone(service),
    _id: `local-service-${index + 1}`,
    active: true,
    images: service.images || [],
    currency: service.currency || DEFAULT_CURRENCY,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
}
function ensureLocalStore() {
  if (localStoreCache) return localStoreCache;
  try { fs.mkdirSync(LOCAL_STORE_DIR, { recursive: true }); } catch {}
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) localStoreCache = JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, 'utf8'));
  } catch (error) {
    console.error('Local social store read failed:', error.message);
  }
  if (!localStoreCache || typeof localStoreCache !== 'object') localStoreCache = {};
  if (!Array.isArray(localStoreCache.services)) localStoreCache.services = localDefaultServices();
  if (!Array.isArray(localStoreCache.marketplace)) localStoreCache.marketplace = [];
  if (!Array.isArray(localStoreCache.requests)) localStoreCache.requests = [];
  if (!Array.isArray(localStoreCache.users)) localStoreCache.users = [];
  if (!localStoreCache.settings || typeof localStoreCache.settings !== 'object') localStoreCache.settings = { ...DEFAULT_SETTINGS };
  saveLocalStore();
  return localStoreCache;
}
function saveLocalStore() {
  try {
    fs.mkdirSync(LOCAL_STORE_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(localStoreCache || {}, null, 2));
  } catch (error) {
    console.error('Local social store write failed:', error.message);
  }
}
function localCollection(name) { return ensureLocalStore()[name] || []; }
function sortItems(items) {
  return items.slice().sort((a, b) => (Number(a.sort || 100) - Number(b.sort || 100)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
function localCreate(name, prefix, data) {
  const store = ensureLocalStore();
  const doc = withLocalDates({ ...deepClone(data), _id: localId(prefix) });
  store[name].push(doc);
  saveLocalStore();
  return deepClone(doc);
}
function localUpdate(name, id, patch) {
  const list = localCollection(name);
  const index = list.findIndex((x) => String(x._id) === String(id));
  if (index < 0) return null;
  list[index] = { ...list[index], ...deepClone(patch), updatedAt: nowIso() };
  saveLocalStore();
  return deepClone(list[index]);
}
function localDelete(name, id) {
  const store = ensureLocalStore();
  const before = store[name].length;
  store[name] = store[name].filter((x) => String(x._id) !== String(id));
  saveLocalStore();
  return before !== store[name].length;
}
function localById(name, id) { return deepClone(localCollection(name).find((x) => String(x._id) === String(id)) || null); }
function localStats() {
  const store = ensureLocalStore();
  return {
    total: store.requests.length,
    fresh: store.requests.filter((x) => x.status === 'NEW').length,
    inGarant: store.requests.filter((x) => x.status === 'IN_GUARANT').length,
    done: store.requests.filter((x) => x.status === 'DONE').length,
    services: store.services.filter((x) => x.active !== false).length,
    users: store.users.length,
    marketplace: store.marketplace.filter((x) => x.approved !== false && x.status !== 'HIDDEN').length,
    sold: store.marketplace.filter((x) => x.status === 'SOLD').length,
    referrals: store.users.filter((x) => x.referredBy).length,
  };
}
function localDbInfo() {
  return { fallbackStorage: !isDbReady(), localStoreFile: LOCAL_STORE_FILE };
}
async function syncLocalStoreToMongo() {
  if (!isDbReady()) return;
  const store = ensureLocalStore();
  let moved = { services: 0, marketplace: 0, requests: 0, users: 0 };
  for (const service of store.services || []) {
    if (!String(service._id || '').startsWith('local-')) continue;
    const exists = await SocialService.exists({ title: service.title, createdAt: service.createdAt }).catch(() => null);
    if (!exists) { const { _id, ...doc } = service; await SocialService.create(doc).catch(() => {}); moved.services++; }
  }
  for (const item of store.marketplace || []) {
    if (!String(item._id || '').startsWith('market-')) continue;
    const exists = await MarketplaceItem.exists({ title: item.title, createdAt: item.createdAt }).catch(() => null);
    if (!exists) { const { _id, ...doc } = item; await MarketplaceItem.create(doc).catch(() => {}); moved.marketplace++; }
  }
  for (const request of store.requests || []) {
    if (!String(request._id || '').startsWith('req-')) continue;
    const exists = await SocialRequest.exists({ requestNo: request.requestNo }).catch(() => null);
    if (!exists) { const { _id, ...doc } = request; await SocialRequest.create(doc).catch(() => {}); moved.requests++; }
  }
  for (const user of store.users || []) {
    if (!user.telegramUserId) continue;
    await SocialVisitor.updateOne({ telegramUserId: user.telegramUserId }, { $setOnInsert: user }, { upsert: true }).catch(() => {});
    moved.users++;
  }
  store.lastMongoSyncAt = nowIso();
  saveLocalStore();
  if (Object.values(moved).some(Boolean)) console.log('Local social store synced to MongoDB:', moved);
}

async function seedDefaults() {
  const ops = DEFAULT_SERVICES.map((service) => ({
    updateOne: {
      filter: { title: service.title },
      update: { $setOnInsert: service, $set: { sort: service.sort, active: true } },
      upsert: true,
    },
  }));
  if (ops.length) await SocialService.bulkWrite(ops, { ordered: false });
  let settings = await SocialSettings.findOne({ key: 'main' });
  if (!settings) {
    await SocialSettings.create({ key: 'main', ...DEFAULT_SETTINGS });
  } else {
    const patch = {};
    for (const key of ['tradeChatUrl', 'channelUrl', 'channelChatId', 'paymentInstructions', 'paymentPaynetUrl', 'paymentClickUrl', 'paymentUzumUrl', 'paymentXaznaUrl', 'paymentPaymeUrl', 'paymentOtherUrl', 'marketplaceTitle']) {
      if (!settings[key] && DEFAULT_SETTINGS[key]) patch[key] = DEFAULT_SETTINGS[key];
    }
    if (Object.keys(patch).length) await SocialSettings.updateOne({ key: 'main' }, { $set: patch });
  }
}

function adminTokenPayload() { return `${Date.now() + ADMIN_TOKEN_TTL_MS}:${crypto.randomBytes(10).toString('hex')}`; }
function signToken(payload) { return `${payload}.${crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`; }
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false; } catch { return false; }
  const exp = Number(payload.split(':')[0]);
  return Number.isFinite(exp) && exp > Date.now();
}
function requireAdmin(req, res, next) {
  const auth = req.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (verifyToken(token)) return next();
  return res.status(401).json({ success: false, message: 'Admin sessiya muddati tugagan. Qayta kiring.' });
}

function telegramApi(method, payload) {
  if (!BOT_TOKEN) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${BOT_TOKEN}/${method}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
async function sendTelegramMessage(chatId, text, extra = {}) {
  if (!chatId) return null;
  return telegramApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
function webAppStartUrl(startParam = '') { if (!WEBAPP_URL) return ''; const q = startParam ? `?startapp=${encodeURIComponent(startParam)}` : ''; return `${String(WEBAPP_URL).replace(/\/+$/, '/')}${q}`; }
function webAppDeepLink(params = {}) { if (!WEBAPP_URL) return ''; const q = new URLSearchParams(params); const sep = String(WEBAPP_URL).includes('?') ? '&' : '?'; return `${String(WEBAPP_URL).replace(/\/+$/, '/')}${q.toString() ? sep + q.toString() : ''}`; }
function adminPanelUrl() {
  const base = (WEBAPP_URL || PUBLIC_URL || '').replace(/\/+$/, '');
  return base ? `${base}/admin` : '';
}

async function ensureBotMenuButton() {
  if (!BOT_TOKEN || !WEBAPP_URL) return;
  try {
    await telegramApi('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Garant Market', web_app: { url: WEBAPP_URL } }
    });
  } catch (error) {
    console.error('Telegram menu button error:', error.message);
  }
}

function requestTypeText(type) {
  return ({ SELL_ACCOUNT: 'Akkaunt sotish', BUY_ACCOUNT: 'Akkaunt sotib olish', GUARANT_DEAL: 'Garant bitim', SERVICE_ORDER: 'Xizmat buyurtmasi' })[type] || type;
}
function statusText(status) {
  return ({ NEW: 'Yangi', REVIEWING: 'Ko‘rib chiqilmoqda', WAITING_PAYMENT: 'To‘lov kutilmoqda', IN_GUARANT: 'Garant jarayoni', DONE: 'Yakunlandi', CANCELLED: 'Bekor qilindi' })[status] || status;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function iconText(doc) {
  const map = { youtube: '▶️', instagram: '📸', tiktok: '🎵', telegram: '✈️', pubg: '🎮', freefire: '🔥', facebook: 'f', stars: '⭐', premium: '💎', shield: '🛡', verify: '✅', ads: '📣', game: '🎮', football: '⚽', vine: '😂', cs2: '🎯', mlbb: '⚔️', clash: '🏰' };
  return doc?.iconEmoji || map[String(doc?.iconKey || doc?.platform || '').toLowerCase()] || '🛡';
}
function paymentTitle(provider) { return ({ PAYNET: 'Paynet', CLICK: 'Click', UZUM: 'Uzum Bank', XAZNA: 'Xazna', PAYME: 'Payme', OTHER: 'Boshqa' })[String(provider || '').toUpperCase()] || provider || ''; }
function ownerContactUrl(doc = {}) {
  const direct = cleanPublicUrl(doc.ownerChatUrl || '');
  if (direct) return direct;
  const username = normalizeTelegramUsername(doc.ownerTelegram || '');
  if (username) return `https://t.me/${username}`;
  const id = String(doc.ownerTelegramId || '').trim();
  if (/^-?\d+$/.test(id)) return `tg://user?id=${id}`;
  return ADMIN_TELEGRAM_URL || GROUP_CHAT_URL || '';
}
function isHttpImage(url) { return /^https?:\/\//i.test(String(url || '')); }
async function sendTelegramPhoto(chatId, photoUrl, caption, extra = {}) {
  if (!chatId || !photoUrl || !isHttpImage(photoUrl)) return null;
  return telegramApi('sendPhoto', { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML', ...extra });
}
async function getPostSettings() { return getSettingsLean().catch(() => ({ ...DEFAULT_SETTINGS })); }
function channelButtons(kind, doc, settings = {}) {
  const buttons = [];
  const detailUrl = webAppDeepLink(kind === 'service' ? { service: String(doc._id || '') } : { item: String(doc._id || '') });
  if (detailUrl) buttons.push([{ text: kind === 'service' ? 'So‘rov yuborish' : 'Batafsil ko‘rish', url: detailUrl }]);
  const owner = ownerContactUrl(doc);
  if (owner) buttons.push([{ text: 'Egasi bilan kelishish', url: owner }]);
  if (settings.tradeChatUrl || GROUP_CHAT_URL) buttons.push([{ text: 'Savdo guruhiga o‘tish', url: settings.tradeChatUrl || GROUP_CHAT_URL }]);
  return buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {};
}
function telegramLabelFromUrl(url, fallback = '') {
  const raw = String(url || '').trim();
  const m = raw.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{4,})/i);
  if (m) return '@' + m[1];
  if (/^@[a-zA-Z0-9_]{4,}$/.test(raw)) return raw;
  return fallback;
}
function compactLinkLine(label, url, fallbackText = '') {
  const text = telegramLabelFromUrl(url, fallbackText || url);
  if (!url) return text ? `${label}: <b>${escapeHtml(text)}</b>` : '';
  return `${label}: <a href="${escapeHtml(url)}">${escapeHtml(text || url)}</a>`;
}
function line(label, value, bold = false) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  return `${label}: ${bold ? `<b>${escapeHtml(v)}</b>` : escapeHtml(v)}`;
}
function channelPostText(kind, doc, settings = {}) {
  const isService = kind === 'service';
  const status = doc.status === 'SOLD' ? '✅ <b>SOTILDI</b>' : (isService ? '🛠 <b>XIZMAT QABUL QILINADI</b>' : '🟢 <b>SOTUVDA</b>');
  const ownerText = [doc.ownerName, doc.ownerTelegram && (String(doc.ownerTelegram).startsWith('@') ? doc.ownerTelegram : '@' + normalizeTelegramUsername(doc.ownerTelegram)), doc.ownerTelegramId].filter(Boolean).join(' · ');
  const adminText = '@' + ADMIN_TELEGRAM_USERNAME;
  const rows = [
    `${iconText(doc)} <b>${isService ? 'YANGI XIZMAT' : 'YANGI EʼLON'}</b>`,
    status,
    '',
    line('Nomi', doc.title || 'Eʼlon', true),
    line('Platforma', doc.platform || 'other', true),
    line('Kategoriya', doc.category || ''),
    doc.badge ? line('Badge', doc.badge, true) : '',
    !isService && doc.accountUsername ? line('Username/ID', doc.accountUsername) : '',
    !isService && doc.accountLink ? `Link: ${escapeHtml(doc.accountLink)}` : '',
    !isService && doc.price ? `Narx: <b>${escapeHtml(formatMoney(doc.price, doc.currency))}</b>` : '',
    !isService && doc.oldPrice ? `Oldingi narx: <s>${escapeHtml(formatMoney(doc.oldPrice, doc.currency))}</s>` : '',
    !isService && doc.audienceSize ? line('Auditoriya/Level', doc.audienceSize, true) : '',
    !isService && doc.monetization ? line('Holat', doc.monetization, true) : '',
    !isService && doc.niche ? line('Nisha', doc.niche) : '',
    !isService && doc.country ? line('Davlat', doc.country) : '',
    isService && doc.priceFrom ? `Boshlang‘ich narx: <b>${escapeHtml(formatMoney(doc.priceFrom, doc.currency))}</b>` : '',
    isService && Array.isArray(doc.customFields) && doc.customFields.length ? `Kerakli inputlar: ${escapeHtml(doc.customFields.map((f) => f.label).filter(Boolean).join(', '))}` : '',
    ownerText ? `Egasi: <b>${escapeHtml(ownerText)}</b>` : 'Egasi: <b>Admin orqali kelishiladi</b>',
    `Admin: <b>${escapeHtml(adminText)}</b>`,
    compactLinkLine('Kanalimiz', settings.channelUrl || CHANNEL_URL || DEFAULT_CHANNEL_URL, '@akkaunt_savdoolar'),
    compactLinkLine('Savdo guruhimiz', settings.tradeChatUrl || GROUP_CHAT_URL || DEFAULT_TRADE_CHAT_URL, '@youtube_savdolarr'),
    '',
    doc.description ? `Tavsif: ${escapeHtml(String(doc.description).slice(0, 550))}` : '',
    '',
    isService ? 'So‘rov mini app orqali yuboriladi. Chek screenshoti admin botiga keladi.' : 'Admin tasdiqlagan marketplace eʼloni. Savdo garant orqali amalga oshiriladi.'
  ].filter((x) => x !== '');
  let text = rows.join('\n');
  if (text.length > 950) text = text.slice(0, 930) + '…';
  return text;
}
async function postToChannel(kind, doc) {
  try {
    const settings = await getPostSettings();
    const channelTarget = settings.channelChatId || telegramTargetFromUrl(settings.channelUrl || CHANNEL_URL) || CHANNEL_CHAT_ID;
    const groupTarget = telegramTargetFromUrl(settings.tradeChatUrl || GROUP_CHAT_URL || DEFAULT_TRADE_CHAT_URL);
    if (!BOT_TOKEN) return null;
    const targets = [channelTarget, groupTarget].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i);
    if (!targets.length) return null;
    const text = channelPostText(kind, doc, settings);
    const firstImage = (doc.images || [])[0]?.url;
    const extra = channelButtons(kind, doc, settings);
    let primaryResult = null;
    for (const [index, target] of targets.entries()) {
      const result = firstImage && isHttpImage(firstImage)
        ? await sendTelegramPhoto(target, firstImage, text, extra)
        : await sendTelegramMessage(target, text, extra);
      if (index === 0) primaryResult = result;
    }
    const messageId = primaryResult?.result?.message_id ? String(primaryResult.result.message_id) : '';
    if (messageId) {
      const patch = { channelMessageId: messageId, channelPostedAt: new Date() };
      if (kind === 'service') {
        if (isDbReady() && mongoose.Types.ObjectId.isValid(String(doc._id))) await SocialService.findByIdAndUpdate(doc._id, patch).catch(() => {});
        else localUpdate('services', doc._id, patch);
      } else {
        if (isDbReady() && mongoose.Types.ObjectId.isValid(String(doc._id))) await MarketplaceItem.findByIdAndUpdate(doc._id, patch).catch(() => {});
        else localUpdate('marketplace', doc._id, patch);
      }
    }
    return primaryResult;
  } catch (error) { console.error('Channel auto post failed:', error.message); return null; }
}
async function notifySold(item) {
  try {
    const settings = await getPostSettings();
    const channelTarget = settings.channelChatId || telegramTargetFromUrl(settings.channelUrl || CHANNEL_URL) || CHANNEL_CHAT_ID;
    const groupTarget = telegramTargetFromUrl(settings.tradeChatUrl || GROUP_CHAT_URL || DEFAULT_TRADE_CHAT_URL);
    const targets = [channelTarget, groupTarget].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i);
    if (!targets.length) return;
    const text = [
      '✅ <b>SOTILDI</b>',
      `${iconText(item)} <b>${escapeHtml(item.title || 'Eʼlon')}</b>`,
      line('Platforma', item.platform || 'other', true),
      item.price ? `Narx: <b>${escapeHtml(formatMoney(item.price, item.currency))}</b>` : '',
      `Admin: <b>@${escapeHtml(ADMIN_TELEGRAM_USERNAME)}</b>`,
      compactLinkLine('Kanalimiz', settings.channelUrl || CHANNEL_URL || DEFAULT_CHANNEL_URL, '@akkaunt_savdoolar'),
      compactLinkLine('Savdo guruhimiz', settings.tradeChatUrl || GROUP_CHAT_URL || DEFAULT_TRADE_CHAT_URL, '@youtube_savdolarr'),
    ].filter(Boolean).join('\n');
    for (const target of targets) await sendTelegramMessage(target, text, channelButtons('marketplace', item, settings));
  } catch (error) { console.error('Sold notification failed:', error.message); }
}
function compactRequestMessage(doc) {
  const lines = [
    `🛡 <b>Yangi garant so‘rov</b>`,
    `#${escapeHtml(doc.requestNo)}`,
    ``,
    `Turi: <b>${escapeHtml(requestTypeText(doc.requestType))}</b>`,
    `Platforma: <b>${escapeHtml(doc.platform)}</b>`,
    doc.serviceTitle ? `Xizmat: <b>${escapeHtml(doc.serviceTitle)}</b>` : '',
    doc.accountUsername || doc.accountLink ? `Hisob: ${escapeHtml(doc.accountUsername || doc.accountLink)}` : '',
    doc.audienceSize ? `Auditoriya: ${escapeHtml(doc.audienceSize)}` : '',
    doc.price ? `Summa: <b>${escapeHtml(formatMoney(doc.price, doc.currency))}</b>` : '',
    doc.paymentProvider ? `To‘lov: <b>${escapeHtml(paymentTitle(doc.paymentProvider))}</b> · ${escapeHtml(doc.paymentStatus || 'PENDING')}` : '',
    doc.paymentScreenshot?.url ? `Chek: biriktirilgan` : '',
    doc.contactTelegram || doc.contactPhone ? `Aloqa: ${escapeHtml(doc.contactName || '')} ${escapeHtml(doc.contactTelegram || doc.contactPhone || '')}` : '',
    doc.referralCode ? `Referral: <code>${escapeHtml(doc.referralCode)}</code>` : '',
    doc.sellerTelegram || doc.sellerPhone ? `Sotuvchi: ${escapeHtml(doc.sellerName || '')} ${escapeHtml(doc.sellerTelegram || doc.sellerPhone || '')}` : '',
    doc.buyerTelegram || doc.buyerPhone ? `Xaridor: ${escapeHtml(doc.buyerName || '')} ${escapeHtml(doc.buyerTelegram || doc.buyerPhone || '')}` : '',
    doc.telegramUsername ? `Telegram: @${escapeHtml(doc.telegramUsername)}` : '',
    doc.note ? `Izoh: ${escapeHtml(doc.note).slice(0, 800)}` : '',
    ``,
    adminPanelUrl() ? `Admin panel: ${adminPanelUrl()}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
async function notifyAdmins(doc) {
  if (!ADMIN_TELEGRAM_IDS.size) return;
  const inline_keyboard = [];
  if (adminPanelUrl()) inline_keyboard.push([{ text: 'Admin panelni ochish', web_app: { url: adminPanelUrl() } }]);
  if (GROUP_CHAT_URL) inline_keyboard.push([{ text: 'Savdo chatini ochish', url: GROUP_CHAT_URL }]);
  for (const id of ADMIN_TELEGRAM_IDS) {
    await sendTelegramMessage(id, compactRequestMessage(doc), inline_keyboard.length ? { reply_markup: { inline_keyboard } } : {});
    const imgs = [doc.paymentScreenshot, ...(doc.proofImages || [])].filter((x) => x?.url && isHttpImage(x.url)).slice(0, 4);
    for (const img of imgs) await sendTelegramPhoto(id, img.url, `#${escapeHtml(doc.requestNo || '')} rasm/chek`).catch(() => {});
  }
}


function slugKey(label, fallback = 'field') {
  const key = String(label || '').toLowerCase().replace(/['‘’`]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return key || `${fallback}_${crypto.randomBytes(2).toString('hex')}`;
}
function normalizeCustomFields(value) {
  if (Array.isArray(value)) {
    return value.map((field) => ({
      key: slugKey(field.key || field.label),
      label: String(field.label || field.key || '').trim(),
      type: ['text', 'number', 'select', 'textarea', 'url', 'tel'].includes(String(field.type || '').toLowerCase()) ? String(field.type).toLowerCase() : 'text',
      required: parseBoolean(field.required, false),
      placeholder: String(field.placeholder || '').trim(),
      options: Array.isArray(field.options) ? field.options.map((x) => String(x).trim()).filter(Boolean) : String(field.options || '').split(',').map((x) => x.trim()).filter(Boolean),
    })).filter((field) => field.label);
  }
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((x) => x.trim());
    const label = parts[0] || '';
    const type = ['text', 'number', 'select', 'textarea', 'url', 'tel'].includes((parts[1] || '').toLowerCase()) ? parts[1].toLowerCase() : 'text';
    return {
      key: slugKey(label),
      label,
      type,
      required: ['1', 'true', 'ha', 'required', 'yes'].includes(String(parts[2] || '').toLowerCase()),
      placeholder: parts[3] || '',
      options: (parts[4] || '').split(',').map((x) => x.trim()).filter(Boolean),
    };
  });
}
function normalizeImageUrls(value) {
  return String(value || '').split(/\n|,/).map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 8).map((url) => ({ url, publicId: '', local: false }));
}
function mergeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  for (const key of ['tradeChatUrl', 'channelUrl', 'channelChatId', 'paymentInstructions', 'paymentPaynetUrl', 'paymentClickUrl', 'paymentUzumUrl', 'paymentXaznaUrl', 'marketplaceTitle']) {
    if (!String(merged[key] || '').trim()) merged[key] = DEFAULT_SETTINGS[key] || '';
  }
  if (!merged.channelChatId) merged.channelChatId = telegramTargetFromUrl(merged.channelUrl || DEFAULT_CHANNEL_URL);
  return merged;
}
async function getSettingsLean() {
  if (!isDbReady()) {
    await waitForDatabaseReady(30000);
    if (!isDbReady()) return mergeSettings(DEFAULT_SETTINGS);
  }
  const settings = await SocialSettings.findOne({ key: 'main' }).lean();
  return mergeSettings(settings || {});
}
async function recordVisitor(initData, startParam = '') {
  const tg = validateTelegramInitData(initData);
  if (!tg.ok || !tg.user?.id) return { user: null, isAdmin: false, reason: tg.reason };
  const tgUser = tg.user;
  const telegramUserId = String(tgUser.id);
  const referralCode = `U${telegramUserId}`;
  const referredBy = String(startParam || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const payload = {
    telegramUserId,
    username: tgUser.username || '',
    fullName: userFullName(tgUser),
    referralCode,
    lastSeen: new Date(),
  };
  if (referredBy && referredBy !== referralCode) payload.referredBy = referredBy;
  let user = { telegramUserId, username: tgUser.username || '', fullName: userFullName(tgUser), referralCode, referredBy, visits: 1 };
  if (!isDbReady()) await waitForDatabaseReady(30000);
  if (isDbReady()) {
    user = await SocialVisitor.findOneAndUpdate(
      { telegramUserId },
      { $set: payload, $inc: { visits: 1 }, $setOnInsert: { firstSeen: new Date(), bonusBalance: 0 } },
      { upsert: true, new: true, lean: true }
    );
  }
  return { user, isAdmin: isAdminTelegramId(telegramUserId), stored: isDbReady() };
}

app.get('/api/health', (_req, res) => res.json({ success: true, app: 'social-garant-market', time: new Date().toISOString(), database: dbStatus() }));

app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    brand: { name: BRAND_NAME, subtitle: BRAND_SUBTITLE },
    publicUrl: PUBLIC_URL,
    webAppUrl: WEBAPP_URL,
    adminTelegramUrl: ADMIN_TELEGRAM_URL,
    adminTelegramUsername: ADMIN_TELEGRAM_USERNAME,
    groupChatUrl: GROUP_CHAT_URL,
    channelUrl: CHANNEL_URL,
    channelChatId: CHANNEL_CHAT_ID,
    botUsername: BOT_EXPECTED_USERNAME,
    currency: DEFAULT_CURRENCY,
    legalNote: 'Faqat egasining roziligi bor hisoblar qabul qilinadi. Parol, SMS kod va 2FA kodlarni formaga yozmang.',
  });
});


app.get('/api/settings', asyncHandler(async (_req, res) => {
  const settings = await getSettingsLean();
  res.json({ success: true, settings, database: dbStatus() });
}));

app.post('/api/track-user', asyncHandler(async (req, res) => {
  const initData = req.body?.initData || req.get('X-Telegram-Init-Data') || '';
  const startParam = req.body?.startParam || '';
  const result = await recordVisitor(initData, startParam);
  res.json({ success: true, ...result, database: dbStatus() });
}));

app.get('/api/marketplace', asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const filter = { approved: true, status: { $ne: 'HIDDEN' } };
  if (req.query.platform) filter.platform = req.query.platform;
  if (req.query.status) filter.status = req.query.status;
  const items = await MarketplaceItem.find(filter).sort({ status: 1, sort: 1, createdAt: -1 }).limit(250).lean();
  res.json({ success: true, items, database: dbStatus() });
}));

app.get('/api/marketplace/:id', asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  ensureObjectId(req.params.id);
  const item = await MarketplaceItem.findOne({ _id: req.params.id, approved: true, status: { $ne: 'HIDDEN' } }).lean();
  if (!item) return res.status(404).json({ success: false, message: 'Eʼlon topilmadi.' });
  res.json({ success: true, item });
}));

app.get('/api/catalog', asyncHandler(async (_req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const services = await SocialService.find({ active: true }).sort({ sort: 1, createdAt: -1 }).lean();
  res.json({ success: true, services, database: dbStatus() });
}));

app.post('/api/requests', upload.fields([{ name: 'proofImages', maxCount: 6 }, { name: 'paymentScreenshot', maxCount: 1 }]), asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const body = req.body || {};
  const initData = body.initData || req.get('X-Telegram-Init-Data') || '';
  const tg = validateTelegramInitData(initData);
  const tgUser = tg.ok ? tg.user : null;
  const serviceId = body.serviceId && mongoose.Types.ObjectId.isValid(String(body.serviceId)) ? body.serviceId : null;
  const service = serviceId && isDbReady() ? await SocialService.findById(serviceId).lean() : null;
  const proofFiles = Array.isArray(req.files) ? req.files : (req.files?.proofImages || []);
  const paymentFiles = Array.isArray(req.files) ? [] : (req.files?.paymentScreenshot || []);
  const proofImages = [];
  for (const file of proofFiles) proofImages.push(await uploadToCloudinary(file, 'social-garant/proofs'));
  const paymentScreenshot = paymentFiles[0] ? await uploadToCloudinary(paymentFiles[0], 'social-garant/payments') : null;

  const requestType = body.requestType || 'GUARANT_DEAL';
  const contactName = String(body.contactName || '').trim();
  const contactPhone = String(body.contactPhone || '').trim();
  const contactTelegram = String(body.contactTelegram || '').trim();
  const referralCode = String(body.referralCode || body.referredBy || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const startParam = String(body.startParam || '').trim().slice(0, 80);
  const payload = {
    requestNo: randomCode('SG'),
    requestType,
    platform: body.platform || service?.platform || 'other',
    serviceId: service?._id || null,
    serviceTitle: service?.title || body.serviceTitle || '',
    dealSide: body.dealSide || '',
    accountType: body.accountType || '',
    accountLink: body.accountLink || '',
    accountUsername: body.accountUsername || '',
    niche: body.niche || '',
    audienceSize: body.audienceSize || '',
    monetization: body.monetization || '',
    country: body.country || '',
    price: normalizeNumber(body.price),
    currency: body.currency || DEFAULT_CURRENCY,
    sellerName: body.sellerName || (requestType !== 'BUY_ACCOUNT' ? contactName : ''),
    sellerPhone: body.sellerPhone || (requestType !== 'BUY_ACCOUNT' ? contactPhone : ''),
    sellerTelegram: body.sellerTelegram || (requestType !== 'BUY_ACCOUNT' ? contactTelegram : ''),
    buyerName: body.buyerName || (requestType === 'BUY_ACCOUNT' ? contactName : ''),
    buyerPhone: body.buyerPhone || (requestType === 'BUY_ACCOUNT' ? contactPhone : ''),
    buyerTelegram: body.buyerTelegram || (requestType === 'BUY_ACCOUNT' ? contactTelegram : ''),
    telegramUserId: tgUser?.id ? String(tgUser.id) : (body.telegramUserId || ''),
    telegramUsername: tgUser?.username || body.telegramUsername || '',
    telegramFullName: tgUser ? userFullName(tgUser) : (body.telegramFullName || ''),
    transferMethod: body.transferMethod || '',
    paymentProvider: String(body.paymentProvider || '').toUpperCase(),
    paymentStatus: body.paymentProvider || paymentScreenshot ? 'PENDING' : 'NOT_REQUIRED',
    paymentScreenshot: paymentScreenshot || undefined,
    contactName,
    contactPhone,
    contactTelegram,
    referralCode,
    referredBy: referralCode,
    startParam,
    proofImages,
    extra: { ...safeJsonParse(body.extra, {}), dynamicFields: safeJsonParse(body.dynamicFields, {}), marketplaceItemId: body.marketplaceItemId || '', startParam },
    note: body.note || '',
  };

  const doc = await SocialRequest.create(payload);
  const stored = true;

  notifyAdmins(doc).catch((error) => console.error('Admin notification failed:', error.message));
  res.status(201).json({ success: true, message: 'So‘rov qabul qilindi. Admin garant bitim uchun Telegram orqali bog‘lanadi.', request: doc, stored, database: dbStatus() });
}));

app.get('/api/requests/my', asyncHandler(async (req, res) => {
  const telegramUserId = String(req.query.telegramUserId || '').trim();
  if (!telegramUserId) return res.json({ success: true, requests: [], database: dbStatus() });
  if (!(await requirePersistentDatabase(res))) return;
  const requests = await SocialRequest.find({ telegramUserId }).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ success: true, requests, database: dbStatus() });
}));

app.post('/api/admin/login', asyncHandler(async (req, res) => {
  const password = String(req.body?.password || '');
  const initData = req.body?.initData || req.get('X-Telegram-Init-Data') || '';
  const tg = validateTelegramInitData(initData);
  const tgAdmin = tg.ok && tg.user?.id && isAdminTelegramId(tg.user.id);
  if (!tgAdmin && password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Parol noto‘g‘ri yoki Telegram admin ruxsati yo‘q.' });
  const token = signToken(adminTokenPayload());
  res.json({ success: true, token });
}));

app.get('/api/admin/stats', requireAdmin, asyncHandler(async (_req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const [total, fresh, inGarant, done, services, users, marketplace, sold, referrals] = await Promise.all([
    SocialRequest.countDocuments(),
    SocialRequest.countDocuments({ status: 'NEW' }),
    SocialRequest.countDocuments({ status: 'IN_GUARANT' }),
    SocialRequest.countDocuments({ status: 'DONE' }),
    SocialService.countDocuments({ active: true }),
    SocialVisitor.countDocuments(),
    MarketplaceItem.countDocuments({ approved: true, status: { $ne: 'HIDDEN' } }),
    MarketplaceItem.countDocuments({ status: 'SOLD' }),
    SocialVisitor.countDocuments({ referredBy: { $nin: ['', null] } }),
  ]);
  res.json({ success: true, stats: { total, fresh, inGarant, done, services, users, marketplace, sold, referrals }, database: dbStatus() });
}));

app.get('/api/admin/services', requireAdmin, asyncHandler(async (_req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const services = await SocialService.find().sort({ sort: 1, createdAt: -1 }).lean();
  res.json({ success: true, services, database: dbStatus() });
}));

app.post('/api/admin/services', requireAdmin, upload.array('images', 10), asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const body = req.body || {};
  const images = normalizeImageUrls(body.imageUrls);
  for (const file of (req.files || [])) images.push(await uploadToCloudinary(file, 'social-garant/services'));
  const payload = {
    title: body.title,
    category: body.category || 'accounts',
    platform: body.platform || 'other',
    iconKey: body.iconKey || '',
    iconEmoji: body.iconEmoji || '',
    badge: body.badge || '',
    description: body.description || '',
    priceFrom: normalizeNumber(body.priceFrom),
    currency: body.currency || DEFAULT_CURRENCY,
    requiredFields: Array.isArray(body.requiredFields) ? body.requiredFields : String(body.requiredFields || '').split('\n').map((x) => x.trim()).filter(Boolean),
    customFields: normalizeCustomFields(body.customFields || body.managedInputs || body.requiredFields),
    images,
    active: parseBoolean(body.active, true),
    autoPost: parseBoolean(body.autoPost, true),
    sort: normalizeNumber(body.sort) || 100,
  };
  const service = await SocialService.create(payload);
  if (service.autoPost !== false) postToChannel('service', service.toObject ? service.toObject() : service).catch((error) => console.error('Service channel post failed:', error.message));
  res.status(201).json({ success: true, service });
}));

app.patch('/api/admin/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const body = req.body || {};
  const patch = { ...body };
  if ('priceFrom' in patch) patch.priceFrom = normalizeNumber(patch.priceFrom);
  if ('sort' in patch) patch.sort = normalizeNumber(patch.sort);
  if ('active' in patch) patch.active = parseBoolean(patch.active, true);
  if ('requiredFields' in patch && !Array.isArray(patch.requiredFields)) patch.requiredFields = String(patch.requiredFields || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if ('customFields' in patch || 'managedInputs' in patch) patch.customFields = normalizeCustomFields(patch.customFields || patch.managedInputs || patch.requiredFields || '');
  delete patch.managedInputs;
  ensureObjectId(req.params.id);
  const service = await SocialService.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
  res.json({ success: true, service });
}));

app.delete('/api/admin/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  ensureObjectId(req.params.id);
  await SocialService.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

app.get('/api/admin/requests', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.platform) filter.platform = req.query.platform;
  const requests = await SocialRequest.find(filter).sort({ createdAt: -1 }).limit(250).lean();
  res.json({ success: true, requests, database: dbStatus() });
}));

app.patch('/api/admin/requests/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const patch = {};
  for (const key of ['status', 'adminNote']) if (key in req.body) patch[key] = req.body[key];
  ensureObjectId(req.params.id);
  const doc = await SocialRequest.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
  res.json({ success: true, request: doc });
}));


app.get('/api/admin/users', requireAdmin, asyncHandler(async (_req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const users = await SocialVisitor.find().sort({ lastSeen: -1 }).limit(500).lean();
  res.json({ success: true, users, database: dbStatus() });
}));

app.get('/api/admin/settings', requireAdmin, asyncHandler(async (_req, res) => {
  const settings = await getSettingsLean();
  res.json({ success: true, settings, database: dbStatus() });
}));

app.patch('/api/admin/settings', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const body = req.body || {};
  const patch = {
    referralBonus: normalizeNumber(body.referralBonus),
    referralBonusText: String(body.referralBonusText || '').trim() || 'Referral bonus shartlarini admin belgilaydi.',
    tradeChatUrl: String(body.tradeChatUrl || '').trim() || GROUP_CHAT_URL || DEFAULT_TRADE_CHAT_URL,
    channelUrl: String(body.channelUrl || '').trim() || CHANNEL_URL || DEFAULT_CHANNEL_URL,
    channelChatId: String(body.channelChatId || '').trim() || telegramTargetFromUrl(String(body.channelUrl || '').trim() || CHANNEL_URL || DEFAULT_CHANNEL_URL),
    paymentInstructions: String(body.paymentInstructions || '').trim() || DEFAULT_SETTINGS.paymentInstructions,
    paymentPaynetUrl: String(body.paymentPaynetUrl || '').trim(),
    paymentClickUrl: String(body.paymentClickUrl || '').trim(),
    paymentUzumUrl: String(body.paymentUzumUrl || '').trim(),
    paymentXaznaUrl: String(body.paymentXaznaUrl || '').trim(),
    paymentPaymeUrl: String(body.paymentPaymeUrl || '').trim(),
    paymentOtherUrl: String(body.paymentOtherUrl || '').trim(),
    marketplaceTitle: String(body.marketplaceTitle || '').trim() || 'Marketplace',
  };
  const settings = await SocialSettings.findOneAndUpdate({ key: 'main' }, { $set: patch, $setOnInsert: { key: 'main' } }, { upsert: true, new: true, lean: true });
  res.json({ success: true, settings });
}));

app.get('/api/admin/marketplace', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.platform) filter.platform = req.query.platform;
  const items = await MarketplaceItem.find(filter).sort({ sort: 1, createdAt: -1 }).limit(500).lean();
  res.json({ success: true, items, database: dbStatus() });
}));

app.post('/api/admin/marketplace', requireAdmin, upload.array('images', 10), asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const body = req.body || {};
  const images = normalizeImageUrls(body.imageUrls);
  for (const file of (req.files || [])) images.push(await uploadToCloudinary(file, 'social-garant/marketplace'));
  const payload = {
    title: body.title,
    platform: body.platform || 'other',
    category: body.category || 'accounts',
    iconKey: body.iconKey || '',
    iconEmoji: body.iconEmoji || '',
    badge: body.badge || '',
    description: body.description || '',
    accountLink: body.accountLink || '',
    accountUsername: body.accountUsername || '',
    audienceSize: body.audienceSize || '',
    niche: body.niche || '',
    country: body.country || '',
    monetization: body.monetization || '',
    price: normalizeNumber(body.price),
    oldPrice: normalizeNumber(body.oldPrice),
    currency: body.currency || DEFAULT_CURRENCY,
    images,
    ownerName: body.ownerName || '',
    ownerTelegram: body.ownerTelegram || '',
    ownerTelegramId: body.ownerTelegramId || '',
    ownerChatUrl: body.ownerChatUrl || '',
    channelAutoPost: parseBoolean(body.channelAutoPost, true),
    status: body.status || 'AVAILABLE',
    approved: parseBoolean(body.approved, true),
    sort: normalizeNumber(body.sort) || 100,
  };
  const item = await MarketplaceItem.create(payload);
  if (item.channelAutoPost !== false) postToChannel('marketplace', item.toObject ? item.toObject() : item).catch((error) => console.error('Marketplace channel post failed:', error.message));
  res.status(201).json({ success: true, item });
}));

app.patch('/api/admin/marketplace/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  const body = req.body || {};
  const patch = { ...body };
  for (const key of ['price', 'oldPrice', 'sort']) if (key in patch) patch[key] = normalizeNumber(patch[key]);
  if ('approved' in patch) patch.approved = parseBoolean(patch.approved, true);
  if ('imageUrls' in patch) { patch.images = normalizeImageUrls(patch.imageUrls); delete patch.imageUrls; }
  if (patch.status === 'SOLD') patch.soldAt = new Date();
  ensureObjectId(req.params.id);
  const before = await MarketplaceItem.findById(req.params.id).lean();
  const item = await MarketplaceItem.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true }).lean();
  if (patch.status === 'SOLD' && before?.status !== 'SOLD') notifySold(item).catch(() => {});
  res.json({ success: true, item });
}));

app.delete('/api/admin/marketplace/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  ensureObjectId(req.params.id);
  await MarketplaceItem.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

app.post('/api/admin/requests/:id/publish-marketplace', requireAdmin, asyncHandler(async (req, res) => {
  if (!(await requirePersistentDatabase(res))) return;
  ensureObjectId(req.params.id);
  const r = await SocialRequest.findById(req.params.id).lean();
  if (!r) return res.status(404).json({ success: false, message: 'So‘rov topilmadi.' });
  const item = await MarketplaceItem.create({
    title: req.body?.title || r.serviceTitle || `${r.platform} hisob`,
    platform: r.platform || 'other',
    category: r.requestType === 'SERVICE_ORDER' ? 'other' : 'accounts',
    badge: 'Tasdiqlangan',
    description: req.body?.description || r.note || `${r.accountUsername || r.accountLink || 'Hisob'} bo‘yicha admin tasdiqlagan eʼlon.`,
    accountLink: r.accountLink || '',
    accountUsername: r.accountUsername || '',
    audienceSize: r.audienceSize || '',
    niche: r.niche || '',
    country: r.country || '',
    monetization: r.monetization || '',
    price: r.price || 0,
    currency: r.currency || DEFAULT_CURRENCY,
    images: r.proofImages || [],
    sourceRequestId: r._id,
    approved: true,
    status: 'AVAILABLE',
    sort: 100,
  });
  await SocialRequest.findByIdAndUpdate(r._id, { status: 'IN_GUARANT', adminNote: `${r.adminNote || ''}\nMarketplacega chiqarildi: ${item._id}`.trim() });
  postToChannel('marketplace', item.toObject ? item.toObject() : item).catch(() => {});
  res.status(201).json({ success: true, item });
}));

app.post('/telegram/webhook', asyncHandler(async (req, res) => {
  if (TELEGRAM_WEBHOOK_SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== TELEGRAM_WEBHOOK_SECRET) return res.status(401).json({ ok: false });
  const msg = req.body?.message;
  const chatId = msg?.chat?.id;
  const text = String(msg?.text || '').trim();
  if (!chatId) return res.json({ ok: true });
  if (text === '/id') {
    await sendTelegramMessage(chatId, `Sizning Telegram ID: <code>${chatId}</code>`);
    return res.json({ ok: true });
  }
  if (text.startsWith('/start') || text === '/menu') {
    const startParam = text.startsWith('/start') ? text.replace(/^\/start(@\w+)?\s*/i, '').trim() : '';
    const buttons = [];
    if (isAdminTelegramId(chatId) && adminPanelUrl()) buttons.push([{ text: 'Admin panel', web_app: { url: adminPanelUrl() } }]);
    if (webAppStartUrl(startParam)) buttons.push([{ text: 'Garant Marketni ochish', web_app: { url: webAppStartUrl(startParam) } }]);
    if (GROUP_CHAT_URL) buttons.push([{ text: 'Savdo guruhi/chati', url: GROUP_CHAT_URL }]);
    if (ADMIN_TELEGRAM_URL) buttons.push([{ text: 'Admin bilan bog‘lanish', url: ADMIN_TELEGRAM_URL }]);
    await sendTelegramMessage(chatId, `<b>${escapeHtml(BRAND_NAME)}</b>

${escapeHtml(BRAND_SUBTITLE)}

Ijtimoiy tarmoq hisoblari savdosi, garant bitim va xizmatlar uchun mini ilovani oching.`, buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {});
    return res.json({ ok: true });
  }
  await sendTelegramMessage(chatId, `Mini ilovani ochish uchun /start yuboring. Admin ID kerak bo‘lsa /id yuboring.`);
  res.json({ ok: true });
}));

app.get('/telegram/set-webhook', asyncHandler(async (_req, res) => {
  if (!BOT_TOKEN) return res.status(400).json({ success: false, message: 'BOT_TOKEN sozlanmagan.' });
  if (!PUBLIC_URL) return res.status(400).json({ success: false, message: 'PUBLIC_URL sozlanmagan.' });
  const result = await telegramApi('setWebhook', {
    url: `${PUBLIC_URL}/telegram/webhook`,
    secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ['message'],
  });
  await ensureBotMenuButton();
  res.json({ success: Boolean(result?.ok), result });
}));

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || error.statusCode || (String(error.message || '').toLowerCase().includes('mongo') ? 503 : 500);
  res.status(status).json({ success: false, message: error.message || 'Server xatoligi.', database: dbStatus() });
});

async function connectMongoWithRetry({ exitOnFail = false } = {}) {
  if (databaseConnecting || isDbReady()) return isDbReady();
  databaseConnecting = true;
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 60000),
      connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 60000),
      socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 1),
      retryWrites: true,
      autoIndex: true,
    });
    databaseReady = true;
    databaseError = '';
    await seedDefaults();
    await syncLocalStoreToMongo().catch((error) => console.error('Old local store sync failed:', error.message));
    console.log(`${BRAND_NAME} MongoDB connected and persistent storage is active`);
    return true;
  } catch (error) {
    databaseReady = false;
    databaseError = error?.message || String(error);
    console.error(`${BRAND_NAME} MongoDB connection failed:`, databaseError);
    if (exitOnFail) process.exit(1);
    setTimeout(() => connectMongoWithRetry().catch(() => {}), Number(process.env.MONGO_RETRY_MS || 10000)).unref();
    return false;
  } finally {
    databaseConnecting = false;
  }
}

mongoose.connection.on('connected', () => { databaseReady = true; databaseError = ''; });
mongoose.connection.on('disconnected', () => {
  databaseReady = false;
  databaseError = databaseError || 'MongoDB disconnected';
  setTimeout(() => connectMongoWithRetry().catch(() => {}), Number(process.env.MONGO_RETRY_MS || 10000)).unref();
});
mongoose.connection.on('error', (error) => {
  databaseReady = false;
  databaseError = error?.message || String(error);
});

async function boot() {
  if (httpServerStarted) return;
  httpServerStarted = true;
  await connectMongoWithRetry({ exitOnFail: true });
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`${BRAND_NAME} server listening on ${PORT} with persistent MongoDB storage`);
    if (AUTO_SET_WEBHOOK && BOT_TOKEN && PUBLIC_URL) {
      try {
        const result = await telegramApi('setWebhook', {
          url: `${PUBLIC_URL}/telegram/webhook`,
          secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
          allowed_updates: ['message'],
        });
        console.log('Telegram webhook:', result?.ok ? 'set' : JSON.stringify(result));
        await ensureBotMenuButton();
      } catch (error) { console.error('Telegram webhook error:', error.message); }
    }
    if (TELEGRAM_POLLING) console.warn('TELEGRAM_POLLING=true sozlangan, lekin bu bot Render uchun webhook rejimida ishlaydi.');
  });
}
boot().catch((error) => { console.error('Boot failed:', error); process.exit(1); });
