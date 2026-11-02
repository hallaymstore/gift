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

// Source channel promotion links may be public t.me handles or private
// t.me/+ /joinchat invitations. Replace their actual URLs with a link
// targeting our destination, rather than leaving a competing source link.
const TELEGRAM_SOURCE_LINK=/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_]{4,31}(?:\/\d+)?)(?:\?[^\s)]*)?/giu;
const SOURCE_FOOTER_HEADER=/^\s*(?:[📢🤖📩📌🔗✉️💬]\s*)?(?:kanalimiz|bizning\s+kanal|botimiz|reklama(?:\s+va\s+hamkorlik)?\s+uchun|manba|наш\s+канал|наш\s+бот|реклама|каналимиз|ботимиз|источник)\s*:?\s*(?:@[A-Za-z][A-Za-z0-9_]{4,31})?\s*$/iu;
const SOURCE_CTA_LABEL=/^\s*(?:👇|👆|👉|➡️|📢|🔗|📌)\s*[^0-9\n]{1,90}\s*$/u;
const TELEGRAM_HANDLE_ONLY=/^\s*@[A-Za-z][A-Za-z0-9_]{4,31}\s*$/;
const SELLER_LINK_CONTEXT=/\b(?:sotuvchi|seller|aloqa|telefon|telegram|contact|сотувчи|продавец|связаться|контакт)\b/iu;

function validInviteLink(value){
  const link=String(value||'').trim();
  return /^https:\/\/t\.me\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)$/.test(link)?link:'';
}
function getTargetPostLink(cfg={}){
  const target=String(cfg.target_chat_id||'');
  const cached=validInviteLink(cfg.target_post_link || (
    cfg.target_invite_chat_id && String(cfg.target_invite_chat_id)===target
      ? cfg.target_invite_link:''
  ));
  if(cached)return cached;
  // If the bot cannot create an invite, the public channel URL is still a
  // reliable destination. Never make up a private invite token.
  const handle=contactUsername(cfg.target_username);
  return handle?'https://t.me/'+handle:'';
}
function hasSourcePromotionLink(text){
  TELEGRAM_SOURCE_LINK.lastIndex=0;
  return TELEGRAM_SOURCE_LINK.test(String(text||''));
}

function cleanSourceAdvertising(original,cfg={}){
  const lines=String(original||'').replace(/\r\n?/g,'\n').split('\n');
  const result=[];
  const replacement=getTargetPostLink(cfg);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    TELEGRAM_SOURCE_LINK.lastIndex=0;
    const matches=[...line.matchAll(TELEGRAM_SOURCE_LINK)];
    if(!matches.length){
      // Replace obsolete source call-to-action only when its next nonblank
      // line is a Telegram promotion. Do not alter ordinary selling details.
      if(SOURCE_FOOTER_HEADER.test(line)){
        if(i+1<lines.length && TELEGRAM_HANDLE_ONLY.test(lines[i+1]))i++;
        continue;
      }
      if(/^\s*(?:📌\s*)?(?:manba|источник)\s*:/iu.test(line))continue;
      if(SOURCE_CTA_LABEL.test(line)){
        let next=i+1;
        while(next<lines.length && !lines[next].trim() && next-i<=3)next++;
        if(next<lines.length && next-i<=3){
          TELEGRAM_SOURCE_LINK.lastIndex=0;
          if(TELEGRAM_SOURCE_LINK.test(lines[next])){
            result.push('👇 Bizning kanal');
            continue;
          }
        }
      }
      result.push(line);
      continue;
    }
    // "telegram.me" is a domain, not evidence this URL belongs to
    // the seller. Exclude Telegram links before checking seller context:
    // otherwise every telegram.me/joinchat invite remains in cloned ads.
    const trimmed=line.trim();
    const onlyLink=matches.length===1 && trimmed===matches[0][0];
    const isChatInvite=matches.some(match=>/\/(?:\+|joinchat\/)/i.test(match[0]));
    const surroundingText=line.replace(TELEGRAM_SOURCE_LINK,'').trim();
    if(!onlyLink && !isChatInvite && SELLER_LINK_CONTEXT.test(surroundingText) &&
       !SOURCE_FOOTER_HEADER.test(line) && !SOURCE_CTA_LABEL.test(line)){
      result.push(line);
      continue;
    }
    const isPromotional=onlyLink||SOURCE_CTA_LABEL.test(line)||
      SOURCE_FOOTER_HEADER.test(line) || /(?:kanal|channel|канал|manba|источник)/iu.test(line);
    if(!isPromotional){
      // A URL embedded in the seller's description is not our promotion.
      result.push(line);
      continue;
    }
    if(replacement){
      if(onlyLink)result.push(replacement);
      else{
        const remaining=line.replace(TELEGRAM_SOURCE_LINK,'').trim();
        if(remaining && !SOURCE_CTA_LABEL.test(remaining) &&
          !SOURCE_FOOTER_HEADER.test(remaining)){
          result.push(remaining);
        } else {
          // Inline source CTA becomes our own channel label.
          const preceding=result[result.length-1]||'';
          if(preceding!=='👇 Bizning kanal')result.push('👇 Bizning kanal');
        }
        result.push(replacement);
      }
    } else {
      const rest=line.replace(TELEGRAM_SOURCE_LINK,'').trim();
      if(rest&&!SOURCE_CTA_LABEL.test(rest)&&!SOURCE_FOOTER_HEADER.test(rest))result.push(rest);
    }
  }
  return result.join('\n').replace(/[ \t]+\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n').trim();
}

function buildClonePostText(original,cfg,limit=1024){
  return joinWithFooter(cleanSourceAdvertising(original,cfg),adFooter(cfg),limit);
}

function refreshClonePostText(existing,cfg,limit=1024){
  // Strip previous own footer before reapplying current branding. This also
  // fixes earlier Cloner posts containing the source's original invite.
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
  return joinWithFooter(cleanSourceAdvertising(body.join('\n'),cfg),adFooter(cfg),limit);
}

module.exports={contactUsername,adFooter,getTargetPostLink,hasSourcePromotionLink,cleanSourceAdvertising,buildClonePostText,refreshClonePostText};
