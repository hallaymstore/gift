'use strict';

require('dotenv').config();

const path = require('path');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/giftgo_platform';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_EXPECTED_USERNAME = String(process.env.BOT_EXPECTED_USERNAME || '').replace(/^@/, '').trim();
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const ADMIN_TELEGRAM_IDS = new Set(String(process.env.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_ID || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean));
const ALLOW_PASSWORD_ADMIN = String(process.env.ALLOW_PASSWORD_ADMIN || 'false').toLowerCase() === 'true';
const REQUIRE_TELEGRAM_AUTH = String(process.env.REQUIRE_TELEGRAM_AUTH || 'false').toLowerCase() === 'true';
const INIT_DATA_MAX_AGE_SECONDS = Number(process.env.INIT_DATA_MAX_AGE_SECONDS || 60 * 60 * 24);
const AUTO_SET_WEBHOOK = String(process.env.AUTO_SET_WEBHOOK || 'false').toLowerCase() === 'true';
const TELEGRAM_POLLING = String(process.env.TELEGRAM_POLLING || 'false').toLowerCase() === 'true';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB || 6);
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 2;

function cleanPublicUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 800, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) return cb(new Error('Faqat PNG, JPG, WEBP yoki GIF rasm qabul qilinadi.'));
    cb(null, true);
  },
});

function asyncHandler(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function normalizeNumber(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function parseBoolean(value, fallback = false) { if (value === undefined || value === null || value === '') return fallback; return ['true', '1', 'yes', 'on', 'ha'].includes(String(value).toLowerCase()); }
function safeJsonParse(value, fallback) { try { if (typeof value === 'string') return JSON.parse(value); return value ?? fallback; } catch { return fallback; } }
function formatMoney(amount, currency = 'UZS') { return `${Number(amount || 0).toLocaleString('uz-UZ')} ${currency}`; }
function orderStatusText(v) { return ({ NEW: 'Yangi', CONFIRMED: 'Tasdiqlandi', PREPARING: 'Tayyorlanmoqda', SHOPPING: 'Xarid qilinmoqda', ON_ROAD: 'Yo‘lda', READY: 'Tayyor', DONE: 'Yakunlandi', CANCELLED: 'Bekor qilindi' })[v] || v || ''; }
function paymentStatusText(v) { return ({ PENDING: 'Kutilmoqda', APPROVED: 'Tasdiqlandi', REJECTED: 'Rad etildi' })[v] || v || ''; }
function normalizePromoCode(code) { return String(code || '').trim().toUpperCase().replace(/\s+/g, ''); }
function dateOnlyUTC(date) { return new Date(`${date}T00:00:00.000Z`); }
function todayLocalISO(offsetDays = 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); }
function ensureObjectId(id, fieldName = 'ID') { if (!mongoose.Types.ObjectId.isValid(String(id || ''))) { const err = new Error(`${fieldName} noto‘g‘ri.`); err.status = 400; throw err; } return id; }
function randomCode(prefix = 'GG') { return `${prefix}${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function nextHumanNo(prefix) { const d = new Date(); const y = String(d.getFullYear()).slice(-2); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${prefix}-${y}${m}${day}-${crypto.randomInt(1000, 9999)}`; }
function userFullName(user, fallback = '') { return [user?.first_name, user?.last_name].filter(Boolean).join(' ') || fallback || 'Telegram foydalanuvchi'; }
function isAdminTelegramId(id) { return ADMIN_TELEGRAM_IDS.has(String(id || '').trim()); }
function adminIdsConfigured() { return ADMIN_TELEGRAM_IDS.size > 0; }
function adminAccessHelp() { return adminIdsConfigured() ? 'Bu Telegram akkaunt boshqaruvchi ro‘yxatida yo‘q.' : 'ADMIN_TELEGRAM_IDS .env faylida sozlanmagan. Botga /id yuborib Telegram raqami ni kiriting.'; }
function adminPanelUrl() { return PUBLIC_URL ? `${PUBLIC_URL}/admin` : ''; }
function webAppStartUrl(startParam = '') { if (!WEBAPP_URL) return ''; const q = startParam ? `?startapp=${encodeURIComponent(startParam)}` : ''; return `${WEBAPP_URL}${q}`; }
function botStartUrl(botUsername, startParam = '') { const username = String(botUsername || '').replace(/^@/, '').trim(); if (!username) return webAppStartUrl(startParam); return `https://t.me/${username}${startParam ? `?start=${encodeURIComponent(startParam)}` : ''}`; }

async function ensureBotMenuButton() {
  if (!BOT_TOKEN || !WEBAPP_URL) return;
  try {
    await telegramApi('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Sovg‘alar', web_app: { url: WEBAPP_URL } }
    });
  } catch (error) {
    console.error('Telegram menu button error:', error.message);
  }
}

function makeLogoDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="126" fill="#fff0f4"/><circle cx="256" cy="246" r="146" fill="#e21b4d"/><path d="M160 252c52-92 124-124 192-52 20 22 26 58 4 92-40 62-152 74-196-40Z" fill="#fff"/><path d="M170 248c42-64 100-92 150-42 19 19 21 46 3 72-34 50-120 55-153-30Z" fill="#e21b4d"/><circle cx="318" cy="162" r="30" fill="#ffcf4a"/><text x="256" y="404" text-anchor="middle" font-family="Arial" font-weight="900" font-size="42" fill="#e21b4d">GIFT</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
function isConfiguredCloudinary() { return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET); }
async function uploadToCloudinary(file, folder) {
  if (!file) return null;
  if (!isConfiguredCloudinary()) { const err = new Error('Cloudinary sozlanmagan. .env ichida CLOUDINARY_* qiymatlarini kiriting.'); err.status = 500; throw err; }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' }, (error, result) => {
      if (error) return reject(error);
      resolve({ url: result.secure_url, publicId: result.public_id });
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
  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (authDate && INIT_DATA_MAX_AGE_SECONDS > 0 && now - authDate > INIT_DATA_MAX_AGE_SECONDS) return { ok: false, reason: 'Telegram initData muddati tugagan.' };
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  try {
    const valid = crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(hash, 'hex'));
    if (!valid) return { ok: false, reason: 'Telegram imzo mos kelmadi.' };
  } catch { return { ok: false, reason: 'Telegram imzo formati noto‘g‘ri.' }; }
  return { ok: true, user: safeJsonParse(params.get('user'), null), raw: Object.fromEntries(params.entries()) };
}
function telegramAuth(req, res, next) {
  const initData = req.get('X-Telegram-Init-Data') || req.body?.initData || req.query?.initData || '';
  const validated = validateTelegramInitData(initData);
  if (validated.ok && validated.user?.id) { req.tgUser = validated.user; req.tgRaw = validated.raw || {}; return next(); }
  if (REQUIRE_TELEGRAM_AUTH) return res.status(401).json({ success: false, message: validated.reason || 'Telegram auth xatosi.' });
  const demoId = req.get('X-Demo-User-Id') || req.body?.demoUserId || req.query?.demoUserId || 'demo-user';
  req.tgUser = { id: String(demoId), first_name: req.body?.fullName || 'Demo', last_name: '', username: 'demo' };
  req.tgRaw = { start_param: req.body?.startParam || req.query?.startParam || '' };
  next();
}
function signAdminToken(payload = {}) { const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ADMIN_TOKEN_TTL_MS })).toString('base64url'); const sig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url'); return `${body}.${sig}`; }
function verifyAdminToken(req, res, next) {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !token.includes('.')) return res.status(401).json({ success: false, message: 'Boshqaruv tokeni kerak.' });
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  if (sig !== expected) return res.status(401).json({ success: false, message: 'Boshqaruv tokeni noto‘g‘ri.' });
  const payload = safeJsonParse(Buffer.from(body, 'base64url').toString('utf8'), null);
  if (!payload || payload.exp < Date.now()) return res.status(401).json({ success: false, message: 'Boshqaruv tokeni muddati tugagan.' });
  if (payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Boshqaruv huquqi yo‘q.' });
  if (payload.tgId && !isAdminTelegramId(payload.tgId)) return res.status(403).json({ success: false, message: 'Bu boshqaruvchi raqami endi ruxsat ro‘yxatida yo‘q.' });
  if (payload.fallback && !ALLOW_PASSWORD_ADMIN) return res.status(403).json({ success: false, message: 'Parol orqali admin kirish o‘chirilgan.' });
  req.admin = payload;
  next();
}

const settingsSchema = new mongoose.Schema({
  brandName: { type: String, default: 'GiftGo — Gul va Sovg‘a Delivery' },
  brandSubtitle: { type: String, default: 'Gullar, sovg‘a box, shirinlik, tort, ichimlik va fast food uchun universal platforma' },
  logoUrl: { type: String, default: makeLogoDataUri },
  currency: { type: String, default: 'UZS' },
  businessPhone: { type: String, default: '+998 90 000 00 00' },
  supportPhone: { type: String, default: '+998887660800' },
  supportTelegram: { type: String, default: '@Qoryogdiyev' },
  businessAddress: { type: String, default: 'Kasbi, Qashqadaryo' },
  businessLat: { type: Number, default: 38.8616 },
  businessLng: { type: Number, default: 65.5858 },
  restaurantPhone: { type: String, default: '+998 90 000 00 00' },
  restaurantAddress: { type: String, default: 'Kasbi, Qashqadaryo' },
  restaurantLat: { type: Number, default: 38.8616 },
  restaurantLng: { type: Number, default: 65.5858 },
  botUsername: { type: String, default: '' },
  instagram: { type: String, default: '@giftgo' },
  openingHours: { type: String, default: 'Har kuni 09:00–22:00' },
  deliveryAutoPricingEnabled: { type: Boolean, default: true },
  deliveryBaseFee: { type: Number, default: 5000 },
  deliveryBaseKm: { type: Number, default: 1 },
  deliveryPricePerKm: { type: Number, default: 5000 },
  deliveryMaxKm: { type: Number, default: 35 },
  deliveryOutOfZoneEnabled: { type: Boolean, default: true },
  scheduledMinLeadDays: { type: Number, default: 4 },
  expressRandomEnabled: { type: Boolean, default: true },
  expressMaxLeadHours: { type: Number, default: 1 },
  expressRandomMinAmount: { type: Number, default: 100000 },
  expressAgreementText: { type: String, default: 'Shakli, rangi yoki turi qanday bo‘lishidan qat’i nazar, bergan pulimga yarasha mavjud mahsulot olib kelinishiga roziman.' },
  firstOrderDiscountEnabled: { type: Boolean, default: true },
  firstOrderDiscountAmount: { type: Number, default: 10000 },
  referralFriendDiscountAmount: { type: Number, default: 10000 },
  referralInviterBonusAmount: { type: Number, default: 10000 },
  cashbackPercent: { type: Number, default: 3 },
  bonusUseEnabled: { type: Boolean, default: true },
  paymentCardTitle: { type: String, default: 'GiftGo karta to‘lovi' },
  paymentCardBank: { type: String, default: 'Click / Payme / Uzcard' },
  paymentCardNumber: { type: String, default: '8600 0000 0000 0000' },
  paymentCardHolder: { type: String, default: 'GIFTGO' },
  paymentInstructions: { type: String, default: 'Buyurtma faqat oldindan to‘lov orqali qabul qilinadi. To‘lov ilovasini tanlang, pulni yuboring, keyin mini ilovaga qaytib chek rasmini yuklang. Boshqaruvchi tasdiqlagandan keyin buyurtma ishga tushadi.' },
  paymentPaynetUrl: { type: String, default: "https://app.paynet.uz/qr-online/00020101021140440012qr-online.uz01186r0vBrkobM1uBpXqv40202115204531153038605802UZ5910AO'PAYNET'6008Tashkent610610002164280002uz0106PAYNET0208Toshkent80520012qr-online.uz03097120207070419marketing@paynet.uz63042E24" },
  paymentClickUrl: { type: String, default: 'https://my.click.uz/clickp2p/64FF6DA1B8F00B46B2936F561CCF73B01A05A23D2130A2B7F7A9E217A12F0BBD' },
  paymentUzumUrl: { type: String, default: 'https://b.2u.uz/ttc?qr=Nzk5MzoyMDQzNTUwMzowMUtTUE1XM0gwSE03RTFUNzRDTU5XRkZLNzpkMUhZYmhKWDZ3UGVQYVkxcW9mU3pVTmRHcVU9' },
  paymentXaznaUrl: { type: String, default: 'https://pay.xazna.uz/p2p/e07e655f-886e-4942-b325-846d8a0c2ce9' },
  paymentPaymeUrl: { type: String, default: '' },
  paymentOtherUrl: { type: String, default: '' },
  cashOnDeliveryEnabled: { type: Boolean, default: false },
  cashOnPickupEnabled: { type: Boolean, default: false },
  adminTelegramChatId: { type: String, default: '' },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true, default: 'Gullar' },
  productType: { type: String, enum: ['FLOWER', 'GIFT_BOX', 'CAKE', 'SWEET', 'DRINK', 'FAST_FOOD', 'SERVICE', 'OTHER'], default: 'FLOWER' },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  oldPrice: { type: Number, default: 0 },
  imageUrl: { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
  galleryUrls: { type: [String], default: [] },
  galleryPublicIds: { type: [String], default: [] },
  emoji: { type: String, default: '' },
  variants: [{ label: { type: String, default: '' }, color: { type: String, default: '' }, size: { type: String, default: '' }, sku: { type: String, default: '' }, price: { type: Number, default: 0 }, oldPrice: { type: Number, default: 0 }, stockQty: { type: Number, default: 0 }, imageUrl: { type: String, default: '' }, imagePublicId: { type: String, default: '' } }],
  customRequestFields: [{ key: { type: String, default: '' }, label: { type: String, default: '' }, description: { type: String, default: '' }, placeholder: { type: String, default: '' }, type: { type: String, default: 'TEXT' }, required: { type: Boolean, default: false } }],
  available: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  promoEligible: { type: Boolean, default: true },
  promoCode: { type: String, default: '' },
  promoDiscountPercent: { type: Number, default: 0 },
  cashbackPercentOverride: { type: Number, default: 0 },
  minLeadDays: { type: Number, default: 4 },
  expressRandomAllowed: { type: Boolean, default: false },
  shortDescription: { type: String, default: '' },
  packageIncludes: { type: String, default: '' },
  composition: { type: String, default: '' },
  colorOptions: { type: [String], default: [] },
  sizeOptions: { type: [String], default: [] },
  flavorOptions: { type: [String], default: [] },
  designOptions: { type: [String], default: [] },
  occasionTags: { type: [String], default: [] },
  recipientTags: { type: [String], default: [] },
  unitLabel: { type: String, default: '' },
  stockQty: { type: Number, default: 0 },
  preparationNote: { type: String, default: '' },
  careInstructions: { type: String, default: '' },
  deliveryNotes: { type: String, default: '' },
  adminInternalNote: { type: String, default: '' },
  serviceKind: { type: String, default: '' },
  serviceFormat: { type: String, enum: ['', 'CALL', 'ONLINE', 'ONSITE', 'MONTAGE', 'DECOR', 'MUSIC', 'HYBRID'], default: '' },
  serviceDuration: { type: String, default: '' },
  servicePerformer: { type: String, default: '' },
  serviceLocationType: { type: String, enum: ['', 'PHONE', 'ONLINE', 'RECIPIENT_ADDRESS', 'CUSTOM_ADDRESS', 'SHOP', 'HYBRID'], default: '' },
  serviceIncludes: { type: String, default: '' },
  serviceRequirements: { type: String, default: '' },
  requiredClientInfo: { type: String, default: '' },
  serviceScriptPrompt: { type: String, default: '' },
  serviceProviderPhone: { type: String, default: '' },
  serviceProviderTelegram: { type: String, default: '' },
  serviceProviderCost: { type: Number, default: 0 },
  serviceCommissionAmount: { type: Number, default: 0 },
  serviceProviderNote: { type: String, default: '' },
  sort: { type: Number, default: 100 },
}, { timestamps: true });
productSchema.index({ name: 'text', category: 'text', description: 'text' });

