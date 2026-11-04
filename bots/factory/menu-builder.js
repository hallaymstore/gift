'use strict';
// 🧩 Menyu konstruktori: bot egasi foydalanuvchi menyusidagi tugmalarni
// joylashtiradi, o'rnini almashtiradi, nomini o'zgartiradi (default saqlanadi),
// yangi tugma qo'shib unga funksiya biriktiradi, yashiradi, o'chiradi va saqlaydi.

const MAX_LABEL = 40;
const MAX_PER_ROW = 4;
const MAX_BUTTONS = 24;
const ACTION_TYPES = ['builtin', 'text', 'url', 'code'];
const REGISTRY = new Map();
const getMenuRuntime = (botKey) => REGISTRY.get(botKey) || null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextId(layout) {
  let max = 0;
  for (const row of layout.rows) for (const b of row) max = Math.max(max, Number(String(b.id).slice(1)) || 0);
  return `b${max + 1}`;
}

function allButtons(layout) {
  return layout.rows.flat();
}

function buildDefaultLayout(defaultRows, builtins) {
  const layout = { v: 1, rows: [] };
  for (const row of defaultRows || []) {
    const out = [];
    for (const key of row) {
      if (!builtins[key]) continue;
      out.push({ id: nextId({ rows: [...layout.rows, out] }), label: '', action: { type: 'builtin', key } });
    }
    if (out.length) layout.rows.push(out);
  }
  return layout;
}

function validAction(action, builtins) {
  if (!action || !ACTION_TYPES.includes(action.type)) return false;
  if (action.type === 'builtin') return Boolean(builtins[action.key]);
  if (action.type === 'url') return /^https?:\/\/\S+$/i.test(String(action.url || ''));
  if (action.type === 'text') return Boolean(String(action.text || '').trim());
  if (action.type === 'code') return Boolean(String(action.code || '').trim());
  return false;
}

function normalizeLayout(raw, defaultRows, builtins) {
  if (!raw || !Array.isArray(raw.rows)) return buildDefaultLayout(defaultRows, builtins);
  const seen = new Set();
  const rows = [];
  for (const row of raw.rows) {
    if (!Array.isArray(row)) continue;
    const out = [];
    for (const b of row) {
      if (!b || !b.id || seen.has(b.id) || !validAction(b.action, builtins)) continue;
      seen.add(b.id);
      out.push({ id: String(b.id), label: String(b.label || '').slice(0, MAX_LABEL), action: clone(b.action), hidden: Boolean(b.hidden) });
    }
    if (out.length) rows.push(out);
  }
  return rows.length ? { v: 1, rows } : buildDefaultLayout(defaultRows, builtins);
}

function labelOf(btn, builtins) {
  if (btn.label) return btn.label;
  if (btn.action?.type === 'builtin') return builtins[btn.action.key] || btn.action.key;
  return btn.id;
}

function renderRows(layout, builtins) {
  return layout.rows
    .map((row) => row.filter((b) => !b.hidden).map((b) => labelOf(b, builtins)))
    .filter((row) => row.length);
}

function findButton(layout, id) {
  for (let r = 0; r < layout.rows.length; r++) {
    const c = layout.rows[r].findIndex((b) => b.id === id);
    if (c >= 0) return { r, c, btn: layout.rows[r][c] };
  }
  return null;
}

// Foydalanuvchi bosgan matnni tugma harakatiga aylantiradi.
function resolveText(layout, builtins, text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const btn = allButtons(layout).find((b) => !b.hidden && labelOf(b, builtins) === value);
  if (!btn) return null;
  const a = btn.action;
  if (a.type === 'builtin') return { type: 'builtin', canonical: builtins[a.key], key: a.key };
  return clone(a);
}

function checkLabel(layout, builtins, label, { exceptId = null, reserved = [] } = {}) {
  const value = String(label || '').trim();
  if (!value) return 'Nom bo‘sh bo‘lmasin.';
  if (value.length > MAX_LABEL) return `Nom ${MAX_LABEL} belgidan oshmasin.`;
  if (value.startsWith('/')) return 'Nom “/” bilan boshlanmasin.';
  if (reserved.includes(value)) return 'Bu nom admin tugmasi bilan bir xil. Boshqa nom tanlang.';
  const clash = allButtons(layout).find((b) => b.id !== exceptId && labelOf(b, builtins) === value);
  if (clash) return 'Bunday nomli tugma allaqachon bor.';
  return null;
}

