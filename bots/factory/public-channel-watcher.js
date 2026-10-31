'use strict';

// Optional authenticated Telegram user client for public-channel monitoring.
// Requires a user-controlled Telegram session in server environment variables.
// The bot itself never obtains source-channel administrator privileges.
const MAX_MEDIA_BYTES = 18 * 1024 * 1024;
const POLL_MS = 90000;
const MAX_PER_POLL = 12;

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
    if (mime.startsWith('video/')) return 'video';
    return 'document';
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
      type: 'channel', chat: { id: 0, username, title: username },
      message_id: Number(message?.id || 0)
    },
    ...(mediaKind(message) === 'video' ? {video:{}} :
      mediaKind(message) === 'photo' ? {photo:[{}]} :
      mediaKind(message) === 'document' ? {document:{}} : {})
  };
}

async function launchPublicChannelWatcher({env = process.env, listSources, deliver, log = console}) {
  if (!sessionConfigured(env)) return { enabled:false, reason:'missing_user_session', stop:async()=>{} };
  const {TelegramClient} = require('telegram');
  const {StringSession} = require('telegram/sessions');
  const client = new TelegramClient(
    new StringSession(env.TELEGRAM_STRING_SESSION),
    Number(env.TELEGRAM_API_ID), env.TELEGRAM_API_HASH,
    { connectionRetries: 3 }
  );
  await client.connect();
  if (!await client.isUserAuthorized()) {
    await client.disconnect();
    return { enabled:false,reason:'invalid_user_session',stop:async()=>{} };
  }

  let running = false;
  let stopped = false;
  async function poll() {
    if (stopped || running) return;
    running = true;
    try {
      const sources = await listSources();
      for (const cfg of sources) {
        if (stopped) break;
        const handle = normalizePublicUsername(cfg.source_username);
        if (!handle) continue;
        try {
          const latest = await client.getMessages('@' + handle, {limit:MAX_PER_POLL});
          const ordered = [...latest].filter(m=>m?.id).sort((a,b)=>a.id-b.id);
          if (!ordered.length) continue;
          // Starting a watch begins with future posts; no backfill/flood.
          if (!Number(cfg.source_cursor)) {
            await deliver({type:'seed',cfg,cursor:ordered[ordered.length-1].id});
            continue;
          }
          for (const message of ordered) {
            if (Number(message.id)<=Number(cfg.source_cursor)) continue;
            // Always advance cursor even for protected or unsupported items.
            if (!isProtected(message) && mediaKind(message)!=='unsupported' &&
                mediaBytes(message)<=MAX_MEDIA_BYTES) {
              await deliver({type:'post',cfg,message,client,
                sourceUsername:handle,kind:mediaKind(message)});
            } else {
              log.warn('[public channel watcher] skipping protected/large/unsupported post',handle,message.id);
            }
            await deliver({type:'cursor',cfg,cursor:Number(message.id)});
            cfg.source_cursor = Number(message.id);
          }
        } catch(err) {
          log.warn('[public channel watcher] source failed',handle,String(err.message || err).slice(0,130));
        }
      }
    } catch(err) {
      log.warn('[public channel watcher] poll failed',String(err.message || err).slice(0,150));
    } finally {running=false;}
  }
  await poll();
  const timer = setInterval(()=>{void poll();},POLL_MS);
  if (timer.unref) timer.unref();
  return {
    enabled:true, reason:'ready',
    stop:async()=>{stopped=true;clearInterval(timer);await client.disconnect();}
  };
}
module.exports = {
  MAX_MEDIA_BYTES, POLL_MS, sessionConfigured, normalizePublicUsername,
  isProtected, mediaKind, mediaBytes, publicMessageData, launchPublicChannelWatcher
};