const deliveryServiceSchema = new mongoose.Schema({ title: { type: String, required: true, trim: true }, description: { type: String, default: '' }, price: { type: Number, default: 0, min: 0 }, eta: { type: String, default: '30–60 daqiqa' }, active: { type: Boolean, default: true }, sort: { type: Number, default: 100 } }, { timestamps: true });

const promoCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  title: { type: String, default: '' },
  discountType: { type: String, enum: ['PERCENT', 'FIXED', 'FREE_DELIVERY'], default: 'PERCENT' },
  value: { type: Number, default: 0 },
  maxDiscount: { type: Number, default: 0 },
  minSubtotal: { type: Number, default: 0 },
  firstOrderOnly: { type: Boolean, default: false },
  categories: { type: [String], default: [] },
  productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  startsAt: Date,
  endsAt: Date,
  usageLimit: { type: Number, default: 0 },
  usedCount: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

const customerSchema = new mongoose.Schema({
  userTelegramId: { type: String, required: true, unique: true, index: true },
  username: { type: String, default: '' },
  fullName: { type: String, default: '' },
  phone: { type: String, default: '' },
  referralCode: { type: String, unique: true, index: true },
  referredBy: { type: String, default: '' },
  bonusBalance: { type: Number, default: 0 },
  totalBonusEarned: { type: Number, default: 0 },
  totalBonusSpent: { type: Number, default: 0 },
  completedOrders: { type: Number, default: 0 },
  referralRewardCredited: { type: Boolean, default: false },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderNo: { type: String, unique: true, index: true },
  userTelegramId: { type: String, index: true },
  userUsername: String,
  userFullName: String,
  phone: { type: String, required: true },
  type: { type: String, enum: ['DELIVERY', 'PICKUP'], default: 'DELIVERY' },
  orderContentType: { type: String, enum: ['PRODUCT', 'SERVICE', 'HYBRID'], default: 'PRODUCT', index: true },
  orderMode: { type: String, enum: ['SCHEDULED', 'EXPRESS_RANDOM'], default: 'SCHEDULED' },
  eventType: { type: String, default: '' },
  deliveryDate: { type: String, default: '' },
  deliveryTime: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  recipientPhone: { type: String, default: '' },
  buyerInfo: {
    fullName: { type: String, default: '' }, phone: { type: String, default: '' }, address: { type: String, default: '' },
    locationNote: { type: String, default: '' }, location: { lat: Number, lng: Number, accuracy: Number, source: String, updatedAt: Date }
  },
  recipientInfo: {
    fullName: { type: String, default: '' }, phone: { type: String, default: '' }, address: { type: String, default: '' },
    relation: { type: String, default: '' }, age: { type: String, default: '' }, locationNote: { type: String, default: '' },
    location: { lat: Number, lng: Number, accuracy: Number, source: String, updatedAt: Date }
  },
  productDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  serviceDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  customFieldAnswers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  cardMessage: { type: String, default: '' },
  noComplaintAgreement: { type: Boolean, default: false },
  agreementText: { type: String, default: '' },
  address: { type: String, default: '' },
  customerLocation: { lat: Number, lng: Number, accuracy: Number, source: { type: String, default: '' }, updatedAt: Date },
  businessLocationSnapshot: { lat: Number, lng: Number, address: String },
  restaurantLocationSnapshot: { lat: Number, lng: Number, address: String },
  distanceKm: { type: Number, default: 0 },
  movementTrend: { type: String, enum: ['UNKNOWN', 'APPROACHING', 'MOVING_AWAY', 'STABLE'], default: 'UNKNOWN' },
  movementDeltaKm: { type: Number, default: 0 },
  lastLocationAt: Date,
  liveLocationEnabled: { type: Boolean, default: false },
  deliveryServiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryService' },
  deliveryServiceTitle: String,
  items: [{ productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, name: String, price: Number, qty: Number, subtotal: Number, productType: String, category: String, variantSku: String, variantLabel: String, selectedColor: String, selectedSize: String }],
  subtotal: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  firstOrderDiscount: { type: Number, default: 0 },
  promoCode: { type: String, default: '' },
  promoDiscount: { type: Number, default: 0 },
  referralDiscount: { type: Number, default: 0 },
  bonusUsed: { type: Number, default: 0 },
  bonusEarned: { type: Number, default: 0 },
  bonusStatus: { type: String, enum: ['PENDING', 'CREDITED', 'CANCELLED'], default: 'PENDING' },
  bonusRefunded: { type: Boolean, default: false },
  total: { type: Number, default: 0 },
  deliveryPricing: { baseFee: Number, baseKm: Number, pricePerKm: Number, maxKm: Number, mode: { type: String, default: 'STATIC' }, zoneStatus: { type: String, default: 'UNKNOWN' } },
  paymentMethod: { type: String, enum: ['CARD_TRANSFER', 'PAYMENT_LINK', 'CASH_ON_DELIVERY', 'CASH_ON_PICKUP'], default: 'CARD_TRANSFER' },
  paymentProvider: { type: String, default: '' },
  paymentScreenshotUrl: { type: String, default: '' },
  paymentScreenshotPublicId: { type: String, default: '' },
  paymentStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  orderStatus: { type: String, enum: ['NEW', 'CONFIRMED', 'PREPARING', 'SHOPPING', 'ON_ROAD', 'READY', 'DONE', 'CANCELLED'], default: 'NEW' },
  note: { type: String, default: '' },
  planNote: { type: String, default: '' },
  adminNote: { type: String, default: '' },
  reminderFrequency: { type: String, enum: ['NONE', 'EVERY_3H', 'EVERY_6H', 'EVERY_12H', 'DAILY'], default: 'DAILY' },
  reminderNote: { type: String, default: '' },
  reminderNextAt: Date,
  reminderLastSentAt: Date,
}, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);
const Product = mongoose.model('Product', productSchema);
const DeliveryService = mongoose.model('DeliveryService', deliveryServiceSchema);
const PromoCode = mongoose.model('PromoCode', promoCodeSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Order = mongoose.model('Order', orderSchema);

const reviewSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  userTelegramId: { type: String, required: true, index: true },
  fullName: { type: String, default: '' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' },
  adminReply: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true });
reviewSchema.index({ productId: 1, userTelegramId: 1 }, { unique: true });
const Review = mongoose.model('Review', reviewSchema);


