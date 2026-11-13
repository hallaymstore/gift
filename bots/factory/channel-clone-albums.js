'use strict';
const {feedbackEdits}=require('./channel-clone-branding');

const {normalizePhone,normalizeUsername,replaceApprovedPhoneContacts,sourceAdminUsernameSet}=require('./channel-clone-contacts');

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

const CONTACT_TOKEN=/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[A-Za-z][A-Za-z0-9_]{4,31}(?![A-Za-z0-9_]|\/\d)|(?<![\w@])@[A-Za-z][A-Za-z0-9_]{4,31}|(?<!\d)\+?998(?:[\s().-]*\d){9}(?!\d)/gi;
const ENTITY_TYPES={
  Mention:'mention',Hashtag:'hashtag',Cashtag:'cashtag',BotCommand:'bot_command',
  Url:'url',Email:'email',Phone:'phone_number',Bold:'bold',Italic:'italic',
  Underline:'underline',Strike:'strikethrough',Spoiler:'spoiler',Code:'code',
  Pre:'pre',TextUrl:'text_link',MentionName:'text_mention',CustomEmoji:'custom_emoji',
  Blockquote:'blockquote'
};

function adminContactCaption(cfg){
  const admin=normalizeUsername(cfg.promo_admin_username);
  const phone=normalizePhone(cfg.promo_admin_phone);
  return [admin?'👤 Admin: @'+admin:'',phone?'☎️ Admin telefoni: '+phone:'']
    .filter(Boolean).join('\n');
}

function albumCaptions(messages,cfg){
  const first=messages.findIndex(message=>String(message.message||'').trim());
  const captions=messages.map((message,index)=>albumCaption(message,cfg,index===first));
  if(captions.every(item=>!item.caption.trim())){
    const caption=adminContactCaption(cfg);
    const combined=caption+feedbackEdits(caption,cfg).map(edit=>edit.value).join('');
    if(combined)captions[0]={caption:combined,entities:[],changed:true};
  }
  return captions;
}

