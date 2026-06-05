'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const { fork } = require('child_process');

const ROOT_PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const INTERNAL_HOST = '127.0.0.1';

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

const PUBLIC_ROOT_URL = cleanPublicUrl(process.env.PUBLIC_URL) || cleanPublicUrl(process.env.URL) || cleanPublicUrl(detectPublicUrl());

function joinUrlPath(root, basePath, trailingSlash = false) {
  const base = String(basePath || '').replace(/\/+$/, '');
  if (!root) return '';
  const url = `${String(root).replace(/\/+$/, '')}${base}`;
  return trailingSlash ? `${url}/` : url;
}

function safeTargetPath(originalUrl, basePath) {
  const raw = String(originalUrl || '/');
  const base = String(basePath || '').replace(/\/+$/, '');
  let rest = raw.startsWith(base) ? raw.slice(base.length) : raw;
  if (!rest || rest === '?' || rest.startsWith('?')) rest = `/${rest.startsWith('?') ? rest : ''}`;
  if (!rest.startsWith('/')) rest = `/${rest}`;
  return rest;
}

function prefixed(prefix, name, fallback = undefined) {
  const value = process.env[`${prefix}_${name}`];
  if (value !== undefined && value !== '') return value;
  return fallback;
}

function withDatabaseName(uri, dbName) {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/^mongodb(\+srv)?:$/i.test(parsed.protocol)) return raw;
    parsed.pathname = `/${dbName}`;
    return parsed.toString();
  } catch {
    return raw;
  }
}

function commonMongoUri() {
  return process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URI || process.env.GIFTGO_MONGODB_URI || '';
}

function botMongoUri(prefix, defaultDbName) {
  const specific = process.env[`${prefix}_MONGODB_URI`] || process.env[`MONGODB_URI_${prefix}`] || process.env[`${prefix}_MONGODB_URL`] || '';
  if (specific) return specific;
  const common = commonMongoUri();
  if (!common) return `mongodb://127.0.0.1:27017/${defaultDbName}`;
  // GiftGo va Social oldingi DB ichida ishlayotgan bo'lishi mumkin. Ularni majburan DB nomiga o'tkazmaymiz.
  if (prefix === 'GIFTGO' || prefix === 'SOCIAL' || prefix === 'FACTORY') return common;
  return withDatabaseName(common, defaultDbName);
}