function listFromText(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  return String(value || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
}

function parseVariantsText(value) {
  const rows = String(value || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return rows.map((row, idx) => {
    const parts = row.split('|').map((x) => x.trim());
    const [label, color, size, price, oldPrice, stockQty, sku, imageUrl] = parts;
    return {
      label: label || [color, size].filter(Boolean).join(' / ') || `Variant ${idx + 1}`,
      color: color || '',
      size: size || '',
      price: normalizeNumber(price),
      oldPrice: normalizeNumber(oldPrice),
      stockQty: normalizeNumber(stockQty),
      sku: String(sku || `${(label || color || size || 'variant').toLowerCase().replace(/\s+/g, '-')}-${idx + 1}`).slice(0, 60),
      imageUrl: String(imageUrl || '').trim(),
      imagePublicId: '',
    };
  }).filter((v) => v.label);
}
function parseCustomFields(value) {
  const raw = safeJsonParse(value, []);
  const items = Array.isArray(raw) ? raw : [];
  return items.map((item, idx) => {
    const label = String(item?.label || '').trim();
    const keyBase = String(item?.key || label || `field-${idx + 1}`).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!label) return null;
    const type = String(item?.type || 'TEXT').trim().toUpperCase();
    const allowed = new Set(['TEXT','TEXTAREA','PHONE','NUMBER','DATE','TIME','ADDRESS']);
    return {
      key: keyBase || `field-${idx + 1}`,
      label,
      description: String(item?.description || '').trim(),
      placeholder: String(item?.placeholder || '').trim(),
      type: allowed.has(type) ? type : 'TEXT',
      required: Boolean(item?.required),
    };
  }).filter(Boolean);
}
function extractOrderCustomFieldAnswers(value, products = []) {
  const submitted = Array.isArray(value) ? value : safeJsonParse(value, []);
  const byKey = new Map((Array.isArray(submitted) ? submitted : []).map((item) => [String(item?.orderKey || item?.key || '').trim(), String(item?.value || '').trim()]));
  const answers = [];
  for (const product of products || []) {
    const fields = Array.isArray(product.customRequestFields) ? product.customRequestFields : [];
    for (const field of fields) {
      const orderKey = `${String(product._id)}__${String(field.key || '').trim()}`;
      const value = String(byKey.get(orderKey) || '').trim();
      if (field.required && !value) {
        const err = new Error(`"${product.name}" uchun "${field.label}" maydonini to‘ldiring.`);
        err.status = 400;
        throw err;
      }
      answers.push({
        productId: String(product._id),
        productName: String(product.name || ''),
        orderKey,
        key: String(field.key || ''),
        label: String(field.label || ''),
        description: String(field.description || ''),
        placeholder: String(field.placeholder || ''),
        type: String(field.type || 'TEXT'),
        required: Boolean(field.required),
        value,
      });
    }
  }
  return answers.filter((item) => item.label);
}
function filesByField(files = [], fieldName) {
  if (!Array.isArray(files)) return [];
  return files.filter((file) => file.fieldname === fieldName);
}
function uniqueProductImages(productLike = {}) {
  const variants = Array.isArray(productLike.variants) ? productLike.variants : [];
  return [...new Set([
    productLike.imageUrl,
    ...((productLike.galleryUrls || []).filter(Boolean)),
    ...variants.map((v) => v.imageUrl).filter(Boolean),
  ].filter(Boolean))].slice(0, 8);
}
async function attachVariantImages(variants = [], files = []) {
  if (!Array.isArray(variants) || !variants.length || !Array.isArray(files) || !files.length) return variants;
  for (let i = 0; i < variants.length; i += 1) {
    const file = files.find((f) => f.fieldname === `variantImage_${i}`) || files[i];
    if (!file) continue;
    const uploaded = await uploadToCloudinary(file, 'giftgo/products/variants');
    variants[i].imageUrl = uploaded.url;
    variants[i].imagePublicId = uploaded.publicId;
  }
  return variants;
}
async function getProductRatingSummary(productId) {
  const rows = await Review.aggregate([{ $match: { productId: new mongoose.Types.ObjectId(String(productId)), active: true } }, { $group: { _id: '$productId', avgRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } }]);
  return rows[0] ? { avgRating: Number(rows[0].avgRating || 0).toFixed(1), reviewCount: Number(rows[0].reviewCount || 0) } : { avgRating: '0.0', reviewCount: 0 };
}

function parsePrefixedLocation(body = {}, prefix = '') {
  const lat = normalizeCoord(body[`${prefix}Lat`], -90, 90);
  const lng = normalizeCoord(body[`${prefix}Lng`], -180, 180);
  if (lat === null || lng === null) return null;
  return { lat, lng, accuracy: Math.max(0, normalizeNumber(body[`${prefix}Accuracy`])), source: String(body[`${prefix}Source`] || prefix || 'client').slice(0, 40), updatedAt: new Date() };
}
function publicProduct(p) {
  const galleryUrls = Array.isArray(p.galleryUrls) ? p.galleryUrls.filter(Boolean).slice(0, 3) : [];
  const images = uniqueProductImages({ imageUrl: p.imageUrl, galleryUrls, variants: p.variants || [] });
  return {
    _id: p._id, name: p.name, category: p.category, productType: p.productType, description: p.description,
    shortDescription: p.shortDescription, packageIncludes: p.packageIncludes, composition: p.composition,
    colorOptions: p.colorOptions || [], sizeOptions: p.sizeOptions || [], flavorOptions: p.flavorOptions || [], designOptions: p.designOptions || [],
    occasionTags: p.occasionTags || [], recipientTags: p.recipientTags || [], unitLabel: p.unitLabel, stockQty: p.stockQty,
    preparationNote: p.preparationNote, careInstructions: p.careInstructions, deliveryNotes: p.deliveryNotes,
    serviceKind: p.serviceKind, serviceFormat: p.serviceFormat, serviceDuration: p.serviceDuration, servicePerformer: p.servicePerformer,
    serviceLocationType: p.serviceLocationType, serviceIncludes: p.serviceIncludes, serviceRequirements: p.serviceRequirements, requiredClientInfo: p.requiredClientInfo, serviceScriptPrompt: p.serviceScriptPrompt,
    price: p.price, oldPrice: p.oldPrice, imageUrl: p.imageUrl, galleryUrls, images, emoji: p.emoji, variants: (p.variants || []).map((v) => ({ label: v.label, color: v.color, size: v.size, sku: v.sku, price: v.price, oldPrice: v.oldPrice, stockQty: v.stockQty, imageUrl: v.imageUrl || '' })), customRequestFields: (p.customRequestFields || []).map((f) => ({ key: f.key, label: f.label, description: f.description, placeholder: f.placeholder, type: f.type, required: !!f.required })), available: p.available,
    featured: p.featured, promoEligible: p.promoEligible, promoCode: p.promoCode, promoDiscountPercent: p.promoDiscountPercent,
    minLeadDays: p.minLeadDays, expressRandomAllowed: p.expressRandomAllowed, sort: p.sort
  };
}
function applyProductAdminPayload(target, body = {}) {
  const stringFields = ['shortDescription','packageIncludes','composition','unitLabel','preparationNote','careInstructions','deliveryNotes','adminInternalNote','serviceKind','serviceFormat','serviceDuration','servicePerformer','serviceLocationType','serviceIncludes','serviceRequirements','requiredClientInfo','serviceScriptPrompt','serviceProviderPhone','serviceProviderTelegram','serviceProviderNote'];
  const numberFields = ['serviceProviderCost','serviceCommissionAmount'];
  const listFields = ['colorOptions','sizeOptions','flavorOptions','designOptions','occasionTags','recipientTags'];
  for (const f of stringFields) if (body[f] !== undefined) target[f] = String(body[f] || '').trim();
  for (const f of listFields) if (body[f] !== undefined) target[f] = listFromText(body[f]);
  for (const f of numberFields) if (body[f] !== undefined) target[f] = normalizeNumber(body[f]);
  if (body.stockQty !== undefined) target.stockQty = normalizeNumber(body.stockQty);
  if (body.variantsText !== undefined) target.variants = parseVariantsText(body.variantsText);
  if (body.customFieldsJson !== undefined) target.customRequestFields = parseCustomFields(body.customFieldsJson);
  return target;
}
function orderContentTypeFromProducts(products = []) {
  const hasService = products.some((p) => p.productType === 'SERVICE');
  const hasProduct = products.some((p) => p.productType !== 'SERVICE');
  return hasService && hasProduct ? 'HYBRID' : hasService ? 'SERVICE' : 'PRODUCT';
}
function syncSettingsAliases(settings) {
  const defaults = { businessLat: settings.restaurantLat ?? 38.8616, businessLng: settings.restaurantLng ?? 65.5858, businessPhone: settings.restaurantPhone || '+998 90 000 00 00', businessAddress: settings.restaurantAddress || 'Kasbi, Qashqadaryo', scheduledMinLeadDays: 4, expressMaxLeadHours: 1, expressRandomMinAmount: 100000, firstOrderDiscountAmount: 10000, cashbackPercent: 3, referralFriendDiscountAmount: 10000, referralInviterBonusAmount: 10000, bonusUseEnabled: true, supportPhone: '+998887660800', supportTelegram: '@Qoryogdiyev', paymentPaynetUrl: "https://app.paynet.uz/qr-online/00020101021140440012qr-online.uz01186r0vBrkobM1uBpXqv40202115204531153038605802UZ5910AO'PAYNET'6008Tashkent610610002164280002uz0106PAYNET0208Toshkent80520012qr-online.uz03097120207070419marketing@paynet.uz63042E24", paymentClickUrl: 'https://my.click.uz/clickp2p/64FF6DA1B8F00B46B2936F561CCF73B01A05A23D2130A2B7F7A9E217A12F0BBD', paymentUzumUrl: 'https://b.2u.uz/ttc?qr=Nzk5MzoyMDQzNTUwMzowMUtTUE1XM0gwSE03RTFUNzRDTU5XRkZLNzpkMUhZYmhKWDZ3UGVQYVkxcW9mU3pVTmRHcVU9', paymentXaznaUrl: 'https://pay.xazna.uz/p2p/e07e655f-886e-4942-b325-846d8a0c2ce9' };
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) if (settings[k] === undefined || settings[k] === null || settings[k] === '') { settings[k] = v; changed = true; }
  if (!settings.restaurantLat && settings.businessLat) { settings.restaurantLat = settings.businessLat; changed = true; }
  if (!settings.restaurantLng && settings.businessLng) { settings.restaurantLng = settings.businessLng; changed = true; }
  if (!settings.restaurantPhone && settings.businessPhone) { settings.restaurantPhone = settings.businessPhone; changed = true; }
  if (!settings.restaurantAddress && settings.businessAddress) { settings.restaurantAddress = settings.businessAddress; changed = true; }
  return changed;
}
async function getSettingsDoc() { let settings = await Settings.findOne(); if (!settings) settings = await Settings.create({}); if (syncSettingsAliases(settings)) await settings.save(); return settings; }

async function seedDefaults() {
  const settings = await getSettingsDoc();
  const deliveryCount = await DeliveryService.countDocuments();
  if (!deliveryCount) await DeliveryService.insertMany([
    { title: 'Manzilga yetkazish', description: 'Xarita bo‘yicha km narxda yetkazish', price: 5000, eta: '30–90 daqiqa', sort: 1 },
    { title: 'Olib ketish', description: 'Do‘kondan o‘zingiz olib ketasiz', price: 0, eta: 'Kelishilgan vaqt', sort: 2 },
  ]);
  const productCount = await Product.countDocuments();
  if (!productCount) await Product.insertMany([
    { name: 'Tezkor random gul buketi', category: 'Gullar', productType: 'FLOWER', description: '1 soat ichida byudjetga mos random sovg‘a/gul. Shakl va tur mavjud holatga qarab tanlanadi.', price: settings.expressRandomMinAmount || 100000, emoji: '', featured: true, expressRandomAllowed: true, minLeadDays: 0, sort: 1 },
    { name: 'Romantik buket', category: 'Gullar', productType: 'FLOWER', description: 'Oldindan buyurtma asosida chiroyli buket.', price: 180000, emoji: '', featured: true, minLeadDays: 4, sort: 2 },
    { name: 'Premium sovg‘a box', category: 'Sovg‘a box', productType: 'GIFT_BOX', description: 'Shirinlik, ichimlik, otkritka va dekor bilan.', price: 220000, emoji: '', featured: true, minLeadDays: 4, sort: 3 },
    { name: 'Tug‘ilgan kun torti', category: 'Tortlar', productType: 'CAKE', description: 'Buyurtma asosida tort. Matn va dizaynni izohda yozing.', price: 250000, emoji: '', minLeadDays: 4, sort: 4 },
    { name: 'Shirinlik set', category: 'Shirinliklar', productType: 'SWEET', description: 'Konfet, pechenye va shirinliklar to‘plami.', price: 90000, emoji: '', minLeadDays: 2, sort: 5 },
    { name: 'Ichimliklar seti', category: 'Ichimliklar', productType: 'DRINK', description: 'Sovuq ichimliklar to‘plami.', price: 45000, emoji: '', minLeadDays: 1, sort: 6 },
    { name: 'Fast food set', category: 'Fast food', productType: 'FAST_FOOD', description: 'Bayram uchun tezkor yegulik seti.', price: 120000, emoji: '', minLeadDays: 1, sort: 7 },
    { name: 'Telefon orqali tabrik', category: 'Xizmatlar', productType: 'SERVICE', description: 'Operator yoki ijrochi qo‘ng‘iroq qilib tabriklaydi. Matn va vaqtni reja izohida yozing.', price: 70000, emoji: '', featured: true, minLeadDays: 4, sort: 8 },
    { name: 'Audio/video tabrik montaji', category: 'Xizmatlar', productType: 'SERVICE', description: 'Rasm, video va ovozdan chiroyli tabrik montaji. Materiallarni izohda kelishiladi.', price: 150000, emoji: '', minLeadDays: 4, sort: 9 },
    { name: 'Gitara bilan qo‘shiqchi', category: 'Xizmatlar', productType: 'SERVICE', description: 'Oldindan kelishilgan manzil va vaqtda jonli tabrik xizmati.', price: 350000, emoji: '', minLeadDays: 4, sort: 10 },
    { name: 'Dekorativ yozuv', category: 'Xizmatlar', productType: 'SERVICE', description: 'Onajonim, Otajonim, Happy Birthday kabi dekor yozuvlari.', price: 120000, emoji: '', minLeadDays: 4, sort: 11 },
  ]);
  const defaultServiceProducts = [
    { name: 'Telefon orqali tabrik', category: 'Xizmatlar', productType: 'SERVICE', description: 'Operator yoki ijrochi qo‘ng‘iroq qilib tabriklaydi. Matn va vaqtni reja izohida yozing.', price: 70000, emoji: '', featured: true, minLeadDays: 4, sort: 8 },
    { name: 'Audio/video tabrik montaji', category: 'Xizmatlar', productType: 'SERVICE', description: 'Rasm, video va ovozdan chiroyli tabrik montaji. Materiallarni izohda kelishiladi.', price: 150000, emoji: '', minLeadDays: 4, sort: 9 },
    { name: 'Gitara bilan qo‘shiqchi', category: 'Xizmatlar', productType: 'SERVICE', description: 'Oldindan kelishilgan manzil va vaqtda jonli tabrik xizmati.', price: 350000, emoji: '', minLeadDays: 4, sort: 10 },
    { name: 'Dekorativ yozuv', category: 'Xizmatlar', productType: 'SERVICE', description: 'Onajonim, Otajonim, Happy Birthday kabi dekor yozuvlari.', price: 120000, emoji: '', minLeadDays: 4, sort: 11 },
  ];
  for (const item of defaultServiceProducts) {
    const exists = await Product.exists({ name: item.name });
    if (!exists) await Product.create(item);
  }
  const promoCount = await PromoCode.countDocuments();
  if (!promoCount) await PromoCode.create({ code: 'WELCOME10', title: 'Birinchi xarid uchun 10 000 so‘m', discountType: 'FIXED', value: 10000, firstOrderOnly: true, minSubtotal: 50000, active: true });
}

