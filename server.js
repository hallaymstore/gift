'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
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

const PUBLIC_ROOT_URL = cleanPublicUrl(process.env.PUBLIC_URL) || cleanPublicUrl(detectPublicUrl());

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

function botMongoUri(prefix, defaultDbName) {
  const specific = process.env[`${prefix}_MONGODB_URI`] || process.env[`MONGODB_URI_${prefix}`] || '';
  if (specific) return specific;
  const common = process.env.MONGODB_URI || '';
  if (!common) return `mongodb://127.0.0.1:27017/${defaultDbName}`;
  if (prefix === 'GIFTGO') return common;
  return withDatabaseName(common, defaultDbName);
}

function makeBotEnv(bot) {
  const env = { ...process.env };
  env.PORT = String(bot.port);
  env.NODE_ENV = process.env.NODE_ENV || 'production';
  const botPublicUrl = PUBLIC_ROOT_URL ? joinUrlPath(PUBLIC_ROOT_URL, bot.basePath, false) : prefixed(bot.prefix, 'PUBLIC_URL', process.env.PUBLIC_URL || '');
  env.PUBLIC_URL = String(botPublicUrl || '').replace(/\/+$/, '');
  // Mini App URL har doim slash bilan tugasin: Telegram webview va relative fetch yo‘llarida redirect sikl bo‘lmaydi.
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
    'UPLOAD_MAX_MB'
  ];

  for (const key of mappedKeys) {
    const direct = process.env[`${bot.prefix}_${key}`];
    if (direct !== undefined && direct !== '') {
      env[key] = direct;
      continue;
    }

    // Har bir Telegram bot tokeni alohida bo'lishi shart.
    // Common BOT_TOKEN fallback qilinsa, ikkala bot bitta token bilan webhookni bir-biridan tortib olishi mumkin.
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

const bots = [
  {
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
    key: 'course',
    title: 'EduCourse',
    prefix: 'COURSE',
    basePath: '/course',
    dir: path.join(__dirname, 'bots', 'course'),
    script: path.join(__dirname, 'bots', 'course', 'server.js'),
    port: Number(process.env.COURSE_INTERNAL_PORT || 4102),
    defaultDbName: 'educourse_platform'
  },
  {
    key: 'social',
    title: 'Garant Market',
    prefix: 'SOCIAL',
    basePath: '/social',
    dir: path.join(__dirname, 'bots', 'social'),
    script: path.join(__dirname, 'bots', 'social', 'server.js'),
    port: Number(process.env.SOCIAL_INTERNAL_PORT || 4103),
    defaultDbName: 'social_garant_market'
  }
];

const children = new Map();
let shuttingDown = false;

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
      const delay = Number(process.env.BOT_RESTART_DELAY_MS || 5000);
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
    app: 'multi-telegram-mini-app-runner',
    time: new Date().toISOString(),
    bots: bots.map((bot) => ({
      key: bot.key,
      title: bot.title,
      path: bot.basePath,
      internalPort: bot.port,
      running: children.has(bot.key),
      publicUrl: joinUrlPath(PUBLIC_ROOT_URL, bot.basePath, true)
    }))
  });
});


// Eski frontendlar ichida absolute `/api/...` fetch ishlatilgan bo‘lsa ham,
// Referer bo‘yicha kerakli ichki botga yo‘naltiramiz. Yangi botlarda relative `./api/...` ishlatiladi.
app.use(['/api', '/telegram'], (req, res, next) => {
  if (req.path === '/health' && req.baseUrl === '/api') return next();
  const bot = botFromReferer(req);
  if (!bot) return next();
  return proxyTo(bot, false)(req, res);
});

app.get('/', (_req, res) => {
  const rows = bots.map((bot) => `
    <a class="card" href="${bot.basePath}/">
      <b>${bot.title}</b>
      <span>${bot.basePath}/</span>
      <small>Admin: ${bot.basePath}/admin · Webhook: ${bot.basePath}/telegram/webhook</small>
    </a>`).join('');
  res.type('html').send(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Multi Bot Server</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f7f7fb;color:#161620}.wrap{max-width:820px;margin:0 auto;padding:24px}.grid{display:grid;gap:12px}.card{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #e6e6ef;border-radius:14px;padding:16px;box-shadow:0 10px 30px rgba(25,25,50,.06)}b{display:block;font-size:20px;margin-bottom:6px}span{display:block;color:#2563eb;font-weight:700;margin-bottom:6px}small{color:#666}</style></head><body><main class="wrap"><h1>Render Multi Bot Server</h1><p>Bitta Render server ichida alohida Telegram Mini App botlar ishlayapti.</p><div class="grid">${rows}</div></main></body></html>`);
});

for (const bot of bots) {
  // /giftgo va /giftgo/ ikkalasi ham ichki botning / sahifasiga tushadi.
  // 301/302 redirect qilmaymiz — Telegram WebView ichida ERR_TOO_MANY_REDIRECTS shu joydan ko‘p chiqadi.
  app.use(bot.basePath, proxyTo(bot));
}

function shutdown() {
  shuttingDown = true;
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(ROOT_PORT, HOST, () => {
  console.log(`Multi bot server listening on ${HOST}:${ROOT_PORT}`);
  for (const bot of bots) console.log(`${bot.title}: http://localhost:${ROOT_PORT}${bot.basePath}/ -> internal ${bot.port}`);
});
