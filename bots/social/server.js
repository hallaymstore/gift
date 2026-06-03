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

mongoose.set('bufferCommands', false);

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
const ADMIN_TELEGRAM_USERNAME = normalizeTelegramUsername(firstEnv('SOCIAL_ADMIN_TELEGRAM_USERNAME', 'ADMIN_TELEGRAM_USERNAME', 'ADMIN_USERNAME'));
const ADMIN_TELEGRAM_URL = cleanPublicUrl(firstEnv('SOCIAL_ADMIN_TELEGRAM_URL', 'ADMIN_TELEGRAM_URL')) || (ADMIN_TELEGRAM_USERNAME ? `https://t.me/${ADMIN_TELEGRAM_USERNAME}` : '');
const GROUP_CHAT_URL = cleanPublicUrl(firstEnv('SOCIAL_GROUP_CHAT_URL', 'GROUP_CHAT_URL', 'SOCIAL_TRADE_CHAT_URL')) || ADMIN_TELEGRAM_URL;
const BRAND_NAME = firstEnv('SOCIAL_BRAND_NAME', 'BRAND_NAME') || 'Garant Market';
const BRAND_SUBTITLE = firstEnv('SOCIAL_BRAND_SUBTITLE', 'BRAND_SUBTITLE') || 'Ijtimoiy tarmoq hisoblari savdosi va garant bitimlar';

let databaseReady = false;
let databaseError = '';
let databaseConnecting = false;
let httpServerStarted = false;
function isDbReady() { return mongoose.connection.readyState === 1 && databaseReady; }
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
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024, files: 6 },
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

const serviceSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, default: 'accounts', enum: ['accounts', 'guarantee', 'promotion', 'gaming', 'support', 'other'] },
  platform: { type: String, default: 'other', trim: true },
  badge: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  priceFrom: { type: Number, default: 0 },
  currency: { type: String, default: DEFAULT_CURRENCY },
  requiredFields: [{ type: String, trim: true }],
  active: { type: Boolean, default: true },
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
  contactName: { type: String, default: '' },
  contactPhone: { type: String, default: '' },
  contactTelegram: { type: String, default: '' },
  referralCode: { type: String, default: '', index: true },
  referredBy: { type: String, default: '', index: true },
  startParam: { type: String, default: '' },
  proofImages: [{ url: String, publicId: String, local: Boolean }],
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  note: { type: String, default: '' },
  status: { type: String, enum: ['NEW', 'REVIEWING', 'WAITING_PAYMENT', 'IN_GUARANT', 'DONE', 'CANCELLED'], default: 'NEW', index: true },
  adminNote: { type: String, default: '' },
}, { timestamps: true });

const SocialService = mongoose.model('SocialService', serviceSchema);
const SocialRequest = mongoose.model('SocialRequest', requestSchema);

const DEFAULT_SERVICES = [
  { title: 'Garant bitim xizmati', category: 'guarantee', platform: 'all', badge: 'Xavfsiz', description: 'Sotuvchi va xaridor uchun admin nazoratidagi garant bitim.', priceFrom: 0, sort: 5, requiredFields: ['Hisob havolasi', 'Bitim summasi', 'Kontakt'] },
  { title: 'YouTube kanal savdosi', category: 'accounts', platform: 'youtube', badge: 'Talabgir', description: 'YouTube kanal sotish yoki sotib olish uchun tekshiruv va garant.', priceFrom: 0, sort: 10, requiredFields: ['Kanal havolasi', 'Obunachi', 'Narx'] },
  { title: 'Instagram akkaunt savdosi', category: 'accounts', platform: 'instagram', badge: 'Tezkor', description: 'Instagram profil/sahifa savdosi uchun qisqa so‘rov va admin aloqa.', priceFrom: 0, sort: 20, requiredFields: ['Username', 'Follower', 'Narx'] },
  { title: 'TikTok akkaunt savdosi', category: 'accounts', platform: 'tiktok', badge: 'Trend', description: 'TikTok akkaunt, auditoriya va aktivlik bo‘yicha savdo so‘rovi.', priceFrom: 0, sort: 30, requiredFields: ['Profil link', 'Follower', 'Narx'] },
  { title: 'Telegram kanal/guruh savdosi', category: 'accounts', platform: 'telegram', badge: 'Kanal', description: 'Telegram kanal, guruh yoki reklama kanalini garant orqali savdo qilish.', priceFrom: 0, sort: 40, requiredFields: ['Kanal linki', 'Aʼzo', 'Narx'] },
  { title: 'PUBG Mobile hisob savdosi', category: 'gaming', platform: 'pubg', badge: 'Gaming', description: 'PUBG hisob ID, level va skinlar bo‘yicha garantli kelishuv.', priceFrom: 0, sort: 50, requiredFields: ['Hisob ID', 'Level', 'Narx'] },
  { title: 'Reklama kanallari savdosi', category: 'promotion', platform: 'ads', badge: 'Reklama', description: 'Reklama kanal sotish/sotib olish yoki post joylash bo‘yicha buyurtma.', priceFrom: 0, sort: 60, requiredFields: ['Kanal turi', 'Auditoriya', 'Byudjet'] },
  { title: 'Hisob tekshirish va maslahat', category: 'support', platform: 'all', badge: 'Tekshiruv', description: 'Akkaunt xavfsizligi, ko‘rsatkichlari va savdoga tayyorligini tekshirish.', priceFrom: 0, sort: 70, requiredFields: ['Hisob turi', 'Muammo', 'Kontakt'] },
];