function normalizeCoord(value, min, max) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) return null; return n; }
function parseLocationPayload(body = {}) { const lat = normalizeCoord(body.customerLat ?? body.lat, -90, 90); const lng = normalizeCoord(body.customerLng ?? body.lng, -180, 180); if (lat === null || lng === null) return null; return { lat, lng, accuracy: Math.max(0, normalizeNumber(body.customerAccuracy ?? body.accuracy)), source: String(body.locationSource || body.source || 'client').slice(0, 40), updatedAt: new Date() }; }
function getBusinessLocation(settings) { const lat = normalizeCoord(settings.businessLat ?? settings.restaurantLat, -90, 90); const lng = normalizeCoord(settings.businessLng ?? settings.restaurantLng, -180, 180); if (lat === null || lng === null) return null; return { lat, lng, address: settings.businessAddress || settings.restaurantAddress || '' }; }
function roundKm(v) { return Math.round(Number(v || 0) * 100) / 100; }
function haversineKm(a, b) { const toRad = (deg) => (Number(deg) * Math.PI) / 180; const R = 6371; const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng); const lat1 = toRad(a.lat); const lat2 = toRad(b.lat); const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }
function makeMapUrl(lat, lng) { if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return ''; return `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`; }
function calculateDeliveryQuote(settings, location, fallbackService = null, type = 'DELIVERY') {
  if (type === 'PICKUP') return { deliveryFee: 0, distanceKm: 0, mode: 'PICKUP', zoneStatus: 'PICKUP', title: 'Olib ketish', mapUrl: '' };
  const autoEnabled = parseBoolean(settings.deliveryAutoPricingEnabled, true); const baseFee = Math.max(0, normalizeNumber(settings.deliveryBaseFee)); const baseKm = Math.max(0, normalizeNumber(settings.deliveryBaseKm)); const pricePerKm = Math.max(0, normalizeNumber(settings.deliveryPricePerKm)); const maxKm = Math.max(0, normalizeNumber(settings.deliveryMaxKm)); const businessLocation = getBusinessLocation(settings);
  if (!autoEnabled || !businessLocation || !location) return { deliveryFee: Math.max(0, normalizeNumber(fallbackService?.price || baseFee)), distanceKm: 0, mode: autoEnabled ? 'STATIC_NO_LOCATION' : 'STATIC', zoneStatus: 'UNKNOWN', title: fallbackService?.title || 'Yetkazib berish', baseFee, baseKm, pricePerKm, maxKm, businessLocation, mapUrl: location ? makeMapUrl(location.lat, location.lng) : '' };
  const distanceKm = roundKm(haversineKm(businessLocation, location)); const extraKm = Math.max(0, Math.ceil(distanceKm - baseKm)); const deliveryFee = baseFee + extraKm * pricePerKm; const zoneStatus = maxKm && distanceKm > maxKm ? 'OUT_OF_ZONE' : 'IN_ZONE';
  return { deliveryFee, distanceKm, mode: 'DISTANCE', zoneStatus, title: `Masofa bo‘yicha yetkazish (${distanceKm} km)`, baseFee, baseKm, pricePerKm, maxKm, businessLocation, mapUrl: makeMapUrl(location.lat, location.lng) };
}
function movementTrend(previousKm, currentKm) { if (!previousKm || !currentKm) return { trend: 'UNKNOWN', delta: 0 }; const delta = roundKm(currentKm - previousKm); if (delta <= -0.05) return { trend: 'APPROACHING', delta }; if (delta >= 0.05) return { trend: 'MOVING_AWAY', delta }; return { trend: 'STABLE', delta }; }

function escapeRegExp(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function nextReminderAt(frequency, from = new Date()) {
  const f = String(frequency || 'NONE');
  if (f === 'EVERY_3H') return new Date(from.getTime() + 3 * 60 * 60 * 1000);
  if (f === 'EVERY_6H') return new Date(from.getTime() + 6 * 60 * 60 * 1000);
  if (f === 'EVERY_12H') return new Date(from.getTime() + 12 * 60 * 60 * 1000);
  if (f === 'DAILY') return new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return null;
}
function supportPhoneUrl(settings) {
  const phone = String(settings?.supportPhone || settings?.businessPhone || '+998887660800').replace(/\s+/g, '');
  return `tel:${phone}`;
}
function supportTelegramUrl(settings) {
  const username = String(settings?.supportTelegram || '@Qoryogdiyev').trim().replace(/^@/, '');
  return username ? `https://t.me/${username}` : '';
}

async function getOrCreateCustomer(tgUser, options = {}) {
  const id = String(tgUser.id);
  let customer = await Customer.findOne({ userTelegramId: id });
  if (!customer) {
    let referralCode = randomCode('REF');
    while (await Customer.findOne({ referralCode })) referralCode = randomCode('REF');
    customer = await Customer.create({ userTelegramId: id, username: tgUser.username || '', fullName: userFullName(tgUser, options.fullName), referralCode });
  } else {
    customer.username = tgUser.username || customer.username;
    customer.fullName = userFullName(tgUser, options.fullName || customer.fullName);
  }
  if (options.phone) customer.phone = String(options.phone).trim();
  const incomingRef = normalizePromoCode(options.referralCode || options.startParam || '').replace(/^REF_?/i, 'REF');
  if (incomingRef && !customer.referredBy && incomingRef !== customer.referralCode) {
    const inviter = await Customer.findOne({ referralCode: incomingRef });
    if (inviter && inviter.userTelegramId !== id) customer.referredBy = inviter.referralCode;
  }
  await customer.save();
  return customer;
}

async function parseCartItems(itemsPayload) {
  if (!Array.isArray(itemsPayload) || !itemsPayload.length) { const err = new Error('Savat bo‘sh.'); err.status = 400; throw err; }
  const ids = itemsPayload.map((item) => ensureObjectId(item.productId, 'Mahsulot ID'));
  const products = await Product.find({ _id: { $in: ids }, available: true });
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const items = itemsPayload.map((item) => {
    const product = productMap.get(String(item.productId));
    if (!product) { const err = new Error('Savatda mavjud bo‘lmagan mahsulot bor.'); err.status = 400; throw err; }
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty || 1))));
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const chosen = variants.find((v) => (item.variantSku && String(v.sku || '') === String(item.variantSku)) || (item.variantLabel && String(v.label || '') === String(item.variantLabel)));
    const unitPrice = chosen?.price > 0 ? Number(chosen.price) : Number(product.price || 0);
    return { product, item: { productId: product._id, name: product.name, price: unitPrice, qty, subtotal: unitPrice * qty, productType: product.productType, category: product.category, variantSku: chosen?.sku || String(item.variantSku || ''), variantLabel: chosen?.label || String(item.variantLabel || ''), selectedColor: String(item.selectedColor || chosen?.color || ''), selectedSize: String(item.selectedSize || chosen?.size || '') } };
  });
  return { items: items.map((x) => x.item), products: items.map((x) => x.product), subtotal: items.reduce((sum, x) => sum + x.item.subtotal, 0) };
}

async function isFirstOrder(userTelegramId) { const count = await Order.countDocuments({ userTelegramId: String(userTelegramId), orderStatus: { $ne: 'CANCELLED' } }); return count === 0; }
function calculateProductPromo(code, items, products) {
  if (!code) return { amount: 0, title: '' };
  let amount = 0;
  for (let i = 0; i < items.length; i += 1) {
    const p = products[i];
    if (!p?.promoEligible) continue;
    if (normalizePromoCode(p.promoCode) === code && Number(p.promoDiscountPercent || 0) > 0) amount += Math.floor(items[i].subtotal * Math.min(100, Math.max(0, Number(p.promoDiscountPercent))) / 100);
  }
  return { amount, title: amount ? 'Mahsulot promo chegirmasi' : '' };
}
async function calculatePromoDiscount({ code, items, products, subtotal, deliveryFee, userTelegramId }) {
  code = normalizePromoCode(code);
  if (!code) return { code: '', amount: 0, title: '', source: '' };
  const now = new Date();
  const firstOrder = await isFirstOrder(userTelegramId);
  const productPromo = calculateProductPromo(code, items, products);
  let best = productPromo.amount ? { code, amount: productPromo.amount, title: productPromo.title, source: 'PRODUCT' } : { code, amount: 0, title: '', source: '' };
  const promo = await PromoCode.findOne({ code, active: true });
  if (promo) {
    if (promo.startsAt && promo.startsAt > now) throw Object.assign(new Error('Promokod hali boshlanmagan.'), { status: 400 });
    if (promo.endsAt && promo.endsAt < now) throw Object.assign(new Error('Promokod muddati tugagan.'), { status: 400 });
    if (promo.usageLimit && promo.usedCount >= promo.usageLimit) throw Object.assign(new Error('Promokod limiti tugagan.'), { status: 400 });
    if (promo.firstOrderOnly && !firstOrder) throw Object.assign(new Error('Bu promokod faqat birinchi xarid uchun.'), { status: 400 });
    if (promo.minSubtotal && subtotal < promo.minSubtotal) throw Object.assign(new Error(`Promokod uchun minimal savat: ${formatMoney(promo.minSubtotal)}.`), { status: 400 });
    const productIdSet = new Set((promo.productIds || []).map(String));
    const categorySet = new Set((promo.categories || []).map(String));
    let eligibleBase = 0;
    for (let i = 0; i < items.length; i += 1) {
      const p = products[i];
      const productMatch = productIdSet.size ? productIdSet.has(String(p._id)) : true;
      const categoryMatch = categorySet.size ? categorySet.has(p.category) : true;
      if (productMatch && categoryMatch) eligibleBase += items[i].subtotal;
    }
    if (!eligibleBase && promo.discountType !== 'FREE_DELIVERY') throw Object.assign(new Error('Promokod ushbu mahsulotlarga mos emas.'), { status: 400 });
    let amount = 0;
    if (promo.discountType === 'PERCENT') amount = Math.floor(eligibleBase * Math.min(100, Math.max(0, promo.value)) / 100);
    if (promo.discountType === 'FIXED') amount = Math.min(eligibleBase || subtotal, Math.max(0, promo.value));
    if (promo.discountType === 'FREE_DELIVERY') amount = Math.max(0, deliveryFee);
    if (promo.maxDiscount) amount = Math.min(amount, promo.maxDiscount);
    if (amount > best.amount) best = { code, amount, title: promo.title || promo.code, source: 'GLOBAL', promoId: promo._id };
  }
  if (!best.amount) throw Object.assign(new Error('Promokod topilmadi yoki chegirma bermaydi.'), { status: 400 });
  return best;
}
function validateFulfillment({ settings, orderMode, deliveryDate, products, subtotal, noComplaintAgreement }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate || ''))) throw Object.assign(new Error('Yetkazish/qabul qilish kunini tanlang.'), { status: 400 });
  const selected = dateOnlyUTC(deliveryDate); const today = dateOnlyUTC(todayLocalISO(0)); const diffDays = Math.floor((selected - today) / 86400000);
  if (orderMode === 'EXPRESS_RANDOM') {
    if (!parseBoolean(settings.expressRandomEnabled, true)) throw Object.assign(new Error('Tezkor random buyurtma hozircha o‘chirilgan.'), { status: 400 });
    const maxHours = Math.max(1, normalizeNumber(settings.expressMaxLeadHours || 1));
    const maxDays = Math.max(0, Math.ceil(maxHours / 24) - 1);
    if (diffDays < 0 || diffDays > maxDays) throw Object.assign(new Error(`Tezkor random buyurtma faqat ${maxHours} soat ichida qabul qilinadi.`), { status: 400 });
    if (subtotal < normalizeNumber(settings.expressRandomMinAmount)) throw Object.assign(new Error(`Tezkor random buyurtma minimal summasi: ${formatMoney(settings.expressRandomMinAmount, settings.currency)}.`), { status: 400 });
    if (!noComplaintAgreement) throw Object.assign(new Error('Tezkor random gul shartiga rozilik belgisini qo‘ying.'), { status: 400 });
    const notAllowed = products.find((p) => !p.expressRandomAllowed);
    if (notAllowed) throw Object.assign(new Error(`“${notAllowed.name}” tezkor buyurtma uchun ruxsat etilmagan. Boshqaruv panelidan ruxsat bering yoki oldindan buyurtma tanlang.`), { status: 400 });
    return { requiredLeadDays: 0, diffDays };
  }
  const requiredLeadDays = Math.max(normalizeNumber(settings.scheduledMinLeadDays || 4), ...products.map((p) => normalizeNumber(p.minLeadDays || 0)));
  if (diffDays < requiredLeadDays) throw Object.assign(new Error(`Oldindan buyurtma kamida ${requiredLeadDays} kun oldin berilishi kerak.`), { status: 400 });
  return { requiredLeadDays, diffDays };
}
async function finalizeOrderRewards(order) {
  if (!order?.userTelegramId) return order;
  const customer = await Customer.findOne({ userTelegramId: String(order.userTelegramId) });
  if (!customer) return order;
  if (order.orderStatus === 'CANCELLED') {
    if (order.bonusUsed > 0 && !order.bonusRefunded) {
      customer.bonusBalance += order.bonusUsed;
      customer.totalBonusSpent = Math.max(0, (customer.totalBonusSpent || 0) - order.bonusUsed);
      order.bonusRefunded = true;
      await customer.save();
    }
    order.bonusStatus = 'CANCELLED';
    await order.save();
    return order;
  }
  if (order.orderStatus === 'DONE' && order.paymentStatus !== 'REJECTED' && order.bonusStatus !== 'CREDITED') {
    customer.bonusBalance += order.bonusEarned || 0;
    customer.totalBonusEarned += order.bonusEarned || 0;
    customer.completedOrders += 1;
    if (customer.referredBy && !customer.referralRewardCredited) {
      const settings = await getSettingsDoc();
      const inviter = await Customer.findOne({ referralCode: customer.referredBy });
      if (inviter && normalizeNumber(settings.referralInviterBonusAmount) > 0) {
        inviter.bonusBalance += normalizeNumber(settings.referralInviterBonusAmount);
        inviter.totalBonusEarned += normalizeNumber(settings.referralInviterBonusAmount);
        await inviter.save();
      }
      customer.referralRewardCredited = true;
    }
    order.bonusStatus = 'CREDITED';
    await customer.save();
    await order.save();
  }
  return order;
}

