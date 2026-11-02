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

// The source may promote its own channel with a public link, an invite link
// (t.me/+... or t.me/joinchat/...), or a label directly above the link.
// A branded repost replaces that promotional footer, while preserving the
// advert details (price, phone, car model, seller description, etc.).
const TELEGRAM_SOURCE_LINK=/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_]{4,31}(?:\/\d+)?)(?:\?[^\s)]*)?/giu;
const SOURCE_FOOTER_HEADER=/^\s*(?:[📢🤖📩📌🔗✉️💬]\s*)?(?:kanalimiz|bizning\s+kanal|botimiz|reklama(?:\s+va\s+hamkorlik)?\s+uchun|manba|наш\s+канал|наш\s+бот|реклама|каналимиз|ботимиз|источник)\s*:?\s*(?:@[A-Za-z][A-Za-z0-9_]{4,31})?\s*$/iu;
const SOURCE_CTA_LABEL=/^\s*(?:👇|👆|👉|➡️|📢|🔗|📌)\s*[^0-9\n]{1,90}\s*$/u;
const TELEGRAM_HANDLE_ONLY=/^\s*@[A-Za-z][A-Za-z0-9_]{4,31}\s*$/;

function cleanSourceAdvertising(original){
  const lines=String(original||'').replace(/\r\n?/g,'\n').split('\n');
  const skip=new Set();

  // Handle source links first so that the call-to-action above them can be
  // removed without guessing at the meaning of unrelated advert lines.
  for(let i=0;i<lines.length;i++){
    TELEGRAM_SOURCE_LINK.lastIndex=0;
    if(!TELEGRAM_SOURCE_LINK.test(lines[i]))continue;
    TELEGRAM_SOURCE_LINK.lastIndex=0;
    const without=lines[i].replace(TELEGRAM_SOURCE_LINK,'').trim();
    if(!without || SOURCE_CTA_LABEL.test(without) || SOURCE_FOOTER_HEADER.test(without) ||
       /^[\s()[\]{}<>👇👆👉➡️🔗📢📌:;.,!-]*$/u.test(without)){
      skip.add(i);
    }else{
      // An ordinary advertisement line might contain content before a link.
      // Remove only the source link; keep actual price or seller details.
      lines[i]=without;
    }
    let prev=i-1;
    while(prev>=0 && !lines[prev].trim() && i-prev<=3)prev--;
    if(prev>=0 && i-prev<=3 && !skip.has(prev) &&
       (SOURCE_CTA_LABEL.test(lines[prev]) || SOURCE_FOOTER_HEADER.test(lines[prev])))
      skip.add(prev);
  }

  // Remove existing source branding, including a separate @username line
  // following "📢 Kanalimiz:" or similar headings.
  for(let i=0;i<lines.length;i++){
    if(skip.has(i))continue;
    if(SOURCE_FOOTER_HEADER.test(lines[i])){
      skip.add(i);
      if(i+1<lines.length && TELEGRAM_HANDLE_ONLY.test(lines[i+1]))skip.add(i+1);
      continue;
    }
    if(/^\s*(?:📌\s*)?(?:manba|источник)\s*:/iu.test(lines[i]))skip.add(i);
  }
  return lines.filter((_,i)=>!skip.has(i)).join('\n')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function buildClonePostText(original,cfg,limit=1024){
  return joinWithFooter(cleanSourceAdvertising(original),adFooter(cfg),limit);
}

function refreshClonePostText(existing,cfg,limit=1024){
  // Reuse the same source-cleaning rules for already published branded posts.
  // Strip our previous footer first; otherwise it would be appended again.
  const lines=String(existing||'').split('\n');
  const body=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^\s*(?:🤖\s*Botimiz|📢\s*Kanalimiz|📩\s*Reklama(?:\s+va\s+hamkorlik)?\s+uchun|📩\s*Reklama\s+va\s+hamkorlik)\s*:/iu.test(line)){
      if(/:\s*$/.test(line) && i+1<lines.length && TELEGRAM_HANDLE_ONLY.test(lines[i+1]))i++;
      continue;
    }
    body.push(line);
  }
  return joinWithFooter(cleanSourceAdvertising(body.join('\n')),adFooter(cfg),limit);
}

module.exports={contactUsername,adFooter,buildClonePostText,refreshClonePostText};