async function seedDefaults() {
  const ops = DEFAULT_SERVICES.map((service) => ({
    updateOne: {
      filter: { title: service.title },
      update: { $setOnInsert: service, $set: { sort: service.sort, active: true } },
      upsert: true,
    },
  }));
  if (ops.length) await SocialService.bulkWrite(ops, { ordered: false });
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
function webAppStartUrl(startParam = '') { if (!WEBAPP_URL) return ''; const q = startParam ? `?startapp=${encodeURIComponent(startParam)}` : ''; return `${WEBAPP_URL}${q}`; }
function adminPanelUrl() { return PUBLIC_URL ? `${PUBLIC_URL}/admin` : ''; }

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
  if (adminPanelUrl()) inline_keyboard.push([{ text: 'Admin panelni ochish', url: adminPanelUrl() }]);
  if (GROUP_CHAT_URL) inline_keyboard.push([{ text: 'Savdo chatini ochish', url: GROUP_CHAT_URL }]);
  for (const id of ADMIN_TELEGRAM_IDS) {
    await sendTelegramMessage(id, compactRequestMessage(doc), inline_keyboard.length ? { reply_markup: { inline_keyboard } } : {});
  }
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
    botUsername: BOT_EXPECTED_USERNAME,
    currency: DEFAULT_CURRENCY,
    legalNote: 'Faqat egasining roziligi bor hisoblar qabul qilinadi. Parol, SMS kod va 2FA kodlarni formaga yozmang.',
  });
});

app.get('/api/catalog', asyncHandler(async (_req, res) => {
  if (!isDbReady()) {
    const services = DEFAULT_SERVICES
      .slice()
      .sort((a, b) => (a.sort || 100) - (b.sort || 100))
      .map((service, index) => ({
        ...service,
        _id: `fallback-${index + 1}`,
        active: true,
        currency: service.currency || DEFAULT_CURRENCY,
        dbFallback: true,
      }));
    return res.json({ success: true, services, database: dbStatus(), fallback: true });
  }
  const services = await SocialService.find({ active: true }).sort({ sort: 1, createdAt: -1 }).lean();
  res.json({ success: true, services, database: dbStatus() });
}));

app.post('/api/requests', upload.array('proofImages', 6), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const initData = body.initData || req.get('X-Telegram-Init-Data') || '';
  const tg = validateTelegramInitData(initData);
  const tgUser = tg.ok ? tg.user : null;
  const serviceId = body.serviceId && mongoose.Types.ObjectId.isValid(String(body.serviceId)) ? body.serviceId : null;
  const service = serviceId && isDbReady() ? await SocialService.findById(serviceId).lean() : null;
  const files = req.files || [];
  const proofImages = [];
  for (const file of files) proofImages.push(await uploadToCloudinary(file, 'social-garant/proofs'));

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
    contactName,
    contactPhone,
    contactTelegram,
    referralCode,
    referredBy: referralCode,
    startParam,
    proofImages,
    extra: { ...safeJsonParse(body.extra, {}), startParam },
    note: body.note || '',
  };

  let doc = payload;
  let stored = false;
  if (isDbReady()) {
    doc = await SocialRequest.create(payload);
    stored = true;
  } else {
    doc = { ...payload, _id: payload.requestNo, status: 'NEW', createdAt: new Date().toISOString(), dbFallback: true };
  }

  notifyAdmins(doc).catch((error) => console.error('Admin notification failed:', error.message));
  res.status(201).json({ success: true, message: stored ? 'So‘rov qabul qilindi. Admin garant bitim uchun Telegram orqali bog‘lanadi.' : 'So‘rov admin Telegramiga yuborildi. Maʼlumotlar bazasi ulanmagan bo‘lsa, Render env MONGODB_URI ni tekshiring.', request: doc, stored, database: dbStatus() });
}));

app.get('/api/requests/my', asyncHandler(async (req, res) => {
  const telegramUserId = String(req.query.telegramUserId || '').trim();
  if (!telegramUserId || !isDbReady()) return res.json({ success: true, requests: [], database: dbStatus() });
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
  if (!isDbReady()) return res.json({ success: true, stats: { total: 0, fresh: 0, inGarant: 0, done: 0, services: DEFAULT_SERVICES.length }, database: dbStatus(), fallback: true });
  const [total, fresh, inGarant, done, services] = await Promise.all([
    SocialRequest.countDocuments(),
    SocialRequest.countDocuments({ status: 'NEW' }),
    SocialRequest.countDocuments({ status: 'IN_GUARANT' }),
    SocialRequest.countDocuments({ status: 'DONE' }),
    SocialService.countDocuments({ active: true }),
  ]);
  res.json({ success: true, stats: { total, fresh, inGarant, done, services }, database: dbStatus() });
}));

