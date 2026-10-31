'use strict';

const MAX_MEDIA_BYTES = 18 * 1024 * 1024;
const LIVE_POLL_MS = 12000;
const HISTORY_POLL_MS = 60000;
const LIVE_BATCH_SIZE = 20;
const HISTORY_BATCH_SIZE = 2;

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
  return Boolean(message?.noforwards || message?.noForwards ||
    message?.chat?.noforwards || message?.chat?.noForwards);
}
function mediaKind(message) {
  const media = message?.media;
  if (!media) return 'text';
  if (media?.photo || media?.className === 'MessageMediaPhoto') return 'photo';
  const doc = media?.document;
  if (doc) {
    const mime = String(doc.mimeType || '');
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
  return !isProtected(message) && mediaKind(message)!=='unsupported' &&
    mediaBytes(message)<=MAX_MEDIA_BYTES;
}

// Track independently: (1) the newest post ID already seen, and
// (2) an oldest-to-newest historic cursor, bounded by the source's snapshot
// ID taken when the historic sync starts. New posts are never blocked by backfill.
async function scanLive({client,cfg,deliver,log=console}) {
  const handle=normalizePublicUsername(cfg.source_username);
  if(!handle)return;
  const entity='@'+handle;
  const cursor=Number(cfg.source_cursor||0);
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
    let result={status:'skipped'};
    if(canRepublish(message)){
      result=await deliver({type:'post',cfg,message,client,
        sourceUsername:handle,kind:mediaKind(message),phase:'live'})||result;
    }
    await deliver({type:'cursor',cfg,cursor:Number(message.id),result});
    cfg.source_cursor=Number(message.id);
  }
}
async function scanHistory({client,cfg,deliver,log=console}){
  if(cfg.history_enabled!==true || cfg.history_completed===true)return;
  const handle=normalizePublicUsername(cfg.source_username);
  if(!handle || Number(cfg.source_cursor||0)<=0)return; // live baseline first
  const ceiling=Number(cfg.history_ceiling||cfg.source_cursor);
  const before=Number(cfg.history_cursor||0);
  const batch=orderedIds(await client.getMessages('@'+handle,{
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
    if(message.id<=before)continue;
    if(message.id>ceiling){ended=true;break;}
    let result={status:'skipped'};
    if(canRepublish(message)){
      result=await deliver({type:'post',cfg,message,client,
        sourceUsername:handle,kind:mediaKind(message),phase:'history'})||result;
    }else log.warn('[channel sync] protected, unsupported or large historic item skipped',
      handle,message.id);
    await deliver({type:'history_cursor',cfg,cursor:Number(message.id),result});
    cfg.history_cursor=Number(message.id);
  }
  if(ended || batch[batch.length-1].id>=ceiling){
    await deliver({type:'history_complete',cfg,cursor:cfg.history_cursor||before});
    cfg.history_completed=true;
    log.info('[channel sync] historic complete',cfg.bot_key,handle);
  }
}

async function launchPublicChannelWatcher({env=process.env,listSources,deliver,log=console,client:injectedClient}){
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
  async function live(){
    if(stopped||liveRunning)return;
    liveRunning=true;
    try{
      const sources=await listSources();
      for(const cfg of sources){
        if(stopped)break;
        try{await scanLive({client,cfg,deliver,log});}
        catch(e){log.warn('[channel sync] live failed',cfg.bot_key,String(e.message||e).slice(0,160));}
      }
    }finally{liveRunning=false;}
  }
  async function history(){
    if(stopped||historyRunning)return;
    historyRunning=true;
    try{
      const sources=await listSources();
      for(const cfg of sources){
        if(stopped)break;
        try{await scanHistory({client,cfg,deliver,log});}
        catch(e){
          log.warn('[channel sync] history failed',cfg.bot_key,String(e.message||e).slice(0,150));
          await deliver({type:'history_error',cfg,error:String(e.message||e).slice(0,160)})
            .catch(()=>{});
        }
      }
    }finally{historyRunning=false;}
  }
  // Do not block server startup on a large post / download.
  void live();
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