function postJson(url, payload, timeoutMs = 15000) { return new Promise((resolve, reject) => { const body = JSON.stringify(payload || {}); const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: timeoutMs }, (res) => { let data = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { data += chunk; }); res.on('end', () => { const parsed = safeJsonParse(data, null); if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed); const err = new Error(parsed?.description || `HTTP ${res.statusCode}`); err.response = parsed; reject(err); }); }); req.on('timeout', () => req.destroy(new Error('Telegram API timeout.'))); req.on('error', reject); req.write(body); req.end(); }); }
async function telegramApi(method, payload = {}) { if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN sozlanmagan.' }; try { const data = await postJson(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, payload); if (!data?.ok) console.error('Telegram API error:', method, data); return data; } catch (error) { console.error('Telegram API request failed:', method, error.message); return { ok: false, description: error.message }; } }

let cachedBotIdentity = null;
async function getTelegramBotIdentity(force = false) {
  if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN sozlanmagan.' };
  if (cachedBotIdentity && !force) return cachedBotIdentity;
  const data = await telegramApi('getMe', {});
  cachedBotIdentity = data?.ok ? data.result : { ok: false, description: data?.description || 'getMe xatosi' };
  return cachedBotIdentity;
}
async function syncTelegramBotIdentity() {
  const identity = await getTelegramBotIdentity(true);
  if (!identity?.username) {
    console.warn('Telegram bot identity aniqlanmadi. BOT_TOKEN ni tekshiring.');
    return identity;
  }
  const actual = String(identity.username).replace(/^@/, '');
  if (BOT_EXPECTED_USERNAME && actual.toLowerCase() !== BOT_EXPECTED_USERNAME.toLowerCase()) {
    console.warn(`DIQQAT: BOT_TOKEN @${actual} botiga tegishli, lekin BOT_EXPECTED_USERNAME=@${BOT_EXPECTED_USERNAME}. Hosting .env ichidagi BOT_TOKEN eski botniki bo'lishi mumkin.`);
  }
  const settings = await getSettingsDoc();
  if (settings.botUsername !== actual) {
    settings.botUsername = actual;
    await settings.save();
  }
  console.log(`Telegram bot ulandi: @${actual} (${identity.first_name || 'no name'})`);
  return identity;
}
async function notifyAdmin(text, photoUrl = '') { const settings = await getSettingsDoc(); const chatId = settings.adminTelegramChatId || process.env.ADMIN_TELEGRAM_CHAT_ID; if (!chatId) return; if (photoUrl) await telegramApi('sendPhoto', { chat_id: chatId, photo: photoUrl, caption: text, parse_mode: 'HTML' }); else await telegramApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }); }
async function notifyCustomer(chatId, text) { if (!chatId) return; await telegramApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }); }
async function answerStart(chatId, fromUser = null, startArg = '') {
  const settings = await getSettingsDoc();
  const url = startArg ? webAppStartUrl(startArg) : WEBAPP_URL;
  const buttons = [];
  if (url) buttons.push([{ text: 'Mini appni ochish', web_app: { url } }]);
  if (fromUser?.id && isAdminTelegramId(fromUser.id) && adminPanelUrl()) buttons.push([{ text: 'Boshqaruv paneli', web_app: { url: adminPanelUrl() } }]);
  const supportRows = [];
  // Telegram inline keyboard URL tugmasi tel: linkni qabul qilmaydi.
  // Shu sabab /start javobsiz qolmasligi uchun telefon callback orqali alertda ko‘rsatiladi.
  supportRows.push({ text: 'Telefon raqam', callback_data: 'phone' });
  const tgUrl = supportTelegramUrl(settings);
  if (tgUrl) supportRows.push({ text: 'Telegram chat', url: tgUrl });
  if (supportRows.length) buttons.push(supportRows);
  const text = url
    ? `Assalomu alaykum! ${settings.brandName} mini ilovasiga xush kelibsiz. Buyurtmalar kamida ${settings.scheduledMinLeadDays || 4} kun oldin qabul qilinadi. To‘lov oldindan Paynet/Click/Uzum/Xazna orqali yuboriladi, keyin chek rasmi orqali tasdiqlanadi.`
    : `${settings.brandName} bot ishga tushdi, lekin PUBLIC_URL/WEBAPP_URL hali sozlanmagan.`;
  return telegramApi('sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: buttons } });
}
async function handleTelegramUpdate(update) {
  const message = update?.message || update?.edited_message; const callback = update?.callback_query;
  if (callback?.id) { if (callback.data === 'phone') { const s = await getSettingsDoc(); await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: s.supportPhone || s.businessPhone || s.restaurantPhone || 'Telefon raqam sozlanmagan', show_alert: true }); return; } await telegramApi('answerCallbackQuery', { callback_query_id: callback.id }); return; }
  const chatId = message?.chat?.id; const fromUser = message?.from || null; const text = String(message?.text || '').trim(); if (!chatId) return;
  if (text.startsWith('/start')) { const startArg = text.split(/\s+/)[1] || ''; await answerStart(chatId, fromUser, startArg); return; }
  if (text.startsWith('/admin')) { if (!fromUser?.id || !isAdminTelegramId(fromUser.id)) { await telegramApi('sendMessage', { chat_id: chatId, text: `Boshqaruv paneli faqat ruxsat berilgan Telegram raqam uchun ochiladi.\n\n${adminAccessHelp()}\n\nID olish uchun /id yuboring.` }); return; } if (!adminPanelUrl()) { await telegramApi('sendMessage', { chat_id: chatId, text: 'Boshqaruv paneli havolasi hali sozlanmagan. PUBLIC_URL ni real HTTPS domen qilib kiriting.' }); return; } await telegramApi('sendMessage', { chat_id: chatId, text: 'Boshqaruv paneli:', reply_markup: { inline_keyboard: [[{ text: 'Boshqaruv panelini ochish', web_app: { url: adminPanelUrl() } }]] } }); return; }
  if (text.startsWith('/id')) { await telegramApi('sendMessage', { chat_id: chatId, text: `Telegram raqami: ${fromUser?.id || 'unknown'}\nChat raqami: ${chatId}\n\nBoshqaruv paneli uchun ruxsat ro‘yxatiga Telegram raqamini kiriting.` }); return; }
  await answerStart(chatId, fromUser);
}

app.get('/api/health', (_req, res) => res.json({ success: true, app: 'GiftGo gibrid Telegram mini ilova', time: new Date().toISOString() }));
app.get('/api/settings', asyncHandler(async (_req, res) => { const settings = await getSettingsDoc(); res.json({ success: true, settings }); }));
app.get('/api/bootstrap', asyncHandler(async (_req, res) => { const [settings, products, services] = await Promise.all([getSettingsDoc(), Product.find({ available: true }).sort({ sort: 1, createdAt: -1 }), DeliveryService.find({ active: true }).sort({ sort: 1, price: 1 })]); const categories = [...new Set(products.map((p) => p.category))]; res.json({ success: true, settings, products: products.map(publicProduct), services, categories, minScheduledDate: todayLocalISO(settings.scheduledMinLeadDays || 4), expressMaxDate: todayLocalISO(Math.max(0, Math.ceil((settings.expressMaxLeadHours || 1) / 24) - 1)) }); }));
app.get('/api/products', asyncHandler(async (req, res) => { const query = { available: true }; if (req.query.category) query.category = req.query.category; if (req.query.type) query.productType = req.query.type; if (req.query.q) query.$text = { $search: String(req.query.q) }; const products = await Product.find(query).sort({ sort: 1, createdAt: -1 }); res.json({ success: true, products: products.map(publicProduct) }); }));

app.get('/api/products/:id', asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, 'Mahsulot ID');
  const product = await Product.findOne({ _id: req.params.id, available: true });
  if (!product) return res.status(404).json({ success: false, message: 'Mahsulot topilmadi.' });
  const summary = await getProductRatingSummary(product._id);
  res.json({ success: true, product: { ...publicProduct(product), ...summary } });
}));
app.get('/api/products/:id/reviews', asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, 'Mahsulot ID');
  const reviews = await Review.find({ productId: req.params.id, active: true }).sort({ createdAt: -1 }).limit(50);
  const summary = await getProductRatingSummary(req.params.id);
  res.json({ success: true, reviews, ...summary });
}));
app.post('/api/products/:id/reviews', telegramAuth, asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, 'Mahsulot ID');
  const product = await Product.findOne({ _id: req.params.id, available: true });
  if (!product) return res.status(404).json({ success: false, message: 'Mahsulot topilmadi.' });
  const rating = Math.max(1, Math.min(5, Math.floor(Number(req.body.rating || 0))));
  if (!rating) return res.status(400).json({ success: false, message: 'Bahoni tanlang.' });
  const comment = String(req.body.comment || '').trim().slice(0, 1000);
  const existing = await Review.findOne({ productId: req.params.id, userTelegramId: String(req.tgUser.id) });
  let review;
  if (existing) {
    existing.rating = rating; existing.comment = comment; existing.fullName = userFullName(req.tgUser, req.body.fullName); existing.active = true;
    review = await existing.save();
  } else {
    review = await Review.create({ productId: req.params.id, userTelegramId: String(req.tgUser.id), fullName: userFullName(req.tgUser, req.body.fullName), rating, comment, active: true });
  }
  const summary = await getProductRatingSummary(req.params.id);
  res.json({ success: true, review, ...summary });
}));

app.get('/api/delivery-services', asyncHandler(async (_req, res) => { const services = await DeliveryService.find({ active: true }).sort({ sort: 1, price: 1 }); res.json({ success: true, services }); }));
app.post('/api/delivery/quote', asyncHandler(async (req, res) => { const settings = await getSettingsDoc(); const type = req.body.type === 'PICKUP' ? 'PICKUP' : 'DELIVERY'; const location = parseLocationPayload(req.body); let fallbackService = null; if (req.body.deliveryServiceId && mongoose.Types.ObjectId.isValid(String(req.body.deliveryServiceId))) fallbackService = await DeliveryService.findOne({ _id: req.body.deliveryServiceId, active: true }); const quote = calculateDeliveryQuote(settings, location, fallbackService, type); res.json({ success: true, quote }); }));
app.get('/api/customer/me', telegramAuth, asyncHandler(async (req, res) => { const settings = await getSettingsDoc(); const startParam = req.tgRaw?.start_param || req.query.startParam || ''; const customer = await getOrCreateCustomer(req.tgUser, { startParam }); const shareUrl = botStartUrl(settings.botUsername, customer.referralCode); res.json({ success: true, customer, shareUrl, shareText: `GiftGo orqali gul va sovg‘a buyurtma qiling. Mening referral havolam: ${shareUrl}` }); }));
app.post('/api/promo/validate', telegramAuth, asyncHandler(async (req, res) => { const settings = await getSettingsDoc(); const cart = await parseCartItems(safeJsonParse(req.body.items, [])); const type = req.body.type === 'PICKUP' ? 'PICKUP' : 'DELIVERY'; const quote = calculateDeliveryQuote(settings, parseLocationPayload(req.body), null, type); const promo = await calculatePromoDiscount({ code: req.body.promoCode, items: cart.items, products: cart.products, subtotal: cart.subtotal, deliveryFee: quote.deliveryFee, userTelegramId: String(req.tgUser.id) }); res.json({ success: true, promo }); }));

