'use strict';
// 💳 Avto to'lov (Hamyon API orqali kartaga tushgan pulni tekshirish).
// Bir xil summa muammosi: har bir hisob-fakturaga UNIKAL summa beriladi
// (masalan 25 000 o'rniga 25 037 so'm). Kutilayotgan (pending) hisoblar orasida
// bir xil summa bo'lmaydi, har bir tranzaksiya ID faqat bir marta ishlatiladi.

// Hamyon 5 daqiqada pul topmasa status=cancel yuboradi — hisob ham shuncha yashaydi.
const INVOICE_TTL_MIN = Number(process.env.PAY_INVOICE_TTL_MIN || 5);
const MAX_OFFSET = Number(process.env.PAY_UNIQUE_MAX_OFFSET || 999);

function pickUniqueAmount(base, usedAmounts, rand = Math.random) {
  const used = new Set(usedAmounts.map(Number));
  const start = 1 + Math.floor(rand() * MAX_OFFSET);
  for (let i = 0; i < MAX_OFFSET; i++) {
    const offset = ((start - 1 + i) % MAX_OFFSET) + 1;
    if (!used.has(base + offset)) return base + offset;
  }
  return null;
}

// Hamyon javobi formati hujjatsiz bo'lgani uchun moslashuvchan o'qiladi.
function extractTransactions(json) {
  const list = Array.isArray(json) ? json
    : [json?.data, json?.result, json?.transactions, json?.items, json?.payments, json?.data?.items, json?.data?.transactions].find(Array.isArray) || [];
  return list.map((t) => ({
    id: String(t.id ?? t.transaction_id ?? t.tx_id ?? t.payment_id ?? ''),
    amount: Math.round(Number(t.amount ?? t.sum ?? t.summa ?? t.price ?? 0)),
    at: new Date(t.created_at ?? t.date ?? t.time ?? t.paid_at ?? Date.now()),
    incoming: !/out|chiqim|debit|minus/i.test(String(t.type ?? t.direction ?? 'in'))
  })).filter((t) => t.id && t.amount > 0 && t.incoming);
}

// Webhook (PREPARE_URL / COMPLETE_URL) tanasidan kerakli maydonlarni moslashuvchan o'qiydi.
function parseWebhook(body = {}) {
  const b = typeof body === 'object' && body ? body : {};
  const d = b.data && typeof b.data === 'object' ? { ...b.data, ...b } : b;
  const status = String(d.status ?? d.state ?? '').toLowerCase();
  return {
    status: ['paid', 'success', 'completed', 'done'].includes(status) ? 'paid' : ['cancel', 'canceled', 'cancelled', 'expired', 'failed'].includes(status) ? 'cancel' : status,
    orderId: String(d.order_id ?? d.merchant_order_id ?? d.invoice_id ?? d.external_id ?? d.merchant_trans_id ?? d.comment ?? ''),
    paymentId: String(d.payment_id ?? d.id ?? d.transaction_id ?? d.tx_id ?? ''),
    amount: Math.round(Number(d.amount ?? d.sum ?? d.summa ?? 0)),
    shopId: String(d.shop_id ?? d.shopId ?? '')
  };
}

function createHamyonProvider(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.HAMYON_API_URL;
  const shopId = env.HAMYON_SHOP_ID;
  const shopKey = env.HAMYON_SHOP_KEY;
  if (!shopId || !shopKey) return null;
  return {
    name: 'hamyon',
    async createPayment(inv) {
      if (!env.HAMYON_CREATE_URL) return null;
      const res = await fetchImpl(env.HAMYON_CREATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ shop_id: shopId, shop_key: shopKey, amount: inv.amount, order_id: String(inv._id) })
      });
      if (!res.ok) throw new Error(`Hamyon to‘lov yaratish: ${res.status}`);
      const j = await res.json().catch(() => ({}));
      return String(j.payment_id ?? j.id ?? j.data?.payment_id ?? j.data?.id ?? '') || null;
    },
    async listIncoming() {
      if (!url) return [];
      const method = String(env.HAMYON_API_METHOD || 'POST').toUpperCase();
      const params = { shop_id: shopId, shop_key: shopKey };
      const target = method === 'GET' ? `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(params)}` : url;
      const res = await fetchImpl(target, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(params)
      });
      if (!res.ok) throw new Error(`Hamyon API ${res.status}`);
      return extractTransactions(await res.json());
    }
  };
}

