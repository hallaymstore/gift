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