function makeMiniAppEnv(bot) {
  const env = { ...process.env };
  env.PORT = String(bot.port);
  env.NODE_ENV = process.env.NODE_ENV || 'production';
  const botPublicUrl = PUBLIC_ROOT_URL ? joinUrlPath(PUBLIC_ROOT_URL, bot.basePath, false) : prefixed(bot.prefix, 'PUBLIC_URL', process.env.PUBLIC_URL || '');
  env.PUBLIC_URL = String(botPublicUrl || '').replace(/\/+$/, '');
  const botWebAppUrl = prefixed(bot.prefix, 'WEBAPP_URL', joinUrlPath(PUBLIC_ROOT_URL, bot.basePath, true) || (env.PUBLIC_URL ? `${env.PUBLIC_URL}/` : ''));
  env.WEBAPP_URL = String(botWebAppUrl || '').replace(/\/+$/, '') + (botWebAppUrl ? '/' : '');
  env.MONGODB_URI = botMongoUri(bot.prefix, bot.defaultDbName);

  const mappedKeys = [
    'BOT_TOKEN',
    'BOT_EXPECTED_USERNAME',
    'ADMIN_TELEGRAM_CHAT_ID',
    'ADMIN_TELEGRAM_IDS',
    'ADMIN_TELEGRAM_ID',
    'ADMIN_PASSWORD',
    'APP_SECRET',
    'ALLOW_PASSWORD_ADMIN',
    'REQUIRE_TELEGRAM_AUTH',
    'INIT_DATA_MAX_AGE_SECONDS',
    'AUTO_SET_WEBHOOK',
    'TELEGRAM_POLLING',
    'TELEGRAM_WEBHOOK_SECRET',
    'CORS_ORIGIN',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'UPLOAD_MAX_MB',
    'BRAND_NAME',
    'BRAND_SUBTITLE',
    'DEFAULT_CURRENCY',
    'GROUP_CHAT_URL',
    'CHANNEL_URL',
    'CHANNEL_CHAT_ID',
    'PAYMENT_PAYNET_URL',
    'PAYMENT_CLICK_URL',
    'PAYMENT_UZUM_URL',
    'PAYMENT_XAZNA_URL'
  ];

  for (const key of mappedKeys) {
    const direct = process.env[`${bot.prefix}_${key}`];
    if (direct !== undefined && direct !== '') {
      env[key] = direct;
      continue;
    }

    if (key === 'BOT_TOKEN' || key === 'BOT_EXPECTED_USERNAME') {
      delete env[key];
      continue;
    }

    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  if (!env.AUTO_SET_WEBHOOK) env.AUTO_SET_WEBHOOK = 'true';
  if (!env.TELEGRAM_POLLING) env.TELEGRAM_POLLING = 'false';
  if (!env.CORS_ORIGIN) env.CORS_ORIGIN = '*';
  return env;
}

function makeFactoryEnv(bot) {
  const env = { ...process.env };
  env.PORT = String(bot.port);
  env.NODE_ENV = process.env.NODE_ENV || 'production';

  const factoryPublicUrl = PUBLIC_ROOT_URL ? joinUrlPath(PUBLIC_ROOT_URL, bot.basePath, false) : (process.env.FACTORY_URL || process.env.URL || '');
  if (factoryPublicUrl) env.URL = String(factoryPublicUrl).replace(/\/+$/, '');

  env.MONGODB_URL = process.env.FACTORY_MONGODB_URL || process.env.FACTORY_MONGODB_URI || process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URI || botMongoUri('FACTORY', 'botfactory_multibot');
  env.MONGODB_URI = env.MONGODB_URL;
  env.ADMIN_IDS = process.env.FACTORY_ADMIN_IDS || process.env.ADMIN_IDS || process.env.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_CHAT_ID || '';
  env.WEBHOOK_SECRET = process.env.FACTORY_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || 'multi_bot_super_secret_2026_change_me';
  env.BOT_TOKEN_SECRET = process.env.FACTORY_BOT_TOKEN_SECRET || process.env.BOT_TOKEN_SECRET || env.WEBHOOK_SECRET;
  env.FACTORYBOT_TOKEN = process.env.FACTORYBOT_TOKEN || process.env.FACTORY_BOT_TOKEN || env.FACTORYBOT_TOKEN || '';
  env.OWNER_USERNAME = process.env.FACTORY_OWNER_USERNAME || process.env.OWNER_USERNAME || process.env.SOCIAL_ADMIN_TELEGRAM_USERNAME || '@Qoryogdiyev';

  // Factory child o'z papkasidagi .env ni ham o'qiydi. Bu yerda mavjud bo'lgan envlar yuqori prioritetda qoladi.
  return env;
}

const bots = [
  {
    kind: 'miniapp',
    key: 'giftgo',
    title: 'GiftGo',
    prefix: 'GIFTGO',
    basePath: '/giftgo',
    dir: path.join(__dirname, 'bots', 'giftgo'),
    script: path.join(__dirname, 'bots', 'giftgo', 'server.js'),
    port: Number(process.env.GIFTGO_INTERNAL_PORT || 4101),
    defaultDbName: 'giftgo_platform'
  },
  {
    kind: 'miniapp',
    key: 'course',
    title: 'KurslarGo',
    prefix: 'COURSE',
    basePath: '/course',
    dir: path.join(__dirname, 'bots', 'course'),
    script: path.join(__dirname, 'bots', 'course', 'server.js'),
    port: Number(process.env.COURSE_INTERNAL_PORT || 4102),
    defaultDbName: 'educourse_platform'
  },
  {
    kind: 'miniapp',
    key: 'social',
    title: 'Akkount Savdo / Garant Market',
    prefix: 'SOCIAL',
    basePath: '/social',
    dir: path.join(__dirname, 'bots', 'social'),
    script: path.join(__dirname, 'bots', 'social', 'server.js'),
    port: Number(process.env.SOCIAL_INTERNAL_PORT || 4103),
    defaultDbName: 'social_garant_market'
  },
  {
    kind: 'factory',
    key: 'factory',
    title: 'BotFactory — Bot yaratuvchi bot',
    prefix: 'FACTORY',
    basePath: '/factory',
    dir: path.join(__dirname, 'bots', 'factory'),
    script: path.join(__dirname, 'bots', 'factory', 'server.js'),
    port: Number(process.env.FACTORY_INTERNAL_PORT || 4104),
    defaultDbName: 'botfactory_multibot'
  }
].filter((bot) => fs.existsSync(bot.script));

const children = new Map();
let shuttingDown = false;

function makeBotEnv(bot) {
  if (bot.kind === 'factory') return makeFactoryEnv(bot);
  return makeMiniAppEnv(bot);
}

function startBot(bot) {
  const env = makeBotEnv(bot);
  const child = fork(bot.script, [], {
    cwd: bot.dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  children.set(bot.key, child);

  child.stdout.on('data', (chunk) => process.stdout.write(`[${bot.key}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${bot.key}] ${chunk}`));

  child.on('exit', (code, signal) => {
    children.delete(bot.key);
    console.error(`[${bot.key}] child exited: code=${code} signal=${signal || '-'}`);
    if (!shuttingDown) {
      const delay = Number(process.env.BOT_RESTART_DELAY_MS || 7000);
      setTimeout(() => startBot(bot), delay);
    }
  });
}

function proxyTo(bot, stripBasePath = true) {
  return (req, res) => {
    const targetPath = stripBasePath ? safeTargetPath(req.originalUrl, bot.basePath) : (req.originalUrl || '/');
    const headers = { ...req.headers };
    headers.host = `${INTERNAL_HOST}:${bot.port}`;
    headers['x-forwarded-host'] = req.headers.host || '';
    headers['x-forwarded-proto'] = req.get('x-forwarded-proto') || req.protocol || 'https';
    headers['x-forwarded-prefix'] = bot.basePath;

    const proxyReq = http.request({
      hostname: INTERNAL_HOST,
      port: bot.port,
      path: targetPath,
      method: req.method,
      headers
    }, (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      if (responseHeaders.location) {
        const loc = String(responseHeaders.location);
        if (loc.startsWith('/') && !loc.startsWith(bot.basePath + '/')) {
          responseHeaders.location = bot.basePath + loc;
        }
      }
      res.writeHead(proxyRes.statusCode || 500, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          message: `${bot.title} ichki serveri hali javob bermadi yoki xatolik berdi.`,
          error: error.message
        });
      } else {
        res.end();
      }
    });

    req.pipe(proxyReq);
  };
}

for (const bot of bots) startBot(bot);

const app = express();
app.set('trust proxy', 1);

function botFromReferer(req) {
  const target = String(req.get('x-target-bot') || '').toLowerCase().trim();
  if (target) {
    const byKey = bots.find((bot) => bot.key === target || bot.prefix.toLowerCase() === target || bot.basePath.slice(1) === target);
    if (byKey) return byKey;
  }
  const ref = `${req.get('referer') || ''} ${req.get('origin') || ''} ${req.get('x-forwarded-prefix') || ''}`;
  return bots.find((bot) => ref.includes(`${bot.basePath}/`) || ref.endsWith(bot.basePath)) || null;
}

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    app: 'render-multi-bots-with-botfactory',
    time: new Date().toISOString(),
    publicRootUrl: PUBLIC_ROOT_URL || null,
    bots: bots.map((bot) => ({
      key: bot.key,
      title: bot.title,
      path: bot.basePath,
      kind: bot.kind,
      internalPort: bot.port,
      running: children.has(bot.key),
      publicUrl: joinUrlPath(PUBLIC_ROOT_URL, bot.basePath, true)
    }))
  });
});

