'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanLive,scanHistory,canRepublish,
 LIVE_POLL_MS,HISTORY_POLL_MS,HISTORY_BATCH_SIZE}=require('./public-channel-watcher');

function fixture(){
 const messages=[
  {id:1,message:'Birinchi post'},
  {id:2,message:'Himoyalangan post',noforwards:true},
  {id:3,message:'Ikkinchi post'},
  {id:4,message:'Uchinchi post'}
 ];
 const client={getMessages:async(_,opts)=>{
   if(opts.reverse)return messages.filter(m=>m.id>Number(opts.minId||0))
     .sort((a,b)=>a.id-b.id).slice(0,opts.limit);
   return messages.slice().sort((a,b)=>b.id-a.id).slice(0,opts.limit);
 }};
 const cfg={bot_key:'mykinobot',source_username:'Kino_Trenduzz',
   source_cursor:0,history_enabled:true,history_completed:false,
   history_cursor:0,history_ceiling:0};
 const delivered=[],events=[];
 const deliver=async evt=>{
   events.push(evt.type);
   if(evt.type==='seed'){cfg.source_cursor=evt.cursor;cfg.history_ceiling=evt.cursor;}
   if(evt.type==='history_begin')cfg.history_ceiling=evt.ceiling;
   if(evt.type==='history_cursor')cfg.history_cursor=evt.cursor;
   if(evt.type==='history_complete')cfg.history_completed=true;
   if(evt.type==='cursor')cfg.source_cursor=evt.cursor;
   if(evt.type==='post'){
     delivered.push({id:evt.message.id,phase:evt.phase});
     return{status:'sent'};
   }
 };
 const log={info:()=>{},warn:()=>{}};
 return{messages,client,cfg,deliver,events,delivered,log};
}

test('first live scan saves baseline but does not post old messages as new',async()=>{
 const d=fixture();
 await scanLive(d);
 assert.equal(d.cfg.source_cursor,4);
 assert.equal(d.cfg.history_ceiling,4);
 assert.deepEqual(d.delivered,[]);
 assert.deepEqual(d.events,['seed']);
});
test('historical sync walks from oldest to newest and skips protected posts',async()=>{
 const d=fixture();
 await scanLive(d);
 await scanHistory(d);
 assert.equal(d.cfg.history_cursor,3);
 await scanHistory(d);
 assert.equal(d.cfg.history_completed,true);
 assert.deepEqual(d.delivered.map(x=>x.id),[1,3,4]);
 assert.equal(d.delivered.every(x=>x.phase==='history'),true);
});
test('new posts are detected during historic backfill without repeating old IDs',async()=>{
 const d=fixture();
 await scanLive(d);
 await scanHistory(d);
 d.messages.push({id:5,message:'Yangi post'});
 await scanLive(d);
 assert.deepEqual(d.delivered.map(x=>x.id),[1,3,5]);
 assert.equal(d.delivered[2].phase,'live');
 assert.equal(d.cfg.source_cursor,5);
 await scanLive(d);
 assert.equal(d.delivered.filter(x=>x.id===5).length,1);
 await scanHistory(d);
 assert.deepEqual(d.delivered.map(x=>x.id),[1,3,5,4]);
});
test('history does not run without an explicit enabled setting',async()=>{
 const d=fixture();
 d.cfg.history_enabled=false;
 d.cfg.source_cursor=4;
 await scanHistory(d);
 assert.equal(d.delivered.length,0);
});
test('protected, unsupported, oversize or empty post is not republished',()=>{
 assert.equal(canRepublish({message:'News',noforwards:true}),false);
 assert.equal(canRepublish({media:{document:{mimeType:'video/mp4',size:20*1024*1024}}}),false);
 assert.equal(canRepublish({media:{className:'MessageMediaUnknown'}}),false);
 assert.equal(canRepublish({action:{type:'MessageActionPinMessage'}}),false);
 assert.equal(canRepublish({message:'   '}),false);
 assert.equal(canRepublish({message:'Normal'}),true);
});
test('live checks every 12 seconds while history is throttled',()=>{
 assert.equal(LIVE_POLL_MS,12000);
 assert.equal(HISTORY_POLL_MS,20000);
 assert.equal(HISTORY_BATCH_SIZE,3);
});
