'use strict';

const {telegramHandle}=require('./channel-publisher');

// Only Telegram public usernames (not arbitrary links) can be saved in the footer.
function contactUsername(input){
  return telegramHandle(input);
}

function adFooter(cfg={}){
  const bot=contactUsername(cfg.promo_bot_username);
  const channel=contactUsername(cfg.target_username);
  const admin=contactUsername(cfg.promo_admin_username);
  return [
    bot?'🤖 Botimiz: @'+bot:'',
    channel?'📢 Kanalimiz: @'+channel:'',
    admin?'📩 Reklama uchun: @'+admin:''
  ].filter(Boolean).join('\n');
}

function fitText(text,max){
  const value=String(text||'').slice(0,Math.max(0,max));
  // Avoid cutting a surrogate pair in the middle of a custom emoji.
  return /[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value;
}

function joinWithFooter(body,footer,maxChars){
  const limit=Math.min(4096,Math.max(1,Number(maxChars)||1024));
  const suffix=footer?('\n\n'+footer):'';
  if(suffix.length>=limit)return fitText(footer,limit);
  const trimmed=fitText(String(body||'').trim(),limit-suffix.length).trim();
  return [trimmed,footer].filter(Boolean).join('\n\n');
}

function cleanSourceAdvertising(original){
  // Existing Cloner branded behavior: remove source-channel references only
  // in the explicit Branded mode; Original mode remains untouched.
  return String(original||'')
    .replace(/https?:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}(?:\?[^\s]*)?/gi,'')
    .replace(/@[A-Za-z][A-Za-z0-9_]{4,31}/g,'')
    .replace(/(?:📌\s*)?Manba\s*:[^\n]*/giu,'')
    .replace(/\n{3,}/g,'\n\n').trim();
}

function buildClonePostText(original,cfg,limit=1024){
  return joinWithFooter(cleanSourceAdvertising(original),adFooter(cfg),limit);
}

function refreshClonePostText(existing,cfg,limit=1024){
  const body=String(existing||'').split('\n').filter(line=>{
    if(/^\s*(?:📌\s*)?Manba\s*:/iu.test(line))return false;
    if(/^\s*(?:🤖\s*Botimiz|📢\s*Kanalimiz|📩\s*Reklama(?:\s+va\s+hamkorlik)?\s+uchun|📩\s*Reklama\s+va\s+hamkorlik)\s*:/iu.test(line))return false;
    return true;
  }).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  return joinWithFooter(body,adFooter(cfg),limit);
}

module.exports={contactUsername,adFooter,buildClonePostText,refreshClonePostText};
