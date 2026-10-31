'use strict';
// Speed up first selection by prefetching a couple of licensed Jamendo MP3s,
// and share completed downloads across searches/users on this process.
// Telegram file_id caching is persisted separately per bot in MongoDB.
const fs=require('node:fs/promises');
const {downloadLicensedMp3}=require('./music-mp3-upload');
const CACHE_TTL_MS=12*60*1000;
const MAX_CACHE_BYTES=28*1024*1024;
const MAX_ITEM_BYTES=16*1024*1024;
const MAX_ITEMS=4;
const entries=new Map();
let usedBytes=0;

function keyFor(track){
  const id=String(track?.id||'');
  if(!/^[1-9]\d*$/.test(id))throw new Error('Jamendo track ID missing');
  return id;
}
function remove(key){
  const rec=entries.get(key);
  if(!rec)return;
  entries.delete(key);
  if(rec.buffer)usedBytes=Math.max(0,usedBytes-rec.buffer.length);
}
function prune(){
  const now=Date.now();
  for(const [key,rec] of entries){
    if(rec.expires<=now && !rec.pending)remove(key);
  }
  while(entries.size>MAX_ITEMS){
    const first=[...entries].find(([,e])=>!e.pending);
    if(!first)break;
    remove(first[0]);
  }
}
async function fetchBuffer(track){
  const temp=await downloadLicensedMp3(track);
  try{return await fs.readFile(temp.filePath);}
  finally{await temp.cleanup().catch(()=>{});}
}
async function getMusicMp3Buffer(track){
  const key=keyFor(track);
  prune();
  const current=entries.get(key);
  if(current && current.expires>Date.now()){
    if(current.buffer){entries.delete(key);entries.set(key,current);return current.buffer;}
    if(current.pending)return current.pending;
  }
  if(current)remove(key);
  const rec={expires:Date.now()+CACHE_TTL_MS,pending:null,buffer:null};
  const promise=fetchBuffer(track).then(buf=>{
    rec.pending=null;
    if(entries.get(key)===rec && buf.length<=MAX_ITEM_BYTES){
      rec.buffer=buf;
      usedBytes+=buf.length;
      rec.expires=Date.now()+CACHE_TTL_MS;
      while(usedBytes>MAX_CACHE_BYTES){
        const old=[...entries].find(([k,v])=>k!==key && v.buffer && !v.pending);
        if(!old)break;
        remove(old[0]);
      }
    }else if(entries.get(key)===rec)remove(key);
    prune();
    return buf;
  }).catch(e=>{if(entries.get(key)===rec)remove(key);throw e;});
  rec.pending=promise;
  entries.set(key,rec);
  return promise;
}
function prefetchMusicTracks(tracks){
  for(const track of (tracks||[]).slice(0,2)){
    try{
      const key=keyFor(track);
      if(entries.has(key))continue;
      // Suppress a prefetch failure. Selection will report the real failure.
      void getMusicMp3Buffer(track).catch(e=>console.warn('[music] prefetch',key,String(e.message||e).slice(0,90)));
    }catch(_){}
  }
}
module.exports={getMusicMp3Buffer,prefetchMusicTracks};
