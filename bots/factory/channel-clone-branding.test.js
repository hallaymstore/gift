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
  assert.ok(!result.includes('t.me/Oldchannel'));
  assert.ok(result.includes('https://t.me/Kino_Channel'));
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
  const carCfg={target_username:'MOSHINA_BOZORI_NARXLARI',target_chat_id:'-1000011122233',target_invite_chat_id:'-1000011122233',target_invite_link:'https://t.me/+OurAutoMarketInvite',promo_admin_username:'Qoryogdiyev'};
  const text=buildClonePostText(source,carCfg,1024);
  assert.ok(text.includes('Нексия 2 донс супер Сотилади ❗'));
  assert.ok(text.includes('Нархи 6.800$'));
  assert.ok(text.includes('+998994084749'));
  assert.ok(!text.includes('👇 Машина Бозори'));
  assert.ok(!text.includes('xQQsHzvTwAMxZjMy'));
  assert.ok(text.includes('👇 Bizning kanal\nhttps://t.me/+OurAutoMarketInvite'));
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
  const carCfg={target_username:'MOSHINA_BOZORI_NARXLARI',target_chat_id:'-1000011122233',target_invite_chat_id:'-1000011122233',target_invite_link:'https://t.me/+OurAutoMarketInvite',promo_admin_username:'Qoryogdiyev'};
  const result=refreshClonePostText(existing,carCfg);
  assert.ok(result.startsWith('Nexia 2, 2013 yil\nTelefon: +998994084749'));
  assert.ok(!result.includes('Машина Бозори'));
  assert.ok(!result.includes('xQQsHzvTwAMxZjMy'));
  assert.ok(result.includes('https://t.me/+OurAutoMarketInvite'));
  assert.equal(result.split('@MOSHINA_BOZORI_NARXLARI').length-1,1);
  assert.equal(result.split('@Qoryogdiyev').length-1,1);
});

test('joinchat URLs and plain public channel links are stripped with directional promo label',()=>{
  const source='Avtomobil 5000$\n\n👇 Бизнинг канал\nhttps://t.me/joinchat/AAAAAFakeInvite\n\n📌 Manba: @old_channel';
  const result=buildClonePostText(source,cfg,1024);
  assert.ok(result.startsWith('Avtomobil 5000$'));
  assert.ok(!result.includes('joinchat'));
  assert.ok(result.includes('👇 Bizning kanal\nhttps://t.me/Kino_Channel'));
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
  assert.ok(result.includes('https://t.me/Kino_Channel'));
});

test('falls back to public channel instead of copying source private invite',()=>{
  const source='Yangi moshina\n\n👇 Mashina Bozori\nhttps://t.me/+SourceInvite';
  const result=buildClonePostText(source,{target_username:'MOSHINA_BOZORI_NARXLARI'},1024);
  assert.ok(result.includes('https://t.me/MOSHINA_BOZORI_NARXLARI'));
  assert.ok(!result.includes('SourceInvite'));
  assert.equal(refreshClonePostText(result,{target_username:'MOSHINA_BOZORI_NARXLARI'}),result);
});

test('destination private invite requires correct target chat id and is not reused after changing channels',()=>{
  const cfg={target_username:'Second_Channel',target_chat_id:'-1009',target_invite_chat_id:'-1008',
    target_invite_link:'https://t.me/+OldChannelPrivateInvite'};
  const text=buildClonePostText('👇 Kanal\nhttps://t.me/+SourceInvite',cfg);
  assert.ok(text.includes('https://t.me/Second_Channel'));
  assert.ok(!text.includes('OldChannelPrivateInvite'));
});

test('seller Telegram contact link inside text stays intact',()=>{
  const text=buildClonePostText('Telefon: +998901112233\nSotuvchi telegram: https://t.me/SellerUser42\n\n👇 Manba kanali\nhttps://t.me/+OldPromo',cfg);
  assert.ok(text.includes('https://t.me/SellerUser42'));
  assert.ok(text.includes('https://t.me/Kino_Channel'));
  assert.ok(!text.includes('OldPromo'));
});


test('real car ad: old telegram.me/joinchat group invite is replaced, price and phones preserved',()=>{
  const source=[
    '🚘 Moshina: #Hogqi eqm5',
    '📍 Pozitsiya: Full',
    '📡 Yil: 2024',
    '💲 Narxi: 15300$',
    '☎️ Tel: +998942892226',
    '☎️ Tel: +998976330393',
    '🚩 Tashkent',
    '✅ Hamma qulayliklari bor',
    '',
    'https://telegram.me/joinchat/PP8gLRFIdeRlN2Qy'
  ].join('\n');
  const car={target_username:'MOSHINA_BOZORI_NARXLARI',promo_admin_username:'Qoryogdiyev'};
  const result=buildClonePostText(source,car,1024);
  assert.ok(result.includes('Narxi: 15300$'));
  assert.ok(result.includes('+998942892226'));
  assert.ok(result.includes('+998976330393'));
  assert.ok(result.includes('https://t.me/MOSHINA_BOZORI_NARXLARI'));
  assert.ok(!result.includes('telegram.me/joinchat'));
  assert.ok(!result.includes('PP8gLRFIdeRlN2Qy'));
  assert.ok(result.endsWith('📩 Reklama uchun: @Qoryogdiyev'));
  assert.equal(refreshClonePostText(result,car,1024),result);
});

test('telegram.me private group invite with Telegram chat label also gets replaced',()=>{
  const source='Salon eʼloni, 6500$\n\nTelegram chatimiz: https://telegram.me/joinchat/OldInviteKey';
  const result=buildClonePostText(source,cfg,1024);
  assert.ok(result.includes('Salon eʼloni, 6500$'));
  assert.ok(!result.includes('OldInviteKey'));
  assert.ok(result.includes('https://t.me/Kino_Channel'));
});

