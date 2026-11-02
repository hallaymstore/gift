'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {contactUsername,adFooter,buildClonePostText,refreshClonePostText}=require('./channel-clone-branding');

const cfg={target_username:'Kino_Channel',promo_bot_username:'y808bot',promo_admin_username:'ads_admin_uz'};

test('contact accepts Telegram usernames and t.me links only',()=>{
  assert.equal(contactUsername('@ads_admin_uz'),'ads_admin_uz');
  assert.equal(contactUsername('https://t.me/ads_admin_uz'),'ads_admin_uz');
  assert.equal(contactUsername('ads_admin_uz'),'ads_admin_uz');
  assert.equal(contactUsername('https://example.com/ads_admin_uz'),'');
  assert.equal(contactUsername('abc'),'');
});

test('every branded channel route gets its own contact, bot and channel',()=>{
  assert.equal(adFooter(cfg),'🤖 Botimiz: @y808bot\n📢 Kanalimiz: @Kino_Channel\n📩 Reklama uchun: @ads_admin_uz');
  assert.equal(adFooter({...cfg,promo_admin_username:''}).includes('Reklama uchun'),false);
});

test('cloned text removes old source promotion and adds new route footer',()=>{
  const result=buildClonePostText('Yangi kino!\n\nManba: @oldadmin\nhttps://t.me/Oldchannel\n🔥',cfg,4096);
  assert.ok(result.startsWith('Yangi kino!'));
  assert.ok(!result.includes('@oldadmin'));
  assert.ok(result.endsWith('📩 Reklama uchun: @ads_admin_uz'));
});

test('text can use 4096 chars and caption is kept <=1024 with entire footer',()=>{
  const text=buildClonePostText('A'.repeat(5000),cfg,4096);
  const caption=buildClonePostText('🧡'.repeat(1200),cfg,1024);
  assert.ok(text.length<=4096);
  assert.ok(caption.length<=1024);
  assert.ok(text.endsWith('@ads_admin_uz'));
  assert.ok(caption.endsWith('@ads_admin_uz'));
  assert.ok(!/[\uD800-\uDBFF]$/.test(caption.split('\n')[0]));
});

test('repair replaces old footer without multiplying advertisements',()=>{
  const post='Yangi mahsulot\n\n🤖 Botimiz: @oldbot\n📢 Kanalimiz: @oldchannel\n📩 Reklama uchun: @oldadmin';
  const first=refreshClonePostText(post,cfg);
  assert.equal(first,'Yangi mahsulot\n\n'+adFooter(cfg));
  assert.equal(refreshClonePostText(first,cfg),first);
});

test('repair can add ad contact to posts that have no footer',()=>{
  const result=refreshClonePostText('Yangilik!\n\n📌 Manba: @oldchannel',cfg);
  assert.equal(result,'Yangilik!\n\n'+adFooter(cfg));
});


test('real car listing drops old channel name and private invite URL while keeping seller details',()=>{
  const source=[
    'Нексия 2 донс супер Сотилади ❗',
    '📅 2013 йил',
    '🛠 Матор хадавой зўр расходи йўқ',
    '💰 Нархи 6.800$ озгина ками бор',
    '☎️ +998994084749',
    '(Аниқ оладиганлар тел қилсин)',
    '',
    '👇 Машина Бозори',
    'https://t.me/+xQQsHzvTwAMxZjMy',
  ].join('\n');
  const carCfg={target_username:'MOSHINA_BOZORI_NARXLARI',promo_admin_username:'Qoryogdiyev'};
  const text=buildClonePostText(source,carCfg,1024);
  assert.ok(text.includes('Нексия 2 донс супер Сотилади ❗'));
  assert.ok(text.includes('Нархи 6.800$'));
  assert.ok(text.includes('+998994084749'));
  assert.ok(!text.includes('👇 Машина Бозори'));
  assert.ok(!text.includes('t.me/+'));
  assert.ok(text.endsWith('📢 Kanalimiz: @MOSHINA_BOZORI_NARXLARI\n📩 Reklama uchun: @Qoryogdiyev'));
  assert.ok(text.length<=1024);
  assert.equal(refreshClonePostText(text,carCfg,1024),text);
});

test('repair removes older channel invite footer and keeps the new brand footer once',()=>{
  const existing=[
    'Nexia 2, 2013 yil',
    'Telefon: +998994084749',
    '',
    '👇 Машина Бозори',
    'https://t.me/+xQQsHzvTwAMxZjMy',
    '',
    '📢 Kanalimiz:',
    '@MOSHINA_BOZORI_NARXLARI',
    '📩 Reklama uchun: @Qoryogdiyev'
  ].join('\n');
  const carCfg={target_username:'MOSHINA_BOZORI_NARXLARI',promo_admin_username:'Qoryogdiyev'};
  const result=refreshClonePostText(existing,carCfg);
  assert.ok(result.startsWith('Nexia 2, 2013 yil\nTelefon: +998994084749'));
  assert.ok(!result.includes('Машина Бозори'));
  assert.ok(!result.includes('t.me/+'));
  assert.equal(result.split('@MOSHINA_BOZORI_NARXLARI').length-1,1);
  assert.equal(result.split('@Qoryogdiyev').length-1,1);
});

test('joinchat URLs and plain public channel links are stripped with directional promo label',()=>{
  const source='Avtomobil 5000$\n\n👇 Бизнинг канал\nhttps://t.me/joinchat/AAAAAFakeInvite\n\n📌 Manba: @old_channel';
  const result=buildClonePostText(source,cfg,1024);
  assert.ok(result.startsWith('Avtomobil 5000$'));
  assert.ok(!result.includes('joinchat'));
  assert.ok(!result.includes('Бизнинг канал'));
  assert.ok(!result.includes('@old_channel'));
});

test('seller phone, model and external contact remain intact, source t.me promotions do not',()=>{
  const source='Narxi 6800$ | Sotuvchi: @my_seller\n☎️ +998901112233\nSayt: https://example.com/car/123\n\n👉 Kanal: https://t.me/OtherPublicChannel';
  const result=buildClonePostText(source,cfg,1024);
  assert.ok(result.includes('@my_seller'));
  assert.ok(result.includes('+998901112233'));
  assert.ok(result.includes('https://example.com/car/123'));
  assert.ok(!result.includes('OtherPublicChannel'));
});
