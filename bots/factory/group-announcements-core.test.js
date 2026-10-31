'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseInterval,parseSendLimit,eligibleGroup,nextAllowedGroupTime,
  MIN_GROUP_COOLDOWN_MS}=require('./group-announcements-core');
test('interval accepts only 30m to 7d; seconds must not create spam loops',()=>{
  assert.equal(parseInterval('30m'),30);
  assert.equal(parseInterval('1h'),60);
  assert.equal(parseInterval('2soat'),120);
  assert.equal(parseInterval('24h'),1440);
  assert.equal(parseInterval('1800s'),30);
  assert.equal(parseInterval('20s'),null);
  assert.equal(parseInterval('29m'),null);
  assert.equal(parseInterval('8d'),null);
  assert.equal(parseInterval('bad'),null);
});
test('finite sending count strictly limited',()=>{
  assert.equal(parseSendLimit('1'),1);
  assert.equal(parseSendLimit('100'),100);
  assert.equal(parseSendLimit('0'),null);
  assert.equal(parseSendLimit('101'),null);
  assert.equal(parseSendLimit('infinite'),null);
});
test('only explicitly approved active groups eligible, once per day maximum',()=>{
  const now=new Date('2026-10-31T10:00:00.000Z');
  const groups=[
    {active:false,chat_id:'-1001'},
    {active:true,chat_id:'-1002',last_sent_at:new Date(now.getTime()-10*60*1000)},
    {active:true,chat_id:'-1003',last_sent_at:new Date(now.getTime()-25*60*60*1000)}
  ];
  assert.equal(eligibleGroup(groups,now).chat_id,'-1003');
  assert.equal(eligibleGroup(groups.slice(0,2),now),null);
  assert.equal(MIN_GROUP_COOLDOWN_MS,24*60*60*1000);
});
test('when all groups cooled down, schedule exact next eligible time',()=>{
  const now=new Date('2026-10-31T10:00:00.000Z');
  const last=new Date(now.getTime()-23*60*60*1000);
  const result=nextAllowedGroupTime([{active:true,last_sent_at:last}],now);
  assert.equal(result.getTime(),now.getTime()+60*60*1000);
  assert.equal(nextAllowedGroupTime([],now),null);
});