app.post('/api/orders', upload.single('screenshot'), telegramAuth, asyncHandler(async (req, res) => {
  const settings = await getSettingsDoc();
  const phone = String(req.body.phone || '').trim(); if (phone.length < 7) return res.status(400).json({ success: false, message: 'Telefon raqamni to‘liq kiriting.' });
  const customer = await getOrCreateCustomer(req.tgUser, { fullName: req.body.fullName, phone, referralCode: req.body.referralCode, startParam: req.tgRaw?.start_param });
  const cart = await parseCartItems(safeJsonParse(req.body.items, []));
  const orderContentType = orderContentTypeFromProducts(cart.products);
  const hasService = orderContentType === 'SERVICE' || orderContentType === 'HYBRID';
  const type = req.body.type === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
  const orderMode = req.body.orderMode === 'EXPRESS_RANDOM' ? 'EXPRESS_RANDOM' : 'SCHEDULED';
  const noComplaintAgreement = parseBoolean(req.body.noComplaintAgreement, false);
  const deliveryDate = String(req.body.deliveryDate || '').trim(); const deliveryTime = String(req.body.deliveryTime || '').trim();
  validateFulfillment({ settings, orderMode, deliveryDate, products: cart.products, subtotal: cart.subtotal, noComplaintAgreement });
  if (!/^\d{2}:\d{2}$/.test(deliveryTime)) return res.status(400).json({ success: false, message: 'Yetkazish vaqtini tanlang.' });
  const serviceRequesterName = String(req.body.serviceRequesterName || req.body.buyerFullName || req.body.fullName || '').trim();
  const serviceRequesterPhone = String(req.body.serviceRequesterPhone || req.body.buyerPhone || phone || '').trim();
  const serviceRecipientName = String(req.body.serviceRecipientName || req.body.recipientName || '').trim();
  const serviceRecipientPhone = String(req.body.serviceRecipientPhone || req.body.recipientPhone || '').trim();
  if (hasService) {
    if (serviceRequesterName.length < 2) return res.status(400).json({ success: false, message: 'Xizmat uchun buyurtma beruvchi ism-familiyasini kiriting.' });
    if (serviceRequesterPhone.length < 7) return res.status(400).json({ success: false, message: 'Xizmat uchun buyurtma beruvchi telefonini kiriting.' });
    if (serviceRecipientName.length < 2) return res.status(400).json({ success: false, message: 'Xizmat qabul qiluvchi ism-familiyasini kiriting.' });
    if (serviceRecipientPhone.length < 7) return res.status(400).json({ success: false, message: 'Xizmat qabul qiluvchi telefonini kiriting.' });
  }
  const buyerInfo = {
    fullName: serviceRequesterName || String(req.body.fullName || '').trim(), phone: serviceRequesterPhone || phone,
    address: String(req.body.serviceRequesterAddress || req.body.buyerAddress || '').trim(),
    locationNote: String(req.body.serviceRequesterLocationNote || req.body.buyerLocationNote || '').trim(),
    location: parsePrefixedLocation(req.body, 'serviceRequester') || undefined,
  };
  const recipientInfo = {
    fullName: serviceRecipientName || String(req.body.recipientName || '').trim(), phone: serviceRecipientPhone || String(req.body.recipientPhone || '').trim(),
    address: String(req.body.serviceRecipientAddress || req.body.recipientAddress || req.body.address || '').trim(),
    relation: String(req.body.recipientRelation || '').trim(), age: String(req.body.recipientAge || '').trim(),
    locationNote: String(req.body.serviceRecipientLocationNote || '').trim(),
    location: parsePrefixedLocation(req.body, 'serviceRecipient') || undefined,
  };
  const productDetails = {
    theme: String(req.body.productTheme || '').trim(), colors: String(req.body.productColors || '').trim(),
    packaging: String(req.body.productPackaging || '').trim(), inscription: String(req.body.productInscription || '').trim(),
    allergyInfo: String(req.body.productAllergy || '').trim(), referenceLink: String(req.body.productReferenceLink || '').trim(),
    substitutionAllowed: parseBoolean(req.body.productSubstitutionAllowed, false),
    extra: String(req.body.productExtraDetails || '').trim(),
  };
  const serviceDetails = {
    requesterName: serviceRequesterName, requesterPhone: serviceRequesterPhone, requesterAddress: buyerInfo.address, requesterLocationNote: buyerInfo.locationNote,
    recipientName: serviceRecipientName, recipientPhone: serviceRecipientPhone, recipientAddress: recipientInfo.address, recipientLocationNote: recipientInfo.locationNote,
    relation: recipientInfo.relation, serviceScenario: String(req.body.serviceScenario || '').trim(), callScript: String(req.body.serviceCallText || '').trim(),
    songName: String(req.body.serviceSongName || '').trim(), montageNotes: String(req.body.serviceMontageNotes || '').trim(),
    mediaLink: String(req.body.serviceMaterialsLink || '').trim(), performerPreference: String(req.body.servicePerformerPreference || '').trim(),
    surpriseMode: parseBoolean(req.body.serviceSecretMode, false), placeNote: String(req.body.servicePlaceNote || '').trim(),
    specialRequirements: String(req.body.serviceSpecialRequirements || '').trim(),
  };
  const customFieldAnswers = extractOrderCustomFieldAnswers(req.body.customFieldAnswers, cart.products);

  // GiftGo modeli: faqat oldindan P2P ilova/havola orqali to‘lov + chek rasmi + boshqaruvchi tasdig‘i.
  const paymentMethod = 'CARD_TRANSFER';
  const allowedPaymentProviders = new Set(['PAYNET', 'CLICK', 'UZUM', 'XAZNA']);
  const paymentProvider = allowedPaymentProviders.has(String(req.body.paymentProvider || '').toUpperCase()) ? String(req.body.paymentProvider).toUpperCase() : '';
  if (!paymentProvider) return res.status(400).json({ success: false, message: 'To‘lov ilovasini tanlang: Paynet, Click, Uzum Bank yoki Xazna.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Buyurtma faqat oldindan to‘lov bilan qabul qilinadi. To‘lov ilovasida pulni yuboring va chek rasmini yuklang.' });

  let fallbackService = null; let deliveryServiceId = null;
  if (type === 'DELIVERY' && req.body.deliveryServiceId) { deliveryServiceId = ensureObjectId(req.body.deliveryServiceId, 'Yetkazib berish xizmati ID'); fallbackService = await DeliveryService.findOne({ _id: deliveryServiceId, active: true }); if (!fallbackService) return res.status(400).json({ success: false, message: 'Yetkazib berish xizmati topilmadi.' }); }
  const customerLocation = parseLocationPayload(req.body); const quote = calculateDeliveryQuote(settings, customerLocation, fallbackService, type);
  if (type === 'DELIVERY' && parseBoolean(settings.deliveryAutoPricingEnabled, true) && getBusinessLocation(settings) && !customerLocation) return res.status(400).json({ success: false, message: 'Yetkazib berish uchun xaritadan joylashuvni belgilang.' });
  if (type === 'DELIVERY' && quote.zoneStatus === 'OUT_OF_ZONE' && !parseBoolean(settings.deliveryOutOfZoneEnabled, true)) return res.status(400).json({ success: false, message: `Bu manzil ${quote.distanceKm} km uzoqda. Bu hududga yetkazish yoqilmagan.` });

  let firstOrderDiscount = 0; const firstOrder = await isFirstOrder(req.tgUser.id);
  if (firstOrder && parseBoolean(settings.firstOrderDiscountEnabled, true)) firstOrderDiscount = Math.min(cart.subtotal, Math.max(0, normalizeNumber(settings.firstOrderDiscountAmount)));
  let referralDiscount = 0;
  if (firstOrder && customer.referredBy && normalizeNumber(settings.referralFriendDiscountAmount) > 0) referralDiscount = Math.min(Math.max(0, cart.subtotal - firstOrderDiscount), normalizeNumber(settings.referralFriendDiscountAmount));
  let promo = { code: '', amount: 0, title: '', source: '' };
  if (normalizePromoCode(req.body.promoCode)) promo = await calculatePromoDiscount({ code: req.body.promoCode, items: cart.items, products: cart.products, subtotal: cart.subtotal, deliveryFee: quote.deliveryFee, userTelegramId: String(req.tgUser.id) });
  const discountAmount = Math.min(cart.subtotal + quote.deliveryFee, firstOrderDiscount + referralDiscount + promo.amount);
  let bonusUsed = 0;
  if (parseBoolean(settings.bonusUseEnabled, true) && parseBoolean(req.body.useBonus, false) && customer.bonusBalance > 0) {
    bonusUsed = Math.min(customer.bonusBalance, Math.max(0, cart.subtotal + quote.deliveryFee - discountAmount));
    customer.bonusBalance -= bonusUsed; customer.totalBonusSpent += bonusUsed; await customer.save();
  }
  const total = Math.max(0, cart.subtotal + quote.deliveryFee - discountAmount - bonusUsed);
  const cashbackPercent = Math.max(0, normalizeNumber(settings.cashbackPercent));
  const bonusEarned = Math.floor(Math.max(0, cart.subtotal - discountAmount) * cashbackPercent / 100);
  const uploaded = req.file ? await uploadToCloudinary(req.file, 'giftgo/payments/orders') : null;
  const order = await Order.create({
    orderNo: nextHumanNo(orderMode === 'EXPRESS_RANDOM' ? 'FAST' : 'GIFT'), userTelegramId: String(req.tgUser.id), userUsername: req.tgUser.username || '', userFullName: userFullName(req.tgUser, req.body.fullName), phone, type, orderContentType, orderMode, eventType: String(req.body.eventType || '').trim(), deliveryDate, deliveryTime, recipientName: recipientInfo.fullName || String(req.body.recipientName || '').trim(), recipientPhone: recipientInfo.phone || String(req.body.recipientPhone || '').trim(), buyerInfo, recipientInfo, productDetails, serviceDetails, customFieldAnswers, cardMessage: String(req.body.cardMessage || '').trim(), noComplaintAgreement, agreementText: noComplaintAgreement ? settings.expressAgreementText : '', address: String(req.body.address || '').trim(), customerLocation: customerLocation || undefined, businessLocationSnapshot: quote.businessLocation || getBusinessLocation(settings) || undefined, restaurantLocationSnapshot: quote.businessLocation || getBusinessLocation(settings) || undefined, distanceKm: quote.distanceKm || 0, lastLocationAt: customerLocation ? new Date() : undefined, liveLocationEnabled: parseBoolean(req.body.liveLocationEnabled, false), deliveryServiceId, deliveryServiceTitle: quote.title || fallbackService?.title || (type === 'PICKUP' ? 'Olib ketish' : 'Yetkazib berish'), items: cart.items, subtotal: cart.subtotal, deliveryFee: quote.deliveryFee, discountAmount, firstOrderDiscount, promoCode: promo.code, promoDiscount: promo.amount, referralDiscount, bonusUsed, bonusEarned, total, deliveryPricing: { baseFee: quote.baseFee, baseKm: quote.baseKm, pricePerKm: quote.pricePerKm, maxKm: quote.maxKm, mode: quote.mode, zoneStatus: quote.zoneStatus }, paymentMethod, paymentProvider, paymentScreenshotUrl: uploaded?.url || '', paymentScreenshotPublicId: uploaded?.publicId || '', note: String(req.body.note || '').trim(), planNote: String(req.body.planNote || req.body.note || '').trim(), reminderFrequency: 'DAILY', reminderNote: 'Oldindan buyurtmani nazorat qilish', reminderNextAt: nextReminderAt('DAILY'),
  });
  if (promo.promoId) await PromoCode.updateOne({ _id: promo.promoId }, { $inc: { usedCount: 1 } });
  const locationLine = customerLocation ? `\nMasofa: ${quote.distanceKm} km\nXarita: ${quote.mapUrl}` : '';
  const randomLine = orderMode === 'EXPRESS_RANDOM' ? `\nTezkor random: rozilik olindi` : `\nOldindan buyurtma: ${deliveryDate} ${deliveryTime}`;
  await notifyAdmin(`<b>Yangi buyurtma</b>\n#${order.orderNo}\nMijoz: ${order.userFullName}\nTelefon: ${order.phone}\nSabab: ${order.eventType || '-'}\nXizmat: ${order.deliveryServiceTitle}\nYetkazish: ${formatMoney(order.deliveryFee, settings.currency)}\nChegirma: ${formatMoney(order.discountAmount, settings.currency)}\nJami: ${formatMoney(order.total, settings.currency)}${randomLine}\nTo‘lov: ${paymentProvider} orqali oldindan + admin tasdiq${uploaded?.url ? '\nChek biriktirilgan' : ''}${locationLine}\nHolat: ${orderStatusText(order.orderStatus)} / ${paymentStatusText(order.paymentStatus)}`, order.paymentScreenshotUrl);
  res.status(201).json({ success: true, order });
}));

