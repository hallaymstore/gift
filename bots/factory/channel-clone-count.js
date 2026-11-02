'use strict';
const {mediaKind}=require('./public-channel-watcher');
const {resolveSourcePeer}=require('./channel-clone-peers');

function emptyCounts(){
  return {total:0,photo:0,video:0,audio:0,document:0,sticker:0,animation:0,text:0,links:0,other:0};
}
function hasLink(m){
  const t=String(m.message||'');
  return /(?:https?:\/\/|t\.me\/|www\.|@[A-Za-z][A-Za-z0-9_]{4,31})/i.test(t) ||
    (m.entities||[]).some(e=>/MessageEntity(?:TextUrl|Url)/.test(String(e.className||'')));
}
async function countSourcePosts(client,source,{onProgress,limitPages=10000}={}){
  const counts=emptyCounts();
  const peer=typeof source==='string'?'@'+String(source).replace(/^@/,''):await resolveSourcePeer(client,source);
  let offsetId=0, pages=0, lastId=0;
  while(pages++<limitPages){
    const opts={limit:100};
    if(offsetId)opts.offsetId=offsetId;
    const batch=await client.getMessages(peer,opts);
    if(!batch?.length)break;
    for(const m of batch){
      const id=Number(m?.id||0);
      if(!id || m.action || (!m.media && !String(m.message||'').trim()))continue;
      counts.total++;
      const type=mediaKind(m);
      if(Object.prototype.hasOwnProperty.call(counts,type))counts[type]++;
      else counts.other++;
      if(hasLink(m))counts.links++;
      lastId=Math.max(lastId,id);
    }
    const next=Math.min(...batch.map(x=>Number(x?.id||0)).filter(Boolean));
    if(!Number.isFinite(next)||next<=0||next>=offsetId&&offsetId>0)
      throw new Error('History pagination did not progress');
    offsetId=next;
    if(onProgress&&pages%10===0)await onProgress({...counts});
    if(batch.length<100)break;
  }
  if(pages>limitPages)throw new Error('History scan page limit reached');
  return {...counts,last_message_id:lastId,scanned_at:new Date()};
}
module.exports={countSourcePosts,emptyCounts};
