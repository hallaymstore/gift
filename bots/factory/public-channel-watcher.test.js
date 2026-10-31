'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  sessionConfigured,normalizePublicUsername,isProtected,mediaKind,mediaBytes,
  publicMessageData
}=require('./public-channel-watcher');

test('public source username can be set without administrator access',()=>{
  assert.equal(normalizePublicUsername('https://t.me/Kino_Trenduzz'),'Kino_Trenduzz');
  assert.equal(normalizePublicUsername('@Kino_Trenduzz'),'Kino_Trenduzz');
  assert.equal(normalizePublicUsername('https://example.com/secret'),'');
  assert.equal(normalizePublicUsername('https://t.me/+PrivateInvite'),'');
});
test('watcher is inactive until owner supplies authorized session credentials',()=>{
  assert.equal(sessionConfigured({}),false);
  assert.equal(sessionConfigured({TELEGRAM_API_ID:'1111',TELEGRAM_API_HASH:'hash'}),false);
  assert.equal(sessionConfigured({TELEGRAM_API_ID:'1111',TELEGRAM_API_HASH:'hash',
    TELEGRAM_STRING_SESSION:'ownerSession'}),true);
});
test('protected Telegram posts must not be republished',()=>{
  assert.equal(isProtected({noforwards:true}),true);
  assert.equal(isProtected({chat:{noforwards:true}}),true);
  assert.equal(isProtected({noforwards:false}),false);
});
test('recognize public video/photo/doc/text and size',()=>{
  assert.equal(mediaKind({media:{className:'MessageMediaPhoto'}}),'photo');
  assert.equal(mediaKind({media:{document:{size:2400,mimeType:'video/mp4'}}}),'video');
  assert.equal(mediaKind({media:{document:{size:200,mimeType:'application/pdf'}}}),'document');
  assert.equal(mediaKind({message:'foo'}),'text');
  assert.equal(mediaBytes({media:{document:{size:2048}}}),2048);
});
test('preserve original public channel name and message for credit',()=>{
  const p=publicMessageData({id:17,message:'Kino kodi: 769',
    media:{document:{mimeType:'video/mp4',size:1000}}},'Kino_Trenduzz');
  assert.equal(p.caption,'Kino kodi: 769');
  assert.equal(p.forward_origin.chat.username,'Kino_Trenduzz');
  assert.equal(p.forward_origin.message_id,17);
  assert.ok(p.video);
});
