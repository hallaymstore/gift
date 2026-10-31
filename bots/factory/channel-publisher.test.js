'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  telegramHandle, telegramChatRef, linkedBots, originalSource,
  messageKind, buildChannelCaption, candidateCode
} = require('./channel-publisher');

test('validate target usernames and numeric Telegram channel IDs', () => {
  assert.equal(telegramChatRef('@My_MovieChannel'), '@My_MovieChannel');
  assert.equal(telegramChatRef('https://t.me/My_MovieChannel'), '@My_MovieChannel');
  assert.equal(telegramChatRef('-1001234567890'), '-1001234567890');
  assert.equal(telegramChatRef('not a channel'), '');
  assert.equal(telegramChatRef('https://example.com/channel'), '');
  assert.equal(telegramHandle('@y808bot'), 'y808bot');
});

test('allow only five distinct linked bot handles; exclude the primary bot', () => {
  assert.deepEqual(linkedBots('@y808bot @cartoonbot, @serialbot; @cartoonbot | @anotherbot @fourthbot @fifthbot', 'y808bot'),
    ['cartoonbot', 'serialbot', 'anotherbot', 'fourthbot', 'fifthbot']);
});

test('forwarded public channel source is credited without pretending it is our channel', () => {
  const msg = {
    video: { file_id: '1234' },
    caption: '🔎 Kino kodi: 769\n🎬 Nomi: Portlash\n🎥 Botimiz: @OtherKinoBot\n🎞 Janr: drama',
    forward_origin: {type:'channel', chat:{id:-100555444333,title:'Other Kino',username:'OtherKino'}, message_id:29}
  };
  assert.equal(messageKind(msg),'video');
  assert.equal(candidateCode(msg),'769');
  assert.equal(originalSource(msg).messageId,29);
  const copy = buildChannelCaption({
    message:msg,destination:{id:'-1001234567890',username:'mycinema',title:'My Cinema'},
    botUsername:'y808bot',otherBots:['mycartoonbot','myserialbot'],
    localContent:{title:'Portlash',code:'769',code_norm:'769'}
  });
  assert.match(copy,/Kino kodi: 769/);
  assert.match(copy,/@y808bot/);
  assert.match(copy,/@mycinema/);
  assert.match(copy,/@mycartoonbot/);
  assert.match(copy,/t\.me\/y808bot\?start=c_769/);
  assert.match(copy,/Manba: @OtherKino/);
  assert.doesNotMatch(copy, /@OtherKinoBot/);
  assert.ok(copy.length <= 1024);
});

test('unknown foreign source code must not be promoted as local catalog code', () => {
  const msg = {photo:[{file_id:'22'}],caption:'🔎 Kino kodi: 887\n🎬 Nomi: Chandu chempion'};
  const copy = buildChannelCaption({
    message:msg,destination:{id:-1001234567890,username:'mycinema'},
    botUsername:'y808bot'
  });
  assert.doesNotMatch(copy,/Kino kodi: 887/);
  assert.doesNotMatch(copy,/start=c_887/);
  assert.match(copy,/t\.me\/y808bot/);
});

test('source text promotion links are stripped and old bot usernames not copied', () => {
  const msg={text:'🎬 Nomi: Kino\n🎞 Janr: Drama\n🔗 https://t.me/OtherKinoBot?start=11\nBotimiz: @OtherKinoBot'};
  const copy=buildChannelCaption({message:msg,destination:{id:'-1001234567890',username:'mychannel'},botUsername:'y808bot'});
  assert.match(copy,/Janr: Drama/);
  assert.doesNotMatch(copy,/OtherKinoBot/);
  assert.match(copy,/@mychannel/);
});

test('caption size respects Telegram size limit',()=>{
  const long='🎬 Nomi: Kino\nJanr: ' + 'sarguzasht '.repeat(130);
  const msg={video:{file_id:'abc'},caption:long};
  const copy=buildChannelCaption({message:msg,destination:{id:'-100222333444',username:'mychannel'},
    botUsername:'y808bot',otherBots:['mycartoonbot']});
  assert.ok(copy.length<=1024);
  assert.match(copy,/@y808bot/);
  assert.match(copy,/@mychannel/);
});