app.post('/api/orders/:id/location', telegramAuth, asyncHandler(async (req, res) => { ensureObjectId(req.params.id, 'Buyurtma ID'); const order = await Order.findOne({ _id: req.params.id, userTelegramId: String(req.tgUser.id) }); if (!order) return res.status(404).json({ success: false, message: 'Buyurtma topilmadi.' }); if (order.type !== 'DELIVERY') return res.status(400).json({ success: false, message: 'Faqat yetkazish buyurtmasida lokatsiya yangilanadi.' }); if (['DONE', 'CANCELLED'].includes(order.orderStatus)) return res.status(400).json({ success: false, message: 'Yakunlangan buyurtmada lokatsiya yangilanmaydi.' }); const settings = await getSettingsDoc(); const location = parseLocationPayload(req.body); if (!location) return res.status(400).json({ success: false, message: 'Lokatsiya koordinatalari noto‘g‘ri.' }); const previousKm = order.distanceKm || 0; const quote = calculateDeliveryQuote(settings, location, null, 'DELIVERY'); const trend = movementTrend(previousKm, quote.distanceKm); order.customerLocation = location; order.distanceKm = quote.distanceKm || 0; order.movementTrend = trend.trend; order.movementDeltaKm = trend.delta; order.lastLocationAt = new Date(); order.liveLocationEnabled = true; if (!order.businessLocationSnapshot?.lat && quote.businessLocation) order.businessLocationSnapshot = quote.businessLocation; await order.save(); res.json({ success: true, order: { _id: order._id, orderNo: order.orderNo, distanceKm: order.distanceKm, movementTrend: order.movementTrend, movementDeltaKm: order.movementDeltaKm, mapUrl: makeMapUrl(location.lat, location.lng), lastLocationAt: order.lastLocationAt } }); }));
app.get('/api/my/orders', telegramAuth, asyncHandler(async (req, res) => { const orders = await Order.find({ userTelegramId: String(req.tgUser.id) }).sort({ createdAt: -1 }).limit(80); res.json({ success: true, orders }); }));

app.post('/api/admin/login', asyncHandler(async (req, res) => { const initData = req.body.initData || req.get('X-Telegram-Init-Data') || ''; const validated = validateTelegramInitData(initData); if (validated.ok && validated.user?.id) { const tgUser = validated.user; if (!isAdminTelegramId(tgUser.id)) return res.status(403).json({ success: false, message: adminAccessHelp(), userId: tgUser.id }); return res.json({ success: true, token: signAdminToken({ role: 'admin', tgId: tgUser.id, username: tgUser.username, name: userFullName(tgUser, 'Boshqaruvchi') }), admin: tgUser }); } if (ALLOW_PASSWORD_ADMIN && req.body.password === ADMIN_PASSWORD) return res.json({ success: true, token: signAdminToken({ role: 'admin', fallback: true, name: 'Parolli boshqaruvchi' }), admin: { id: 'password-admin', first_name: 'Parol', last_name: 'Boshqaruvchi' } }); res.status(401).json({ success: false, message: validated.reason || 'Telegram orqali boshqaruvchi tasdig‘i kerak. Lokal test uchun parol orqali kirishni yoqing.', hint: adminAccessHelp() }); }));
app.get('/api/admin/me', verifyAdminToken, asyncHandler(async (req, res) => res.json({ success: true, admin: req.admin, adminIdsConfigured: adminIdsConfigured(), adminIdsCount: ADMIN_TELEGRAM_IDS.size })));
app.get('/api/admin/dashboard', verifyAdminToken, asyncHandler(async (_req, res) => { const [ordersTotal, ordersPending, productsTotal, customersTotal, promoTotal, revenueAgg, bonusAgg] = await Promise.all([Order.countDocuments(), Order.countDocuments({ orderStatus: { $in: ['NEW', 'CONFIRMED', 'PREPARING', 'SHOPPING', 'ON_ROAD', 'READY'] } }), Product.countDocuments(), Customer.countDocuments(), PromoCode.countDocuments(), Order.aggregate([{ $match: { paymentStatus: { $ne: 'REJECTED' }, orderStatus: { $ne: 'CANCELLED' } } }, { $group: { _id: null, total: { $sum: '$total' } } }]), Customer.aggregate([{ $group: { _id: null, total: { $sum: '$bonusBalance' } } }])]); res.json({ success: true, stats: { ordersTotal, ordersPending, productsTotal, customersTotal, promoTotal, revenue: revenueAgg[0]?.total || 0, bonusBalance: bonusAgg[0]?.total || 0 } }); }));
app.get('/api/admin/orders', verifyAdminToken, asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  if (req.query.orderStatus) filter.orderStatus = req.query.orderStatus;
  if (req.query.orderMode) filter.orderMode = req.query.orderMode;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.orderContentType) filter.orderContentType = req.query.orderContentType;
  if (req.query.dateFrom || req.query.dateTo) {
    filter.deliveryDate = {};
    if (req.query.dateFrom) filter.deliveryDate.$gte = String(req.query.dateFrom);
    if (req.query.dateTo) filter.deliveryDate.$lte = String(req.query.dateTo);
  }
  if (req.query.q) {
    const r = new RegExp(escapeRegExp(req.query.q), 'i');
    filter.$or = [{ orderNo: r }, { userFullName: r }, { phone: r }, { recipientName: r }, { recipientPhone: r }, { address: r }, { note: r }, { planNote: r }, { 'buyerInfo.fullName': r }, { 'buyerInfo.phone': r }, { 'buyerInfo.address': r }, { 'recipientInfo.fullName': r }, { 'recipientInfo.phone': r }, { 'recipientInfo.address': r }, { 'serviceDetails.serviceScenario': r }, { 'serviceDetails.callScript': r }, { 'productDetails.theme': r }];
  }
  const orders = await Order.find(filter).sort({ deliveryDate: 1, deliveryTime: 1, createdAt: -1 }).limit(300);
  res.json({ success: true, orders });
}));
app.patch('/api/admin/orders/:id', verifyAdminToken, asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, 'Buyurtma ID');
  const allowed = ['paymentStatus', 'orderStatus', 'adminNote', 'reminderFrequency', 'reminderNote'];
  const update = {};
  for (const key of allowed) if (req.body[key] !== undefined) update[key] = req.body[key];
  if (req.body.reminderFrequency !== undefined) update.reminderNextAt = nextReminderAt(req.body.reminderFrequency);
  let order = await Order.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!order) return res.status(404).json({ success: false, message: 'Buyurtma topilmadi.' });
  order = await finalizeOrderRewards(order);
  await notifyCustomer(order.userTelegramId, `<b>Buyurtma holati yangilandi</b>
#${order.orderNo}
To‘lov: ${paymentStatusText(order.paymentStatus)}
Holat: ${orderStatusText(order.orderStatus)}
Bonus: ${formatMoney(order.bonusEarned || 0)}`);
  res.json({ success: true, order });
}));
app.get('/api/admin/customers', verifyAdminToken, asyncHandler(async (_req, res) => { const customers = await Customer.find().sort({ createdAt: -1 }).limit(300); res.json({ success: true, customers }); }));

app.get('/api/admin/products', verifyAdminToken, asyncHandler(async (_req, res) => { const products = await Product.find().sort({ sort: 1, createdAt: -1 }); res.json({ success: true, products }); }));
app.post('/api/admin/products', verifyAdminToken, upload.any(), asyncHandler(async (req, res) => {
  const imageFiles = [...filesByField(req.files, 'image'), ...filesByField(req.files, 'gallery')].slice(0, 4);
  const variantImageFiles = (req.files || []).filter((file) => /^variantImage_\d+$/.test(file.fieldname) || file.fieldname === 'variantImages').slice(0, 30);
  const uploadedImages = [];
  for (const file of imageFiles) uploadedImages.push(await uploadToCloudinary(file, 'giftgo/products'));
  const primaryImage = uploadedImages[0] || null;
  const galleryImages = uploadedImages.slice(1, 4);
  const productData = {
    name: String(req.body.name || '').trim(), category: String(req.body.category || 'Gullar').trim(),
    productType: String(req.body.productType || 'FLOWER'), description: String(req.body.description || '').trim(),
    price: normalizeNumber(req.body.price), oldPrice: normalizeNumber(req.body.oldPrice),
    imageUrl: primaryImage?.url || '', imagePublicId: primaryImage?.publicId || '', galleryUrls: galleryImages.map((x) => x.url), galleryPublicIds: galleryImages.map((x) => x.publicId),
    emoji: String(req.body.emoji || '').trim(), available: parseBoolean(req.body.available, true), featured: parseBoolean(req.body.featured, false),
    promoEligible: parseBoolean(req.body.promoEligible, true), promoCode: normalizePromoCode(req.body.promoCode), promoDiscountPercent: Math.max(0, Math.min(100, normalizeNumber(req.body.promoDiscountPercent))),
    cashbackPercentOverride: normalizeNumber(req.body.cashbackPercentOverride), minLeadDays: normalizeNumber(req.body.minLeadDays ?? 4), expressRandomAllowed: parseBoolean(req.body.expressRandomAllowed, false), sort: normalizeNumber(req.body.sort || 100),
  };
  applyProductAdminPayload(productData, req.body);
  await attachVariantImages(productData.variants, variantImageFiles);
  const product = await Product.create(productData);
  res.status(201).json({ success: true, product });
}));
app.patch('/api/admin/products/:id', verifyAdminToken, upload.any(), asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, 'Mahsulot ID');
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Mahsulot topilmadi.' });
  for (const f of ['name', 'category', 'description', 'emoji', 'productType']) if (req.body[f] !== undefined) product[f] = String(req.body[f]).trim();
  for (const f of ['price', 'oldPrice', 'sort', 'promoDiscountPercent', 'cashbackPercentOverride', 'minLeadDays']) if (req.body[f] !== undefined) product[f] = normalizeNumber(req.body[f]);
  if (req.body.promoCode !== undefined) product.promoCode = normalizePromoCode(req.body.promoCode);
  for (const f of ['available', 'featured', 'promoEligible', 'expressRandomAllowed']) if (req.body[f] !== undefined) product[f] = parseBoolean(req.body[f], product[f]);
  applyProductAdminPayload(product, req.body);
  await attachVariantImages(product.variants, (req.files || []).filter((file) => /^variantImage_\d+$/.test(file.fieldname) || file.fieldname === 'variantImages').slice(0, 30));
  const imageFiles = [...filesByField(req.files, 'image'), ...filesByField(req.files, 'gallery')].slice(0, 4);
  if (imageFiles.length) {
    const uploadedImages = [];
    for (const file of imageFiles) uploadedImages.push(await uploadToCloudinary(file, 'giftgo/products'));
    const primaryImage = uploadedImages[0] || null;
    const galleryImages = uploadedImages.slice(1, 4);
    product.imageUrl = primaryImage?.url || '';
    product.imagePublicId = primaryImage?.publicId || '';
    product.galleryUrls = galleryImages.map((x) => x.url);
    product.galleryPublicIds = galleryImages.map((x) => x.publicId);
  }
  await product.save();
  res.json({ success: true, product });
}));
app.delete('/api/admin/products/:id', verifyAdminToken, asyncHandler(async (req, res) => { ensureObjectId(req.params.id, 'Mahsulot ID'); const product = await Product.findByIdAndDelete(req.params.id); if (!product) return res.status(404).json({ success: false, message: 'Mahsulot topilmadi.' }); res.json({ success: true }); }));