function albumCaption(message,cfg,includeFeedback=true){
  const original=String(message.message||'');
  const approvedUsers=sourceAdminUsernameSet(cfg.source_admin_usernames);
  const admin=normalizeUsername(cfg.promo_admin_username);
  const phoneOptions={adminPhone:normalizePhone(cfg.promo_admin_phone),
    sourceAdminPhones:cfg.source_admin_phones};
  const source=normalizeUsername(cfg.source_username).toLowerCase();
  const target=normalizeUsername(cfg.target_username);
  function replaceUsername(value,offset){
    const start=original.lastIndexOf('\n',offset-1)+1;
    const prefix=original.slice(start,offset).trim();
    if(/(?:kanal\s+egasi|sotuvchi|seller|muallif|продавец|владелец)\s*[:：–—-]?\s*$/iu.test(prefix))return value;
    if(admin&&(approvedUsers.has(value.toLowerCase())||
       /(?:^|[^\p{L}])(?:admin(?:istrator)?|админ|администратор)\s*[:：–—-]?\s*$/iu.test(prefix)))return admin;
    return source&&target&&value.toLowerCase()===source?target:value;
  }
  function replaceLink(url,offset){
    return url.replace(/^((?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/)([a-z][a-z0-9_]{4,31})(?=$|[?#])/i,
      (match,prefix,name)=>prefix+replaceUsername(name,offset));
  }
  const feedback=original.trim()?feedbackEdits(original,includeFeedback?cfg:{...cfg,feedback_mode:cfg.feedback_mode==='replace'?'remove':cfg.feedback_mode}):[];
  const edits=[...feedback];
  original.replace(CONTACT_TOKEN,(value,offset)=>{
    if(feedback.some(edit=>offset>=edit.start&&offset<edit.end))return value;
    const replacement=value.startsWith('@')?'@'+replaceUsername(value.slice(1),offset):
      /^(?:\+?998)/.test(value)?replaceApprovedPhoneContacts(value,phoneOptions):replaceLink(value,offset);
    if(value!==replacement)edits.push({start:offset,end:offset+value.length,value:replacement});
    return replacement;
  });
  edits.sort((a,b)=>a.start-b.start);
  let caption=original;
  for(const edit of [...edits].reverse())caption=caption.slice(0,edit.start)+edit.value+caption.slice(edit.end);
  function mapOffset(offset,isEnd){
    let shift=0;
    for(const edit of edits){
      if(offset<=edit.start)break;
      if(offset<edit.end)return edit.start+shift+(isEnd?edit.value.length:0);
      shift+=edit.value.length-(edit.end-edit.start);
    }
    return offset+shift;
  }
  const entities=[];
  let linksChanged=false;
  for(const entity of message.entities||[]){
    if(feedback.some(edit=>entity.offset<edit.end&&entity.offset+entity.length>edit.start))continue;
    const type=ENTITY_TYPES[String(entity.className||'').replace(/^MessageEntity/,'')];
    if(!type)continue;
    const offset=mapOffset(entity.offset,false);
    const length=mapOffset(entity.offset+entity.length,true)-offset;
    if(length<=0)continue;
    const output={type,offset,length};
    if(type==='pre')output.language=entity.language;
    if(type==='text_link'){
      output.url=replaceLink(String(entity.url||''),entity.offset);
      linksChanged ||= output.url!==entity.url;
    }
    if(type==='custom_emoji')output.custom_emoji_id=String(entity.documentId);
    if(type==='text_mention')output.user={id:Number(entity.userId),is_bot:false,first_name:''};
    if(type==='blockquote'&&entity.collapsed)output.type='expandable_blockquote';
    entities.push(output);
  }
  return {caption,entities,changed:caption!==original||linksChanged};
}

async function uploadMediaAlbum({client,telegram,chatId,messages,captions,caption:legacyCaption}){
  const {Input}=require('telegraf');
  const {MAX_UPLOAD_BYTES}=require('./channel-clone-media');
  if(messages.length<2||messages.length>MAX_ALBUM_ITEMS)
    throw new Error('Album uchun 2–10 ta foto/video kerak.');
  let bytes=0;
  const media=[];
  for(const [index,m] of messages.entries()){
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
    const item={type,media:Input.fromBuffer(data,type==='photo'?'photo.jpg':'video.mp4')};
    const {caption,entities=[]}=captions?.[index]||{caption:index===0?legacyCaption:''};
    if(caption){
      item.caption=caption;
      if(entities.length)item.caption_entities=entities;
    }
    if(m.media?.spoiler)item.has_spoiler=true;
    if(m.invertMedia)item.show_caption_above_media=true;
    media.push(item);
  }
  const sent=await telegram.sendMediaGroup(chatId,media);
  if(!Array.isArray(sent)||sent.length!==media.length)
    throw new Error('Telegram albomni to‘liq yuborganini tasdiqlamadi; qo‘lda tekshiring.');
  return sent;
}

async function relayCloneAlbum({cfg,messages,client,telegram,Log}){
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
  let delivered=false;
  try{
    const captions=albumCaptions(sorted,cfg);
    const sourceChat=cfg.source_username?'@'+cfg.source_username:cfg.source_chat_id;
    let sent;
    if(sourceChat){
      try{
        sent=await telegram.callApi('copyMessages',{
          chat_id:target,from_chat_id:sourceChat,message_ids:sorted.map(m=>Number(m.id))
        });
      }catch(error){
        const reason=String(error?.description||error?.message||error);
        if(/CHAT_FORWARDS_RESTRICTED|protected content|copying is not allowed/i.test(reason))
          throw new Error('SOURCE_PROTECTED: manbada nusxalash cheklangan.');
        if(Number(error?.code||error?.response?.error_code)!==400)throw error;
      }
    }
    const copied=Array.isArray(sent)&&sent.length>0;
    if(!copied){
      const peer=cfg.target_username?'@'+cfg.target_username:target;
      const posted=await client.sendFile(peer,{
        file:sorted.map(item=>item.media),
        caption:captions.map(item=>item.caption),
        parseMode:null
      });
      sent=(Array.isArray(posted)?posted:[]).map(item=>({message_id:item.id}));
    }
    delivered=Array.isArray(sent)&&sent.length>0;
    const ids=(Array.isArray(sent)?sent:[]).map(x=>Number(x?.message_id||0));
    if(ids.length!==sorted.length||ids.some(x=>x<=0))
      throw new Error('Telegram albomga yuborilgan xabar IDlarini qaytarmadi; qo‘lda tekshiring.');
    if(copied){
      for(const [index,item] of captions.entries()){
        if(!item.changed)continue;
        await telegram.editMessageCaption(target,ids[index],undefined,item.caption,{
          caption_entities:item.entities
        });
      }
    }
    await Log.updateOne({bot_key:cfg.bot_key,source_key:key},
      {$set:{status:'sent',target_message_id:ids[0],error:''}});
    return {status:'sent',message_ids:ids};
  }catch(error){
    const {describeRelayError}=require('./channel-clone-errors');
    const reason=describeRelayError(error,180);
    if(claimed&&!delivered)await Log.updateOne({bot_key:cfg.bot_key,source_key:key},
      {$set:{status:'failed',error:reason}}).catch(()=>{});
    return {status:'failed',error:reason};
  }
}
module.exports={groupedId,albumType,albumCaptionMessage,albumCaption,adminContactCaption,albumCaptions,albumYoung,
  collectAlbumMembers,uploadMediaAlbum,relayCloneAlbum,MAX_ALBUM_ITEMS,MAX_ALBUM_BYTES};
