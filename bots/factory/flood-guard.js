'use strict';
// 🛡 Flood guard: barcha botlar uchun Telegram 429 (Too Many Requests) himoyasi.
// - send*/copy*/forward* chaqiruvlari har bir bot bo'yicha sekundiga ~25 tadan oshmaydi;
// - 429 kelsa retry_after kutiladi va so'rov qayta yuboriladi (ko'pi bilan 3 marta).

const SEND_RE = /^(send|copy|forward)/;
const DEFAULT_RATE = Number(process.env.TELEGRAM_SEND_RATE || 25);
const MAX_RETRIES = 3;
const MAX_WAIT_SEC = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryAfterSec(error) {
  const code = error?.code || error?.response?.error_code;
  if (Number(code) !== 429) return 0;
  const sec = Number(error?.parameters?.retry_after || error?.response?.parameters?.retry_after || 1);
  return Math.min(Math.max(sec, 1), MAX_WAIT_SEC);
}

// Har bir Telegram instansiyasi uchun navbatli slot (token bucket o'rniga oddiy interval).
function createLimiter(rate = DEFAULT_RATE, now = Date.now, wait = sleep) {
  const interval = 1000 / Math.max(rate, 1);
  let nextAt = 0;
  return async function take() {
    const t = now();
    const at = Math.max(t, nextAt);
    nextAt = at + interval;
    if (at > t) await wait(at - t);
  };
}

async function callWithRetry(fn, { wait = sleep, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const sec = retryAfterSec(error);
      if (!sec || attempt >= MAX_RETRIES) throw error;
      if (onRetry) onRetry(sec, attempt + 1);
      await wait(sec * 1000);
    }
  }
}

function installFloodGuard(TelegramClass, opts = {}) {
  const proto = TelegramClass?.prototype;
  if (!proto || proto.__floodGuard) return false;
  const original = proto.callApi;
  const limiters = new WeakMap();
  proto.callApi = function guardedCallApi(method, ...rest) {
    if (!SEND_RE.test(String(method))) return original.call(this, method, ...rest);
    let take = limiters.get(this);
    if (!take) { take = createLimiter(opts.rate); limiters.set(this, take); }
    return callWithRetry(async () => { await take(); return original.call(this, method, ...rest); }, {
      onRetry: (sec, n) => console.warn(`⏳ Telegram 429: ${method} ${sec}s kutilmoqda (urinish ${n}/${MAX_RETRIES})`)
    });
  };
  proto.__floodGuard = true;
  return true;
}

module.exports = { installFloodGuard, createLimiter, callWithRetry, retryAfterSec };
