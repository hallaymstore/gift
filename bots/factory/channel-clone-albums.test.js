'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {collectAlbumMembers,albumCaptionMessage,albumYoung,relayCloneAlbum}=require('./channel-clone-albums');
const {scanHistory,scanLive,HISTORY_BATCH_SIZE}=require('./public-channel-watcher');
const old=Math.floor(Date.now()/1000)-3600;
const photo=(id,caption='')=>({id,groupedId:123n,date:old,message:caption,media:{className:'MessageMediaPhoto',photo:{id}}});
function fixture(){
 const messages=[photo(10,'Nexia 2014. Price: 6500. Call seller.\n\n👇 Source\nhttps://t.me/+OldSource'),photo(11),photo(12),photo(13),{id:14,message:'Next listing'}];
 const client={getMessages:async(_,opts)=>opts.ids?messages.filter(m=>opts.ids.includes(m.id)):
   opts.reverse?messages.filter(m=>m.id>Number(opts.minId||0)).slice(0,opts.limit):
   [...messages].reverse().slice(0,opts.limit),
   downloadMedia:async()=>Buffer.from([1,2,3])};
 return {messages,client};
}
test('historical batch of 3 collects all 4 album photos',async()=>{
 const {messages,client}=fixture();
 assert.equal(HISTORY_BATCH_SIZE,3);
 const album=await collectAlbumMembers(client,'@source',messages[0]);
 assert.deepEqual(album.map(x=>x.id),[10,11,12,13]);
 assert.equal(albumCaptionMessage(album).id,10);
});
test('history advances by entire album, then handles next message',async()=>{
 const {client}=fixture();
 const cfg={bot_key:'channel_clone',source_username:'source_channel',source_cursor:14,
 history_ceiling:14,history_enabled:true,history_cursor:0,history_completed:false};
 const calls=[];const log={info(){},warn(){}};
 const deliver=async e=>{if(e.type==='album'){calls.push(e.messages.map(m=>m.id));return {status:'sent'};}
 if(e.type==='post'){calls.push([e.message.id]);return {status:'sent'};}
 if(e.type==='history_cursor')cfg.history_cursor=e.cursor;};
 await scanHistory({client,cfg,deliver,log});
 assert.deepEqual(calls,[[10,11,12,13]]);
 assert.equal(cfg.history_cursor,13);
 await scanHistory({client,cfg,deliver,log});
 assert.deepEqual(calls,[[10,11,12,13],[14]]);
});
test('live scans grouped posts only once and advances cursor',async()=>{
 const {client}=fixture();const cfg={bot_key:'channel_clone',source_username:'source_channel',source_cursor:9};
 const calls=[];const deliver=async e=>{if(e.type==='album'){calls.push(e.messages.map(m=>m.id));return {status:'sent'};}
 if(e.type==='post'){calls.push([e.message.id]);return {status:'sent'};}};
 await scanLive({client,cfg,deliver,log:{info(){},warn(){}}});
 assert.deepEqual(calls,[[10,11,12,13],[14]]);
 assert.equal(cfg.source_cursor,14);
});
test('newly posted album is deferred until it settles',()=>{
 assert.equal(albumYoung([{date:Math.floor(Date.now()/1000)}]),true);
 assert.equal(albumYoung([photo(10)]),false);
});
function logs(hasOld=false){
 const docs=new Map();
 return {docs,
 findOne(q){return {lean:async()=>q.source_key?.$in?(hasOld?{status:'sent'}:null):docs.get(q.source_key)||null};},
 async create(doc){if(docs.has(doc.source_key)){const error=new Error('duplicate album log');error.code=11000;throw error;}docs.set(doc.source_key,{...doc});},
 async updateOne(q,u){Object.assign(docs.get(q.source_key),u.$set);return {modifiedCount:1};}};
}
test('four photos become one media group with one branded caption',async()=>{
 const {messages,client}=fixture(),Log=logs();
 const calls=[];const telegram={sendMediaGroup:async(_,media)=>{calls.push(media);return media.map((_,i)=>({message_id:200+i}));}};
 const cfg={bot_key:'channel_clone',source_username:'source_channel',target_chat_id:'-1001234567890',target_username:'my_market',clone_format:'branded'};
 const Config={findOne(){return {select(){return {lean:async()=>({target_invite_attempt_at:new Date()})};}};}};
 const first=await relayCloneAlbum({cfg,messages:messages.slice(0,4),client,telegram,Log,Config});
 assert.equal(first.status,'sent');assert.equal(calls.length,1);assert.equal(calls[0].length,4);
 assert.ok(calls[0][0].caption.includes('Nexia 2014'));
 assert.ok(calls[0][0].caption.includes('https://t.me/my_market'));
 assert.ok(calls[0].slice(1).every(x=>!x.caption));
 assert.equal((await relayCloneAlbum({cfg,messages:messages.slice(0,4),client,telegram,Log,Config})).status,'duplicate');
 assert.equal(calls.length,1);
});
test('existing individual copy prevents reposting the whole album',async()=>{
 const {messages,client}=fixture(),Log=logs(true);
 const cfg={bot_key:'channel_clone',source_username:'source_channel',target_chat_id:'-1001234567890'};
 const result=await relayCloneAlbum({cfg,messages:messages.slice(0,4),client,telegram:{},Log,Config:{}});
 assert.equal(result.status,'duplicate');
});