app.get('/api/admin/services', requireAdmin, asyncHandler(async (_req, res) => {
  if (!isDbReady()) {
    const services = DEFAULT_SERVICES.slice().sort((a, b) => (a.sort || 100) - (b.sort || 100)).map((service, index) => ({ ...service, _id: `fallback-${index + 1}`, active: true, currency: service.currency || DEFAULT_CURRENCY, dbFallback: true }));
    return res.json({ success: true, services, database: dbStatus(), fallback: true });
  }
  const services = await SocialService.find().sort({ sort: 1, createdAt: -1 }).lean();
  res.json({ success: true, services, database: dbStatus() });
}));

app.post('/api/admin/services', requireAdmin, asyncHandler(async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ success: false, message: 'Maʼlumotlar bazasi ulanmagan. Render env MONGODB_URI ni tekshiring.', database: dbStatus() });
  const body = req.body || {};
  const service = await SocialService.create({
    title: body.title,
    category: body.category || 'accounts',
    platform: body.platform || 'other',
    badge: body.badge || '',
    description: body.description || '',
    priceFrom: normalizeNumber(body.priceFrom),
    currency: body.currency || DEFAULT_CURRENCY,
    requiredFields: Array.isArray(body.requiredFields) ? body.requiredFields : String(body.requiredFields || '').split('\n').map((x) => x.trim()).filter(Boolean),
    active: parseBoolean(body.active, true),
    sort: normalizeNumber(body.sort) || 100,
  });
  res.status(201).json({ success: true, service });
}));

app.patch('/api/admin/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ success: false, message: 'Maʼlumotlar bazasi ulanmagan. Render env MONGODB_URI ni tekshiring.', database: dbStatus() });
  ensureObjectId(req.params.id);
  const body = req.body || {};
  const patch = { ...body };
  if ('priceFrom' in patch) patch.priceFrom = normalizeNumber(patch.priceFrom);
  if ('sort' in patch) patch.sort = normalizeNumber(patch.sort);
  if ('active' in patch) patch.active = parseBoolean(patch.active, true);
  if ('requiredFields' in patch && !Array.isArray(patch.requiredFields)) patch.requiredFields = String(patch.requiredFields || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const service = await SocialService.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
  res.json({ success: true, service });
}));

app.delete('/api/admin/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ success: false, message: 'Maʼlumotlar bazasi ulanmagan. Render env MONGODB_URI ni tekshiring.', database: dbStatus() });
  ensureObjectId(req.params.id);
  await SocialService.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

app.get('/api/admin/requests', requireAdmin, asyncHandler(async (req, res) => {
  if (!isDbReady()) return res.json({ success: true, requests: [], database: dbStatus(), fallback: true });
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.platform) filter.platform = req.query.platform;
  const requests = await SocialRequest.find(filter).sort({ createdAt: -1 }).limit(250).lean();
  res.json({ success: true, requests, database: dbStatus() });
}));

app.patch('/api/admin/requests/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ success: false, message: 'Maʼlumotlar bazasi ulanmagan. Render env MONGODB_URI ni tekshiring.', database: dbStatus() });
  ensureObjectId(req.params.id);
  const patch = {};
  for (const key of ['status', 'adminNote']) if (key in req.body) patch[key] = req.body[key];
  const doc = await SocialRequest.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
  res.json({ success: true, request: doc });
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

async function connectMongoWithRetry() {
  if (databaseConnecting || isDbReady()) return;
  databaseConnecting = true;
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 12000, autoIndex: true });
    databaseReady = true;
    databaseError = '';
    await seedDefaults();
    console.log(`${BRAND_NAME} MongoDB connected`);
  } catch (error) {
    databaseReady = false;
    databaseError = error?.message || String(error);
    console.error(`${BRAND_NAME} MongoDB connection failed:`, databaseError);
    setTimeout(connectMongoWithRetry, Number(process.env.MONGO_RETRY_MS || 10000)).unref();
  } finally {
    databaseConnecting = false;
  }
}

mongoose.connection.on('connected', () => { databaseReady = true; databaseError = ''; });
mongoose.connection.on('disconnected', () => {
  databaseReady = false;
  databaseError = databaseError || 'MongoDB disconnected';
  setTimeout(connectMongoWithRetry, Number(process.env.MONGO_RETRY_MS || 10000)).unref();
});
mongoose.connection.on('error', (error) => {
  databaseReady = false;
  databaseError = error?.message || String(error);
});

function boot() {
  if (httpServerStarted) return;
  httpServerStarted = true;
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`${BRAND_NAME} server listening on ${PORT}`);
    connectMongoWithRetry();
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
boot();
