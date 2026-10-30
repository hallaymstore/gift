'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubInput, membershipAccepted, subscriptionChatRef } = require('./subscription-support');

test('public channel and group references resolve correctly', () => {
  assert.equal(parseSubInput('@mykinobot').chat_ref, '@mykinobot');
  assert.equal(parseSubInput('https://t.me/mykinobot', 'group').chat_ref, '@mykinobot');
  assert.equal(parseSubInput('@mykinobot | zayavka').requires_request, true);
  assert.equal(parseSubInput('https://t.me/mykinobot').join_url, 'https://t.me/mykinobot');
});
test('private group with known ID can be checked via getChatMember', () => {
  const x = parseSubInput('Kanal nomi | -1001234567890 | https://t.me/+AnInvite12345 | zayavka');
  assert.equal(x.chat_id, '-1001234567890');
  assert.equal(x.chat_ref, '-1001234567890');
  assert.equal(x.invite_link, 'https://t.me/+AnInvite12345');
  assert.equal(x.requires_request, true);
  assert.equal(subscriptionChatRef(x), '-1001234567890');
});
test('invite-only entry must request real chat ID later', () => {
  const x = parseSubInput('Kanal nomi | https://t.me/+AnInvite12345 | zayavka');
  assert.equal(x.chat_id, undefined);
  assert.equal(subscriptionChatRef(x), '');
  assert.equal(x.is_private_link, true);
});
test('public zayavka mode must not be mistaken for @zayavka', () => {
  const x = parseSubInput('Kanal nomi | zayavka | https://t.me/+AnInvite12345');
  assert.equal(x.chat_ref, undefined);
  assert.equal(x.requires_request, true);
});
test('only real members count', () => {
  for (const status of ['member', 'creator', 'administrator'])
    assert.equal(membershipAccepted({ status }), true);
  assert.equal(membershipAccepted({status:'restricted',is_member:true}), true);
  assert.equal(membershipAccepted({status:'restricted',is_member:false}), false);
  assert.equal(membershipAccepted({status:'left'}), false);
  assert.equal(membershipAccepted({status:'kicked'}), false);
});
test('invalid Telegram links and arbitrary external URLs rejected', () => {
  assert.equal(parseSubInput('https://example.com/channel'), null);
  assert.equal(parseSubInput('T.me/other stuff'), null);
});