// Eski mini app frontendlarida absolute /api yoki /telegram fetch ishlatilsa,
// referer/origin bo'yicha kerakli ichki botga proxy qilamiz.
app.use(['/api', '/telegram'], (req, res, next) => {
  if (req.path === '/health' && req.baseUrl === '/api') return next();
  const bot = botFromReferer(req);
  if (!bot) return next();
  return proxyTo(bot, false)(req, res);
});

app.get('/', (_req, res) => {
  const rows = bots.map((bot) => {
    const extra = bot.kind === 'factory'
      ? `Webhooklar: ${bot.basePath}/webhook/... · Status: ${bot.basePath}/status`
      : `Admin: ${bot.basePath}/admin · Webhook: ${bot.basePath}/telegram/webhook`;
    return `
    <a class="card" href="${bot.basePath}/">
      <b>${bot.title}</b>
      <span>${bot.basePath}/</span>
      <small>${extra}</small>
    </a>`;
  }).join('');
  res.type('html').send(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Render Multi Bot + BotFactory</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f7f7fb;color:#161620}.wrap{max-width:880px;margin:0 auto;padding:24px}.grid{display:grid;gap:12px}.card{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #e6e6ef;border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(25,25,50,.06)}b{display:block;font-size:20px;margin-bottom:6px}span{display:block;color:#2563eb;font-weight:700;margin-bottom:6px}small{color:#666}.note{background:#111827;color:#fff;border-radius:12px;padding:14px;margin:14px 0}</style></head><body><main class="wrap"><h1>Render Multi Bot + BotFactory</h1><p>Bitta Render server ichida mini app botlar va bot yaratuvchi BotFactory ishlaydi.</p><div class="note">Start Command: <b>node server.js</b></div><div class="grid">${rows}</div></main></body></html>`);
});

for (const bot of bots) {
  app.use(bot.basePath, proxyTo(bot));
}

function shutdown() {
  shuttingDown = true;
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(ROOT_PORT, HOST, () => {
  console.log(`Multi bot + BotFactory server listening on ${HOST}:${ROOT_PORT}`);
  for (const bot of bots) console.log(`${bot.title}: http://localhost:${ROOT_PORT}${bot.basePath}/ -> internal ${bot.port}`);
});
