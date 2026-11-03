'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizePhone,normalizeUsername,findPhones,findUsernames,
  replaceApprovedPhoneContacts,sourceAdminUsernameSet,detectSourceAdminCandidates
}=require('./channel-clone-contacts');
const {buildClonePostText,refreshClonePostText,adFooter}=require('./channel-clone-branding');

test('accept Uzbekistan numbers in commonly used writing styles; reject short or garbage numbers',()=>{
  assert.equal(normalizePhone('+998910021877'),'+998910021877');
  assert.equal(normalizePhone('998 91 002 18 77'),'+998910021877');
  assert.equal(normalizePhone('+998 (91) 002-18-77'),'+998910021877');
  assert.equal(normalizePhone('910021877'),'');
  assert.equal(normalizePhone('+99891002187'),'');
  assert.equal(normalizePhone('xyz'),'');
  assert.equal(normalizeUsername('@Tabriklar_admin02'),'Tabriklar_admin02');
  assert.equal(normalizeUsername('@a'),'');
  assert.deepEqual(findPhones('☎️ +998910021877, boshqa raqam +998 (90) 111-22-33'),
    ['+998910021877','+998901112233']);
  assert.deepEqual(findUsernames('@AdminUser01 @AdminUser01 @OtherAdmin'),'AdminUser01 OtherAdmin'.split(' '));
});

test('without manual approval, both customer and source admin numbers remain untouched',()=>{
  const text='Admin: @OldAds\n+998910021877\nMijoz: +998901112233';
  const cfg={target_username:'my_greetings',promo_admin_username:'NewAds',promo_admin_phone:'+998907778899'};
  const result=buildClonePostText(text,cfg,4096);
  assert.ok(result.includes('+998910021877'));
  assert.ok(result.includes('+998901112233'));
  assert.ok(result.endsWith('☎️ Reklama telefoni: +998907778899'));
});

test('approved source admin phone is replaced exactly, client phone remains unchanged',()=>{
  const cfg={
    target_username:'yaqinlarimga_tabriklarim02',
    promo_admin_username:'Qoryogdiyev',
    promo_admin_phone:'+998907778899',
    source_admin_phones:['+998910021877'],
    source_admin_usernames:['Tabriklar_admin02']
  };
  const source=[
    '🌸 TUG‘ILGAN KUNINGIZ MUBORAK!',
    '',
    'BIZ BILAN TELEGRAM ORQALI BOG‘LANING 👇',
    '@Tabriklar_admin02',
    'MUROJAT UCHUN 👇',
    '+998910021877',
    '',
    'Mehmon raqami: +998901112233',
    '🎙 Boshlovchi: ZULFIZAR QORYOG‘DIYEVA'
  ].join('\n');
  const result=buildClonePostText(source,cfg,4096);
  assert.ok(result.includes('+998907778899'));
  assert.ok(!result.includes('998910021877'));
  assert.ok(result.includes('Mehmon raqami: +998901112233'));
  assert.ok(!result.includes('@Tabriklar_admin02'));
  assert.ok(result.includes('@Qoryogdiyev'));
  assert.ok(result.includes('ZULFIZAR QORYOG‘DIYEVA'));
  assert.equal(result.split('☎️ Reklama telefoni:').length-1,1);
  assert.equal(refreshClonePostText(result,cfg,4096),result);
});

test('only exact approved phone replaced, not same prefix or random market numbers',()=>{
  const output=replaceApprovedPhoneContacts(
    'Manba: +998 91 002 18 77\nMijoz: +998910021878\nSotuvchi: +998994084749',
    {sourceAdminPhones:['+998910021877'],adminPhone:'+998901234567'}
  );
  assert.ok(output.includes('+998901234567'));
  assert.ok(output.includes('+998910021878'));
  assert.ok(output.includes('+998994084749'));
  assert.ok(!output.includes('+998 91 002 18 77'));
});

test('car marketplace seller numbers and buyer contacts are preserved even if source has admin mapping',()=>{
  const conf={
    target_username:'MOSHINA_BOZORI_NARXLARI',promo_admin_username:'Qoryogdiyev',
    promo_admin_phone:'+998907778899',source_admin_phones:['+998910021877']
  };
  const source=[
    '🚗 Nexia sotiladi, narxi 6500$',
    '☎️ Sotuvchi telefon: +998910021877',
    '☎️ Xaridor telefon: +998994084749',
    'Admin reklama uchun: @old_ads_admin'
  ].join('\n');
  const output=buildClonePostText(source,conf,1024);
  assert.ok(output.includes('Sotuvchi telefon: +998910021877'));
  assert.ok(output.includes('Xaridor telefon: +998994084749'));
  assert.ok(output.includes('narxi 6500$'));
});

test('scan candidates from strong source-admin context but do not automatically approve them',()=>{
  const posts=[
    {message:'🌹 Tabrik! BIZ BILAN TELEGRAM ORQALI BOG‘LANING\n\n@Tabriklar_admin02\nMUROJAT UCHUN\n+998910021877'},
    {message:'NAVBAT OLISH UCHUN ADMIN LICHKASI:\n@Tabriklar_admin02\nTelefon: +998910021877'},
    {message:'Mijoz raqami: +998901112233\nSizni tabriklaymiz!'},
    {message:'🚘 Nexia sotiladi\nNarxi 6500$\nSotuvchi: +998994084749'}
  ];
  const found=detectSourceAdminCandidates(posts);
  assert.ok(found.some(c=>c.kind==='phone'&&c.value==='+998910021877'));
  assert.ok(found.some(c=>c.kind==='username'&&c.value==='Tabriklar_admin02'));
  assert.ok(!found.some(c=>c.kind==='phone'&&c.value==='+998901112233'));
  assert.ok(!found.some(c=>c.kind==='phone'&&c.value==='+998994084749'));
});

test('source names only apply when explicitly confirmed and admin destination is configured',()=>{
  assert.equal(sourceAdminUsernameSet(['@old_admin','OtherAdmin']).has('old_admin'),true);
  const cfg={
    target_username:'greetings_channel',promo_admin_username:'OurAdmin',
    source_admin_usernames:['@sourceadmin']
  };
  const result=buildClonePostText('Reklama: @sourceadmin\nMuallif: @BaxromPoet',cfg,4096);
  assert.ok(result.includes('@OurAdmin'));
  assert.ok(result.includes('Muallif: @BaxromPoet'));
  assert.ok(!result.includes('@sourceadmin'));
});

test('changing one source admin mapping does not affect another route',()=>{
  const body='Murojat uchun\n+998910021877';
  const first=buildClonePostText(body,{
    target_username:'channel_a',promo_admin_phone:'+998907778899',
    source_admin_phones:['+998910021877']
  },4096);
  const second=buildClonePostText(body,{
    target_username:'channel_b',promo_admin_phone:'+998907778899',
    source_admin_phones:[]
  },4096);
  assert.ok(first.includes('+998907778899'));
  assert.ok(second.includes('+998910021877'));
  assert.ok(!first.includes('+998910021877'));
  assert.ok(adFooter({promo_admin_phone:'+998907778899'}).includes('+998907778899'));
});
