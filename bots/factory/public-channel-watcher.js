'use strict';

const {describeRelayError}=require('./channel-clone-errors');
const {resolveSourcePeer,sourceKey}=require('./channel-clone-peers');
const {groupedId,albumType,albumYoung,collectAlbumMembers}=require('./channel-clone-albums');

const MAX_MEDIA_BYTES = 18 * 1024 * 1024;
const LIVE_POLL_MS = 30000;
const HISTORY_POLL_MS = 30000;
const LIVE_BATCH_SIZE = 20;
const HISTORY_BATCH_SIZE = 3;

function sessionConfigured(env = process.env) {
  const id = Number(env.TELEGRAM_API_ID);
  return Number.isSafeInteger(id) && id > 0 &&
    Boolean(env.TELEGRAM_API_HASH && env.TELEGRAM_STRING_SESSION);
}
function normalizePublicUsername(value) {
  const name = String(value || '').trim().replace(/^@/, '')
    .replace(/^(?:https?:\/\/)?t\.me\//i,'').replace(/\/.*$/,'');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name) ? name : '';
}
function isProtected(message) {
  // Telegram MTProto message and channel flag: noforwards.
  return Boolean(message?.noforwards || message?.noForwards ||
    message?.chat?.noforwards || message?.chat?.noForwards ||
    message?.peer?.noforwards || message?.peer?.noForwards);
}
function mediaKind(message) {
  const media = message?.media;
  if (!media) return 'text';
  if (media?.photo || media?.className === 'MessageMediaPhoto') return 'photo';
  const doc = media?.document;
  if (doc) {
    const mime = String(doc.mimeType || '');
    const attrs=doc.attributes||[];
    if(attrs.some(a=>a.className==='DocumentAttributeSticker'))return 'sticker';
    if(attrs.some(a=>a.className==='DocumentAttributeAnimated'))return 'animation';
    if(mime.startsWith('audio/'))return 'audio';
    return mime.startsWith('video/') ? 'video' : 'document';
  }
  return 'unsupported';
}
function mediaBytes(message) {
  return Number(message?.media?.document?.size || message?.file?.size || 0);
}
function publicMessageData(message, handle) {
  const username = normalizePublicUsername(handle);
  return {
    text: String(message?.message || ''),
    caption: String(message?.message || ''),
    forward_origin: {
      type:'channel', chat:{id:0,username,title:username},
      message_id:Number(message?.id||0)
    },
    ...(mediaKind(message)==='video' ? {video:{}} :
      mediaKind(message)==='photo' ? {photo:[{}]} :
      mediaKind(message)==='document' ? {document:{}} : {})
  };
}
function orderedIds(messages) {
  return [...(messages || [])].filter(m=>Number(m?.id)>0)
    .sort((a,b)=>Number(a.id)-Number(b.id));
}
function canRepublish(message) {
  if(message?.action || (!message?.media && !String(message?.message||'').trim())) return false;
  return !isProtected(message) && mediaKind(message)!=='unsupported' &&
    true;
}

function isCloneRoute(cfg){
  return cfg?.bot_key==='channel_clone'||cfg?.owner_bot_key==='channel_clone'||
    String(cfg?.bot_key||'').startsWith('channel_clone:');
}
async function prepareAlbum({client,entity,message,isClone,phase,cursor}){
  if(!isClone||!groupedId(message))
    return {isAlbum:false,messages:[message]};
  const all=await collectAlbumMembers(client,entity,message);
  if(phase==='live'&&albumYoung(all))return {isAlbum:true,defer:true,messages:all};
  if(all.length<2)throw new Error('Telegram albomining qolgan rasmlari hali olinmadi.');
  // Never repeat a partly processed album from an older deployed version.
  if(all.some(m=>Number(m.id)<=Number(cursor||0)))
    return {isAlbum:true,partial:true,messages:all};
  if(all.some(m=>!albumType(m)))return {isAlbum:true,unsupported:true,messages:all};
  return {isAlbum:true,messages:all};
}

// Track independently: (1) the newest post ID already seen, and
// (2) an oldest-to-newest historic cursor, bounded by the source's snapshot
// ID taken when the historic sync starts. New posts are never blocked by backfill.
async function scanLive({client,cfg,deliver,log=console,isClone=isCloneRoute(cfg)}) {
  if(cfg.history_retry_at && new Date(cfg.history_retry_at).getTime()>Date.now())return;
  const handle=sourceKey(cfg);
  if(!handle)return;
  const entity=await resolveSourcePeer(client,cfg);
  const cursor=Number(cfg.source_cursor||0);
  // With a configured route interval, old and new posts share ONE delivery
  // schedule. Do not relay live posts ahead of the historic backlog.
  const interval=Number(cfg.publish_interval_minutes||0);
  if(cursor && interval>0){
    if(cfg.history_enabled && cfg.history_completed!==true)return;
    if(cfg.next_publish_at && new Date(cfg.next_publish_at).getTime()>Date.now())return;
  }
  const messages=cursor
    ? await client.getMessages(entity,{limit:LIVE_BATCH_SIZE,minId:cursor,reverse:true})
    : await client.getMessages(entity,{limit:1});
  const ordered=orderedIds(messages);
  if(!ordered.length)return;
  if(!cursor){
    const latest=ordered[ordered.length-1].id;
    await deliver({type:'seed',cfg,cursor:latest});
    cfg.source_cursor=latest;
    log.info('[channel sync] baseline',cfg.bot_key,handle,latest);
    return;
  }
  for(const message of ordered){
    if(Number(message.id)<=Number(cfg.source_cursor||0))continue;
    const album=await prepareAlbum({client,entity,message,isClone,phase:'live',cursor:cfg.source_cursor});
    if(album.defer)break; // allow Telegram to finish assembling a freshly posted album
    const lastId=album.isAlbum?Math.max(...album.messages.map(m=>Number(m.id))):Number(message.id);
    let result={status:'skipped'};
    if(album.partial) {
      // A previous build may have copied an initial image already; do not
      // publish the remaining images as a second partial album.
      result={status:'duplicate'};
    }else if(album.unsupported){
      result={status:'failed',error:'Albomdagi media turlari Telegram albom sifatida yuborilmaydi.'};
    }else if(album.isAlbum && album.messages.some(isProtected)){
      result=await deliver({type:'protected',cfg,message,
        sourceUsername:handle,phase:'live'})||{status:'protected'};
    }else if(album.isAlbum){
      result=await deliver({type:'album',cfg,message,client,
        messages:album.messages,sourceUsername:handle,kind:'album',phase:'live'})||result;
    }else if(isProtected(message)){
      result=await deliver({type:'protected',cfg,message,sourceUsername:handle,phase:'live'})
        ||{status:'protected'};
    }else if(canRepublish(message)){
      result=await deliver({type:'post',cfg,message,client,
        sourceUsername:handle,kind:mediaKind(message),phase:'live'})||result;
    }
    if(result?.status==='failed') {
      log.warn('[channel sync] live relay failed; cursor stays at',message.id);
      await deliver({type:'live_error',cfg,error:describeRelayError(result.error||'Post relay failed')}).catch(()=>{});
      break;
    }
    await deliver({type:'cursor',cfg,cursor:lastId,result});
    cfg.source_cursor=lastId;
    if(result?.status==='sent' && interval>0){
      cfg.next_publish_at=new Date(Date.now()+interval*60000);
      break;
    }
  }
}
async function scanHistory({client,cfg,deliver,log=console,isClone=isCloneRoute(cfg)}){
  if(cfg.history_enabled!==true || cfg.history_completed===true)return;
  if(cfg.history_retry_at && new Date(cfg.history_retry_at).getTime()>Date.now())return;
  if(Number(cfg.publish_interval_minutes)>0 && cfg.next_publish_at && new Date(cfg.next_publish_at).getTime()>Date.now())return;
  const handle=sourceKey(cfg);
  if(!handle || Number(cfg.source_cursor||0)<=0)return; // live baseline first
  const entity=await resolveSourcePeer(client,cfg);
  const ceiling=Number(cfg.history_ceiling||cfg.source_cursor);
  if(!Number(cfg.history_ceiling)){
    await deliver({type:'history_begin',cfg,ceiling});
    cfg.history_ceiling=ceiling;
  }
  const before=Number(cfg.history_cursor||0);
  const batch=orderedIds(await client.getMessages(entity,{
    limit:HISTORY_BATCH_SIZE,reverse:true,minId:before
  }));
  if(!batch.length){
    await deliver({type:'history_complete',cfg,cursor:before});
    cfg.history_completed=true;
    log.info('[channel sync] historic complete',cfg.bot_key,handle);
    return;
  }
  let ended=false;
  for(const message of batch){
    if(message.id<=Number(cfg.history_cursor||before))continue;
    if(message.id>ceiling){ended=true;break;}
    const album=await prepareAlbum({client,entity,message,isClone,phase:'history',cursor:cfg.history_cursor||before});
    const lastId=album.isAlbum?Math.max(...album.messages.map(m=>Number(m.id))):Number(message.id);
    let result={status:'skipped'};
    if(album.partial){
      result={status:'duplicate'};
    }else if(album.unsupported){
      result={status:'failed',error:'Albomdagi media turlari Telegram albom sifatida yuborilmaydi.'};
    }else if(album.isAlbum && album.messages.some(isProtected)){
      result=await deliver({type:'protected',cfg,message,
        sourceUsername:handle,phase:'history'})||{status:'protected'};
    }else if(album.isAlbum){
      result=await deliver({type:'album',cfg,message,client,
        messages:album.messages,sourceUsername:handle,kind:'album',phase:'history'})||result;
    }else if(isProtected(message)){
      result=await deliver({type:'protected',cfg,message,sourceUsername:handle,phase:'history'})
        ||{status:'protected'};
    }else if(canRepublish(message)){
      result=await deliver({type:'post',cfg,message,client,
        sourceUsername:handle,kind:mediaKind(message),phase:'history'})||result;
    }else log.warn('[channel sync] unsupported historic item skipped',handle,message.id);
    if(result?.status==='failed'){
      throw new Error('History post '+message.id+' could not be relayed: '+describeRelayError(result.error||'see server logs'));
    }
    await deliver({type:'history_cursor',cfg,cursor:lastId,result});
    cfg.history_cursor=lastId;
    if(result?.status==='sent' && Number(cfg.publish_interval_minutes)>0){
      cfg.next_publish_at=new Date(Date.now()+Number(cfg.publish_interval_minutes)*60000);
      break;
    }
  }
  if(ended || batch[batch.length-1].id>=ceiling){
    await deliver({type:'history_complete',cfg,cursor:cfg.history_cursor||before});
    cfg.history_completed=true;
    log.info('[channel sync] historic complete',cfg.bot_key,handle);
  }
}

async function launchPublicChannelWatcher({env=process.env,listSources,deliver,log=console,client:injectedClient,isClonerRoute=isCloneRoute}){
  if(!injectedClient && !sessionConfigured(env))
    return {enabled:false,reason:'missing_user_session',stop:async()=>{}};
  let client=injectedClient;
  if(!client){
    const {TelegramClient}=require('teleproto');
    const {StringSession}=require('teleproto/sessions');
    client=new TelegramClient(new StringSession(env.TELEGRAM_STRING_SESSION),
      Number(env.TELEGRAM_API_ID),env.TELEGRAM_API_HASH,{connectionRetries:3});
    await client.connect();
    if(!await client.isUserAuthorized()){
      await client.disconnect();
      return {enabled:false,reason:'invalid_user_session',stop:async()=>{}};
    }
  }
  let stopped=false;
  let liveRunning=false;
  let historyRunning=false;
  // Shared MTProto user accounts have FloodWait limits. Spread up to 20 routes
  // across polling ticks rather than requesting every channel in one burst.
  const PER_TICK=6;
  let liveOffset=0,historyOffset=0;
  function nextBatch(sources,type){
    if(!sources.length)return [];
    const offset=type==='live'?liveOffset:historyOffset;
    const count=Math.min(PER_TICK,sources.length);
    const batch=Array.from({length:count},(_,i)=>sources[(offset+i)%sources.length]);
    if(type==='live')liveOffset=(offset+count)%sources.length;
    else historyOffset=(offset+count)%sources.length;
    return batch;
  }
  async function live(){
    if(stopped||liveRunning)return;
    liveRunning=true;
    try{
      const sources=await listSources();
      for(const cfg of nextBatch(sources,'live')){
        if(stopped)break;
        try{await scanLive({client,cfg,deliver,log,isClone:isClonerRoute(cfg)});}
        catch(e){log.warn('[channel sync] live failed',cfg.bot_key,describeRelayError(e,160));}
      }
    }catch(e){log.warn('[channel sync] source listing failed',String(e.message||e).slice(0,160));}
    finally{liveRunning=false;}
  }
  async function history(){
    if(stopped||historyRunning)return;
    historyRunning=true;
    try{
      const sources=await listSources();
      for(const cfg of nextBatch(sources,'history')){
        if(stopped)break;
        try{await scanHistory({client,cfg,deliver,log,isClone:isClonerRoute(cfg)});}
        catch(e){
          log.warn('[channel sync] history failed',cfg.bot_key,describeRelayError(e,150));
          await deliver({type:'history_error',cfg,error:String(e.message||e).slice(0,160)})
            .catch(()=>{});
        }
      }
    }catch(e){log.warn('[channel sync] source listing failed',String(e.message||e).slice(0,160));}
    finally{historyRunning=false;}
  }
  // Start new post tracking and then historical sync immediately.
  // Neither one blocks HTTP startup.
  void (async()=>{await live();await history();})();
  const liveTimer=setInterval(()=>{void live();},LIVE_POLL_MS);
  const historyTimer=setInterval(()=>{void history();},HISTORY_POLL_MS);
  liveTimer.unref?.();
  historyTimer.unref?.();
  return {enabled:true,reason:'ready',scanLive:live,scanHistory:history,
    stop:async()=>{stopped=true;clearInterval(liveTimer);clearInterval(historyTimer);
      if(!injectedClient)await client.disconnect();}};
}
module.exports={
  MAX_MEDIA_BYTES,LIVE_POLL_MS,HISTORY_POLL_MS,LIVE_BATCH_SIZE,HISTORY_BATCH_SIZE,
  sessionConfigured,normalizePublicUsername,isProtected,mediaKind,mediaBytes,
  publicMessageData,orderedIds,canRepublish,scanLive,scanHistory,launchPublicChannelWatcher
};