test('do not replace a seller personal contact just because domain is telegram.me',()=>{
  const source='Narxi 6800$\nSotuvchi telegram: https://telegram.me/SellerContact777\n☎️ +998901112233\n\nhttps://telegram.me/joinchat/SourceGroup';
  const result=buildClonePostText(source,cfg,1024);
  assert.ok(result.includes('https://telegram.me/SellerContact777'));
  assert.ok(result.includes('+998901112233'));
  assert.ok(!result.includes('SourceGroup'));
  assert.ok(result.includes('https://t.me/Kino_Channel'));
});

test('the same private group invite is replaced in a preexisting branded caption',()=>{
  const source='Avtomobil 2024, 15300$\n\nhttps://telegram.me/joinchat/OldGroupInvite\n\n📢 Kanalimiz: @Kino_Channel\n📩 Reklama uchun: @ads_admin_uz';
  const repaired=refreshClonePostText(source,cfg,1024);
  assert.ok(!repaired.includes('OldGroupInvite'));
  assert.ok(repaired.includes('https://t.me/Kino_Channel'));
  assert.equal(repaired.split('📢 Kanalimiz:').length-1,1);
  assert.equal(repaired.split('📩 Reklama uchun:').length-1,1);
  assert.equal(refreshClonePostText(repaired,cfg,1024),repaired);
});


test('greeting: delete source ad admin and phone, replace group invite, preserve poem and performer',()=>{
  const source=[
    '🌷 Ravon qilsin Allohim!',
    '🌟 Taningizga sog‘likni.',
    '🌷 Unvon qilsin Allohim!',
    '',
    '🌸 Gina g‘ubor yuvilsin,',
    '🌷 Hamroh bo‘lsin ezgulik.',
    '👇🌹 BIZ BILAN TELEGRAM ORQALI BOG‘LANING',
    '',
    '@Tabriklar_admin02',
    'MUROJAAT UCHUN 👇🌹',
    '',
    '+998910021877',
    '',
    'GURUHIMIZGA QO‘SHILING 👇🌹',
    '',
    'https://t.me/+EprtVt19Keg5MWU5',
    '',
    '🎙 Boshlovchi: 🎤 ZULFIZAR QORYOG‘DIYEVA',
    '🌹 TABRIKNOMA 🌷'
  ].join('\n');
  const conf={target_username:'yaqinlarimga_tabriklarim02',promo_admin_username:'MyAdsAdmin'};
  const text=buildClonePostText(source,conf,4096);
  assert.ok(text.includes('Ravon qilsin Allohim'));
  assert.ok(text.includes('Gina g‘ubor yuvilsin'));
  assert.ok(text.includes('ZULFIZAR QORYOG‘DIYEVA'));
  assert.ok(text.includes('TABRIKNOMA'));
  assert.ok(!text.includes('Tabriklar_admin02'));
  assert.ok(!text.includes('998910021877'));
  assert.ok(!text.includes('EprtVt19Keg5MWU5'));
  assert.ok(!text.includes('MUROJAAT UCHUN'));
  assert.ok(!text.includes('BIZ BILAN TELEGRAM ORQALI BOG'));
  assert.ok(!text.includes('GURUHIMIZGA QO'));
  assert.ok(text.includes('👇 Bizning kanal\nhttps://t.me/yaqinlarimga_tabriklarim02'));
  assert.ok(text.endsWith('📢 Kanalimiz: @yaqinlarimga_tabriklarim02\n📩 Reklama uchun: @MyAdsAdmin'));
  assert.equal(refreshClonePostText(text,conf,4096),text);
});

test('post with ad contact and separate phone but no invite is cleaned',()=>{
  const source='Original she’r.\n\n📩 Reklama uchun\n@source_admin\n\n☎️ +998 91 002 18 77\n\nIjrochi: Qodirova';
  const text=buildClonePostText(source,{target_username:'our_greetings',promo_admin_username:'OurAds'},4096);
  assert.ok(!text.includes('@source_admin'));
  assert.ok(!text.includes('002 18 77'));
  assert.ok(text.includes('Original she’r.'));
  assert.ok(text.includes('Ijrochi: Qodirova'));
  assert.ok(text.includes('@OurAds'));
});

test('car listing keeps actual seller phone and independent personal account',()=>{
  const source=[
    '🚘 Nexia sotiladi',
    '💰 Narxi: 6500$',
    '📞 Murojaat uchun:',
    '+998994084749',
    'Sotuvchi telegram: @NexiaOwner007',
    '',
    'GURUHIMIZGA QO‘SHILING',
    'https://t.me/+OldGroupLink'
  ].join('\n');
  const text=buildClonePostText(source,{
    target_username:'MOSHINA_BOZORI_NARXLARI',promo_admin_username:'Qoryogdiyev'},1024);
  assert.ok(text.includes('+998994084749'));
  assert.ok(text.includes('@NexiaOwner007'));
  assert.ok(!text.includes('OldGroupLink'));
  assert.ok(text.includes('https://t.me/MOSHINA_BOZORI_NARXLARI'));
});

test('preserve ordinary phone and @username in non-promotional content',()=>{
  const source='Doktor telefon: +998901112233\nMuallif: @BaxromPoet\nTabriknoma shu yerda.';
  const text=buildClonePostText(source,{target_username:'yangi_kanal'});
  assert.ok(text.includes('+998901112233'));
  assert.ok(text.includes('@BaxromPoet'));
});
