'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {redactTelegramSecrets,describeRelayError}=require('./channel-clone-errors');

test('redact normal Telegram API tokens from raw sendPhoto errors',()=>{
  const token='1234567890:ABCdef_abcdefghijklmnopqrstuvwxyz123456';
  const input='request to https://api.telegram.org/bot'+token+'/sendPhoto failed, reason: socket hang up';
  assert.ok(!redactTelegramSecrets(input).includes(token));
  assert.ok(!describeRelayError(new Error(input)).includes(token));
  assert.match(describeRelayError(new Error(input)),/ulanish uzildi/);
});

test('redact previously redacted paths and file/bot endpoint',()=>{
  const input='https://api.telegram.org/file/bot1234567890:[REDACTED]/photos/file.jpg';
  assert.ok(!redactTelegramSecrets(input).includes('1234567890'));
});

test('failed post ID is preserved even for network errors',()=>{
  const detail=describeRelayError('History post 12130 could not be relayed: request to https://api.telegram.org/bot1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg/sendPhoto failed, reason: socket hang up');
  assert.match(detail,/History post 12130:/);
  assert.ok(!detail.includes('1234567890'));
});

test('long captions are diagnosed clearly',()=>{
  assert.match(describeRelayError(new Error('The caption is too long. (caused by messages.SendMedia)')),/izohi.*uzun/);
});

test('unknown errors are bounded and remove Telegram tokens',()=>{
  const message='invalid request: 1234567890:ABCdef_abcdefghijklmnopqrstuvwxyz123456 '+ 'Z'.repeat(1000);
  const result=describeRelayError({message},135);
  assert.ok(result.length<=135);
  assert.ok(!result.includes('1234567890'));
});
