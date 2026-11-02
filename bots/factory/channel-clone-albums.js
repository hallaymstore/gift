'use strict';

const {buildClonePostText,hasSourcePromotionLink}=require('./channel-clone-branding');
const {createOrReuseInvite}=require('./channel-clone-invite');

const MAX_ALBUM_ITEMS=10;
const MAX_ALBUM_BYTES=45*1024*1024;

function groupedId(message){
  const value=message?.groupedId ?? message?.grouped_id;
  return value==null?'':String(value);
}
function albumType(message){
  const media=message?.media;
  if(media?.photo||media?.className==='MessageMediaPhoto')return 'photo';
  const doc=media?.document;
  if(doc && /^video\/mp4/i.test(String(doc.mimeType||'')))return 'video';
  return '';
}
function albumCaptionMessage(messages){
  // Telegram usually attaches an album's description to only ONE photograph.
  // Don't replace it with the next empty photo's branding.
  return [...messages].filter(m=>String(m?.message||'').trim())
    .sort((a,b)=>String(b.message).length-String(a.message).length)[0]||messages[0];
}
function albumYoung(messages,now=Date.now(),minAgeMs=8000){
  const stamps=messages.map(m=>m?.date).filter(x=>x!=null).map(x=>
    x instanceof Date?x.getTime():Number(x)*1000).filter(x=>Number.isFinite(x)&&x>0);
  return stamps.length>0 && now-Math.max(...stamps)<minAgeMs;
}
async function collectAlbumMembers(client,peer,message){
  const group=groupedId(message);
  if(!group)return [message];
  const anchor=Number(message.id);
  if(!Number.isSafeInteger(anchor)||anchor<=0)return [message];
  // Up to ten MTProto messages form one Telegram media group. Fetch around
  // the observed photo, even when history polling retrieves only 3 at a time.
  const ids=[];
  for(let id=Math.max(1,anchor-MAX_ALBUM_ITEMS);id<=anchor+MAX_ALBUM_ITEMS;id++)ids.push(id);
  const fetched=await client.getMessages(peer,{ids});
  const unique=new Map([[anchor,message]]);
  for(const m of Array.isArray(fetched)?fetched:[fetched]){
    if(m?.id&&groupedId(m)===group)unique.set(Number(m.id),m);
  }
  return [...unique.values()].sort((a,b)=>a.id-b.id).slice(0,MAX_ALBUM_ITEMS);
}

async function uploadMediaAlbum({client,telegram,chatId,messages,caption}){
  const {Input}=require('telegraf');
  const {MAX_UPLOAD_BYTES}=require('./channel-clone-media');
  if(messages.length<2||messages.length>MAX_ALBUM_ITEMS)
    throw new Error('Album uchun 2–10 ta foto/video kerak.');
  let bytes=0;
  const media=[];
  for(const m of messages){
    const type=albumType(m);
    if(!type)throw new Error('Bu albomda Telegram sendMediaGroup qo‘llamaydigan media turi bor.');
    const reported=Number(m.media?.document?.size||m.file?.size||0);
    if(reported>MAX_UPLOAD_BYTES||reported+bytes>MAX_ALBUM_BYTES)
      throw new Error('Albom umumiy hajmi 45 MB dan oshadi; avtomatik bo‘lib yuborilmadi.');
    const data=await client.downloadMedia(m,{});
    if(!Buffer.isBuffer(data)||!data.length)
      throw new Error('Albomdagi media fayli olinmadi.');
    bytes+=data.length;
    if(data.length>MAX_UPLOAD_BYTES||bytes>MAX_ALBUM_BYTES)
      throw new Error('Albom umumiy hajmi 45 MB dan oshadi; avtomatik bo‘lib yuborilmadi.');
    media.push({type,media:Input.fromBuffer(data,type==='photo'?'photo.jpg':'video.mp4')});
  }
  // One album message carries the caption, not every individual photograph.
  if(caption)media[0].caption=String(caption).slice(0,1024);
  const sent=await telegram.sendMediaGroup(chatId,media);
  if(!Array.isArray(sent)||sent.length!==media.length)
    throw new Error('Telegram albomni to‘liq yuborganini tasdiqlamadi; qo‘lda tekshiring.');
  return sent;
}

