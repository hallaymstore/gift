'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runGroupAnnouncementTick}=require('./group-announcements-runner');

function setup({approved=true,groupActive=true}={}) {
 const now=new Date('2026-11-01T09:00:00Z');
 const campaign={_id:'campaign1',bot_key:'testbot',running:true,
  source_chat_id:1234,source_message_id:45,revision:2,attempt_count:0,
  max_sends:5,sent_count:0,interval_minutes:60,next_send_at:new Date(now.getTime()-1000)};
 const group={_id:'group1',bot_key:'testbot',chat_id:'-1001234567890',
  active:groupActive,title:'Approved Group',last_sent_at:null};
 const emitted=[];
 const tick={
 Group:{
  find:()=>({lean:async()=>approved?[group]:[]}),
  updateOne:async()=>({matchedCount:groupActive?1:0}),
  exists:async()=>groupActive?group:null
 },
 Campaign:{
  find:()=>({sort:()=>({limit:()=>({lean:async()=>[campaign]})})}),
  findOneAndUpdate:async(filter,update)=> {
    if(filter.revision!==undefined)return {...campaign,attempt_count:1};
    return campaign;
  },
  updateOne:async()=>({matchedCount:1})
 },
 Log:{create:async()=>({}),updateOne:async()=>({})},
 activeBots:new Map([['testbot',{
  config:{engine:'group_announcements'},
  bot:{botInfo:{id:987},telegram:{
    getChatMember:async()=>({status:'administrator'}),
    copyMessage:async(...args)=>{emitted.push(args);return{message_id:51}}
  }}
 }]]),
 logger:{warn:()=>{},error:()=>{}},
 clock:()=>now
 };
 return {tick,emitted,group};
}

test('only opted-in group gets a single scheduled copyMessage',async()=>{
 const a=setup();
 const count=await runGroupAnnouncementTick(a.tick);
 assert.equal(count,1);
 assert.equal(a.emitted.length,1);
 assert.equal(a.emitted[0][0],a.group.chat_id);
 assert.equal(a.emitted[0][1],1234);
 assert.equal(a.emitted[0][2],45);
});

test('no allowed group means no Telegram post',async()=>{
 const a=setup({approved:false});
 await runGroupAnnouncementTick(a.tick);
 assert.equal(a.emitted.length,0);
});

test('revoked group cannot receive even if its record was fetched',async()=>{
 const a=setup({groupActive:false});
 await runGroupAnnouncementTick(a.tick);
 assert.equal(a.emitted.length,0);
});