function renameButton(layout, builtins, id, label, opts = {}) {
  const hit = findButton(layout, id);
  if (!hit) return { error: 'Tugma topilmadi.' };
  const err = checkLabel(layout, builtins, label, { ...opts, exceptId: id });
  if (err) return { error: err };
  const next = clone(layout);
  next.rows[hit.r][hit.c].label = String(label).trim();
  return { layout: next };
}

function resetLabel(layout, id) {
  const hit = findButton(layout, id);
  if (!hit) return { error: 'Tugma topilmadi.' };
  if (hit.btn.action.type !== 'builtin') return { error: 'Faqat standart tugmalarning default nomi bor.' };
  const next = clone(layout);
  next.rows[hit.r][hit.c].label = '';
  return { layout: next };
}

function moveButton(layout, id, dir) {
  const hit = findButton(layout, id);
  if (!hit) return { error: 'Tugma topilmadi.' };
  const next = clone(layout);
  const row = next.rows[hit.r];
  if (dir === 'left' || dir === 'right') {
    const to = hit.c + (dir === 'left' ? -1 : 1);
    if (to < 0 || to >= row.length) return { layout: next };
    [row[hit.c], row[to]] = [row[to], row[hit.c]];
    return { layout: next };
  }
  if (dir !== 'up' && dir !== 'down') return { error: 'Noto‘g‘ri yo‘nalish.' };
  const [btn] = row.splice(hit.c, 1);
  let to = hit.r + (dir === 'up' ? -1 : 1);
  if (to < 0 || to >= next.rows.length || next.rows[to].length >= MAX_PER_ROW) {
    // Chegarada yoki qator to'la bo'lsa — alohida yangi qatorga chiqariladi.
    if (!row.length) { row.push(btn); return { layout: next }; }
    to = dir === 'up' ? Math.max(hit.r, 0) : hit.r + 1;
    next.rows.splice(to, 0, [btn]);
  } else {
    next.rows[to].push(btn);
  }
  next.rows = next.rows.filter((r) => r.length);
  return { layout: next };
}

function addButton(layout, builtins, { label, action }, opts = {}) {
  if (allButtons(layout).length >= MAX_BUTTONS) return { error: `Ko‘pi bilan ${MAX_BUTTONS} ta tugma.` };
  const err = checkLabel(layout, builtins, label, opts);
  if (err) return { error: err };
  const act = action || { type: 'text', text: 'ℹ️ Bu tugmaga hali funksiya biriktirilmagan.' };
  if (!validAction(act, builtins)) return { error: 'Funksiya noto‘g‘ri.' };
  const next = clone(layout);
  const id = nextId(next);
  next.rows.push([{ id, label: String(label).trim(), action: clone(act), hidden: false }]);
  return { layout: next, id };
}

function setAction(layout, builtins, id, action) {
  const hit = findButton(layout, id);
  if (!hit) return { error: 'Tugma topilmadi.' };
  if (!validAction(action, builtins)) return { error: 'Funksiya noto‘g‘ri: havola http(s):// bilan boshlansin, matn/kod bo‘sh bo‘lmasin.' };
  const next = clone(layout);
  const btn = next.rows[hit.r][hit.c];
  // Standart tugma boshqa funksiyaga o'tsa, ko'rinadigan nomi saqlanib qoladi.
  if (!btn.label) btn.label = labelOf(hit.btn, builtins);
  btn.action = clone(action);
  return { layout: next };
}

function toggleHidden(layout, id) {
  const hit = findButton(layout, id);
  if (!hit) return { error: 'Tugma topilmadi.' };
  const next = clone(layout);
  next.rows[hit.r][hit.c].hidden = !hit.btn.hidden;
  return { layout: next };
}

function removeButton(layout, id) {
  const hit = findButton(layout, id);
  if (!hit) return { error: 'Tugma topilmadi.' };
  const next = clone(layout);
  next.rows[hit.r].splice(hit.c, 1);
  next.rows = next.rows.filter((r) => r.length);
  return { layout: next };
}