app.get('/api/admin/promocodes', verifyAdminToken, asyncHandler(async (_req, res) => { const promos = await PromoCode.find().sort({ createdAt: -1 }).limit(200); res.json({ success: true, promos }); }));
app.post('/api/admin/promocodes', verifyAdminToken, asyncHandler(async (req, res) => { const promo = await PromoCode.create({ code: normalizePromoCode(req.body.code), title: String(req.body.title || '').trim(), discountType: String(req.body.discountType || 'PERCENT'), value: normalizeNumber(req.body.value), maxDiscount: normalizeNumber(req.body.maxDiscount), minSubtotal: normalizeNumber(req.body.minSubtotal), firstOrderOnly: parseBoolean(req.body.firstOrderOnly, false), categories: safeJsonParse(req.body.categories, []), productIds: safeJsonParse(req.body.productIds, []), startsAt: req.body.startsAt ? new Date(req.body.startsAt) : undefined, endsAt: req.body.endsAt ? new Date(req.body.endsAt) : undefined, usageLimit: normalizeNumber(req.body.usageLimit), active: parseBoolean(req.body.active, true) }); res.status(201).json({ success: true, promo }); }));
app.patch('/api/admin/promocodes/:id', verifyAdminToken, asyncHandler(async (req, res) => { ensureObjectId(req.params.id, 'Promokod ID'); const update = {}; for (const f of ['title', 'discountType']) if (req.body[f] !== undefined) update[f] = String(req.body[f]).trim(); if (req.body.code !== undefined) update.code = normalizePromoCode(req.body.code); for (const f of ['value', 'maxDiscount', 'minSubtotal', 'usageLimit']) if (req.body[f] !== undefined) update[f] = normalizeNumber(req.body[f]); for (const f of ['firstOrderOnly', 'active']) if (req.body[f] !== undefined) update[f] = parseBoolean(req.body[f], true); for (const f of ['categories', 'productIds']) if (req.body[f] !== undefined) update[f] = safeJsonParse(req.body[f], []); for (const f of ['startsAt', 'endsAt']) if (req.body[f] !== undefined) update[f] = req.body[f] ? new Date(req.body[f]) : null; const promo = await PromoCode.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }); if (!promo) return res.status(404).json({ success: false, message: 'Promokod topilmadi.' }); res.json({ success: true, promo }); }));
app.delete('/api/admin/promocodes/:id', verifyAdminToken, asyncHandler(async (req, res) => { ensureObjectId(req.params.id, 'Promokod ID'); const promo = await PromoCode.findByIdAndDelete(req.params.id); if (!promo) return res.status(404).json({ success: false, message: 'Promokod topilmadi.' }); res.json({ success: true }); }));

app.get('/api/admin/delivery-services', verifyAdminToken, asyncHandler(async (_req, res) => { const services = await DeliveryService.find().sort({ sort: 1, createdAt: -1 }); res.json({ success: true, services }); }));
app.post('/api/admin/delivery-services', verifyAdminToken, asyncHandler(async (req, res) => { const service = await DeliveryService.create({ title: String(req.body.title || '').trim(), description: String(req.body.description || '').trim(), price: normalizeNumber(req.body.price), eta: String(req.body.eta || '30–60 daqiqa').trim(), active: parseBoolean(req.body.active, true), sort: normalizeNumber(req.body.sort || 100) }); res.status(201).json({ success: true, service }); }));
app.patch('/api/admin/delivery-services/:id', verifyAdminToken, asyncHandler(async (req, res) => { ensureObjectId(req.params.id, 'Yetkazib berish ID'); const update = {}; for (const k of ['title', 'description', 'eta']) if (req.body[k] !== undefined) update[k] = String(req.body[k]).trim(); for (const k of ['price', 'sort']) if (req.body[k] !== undefined) update[k] = normalizeNumber(req.body[k]); if (req.body.active !== undefined) update.active = parseBoolean(req.body.active, true); const service = await DeliveryService.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }); if (!service) return res.status(404).json({ success: false, message: 'Xizmat topilmadi.' }); res.json({ success: true, service }); }));
app.delete('/api/admin/delivery-services/:id', verifyAdminToken, asyncHandler(async (req, res) => { ensureObjectId(req.params.id, 'Yetkazib berish ID'); const service = await DeliveryService.findByIdAndDelete(req.params.id); if (!service) return res.status(404).json({ success: false, message: 'Xizmat topilmadi.' }); res.json({ success: true }); }));

app.get('/api/admin/settings', verifyAdminToken, asyncHandler(async (_req, res) => { const settings = await getSettingsDoc(); res.json({ success: true, settings }); }));
app.patch('/api/admin/settings', verifyAdminToken, upload.single('logo'), asyncHandler(async (req, res) => { const settings = await getSettingsDoc(); const strings = ['brandName', 'brandSubtitle', 'currency', 'businessPhone', 'supportPhone', 'supportTelegram', 'businessAddress', 'restaurantPhone', 'restaurantAddress', 'botUsername', 'instagram', 'openingHours', 'paymentCardTitle', 'paymentCardBank', 'paymentCardNumber', 'paymentCardHolder', 'paymentInstructions', 'paymentPaynetUrl', 'paymentClickUrl', 'paymentUzumUrl', 'paymentXaznaUrl', 'paymentPaymeUrl', 'paymentOtherUrl', 'adminTelegramChatId', 'expressAgreementText']; for (const f of strings) if (req.body[f] !== undefined) settings[f] = String(req.body[f]).trim(); const nums = ['businessLat', 'businessLng', 'restaurantLat', 'restaurantLng', 'deliveryBaseFee', 'deliveryBaseKm', 'deliveryPricePerKm', 'deliveryMaxKm', 'scheduledMinLeadDays', 'expressMaxLeadHours', 'expressRandomMinAmount', 'firstOrderDiscountAmount', 'referralFriendDiscountAmount', 'referralInviterBonusAmount', 'cashbackPercent']; for (const f of nums) if (req.body[f] !== undefined) settings[f] = normalizeNumber(req.body[f]); const bools = ['deliveryAutoPricingEnabled', 'deliveryOutOfZoneEnabled', 'cashOnDeliveryEnabled', 'cashOnPickupEnabled', 'expressRandomEnabled', 'firstOrderDiscountEnabled', 'bonusUseEnabled']; for (const f of bools) if (req.body[f] !== undefined) settings[f] = parseBoolean(req.body[f], settings[f]); if (settings.businessLat) settings.restaurantLat = settings.businessLat; if (settings.businessLng) settings.restaurantLng = settings.businessLng; if (settings.businessPhone) settings.restaurantPhone = settings.businessPhone; if (settings.businessAddress) settings.restaurantAddress = settings.businessAddress; if (req.file) { const uploaded = await uploadToCloudinary(req.file, 'giftgo/brand'); settings.logoUrl = uploaded.url; } await settings.save(); res.json({ success: true, settings }); }));

app.get('/api/admin/reviews', verifyAdminToken, asyncHandler(async (_req, res) => {
  const reviews = await Review.find({ active: true }).sort({ createdAt: -1 }).limit(200).lean();
  const productIds = [...new Set(reviews.map((r) => String(r.productId)).filter(Boolean))];
  const products = await Product.find({ _id: { $in: productIds } }).select('name').lean();
  const productMap = new Map(products.map((p) => [String(p._id), p.name]));
  res.json({ success: true, reviews: reviews.map((r) => ({ ...r, productName: productMap.get(String(r.productId)) || 'Mahsulot' })) });
}));
app.patch('/api/admin/reviews/:id', verifyAdminToken, asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, 'Sharh ID');
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ success: false, message: 'Sharh topilmadi.' });
  if (req.body.adminReply !== undefined) review.adminReply = String(req.body.adminReply || '').trim().slice(0, 1000);
  if (req.body.active !== undefined) review.active = parseBoolean(req.body.active, review.active);
  await review.save();
  res.json({ success: true, review });
}));

app.get('/api/admin/bot/status', verifyAdminToken, asyncHandler(async (_req, res) => { const [webhookInfo, identity] = await Promise.all([telegramApi('getWebhookInfo', {}), getTelegramBotIdentity(true)]); res.json({ success: true, bot: { hasToken: Boolean(BOT_TOKEN), username: identity?.username || '', firstName: identity?.first_name || '', expectedUsername: BOT_EXPECTED_USERNAME, publicUrl: PUBLIC_URL, webAppUrl: WEBAPP_URL, autoSetWebhook: AUTO_SET_WEBHOOK, polling: TELEGRAM_POLLING, webhookSecretEnabled: Boolean(TELEGRAM_WEBHOOK_SECRET), adminIdsConfigured: adminIdsConfigured(), adminIdsCount: ADMIN_TELEGRAM_IDS.size, adminPanelUrl: adminPanelUrl(), webhookInfo } }); }));
app.post('/api/admin/bot/setup-webhook', verifyAdminToken, asyncHandler(async (_req, res) => { if (!PUBLIC_URL) return res.status(400).json({ success: false, message: 'PUBLIC_URL kerak.' }); const identity = await syncTelegramBotIdentity(); const result = await telegramApi('setWebhook', { url: `${PUBLIC_URL}/telegram/webhook`, secret_token: TELEGRAM_WEBHOOK_SECRET || undefined, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }); await ensureBotMenuButton(); res.json({ success: Boolean(result.ok), bot: identity, result }); }));
app.post('/api/admin/bot/delete-webhook', verifyAdminToken, asyncHandler(async (_req, res) => { const result = await telegramApi('deleteWebhook', { drop_pending_updates: false }); res.json({ success: Boolean(result.ok), result }); }));

app.get('/telegram/webhook', (_req, res) => res.send('GiftGo Telegram webhook is alive'));
app.post('/telegram/webhook', asyncHandler(async (req, res) => { if (TELEGRAM_WEBHOOK_SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).json({ success: false }); await handleTelegramUpdate(req.body); res.json({ success: true }); }));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function processAdminReminders() {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const due = await Order.find({
      reminderFrequency: { $ne: 'NONE' },
      reminderNextAt: { $lte: new Date() },
      orderStatus: { $nin: ['DONE', 'CANCELLED'] },
    }).sort({ reminderNextAt: 1 }).limit(20);
    for (const order of due) {
      const loc = order.customerLocation?.lat ? `
${makeMapUrl(order.customerLocation.lat, order.customerLocation.lng)}` : '';
      await notifyAdmin(`<b>Renotif</b>
#${order.orderNo}
Sana: ${order.deliveryDate || '-'} ${order.deliveryTime || ''}
Mijoz: ${order.userFullName || '-'} · ${order.phone || ''}
Sabab: ${order.eventType || '-'}
Jami: ${formatMoney(order.total || 0)}
Holat: ${orderStatusText(order.orderStatus)} / ${paymentStatusText(order.paymentStatus)}
Izoh: ${order.reminderNote || order.adminNote || order.planNote || order.note || '-'}${loc}`);
      order.reminderLastSentAt = new Date();
      order.reminderNextAt = nextReminderAt(order.reminderFrequency, order.reminderLastSentAt);
      await order.save();
    }
  } catch (error) {
    console.error('Boshqaruv eslatmasi xatosi:', error.message);
  }
}
setInterval(processAdminReminders, 60 * 1000);

app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ success: false, message: error.message || 'Server xatosi' }); });

mongoose.connect(MONGODB_URI).then(async () => {
  await seedDefaults();
  app.listen(PORT, async () => {
    console.log(`GiftGo Mini App listening on ${PORT}`);
    if (BOT_TOKEN) await syncTelegramBotIdentity();
    if (AUTO_SET_WEBHOOK && PUBLIC_URL && BOT_TOKEN) { await telegramApi('setWebhook', { url: `${PUBLIC_URL}/telegram/webhook`, secret_token: TELEGRAM_WEBHOOK_SECRET || undefined, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }); await ensureBotMenuButton(); }
    if (TELEGRAM_POLLING && BOT_TOKEN && !AUTO_SET_WEBHOOK) {
      // Agar oldingi deployda webhook qolib ketgan bo‘lsa, getUpdates ishlamaydi.
      // .env o‘zgarmasdan ham /start javob berishi uchun pollingdan oldin webhook xavfsiz o‘chiriladi.
      await telegramApi('deleteWebhook', { drop_pending_updates: false });
      startPolling();
    }
  });
}).catch((error) => { console.error('MongoDB connection failed:', error); process.exit(1); });

let pollingOffset = 0;
function startPolling() {
  async function loop() {
    try {
      const data = await telegramApi('getUpdates', { offset: pollingOffset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      if (data?.ok && Array.isArray(data.result)) for (const update of data.result) { pollingOffset = update.update_id + 1; await handleTelegramUpdate(update); }
    } catch (error) { console.error('Polling error:', error.message); }
    setTimeout(loop, 1000);
  }
  loop();
}