async function relayCloneAlbum({cfg,messages,client,telegram,Log,Config}){
  const sorted=[...messages].sort((a,b)=>Number(a.id)-Number(b.id));
  const albumId=groupedId(sorted[0]);
  if(!albumId||sorted.length<2)return {status:'failed',error:'Telegram albom ID yoki rasmlar yetarli emas.'};
  const source=String(cfg.source_username||cfg.source_chat_id||'').toLowerCase();
  const target=String(cfg.target_chat_id||'');
  if(!source||!target)return {status:'failed',error:'Manba yoki maqsad kanal/guruh ulanmagan.'};
  // Old builds copied photo-by-photo. Do not duplicate any partially copied
  // album while reprocessing history on a newly upgraded Cloner.
  const legacyKeys=sorted.flatMap(m=>[
    'public:'+source+':'+m.id,
    'public:'+source+':'+m.id+':target:'+target
  ]);
  const priorIndividual=await Log.findOne({bot_key:cfg.bot_key,status:'sent',
    target_chat_id:target,source_key:{$in:legacyKeys}}).lean();
  if(priorIndividual)return {status:'duplicate'};
  const key='public:'+source+':album:'+albumId+':target:'+target;
  let claimed=false;
  try{
    await Log.create({bot_key:cfg.bot_key,source_key:key,target_chat_id:target,status:'pending'});
    claimed=true;
  }catch(error){
    if(error?.code!==11000)throw error;
    const previous=await Log.findOne({bot_key:cfg.bot_key,source_key:key}).lean();
    if(previous?.status==='sent')return {status:'duplicate'};
    if(previous?.status!=='failed')return {status:'failed',error:'Albom avval yuborilmoqda yoki javob kutilmoqda.'};
    const updated=await Log.updateOne({bot_key:cfg.bot_key,source_key:key,
      status:'failed',target_message_id:{$in:[null,undefined]}},
      {$set:{status:'pending',error:''}});
    claimed=Boolean(updated?.modifiedCount);
    if(!claimed)return {status:'failed',error:'Albom xatoligi bo‘yicha tekshiruv kerak.'};
  }
  try{
    const original=cfg.clone_format==='original';
    const captionMessage=albumCaptionMessage(sorted);
    let sent;
    if(original && typeof telegram.copyMessages==='function' && cfg.source_username){
      try{
        sent=await telegram.copyMessages(target,'@'+cfg.source_username,
          sorted.map(m=>Number(m.id)));
      }catch(error){
        const reason=String(error?.description||error?.message||error);
        if(/CHAT_FORWARDS_RESTRICTED|protected content|copying is not allowed/i.test(reason))
          throw new Error('SOURCE_PROTECTED: manbada nusxalash cheklangan.');
      }
    }
    if(!sent){
      let caption=String(captionMessage?.message||'');
      if(!original){
        const destinationLink=hasSourcePromotionLink(caption)?
          await createOrReuseInvite({cfg,telegram,Config}):'';
        caption=buildClonePostText(caption,destinationLink?
          {...cfg,target_post_link:destinationLink}:cfg,1024);
      }
      sent=await uploadMediaAlbum({client,telegram,chatId:target,messages:sorted,caption});
    }
    const ids=(Array.isArray(sent)?sent:[]).map(x=>Number(x?.message_id||0));
    if(ids.length!==sorted.length||ids.some(x=>x<=0))
      throw new Error('Telegram albomga yuborilgan xabar IDlarini qaytarmadi; qo‘lda tekshiring.');
    await Log.updateOne({bot_key:cfg.bot_key,source_key:key},
      {$set:{status:'sent',target_message_id:ids[0],error:''}});
    return {status:'sent',message_ids:ids};
  }catch(error){
    const {describeRelayError}=require('./channel-clone-errors');
    const reason=describeRelayError(error,180);
    if(claimed)await Log.updateOne({bot_key:cfg.bot_key,source_key:key},
      {$set:{status:'failed',error:reason}}).catch(()=>{});
    return {status:'failed',error:reason};
  }
}
module.exports={groupedId,albumType,albumCaptionMessage,albumYoung,
  collectAlbumMembers,uploadMediaAlbum,relayCloneAlbum,MAX_ALBUM_ITEMS,MAX_ALBUM_BYTES};