function describeAction(action, builtins) {
  if (action.type === 'builtin') return `standart: ${builtins[action.key] || action.key}`;
  if (action.type === 'text') return `💬 matn javob`;
  if (action.type === 'url') return `🌐 havola: ${action.url}`;
  if (action.type === 'code') return `🎬 kontent kodi: ${action.code}`;
  return action.type;
}

// =========================
// Telegraf integratsiyasi
// =========================
function attachMenuBuilder(bot, options) {
  const { Markup, botKey, getBuiltins, defaultRows, isAdmin, load, save } = options;
  const reserved = () => (typeof options.reservedLabels === 'function' ? options.reservedLabels() : []);
  const openLabel = options.openLabel || '🧩 Menyu konstruktor';
  let cache = null;
  let loading = null;

  async function ensureLoaded() {
    if (cache) return cache;
    if (!loading) {
      loading = Promise.resolve(load(botKey))
        .then((raw) => { cache = normalizeLayout(raw, defaultRows, getBuiltins()); return cache; })
        .catch(() => { cache = buildDefaultLayout(defaultRows, getBuiltins()); return cache; })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function current() {
    return cache || buildDefaultLayout(defaultRows, getBuiltins());
  }

  function keyboardRows() {
    const rows = renderRows(current(), getBuiltins());
    return rows.length ? rows : renderRows(buildDefaultLayout(defaultRows, getBuiltins()), getBuiltins());
  }

  function draftOf(ctx) {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.mbDraft) ctx.session.mbDraft = clone(current());
    return ctx.session.mbDraft;
  }

  function editorView(ctx, notice = '') {
    const b = getBuiltins();
    const draft = draftOf(ctx);
    const rows = draft.rows.map((row) => row.map((btn) =>
      Markup.button.callback(`${btn.hidden ? '🙈 ' : ''}${labelOf(btn, b)}`.slice(0, 60), `mb:sel:${btn.id}`)));
    rows.push([Markup.button.callback('➕ Tugma qo‘shish', 'mb:add'), Markup.button.callback('👁 Ko‘rish', 'mb:preview')]);
    rows.push([Markup.button.callback('💾 Saqlash', 'mb:save'), Markup.button.callback('♻️ Default', 'mb:reset')]);
    rows.push([Markup.button.callback('❌ Bekor qilish', 'mb:cancel')]);
    const text = `🧩 Menyu konstruktor\n\nTugmani tanlang — o‘rnini almashtirish, nomini o‘zgartirish, funksiya biriktirish yoki o‘chirish mumkin.\n🙈 — yashirilgan tugma.\n\n⚠️ O‘zgarishlar “💾 Saqlash” bosilgandan keyin foydalanuvchilarga ko‘rinadi.${notice ? `\n\n${notice}` : ''}`;
    return { text, extra: Markup.inlineKeyboard(rows) };
  }

  function buttonView(ctx, id, notice = '') {
    const b = getBuiltins();
    const hit = findButton(draftOf(ctx), id);
    if (!hit) return editorView(ctx, '❌ Tugma topilmadi.');
    const btn = hit.btn;
    const rows = [
      [Markup.button.callback('⬆️', `mb:mv:${id}:up`), Markup.button.callback('⬇️', `mb:mv:${id}:down`), Markup.button.callback('⬅️', `mb:mv:${id}:left`), Markup.button.callback('➡️', `mb:mv:${id}:right`)],
      [Markup.button.callback('✏️ Nomini o‘zgartirish', `mb:ren:${id}`), Markup.button.callback('↩️ Default nom', `mb:def:${id}`)],
      [Markup.button.callback('🔗 Funksiya biriktirish', `mb:act:${id}`), Markup.button.callback(btn.hidden ? '👁 Ko‘rsatish' : '🙈 Yashirish', `mb:hide:${id}`)],
      [Markup.button.callback('🗑 O‘chirish', `mb:del:${id}`), Markup.button.callback('⬅️ Orqaga', 'mb:home')]
    ];
    const defLine = btn.action.type === 'builtin' ? `\n↩️ Default nom: ${b[btn.action.key]}` : '';
    const text = `🔘 ${labelOf(btn, b)}\n📍 Joyi: ${hit.r + 1}-qator, ${hit.c + 1}-ustun\n⚙️ Funksiya: ${describeAction(btn.action, b)}${defLine}${btn.hidden ? '\n🙈 Yashirilgan' : ''}${notice ? `\n\n${notice}` : ''}`;
    return { text, extra: Markup.inlineKeyboard(rows) };
  }

  function actionView(ctx, id) {
    const b = getBuiltins();
    const rows = Object.entries(b).map(([key, label]) => [Markup.button.callback(`⚙️ ${label}`, `mb:set:${id}:${key}`)]);
    rows.push([Markup.button.callback('💬 Matn javob', `mb:in:${id}:text`), Markup.button.callback('🌐 Havola', `mb:in:${id}:url`)]);
    rows.push([Markup.button.callback('🎬 Kontent kodi', `mb:in:${id}:code`), Markup.button.callback('⬅️ Orqaga', `mb:sel:${id}`)]);
    return { text: '🔗 Tugmaga qaysi funksiya biriktirilsin?\n\n⚙️ — botning standart funksiyalari\n💬 — bosilganda sizning matningiz yuboriladi\n🌐 — havola tugmasi chiqadi\n🎬 — kod bo‘yicha kontent (kino/serial) ochiladi', extra: Markup.inlineKeyboard(rows) };
  }

  async function show(ctx, view) {
    if (ctx.callbackQuery) {
      try { return await ctx.editMessageText(view.text, view.extra); } catch (e) {
        if (String(e?.description || e?.message || '').includes('not modified')) return null;
      }
    }
    return ctx.reply(view.text, view.extra);
  }

  function apply(ctx, result) {
    if (result.error) return result.error;
    ctx.session.mbDraft = result.layout;
    return '';
  }

  async function openEditor(ctx) {
    if (!isAdmin(ctx)) return null;
    await ensureLoaded();
    ctx.session.mbDraft = clone(current());
    ctx.session.mbWait = null;
    return show(ctx, editorView(ctx));
  }

  // 1) Matnli tugmalarni marshrutlash (hears'dan oldin ishlaydi).
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (typeof text !== 'string') return next();
    await ensureLoaded();

    const wait = ctx.session?.mbWait;
    if (wait && text.startsWith('/cancel')) ctx.session.mbWait = null;
    if (wait && isAdmin(ctx) && !text.startsWith('/')) {
      ctx.session.mbWait = null;
      const b = getBuiltins();
      const draft = draftOf(ctx);
      const opts = { reserved: reserved() };
      let err = '';
      if (wait.kind === 'rename') err = apply(ctx, renameButton(draft, b, wait.id, text, opts));
      else if (wait.kind === 'add') {
        const res = addButton(draft, b, { label: text }, opts);
        err = apply(ctx, res);
        if (!err) return show(ctx, buttonView(ctx, res.id, '✅ Tugma qo‘shildi. Endi “🔗 Funksiya biriktirish” orqali vazifa bering.'));
      } else {
        const action = wait.kind === 'url' ? { type: 'url', url: text.trim() } : wait.kind === 'code' ? { type: 'code', code: text.trim() } : { type: 'text', text };
        err = apply(ctx, setAction(draft, b, wait.id, action));
      }
      if (err) { ctx.session.mbWait = wait; return ctx.reply(`❌ ${err}\nQayta yuboring yoki /cancel.`); }
      return show(ctx, wait.id ? buttonView(ctx, wait.id, '✅ Saqlandi (qoralama).') : editorView(ctx));
    }

    if (text === openLabel && isAdmin(ctx)) return openEditor(ctx);

    const hit = resolveText(current(), getBuiltins(), text);
    if (!hit) return next();
    if (hit.type === 'builtin' || hit.type === 'code') {
      ctx.message.text = hit.type === 'builtin' ? hit.canonical : hit.code;
      return next();
    }
    if (hit.type === 'url') return ctx.reply('🌐 Havolani ochish:', Markup.inlineKeyboard([[Markup.button.url('↗️ Ochish', hit.url)]]));
    return ctx.reply(hit.text);
  });

  bot.command('menu', openEditor);

  // 2) Inline tahrirlovchi.
  bot.action(/^mb:([a-z]+)(?::([a-z0-9]+))?(?::([a-z0-9_]+))?$/i, async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);
    if (!isAdmin(ctx)) return null;
    await ensureLoaded();
    const [, op, id, arg] = ctx.match;
    const b = getBuiltins();
    const draft = draftOf(ctx);

    if (op === 'home') return show(ctx, editorView(ctx));
    if (op === 'sel') return show(ctx, buttonView(ctx, id));
    if (op === 'mv') { const err = apply(ctx, moveButton(draft, id, arg)); return show(ctx, buttonView(ctx, id, err && `❌ ${err}`)); }
    if (op === 'def') { const err = apply(ctx, resetLabel(draft, id)); return show(ctx, buttonView(ctx, id, err ? `❌ ${err}` : '↩️ Default nom qaytarildi.')); }
    if (op === 'hide') { const err = apply(ctx, toggleHidden(draft, id)); return show(ctx, buttonView(ctx, id, err && `❌ ${err}`)); }
    if (op === 'del') { const err = apply(ctx, removeButton(draft, id)); return show(ctx, editorView(ctx, err ? `❌ ${err}` : '🗑 Tugma o‘chirildi. (♻️ Default bilan qaytarish mumkin)')); }
    if (op === 'act') return show(ctx, actionView(ctx, id));
    if (op === 'set') { const err = apply(ctx, setAction(draft, b, id, { type: 'builtin', key: arg })); return show(ctx, buttonView(ctx, id, err ? `❌ ${err}` : '✅ Funksiya biriktirildi.')); }
    if (op === 'ren' || op === 'in' || op === 'add') {
      const kind = op === 'ren' ? 'rename' : op === 'add' ? 'add' : arg;
      ctx.session.mbWait = { kind, id: op === 'add' ? null : id };
      const prompts = { rename: '✏️ Tugmaning yangi nomini yuboring:', add: '➕ Yangi tugma nomini yuboring (masalan: 📞 Admin bilan aloqa):', text: '💬 Tugma bosilganda yuboriladigan matnni yuboring:', url: '🌐 Havolani yuboring (https://...):', code: '🎬 Kontent kodini yuboring (masalan: avatar):' };
      return ctx.reply(`${prompts[kind] || prompts.text}\n\n❌ Bekor qilish: /cancel`);
    }
    if (op === 'preview') {
      return ctx.reply('👁 Qoralama menyu shunday ko‘rinadi (saqlanmagan):', Markup.keyboard(renderRows(draft, b)).resize());
    }
    if (op === 'reset') { ctx.session.mbDraft = buildDefaultLayout(defaultRows, b); return show(ctx, editorView(ctx, '♻️ Default menyu tiklandi. Saqlash uchun “💾 Saqlash”ni bosing.')); }
    if (op === 'cancel') { ctx.session.mbDraft = null; ctx.session.mbWait = null; return show(ctx, { text: '❌ O‘zgarishlar bekor qilindi.', extra: undefined }); }
    if (op === 'save') {
      const layout = normalizeLayout(draft, defaultRows, b);
      await save(botKey, layout);
      cache = layout;
      ctx.session.mbDraft = null;
      await show(ctx, { text: '💾 Menyu saqlandi va foydalanuvchilarga qo‘llandi.', extra: undefined });
      if (typeof options.afterSave === 'function') return options.afterSave(ctx);
      return null;
    }
    return null;
  });

  const runtime = {
    keyboardRows, openEditor, ensureLoaded, openLabel,
    builtins: () => getBuiltins(),
    defaultLayout: () => buildDefaultLayout(defaultRows, getBuiltins()),
    current: async () => clone(await ensureLoaded()),
    reserved,
    async apply(raw) {
      const layout = normalizeLayout(raw, defaultRows, getBuiltins());
      await save(botKey, layout);
      cache = layout;
      return layout;
    }
  };
  REGISTRY.set(botKey, runtime);
  return runtime;
}

module.exports = {
  MAX_LABEL,
  MAX_PER_ROW,
  MAX_BUTTONS,
  buildDefaultLayout,
  normalizeLayout,
  renderRows,
  resolveText,
  labelOf,
  findButton,
  renameButton,
  resetLabel,
  moveButton,
  addButton,
  setAction,
  toggleHidden,
  removeButton,
  attachMenuBuilder,
  getMenuRuntime
};
