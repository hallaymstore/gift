'use strict';
// 🌐 Har bir bot uchun alohida veb panel (Telegram Mini App sifatida ham ochiladi).
// Kirish: bot ichida /panel — admin uchun 24 soatlik imzolangan havola beriladi.
// Panelda: statistika + foydalanuvchi menyusi konstruktori (nom, joy, funksiya, yashirish, o'chirish).
const crypto = require('crypto');
const { getMenuRuntime, normalizeLayout, renderRows } = require('./menu-builder');

const TTL_SEC = 24 * 3600;

function sign(secret, botKey, exp) {
  return crypto.createHmac('sha256', String(secret)).update(`${botKey}.${exp}`).digest('base64url');
}

function panelLink(baseUrl, secret, botKey, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL_SEC;
  return `${String(baseUrl).replace(/\/+$/, '')}/panel/${encodeURIComponent(botKey)}?exp=${exp}&sig=${sign(secret, botKey, exp)}`;
}

function verify(secret, botKey, exp, sig, now = Date.now()) {
  if (!secret || !exp || !sig || Number(exp) < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(sign(secret, botKey, exp));
  const got = Buffer.from(String(sig));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

function mountWebPanel(app, { secret, getStats, getTitle }) {
  const guard = (req, res, next) => {
    const { exp, sig } = { ...req.query, ...(req.body?.auth || {}) };
    if (!verify(secret, req.params.botKey, exp, sig)) return res.status(403).send('⛔ Havola eskirgan yoki noto‘g‘ri. Botda /panel buyrug‘ini qayta yuboring.');
    return next();
  };

  app.get('/panel/:botKey', guard, (_req, res) => res.type('html').send(PAGE));

  app.get('/panel/:botKey/api', guard, async (req, res) => {
    const rt = getMenuRuntime(req.params.botKey);
    const stats = await Promise.resolve(getStats(req.params.botKey)).catch(() => ({}));
    res.json({
      title: (getTitle && getTitle(req.params.botKey)) || req.params.botKey,
      stats,
      menu: rt ? { builtins: rt.builtins(), layout: await rt.current(), defaults: rt.defaultLayout() } : null
    });
  });

  app.post('/panel/:botKey/api/menu', guard, async (req, res) => {
    const rt = getMenuRuntime(req.params.botKey);
    if (!rt) return res.status(404).json({ error: 'Bu bot turida menyu konstruktori yo‘q.' });
    const builtins = rt.builtins();
    const layout = normalizeLayout(req.body?.layout, [], builtins);
    const labels = renderRows(layout, builtins).flat();
    const reserved = rt.reserved();
    if (new Set(labels).size !== labels.length) return res.status(400).json({ error: 'Tugma nomlari takrorlanmasin.' });
    if (labels.some((l) => !l.trim() || l.length > 40 || l.startsWith('/') || reserved.includes(l))) return res.status(400).json({ error: 'Nom bo‘sh, 40 belgidan uzun, “/” bilan boshlangan yoki admin tugmasi bilan bir xil.' });
    res.json({ ok: true, layout: await rt.apply(layout) });
  });
}

const PAGE = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot panel</title><script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:#f5f6f8;--card:#fff;--fg:#1c1f24;--mut:#6b7280;--acc:#2f7cf6;--bd:#e3e6ea;--bad:#d64545}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1c1f24;--fg:#eceff3;--mut:#9aa3ad;--bd:#2c3138;--acc:#5b9bff}}
body{margin:0;background:var(--tg-theme-bg-color,var(--bg));color:var(--tg-theme-text-color,var(--fg));font:15px/1.45 system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}h1{font-size:20px;margin:4px 0 14px}h2{font-size:16px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}.stat b{display:block;font-size:20px}.stat span{color:var(--mut);font-size:13px}
.row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;padding:6px;border:1px dashed var(--bd);border-radius:10px}
.btn{border:1px solid var(--bd);background:var(--bg);color:inherit;border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit}
.btn.sel{outline:2px solid var(--acc)}.btn.hid{opacity:.45}.pri{background:var(--acc);color:#fff;border-color:var(--acc)}
.tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}input,select{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:inherit;font:inherit;margin:4px 0}
.mut{color:var(--mut);font-size:13px}.err{color:var(--bad)}
</style></head><body><main>
<h1 id="title">Bot panel</h1>
<section class="card"><h2>📊 Statistika</h2><div class="stats" id="stats"></div></section>
<section class="card" id="menuCard"><h2>🧩 Foydalanuvchi menyusi</h2>
<p class="mut">Tugmani tanlang: o‘rnini almashtiring, nomini o‘zgartiring, funksiya biriktiring. Bo‘sh nom = default nom.</p>
<div id="rows"></div><div id="editor"></div>
<div class="tools"><button class="btn" id="add">➕ Tugma</button><button class="btn" id="reset">♻️ Default</button><button class="btn pri" id="save">💾 Saqlash</button></div>
<p id="msg" class="mut"></p></section>
</main><script>
const tg=window.Telegram&&Telegram.WebApp;if(tg){tg.ready();tg.expand();}
const q=location.search;const base=location.pathname.replace(/\\/$/,'');
let B={},L={rows:[]},D=null,sel=null;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lab=b=>b.label||(b.action.type==='builtin'?B[b.action.key]:b.id);
const names={users:'Foydalanuvchilar',activeUsers:'Aktiv',blockedUsers:'Bloklagan',contents:'Kontentlar',parts:'Qismlar',withParts:'Qismli kontent',subscriptions:'Majburiy obunalar'};
function find(id){for(let r=0;r<L.rows.length;r++){const c=L.rows[r].findIndex(b=>b.id===id);if(c>=0)return{r,c}}return null}
function draw(){
  const rows=document.getElementById('rows');rows.innerHTML='';
  L.rows.forEach(row=>{const d=document.createElement('div');d.className='row';row.forEach(b=>{const e=document.createElement('button');e.className='btn'+(b.id===sel?' sel':'')+(b.hidden?' hid':'');e.textContent=lab(b);e.onclick=()=>{sel=b.id;draw()};d.appendChild(e)});rows.appendChild(d)});
  const ed=document.getElementById('editor');const h=sel&&find(sel);if(!h){ed.innerHTML='';return}
  const b=L.rows[h.r][h.c];const a=b.action;
  ed.innerHTML='<div class="card"><div class="tools"><button class="btn" data-m="up">⬆️</button><button class="btn" data-m="down">⬇️</button><button class="btn" data-m="left">⬅️</button><button class="btn" data-m="right">➡️</button><button class="btn" id="hide">'+(b.hidden?'👁 Ko‘rsatish':'🙈 Yashirish')+'</button><button class="btn" id="del">🗑 O‘chirish</button></div>'+
  '<label class="mut">Nomi'+(a.type==='builtin'?' (default: '+esc(B[a.key])+')':'')+'</label><input id="name" maxlength="40" value="'+esc(b.label)+'">'+
  '<label class="mut">Funksiya</label><select id="atype">'+Object.entries(B).map(([k,v])=>'<option value="b:'+k+'"'+(a.type==='builtin'&&a.key===k?' selected':'')+'>⚙️ '+esc(v)+'</option>').join('')+
  '<option value="text"'+(a.type==='text'?' selected':'')+'>💬 Matn javob</option><option value="url"'+(a.type==='url'?' selected':'')+'>🌐 Havola</option><option value="code"'+(a.type==='code'?' selected':'')+'>🎬 Kontent kodi</option></select>'+
  '<input id="aval" placeholder="Matn / https://... / kod" value="'+esc(a.text||a.url||a.code||'')+'"></div>';
  ed.querySelectorAll('[data-m]').forEach(x=>x.onclick=()=>move(x.dataset.m));
  ed.querySelector('#hide').onclick=()=>{b.hidden=!b.hidden;draw()};
  ed.querySelector('#del').onclick=()=>{L.rows[h.r].splice(h.c,1);L.rows=L.rows.filter(r=>r.length);sel=null;draw()};
  ed.querySelector('#name').oninput=e=>{b.label=e.target.value.trim();drawRowsOnly()};
  const upd=()=>{const t=ed.querySelector('#atype').value,v=ed.querySelector('#aval').value.trim();
    if(t.startsWith('b:')){if(a.type!=='builtin'&&!b.label)b.label=lab(b);b.action={type:'builtin',key:t.slice(2)}}
    else{if(!b.label)b.label=lab(b);b.action=t==='url'?{type:'url',url:v}:t==='code'?{type:'code',code:v}:{type:'text',text:v||'ℹ️'}}};
  ed.querySelector('#atype').onchange=()=>{upd();draw()};ed.querySelector('#aval').onchange=upd;
}
function drawRowsOnly(){const s=sel;draw();sel=s}
function move(dir){const h=find(sel);if(!h)return;const row=L.rows[h.r];
  if(dir==='left'||dir==='right'){const t=h.c+(dir==='left'?-1:1);if(t>=0&&t<row.length)[row[h.c],row[t]]=[row[t],row[h.c]]}
  else{const[b]=row.splice(h.c,1);const t=h.r+(dir==='up'?-1:1);if(t>=0&&t<L.rows.length&&L.rows[t].length<4)L.rows[t].push(b);else L.rows.splice(dir==='up'?h.r:h.r+1,0,[b]);L.rows=L.rows.filter(r=>r.length)}
  draw()}
document.getElementById('add').onclick=()=>{let m=0;L.rows.flat().forEach(b=>m=Math.max(m,+b.id.slice(1)||0));const id='b'+(m+1);L.rows.push([{id,label:'🆕 Yangi tugma',action:{type:'text',text:'ℹ️ Matnni paneldan o‘zgartiring.'}}]);sel=id;draw()};
document.getElementById('reset').onclick=()=>{L=JSON.parse(JSON.stringify(D));sel=null;draw();say('♻️ Default tiklandi — saqlashni unutmang.')};
document.getElementById('save').onclick=async()=>{const r=await fetch(base+'/api/menu'+q,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout:L})});const j=await r.json().catch(()=>({error:'Server javobi xato'}));
  if(j.ok){L=j.layout;draw();say('💾 Saqlandi! Foydalanuvchilar /start yoki 🏠 Bosh menyu bosganda yangi menyuni ko‘radi.')}else say('❌ '+(j.error||'Xato'),1)};
function say(t,bad){const m=document.getElementById('msg');m.textContent=t;m.className=bad?'err':'mut'}
fetch(base+'/api'+q).then(r=>r.ok?r.json():Promise.reject(r)).then(d=>{
  document.getElementById('title').textContent='⚙️ '+d.title;
  document.getElementById('stats').innerHTML=Object.entries(d.stats||{}).filter(([k,v])=>typeof v==='number'&&names[k]).map(([k,v])=>'<div class="stat"><b>'+v+'</b><span>'+names[k]+'</span></div>').join('')||'<span class="mut">Statistika yo‘q</span>';
  if(!d.menu){document.getElementById('menuCard').style.display='none';return}
  B=d.menu.builtins;L=d.menu.layout;D=d.menu.defaults;draw()}).catch(()=>say('⛔ Havola eskirgan. Botda /panel yuboring.',1));
</script></body></html>`;

module.exports = { mountWebPanel, panelLink, verify, sign };