function createAutoPay({ mongoose, provider, onPaid, logger = console }) {
  const schema = new mongoose.Schema({
    managed_bot_id: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
    owner_user_id: { type: Number, index: true },
    base_amount: Number,
    amount: { type: Number, index: true },
    currency: { type: String, default: 'UZS' },
    status: { type: String, enum: ['pending', 'paid', 'expired', 'cancelled'], default: 'pending', index: true },
    expires_at: Date,
    paid_at: Date,
    provider_tx_id: { type: String, default: null },
    provider_payment_id: { type: String, default: null, index: true }
  }, { timestamps: true, collection: 'factory_payment_invoices' });
  // Bir vaqtda ikki pending hisobda bir xil summa bo'lmaydi; bitta tranzaksiya ikki marta ishlatilmaydi.
  schema.index({ amount: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
  schema.index({ provider_tx_id: 1 }, { unique: true, partialFilterExpression: { provider_tx_id: { $type: 'string' } } });
  const Invoice = mongoose.models.FactoryPaymentInvoice || mongoose.model('FactoryPaymentInvoice', schema);

  async function expireOld() {
    await Invoice.updateMany({ status: 'pending', expires_at: { $lt: new Date() } }, { $set: { status: 'expired' } });
  }

  async function createInvoice(record, baseAmount, currency = 'UZS') {
    await expireOld();
    const existing = await Invoice.findOne({ managed_bot_id: record._id, status: 'pending' });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      const used = await Invoice.find({ status: 'pending' }).distinct('amount');
      const amount = pickUniqueAmount(Number(baseAmount), used);
      if (!amount) throw new Error('Hozir juda ko‘p kutilayotgan to‘lov bor, birozdan keyin urinib ko‘ring.');
      try {
        const inv = await Invoice.create({
          managed_bot_id: record._id, owner_user_id: record.owner_user_id, base_amount: Number(baseAmount), amount, currency,
          expires_at: new Date(Date.now() + INVOICE_TTL_MIN * 60000)
        });
        if (provider?.createPayment) {
          const pid = await provider.createPayment(inv).catch((e) => { logger.error('Hamyon createPayment xatosi:', e.message); return null; });
          if (pid) { inv.provider_payment_id = pid; await inv.save(); }
        }
        return inv;
      } catch (e) {
        if (e?.code !== 11000) throw e; // parallel so'rovda summa band bo'lsa — qayta tanlanadi
      }
    }
    throw new Error('Unikal summa tanlab bo‘lmadi, qayta urinib ko‘ring.');
  }

  async function markPaid(inv, txId) {
    const done = await Invoice.findOneAndUpdate(
      { _id: inv._id, status: { $in: ['pending', 'expired'] } },
      { $set: { status: 'paid', paid_at: new Date(), provider_tx_id: txId || `inv_${inv._id}` } },
      { new: true }
    ).catch((e) => { if (e?.code === 11000) return null; throw e; });
    if (done) await Promise.resolve(onPaid(done)).catch((e) => logger.error('AutoPay onPaid xatosi:', e.message));
    return done;
  }

  // Hamyon webhook: status=prepare | paid | cancel.
  async function handleWebhook(body, { shopId } = {}) {
    const w = parseWebhook(body);
    if (shopId && w.shopId && w.shopId !== String(shopId)) return { ok: false, error: 'shop_id mos emas' };
    let inv = null;
    if (/^[a-f0-9]{24}$/.test(w.orderId)) inv = await Invoice.findById(w.orderId);
    if (!inv && w.paymentId) inv = await Invoice.findOne({ provider_payment_id: w.paymentId });
    // ID bo'lmasa — unikal summa bo'yicha (pending orasida summa takrorlanmaydi).
    if (!inv && w.amount > 0) inv = await Invoice.findOne({ amount: w.amount, status: { $in: ['pending', 'expired'] } }).sort({ createdAt: -1 });
    if (!inv) return { ok: true, matched: false };
    if (w.amount > 0 && w.amount !== inv.amount) return { ok: false, error: 'summa mos emas' };
    if (w.status === 'paid') return { ok: true, matched: true, paid: Boolean(await markPaid(inv, w.paymentId || null)) };
    if (w.status === 'cancel') await Invoice.updateOne({ _id: inv._id, status: 'pending' }, { $set: { status: 'expired' } });
    return { ok: true, matched: true };
  }

  let running = false;
  async function checkPending() {
    if (!provider || running) return 0;
    running = true;
    try {
      await expireOld();
      const pending = await Invoice.find({ status: 'pending' }).lean();
      if (!pending.length) return 0;
      const txs = await provider.listIncoming();
      let paid = 0;
      for (const inv of pending) {
        const tx = txs.find((t) => t.amount === inv.amount && t.at >= new Date(new Date(inv.createdAt).getTime() - 60000));
        if (!tx) continue;
        // Atomik: faqat pending bo'lsa va tranzaksiya ID hali ishlatilmagan bo'lsa yopiladi.
        if (await markPaid(inv, tx.id)) paid++;
      }
      return paid;
    } catch (e) {
      logger.error('AutoPay tekshiruv xatosi:', e.message);
      return 0;
    } finally {
      running = false;
    }
  }

  function start(intervalMs = Number(process.env.PAY_CHECK_INTERVAL_MS || 20000)) {
    if (!provider) { logger.warn('⚠️ Avto to‘lov o‘chiq: HAMYON_SHOP_ID / HAMYON_SHOP_KEY berilmagan.'); return null; }
    if (!process.env.HAMYON_API_URL) return null; // webhook rejimi: polling kerak emas
    const timer = setInterval(checkPending, intervalMs);
    timer.unref?.();
    return timer;
  }

  return { Invoice, createInvoice, checkPending, handleWebhook, start, enabled: Boolean(provider) };
}

module.exports = { createAutoPay, createHamyonProvider, pickUniqueAmount, extractTransactions, parseWebhook, INVOICE_TTL_MIN };
