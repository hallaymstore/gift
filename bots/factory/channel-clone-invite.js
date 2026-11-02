'use strict';

const {getTargetPostLink}=require('./channel-clone-branding');

// Cache one invite per destination route. Do not create a new Telegram invite
// for every copied post; Telegram channels can have thousands of posts.
const inFlight=new Map();
const resolved=new Map();
const RETRY_AFTER_FAILED_CREATE_MS=3*60*60*1000;

async function createOrReuseInvite({cfg,telegram,Config,force=false,now=Date.now()}){
  const key=String(cfg?.bot_key||'');
  const chatId=String(cfg?.target_chat_id||'');
  if(!key || !chatId)return getTargetPostLink(cfg);
  const mapKey=key+':'+chatId;
  if(!force && resolved.has(mapKey))return resolved.get(mapKey);
  if(inFlight.has(mapKey))return inFlight.get(mapKey);
  const run=(async()=>{
    const fallback=getTargetPostLink({...cfg,target_invite_link:'',target_post_link:''});
    const record=await Config.findOne({bot_key:key,target_chat_id:chatId})
      .select('target_invite_link target_invite_chat_id target_invite_attempt_at').lean();
    if(!record)return fallback;
    const fromDb=getTargetPostLink({...cfg,...record,target_post_link:''});
    if(record.target_invite_link && String(record.target_invite_chat_id||'')===chatId
       && fromDb!==fallback){
      resolved.set(mapKey,fromDb);
      return fromDb;
    }
    const attempted=record.target_invite_attempt_at?new Date(record.target_invite_attempt_at).getTime():0;
    if(!force && attempted && now-attempted<RETRY_AFTER_FAILED_CREATE_MS){
      resolved.set(mapKey,fallback);
      return fallback;
    }
    if(typeof telegram?.createChatInviteLink!=='function'){
      resolved.set(mapKey,fallback);
      return fallback;
    }
    try{
      // Requires can_invite_users permission, separate from can_post_messages.
      const created=await telegram.createChatInviteLink(chatId,{name:'Cloner branded post'});
      const link=String(created?.invite_link||'');
      const valid=/^https:\/\/t\.me\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)$/.test(link);
      if(!valid)throw new Error('Telegram did not return a usable invite link');
      const update=await Config.updateOne({bot_key:key,target_chat_id:chatId},
        {$set:{target_invite_link:link,target_invite_chat_id:chatId,target_invite_attempt_at:new Date(now)}});
      if(!update?.matchedCount)return fallback;
      resolved.set(mapKey,link);
      return link;
    }catch(error){
      // For public channels, the public t.me/username still works. Never put
      // raw Telegram errors into stored config or user-visible status.
      await Config.updateOne({bot_key:key,target_chat_id:chatId},
        {$set:{target_invite_attempt_at:new Date(now)}}).catch(()=>{});
      resolved.set(mapKey,fallback);
      return fallback;
    }
  })();
  inFlight.set(mapKey,run);
  try{return await run;}finally{inFlight.delete(mapKey);}
}

function forgetRouteInvite(cfg){
  const key=String(cfg?.bot_key||'')+':'+String(cfg?.target_chat_id||'');
  resolved.delete(key);
}

module.exports={createOrReuseInvite,forgetRouteInvite};
