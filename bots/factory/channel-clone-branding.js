'use strict';

const {telegramHandle}=require('./channel-publisher');
const {replaceSourcePromotions}=require('./channel-clone-promos');
const {normalizePhone}=require('./channel-clone-contacts');

// Only Telegram public usernames (not arbitrary links) can be saved in the footer.
function contactUsername(input){
  return telegramHandle(input);
}

function adFooter(cfg={}){
  const bot=contactUsername(cfg.promo_bot_username);
  const channel=contactUsername(cfg.target_username);
  const admin=contactUsername(cfg.promo_admin_username);
  const phone=normalizePhone(cfg.promo_admin_phone);
  return [
    bot?'🤖 Botimiz: @'+bot:'',
    channel?'📢 Kanalimiz: @'+channel:'',
    admin?'👤 Admin: @'+admin:'',
    phone?'☎️ Admin telefoni: '+phone:''
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

// Remove the source's marketing contacts, not every Telegram mention or number.
// A vehicle listing's seller telephone must remain intact.
const SOURCE_PROMO_CONTACT_CTA=/(?:\bbiz\s+bilan(?:\s+telegram\s+orqali)?\s+bog['’ʼ‘]?lan(?:ing|ish)\b|\btelegram\s+orqali\s+bog['’ʼ‘]?lan(?:ing|ish)\b|\bmurojaat\s+uchun\b|\breklama(?:lar)?\s+uchun\b|\bhamkorlik\s+uchun\b|\b(?:reklama|e['’ʼ‘]?lon)(?:lar)?\s+bo['’ʼ‘]?yicha\b|\bnavbat\s+olish\s+uchun\b[^\n]{0,65}\b(?:admin|lichka(?:si)?|yozing)\b|\b(?:admin\s+lichka(?:si)?|lichkaga\s+yozing)\b|\b(?:админ|реклама)\s*(?:учун|для|га)\b)/iu;
const SOURCE_PROMO_JOIN_CTA=/(?:\b(?:guruhimizga|guruhga|kanalimizga|kanalga)\s+(?:qo['’ʼ‘]?shiling|kiring|obuna\s+bo['’ʼ‘]?ling)\b|(?:групп(?:у|е)|канал)\s+(?:вступайте|подписывайтесь|присоединяйтесь)|\b(?:join\s+(?:our\s+)?(?:group|channel)|subscribe\s+to\s+our\s+channel)\b)/iu;
const CONTACT_ONLY_HANDLE=/^\s*(?:[^\p{L}\p{N}@+]{0,12})?@[A-Za-z][A-Za-z0-9_]{4,31}\s*(?:[^\p{L}\p{N}]{0,8})?$/u;
const CONTACT_ONLY_PHONE=/^\s*(?:[^\p{L}\p{N}+]{0,12})?(?:(?:tel(?:efon)?|telefon\s+raqam(?:i)?|phone|номер|raqam)\s*[:：-]?\s*)?\+?(?:998|8|[0-9]{2,3})[\d\s().-]{7,20}\s*(?:[^\p{L}\p{N}]{0,5})?$/iu;
const CONTACT_ONLY_INLINE=/^\s*(?:telegram|admin|administrator|reklama|aloqa)\s*[:：-]\s*@[A-Za-z][A-Za-z0-9_]{4,31}\s*$/iu;
const SALES_DESCRIPTION=/(?:\bnarxi\b|\bцена\b|\bсотилади\b|\bsotiladi\b|\bпробег\b|\bprobeg\b|\byurgan\b|\bмашина\b|\bavtomobil\b)/iu;
function isSourceContactOnly(line){
  const text=String(line||'').trim();
  return CONTACT_ONLY_HANDLE.test(text)||CONTACT_ONLY_PHONE.test(text)||
    CONTACT_ONLY_INLINE.test(text);
}
function stripSourceContactPromotions(original){
  const lines=String(original||'').replace(/\r\n?/g,'\n').split('\n');
  const skipped=new Set(),replacements=new Map();
  const marketplace=SALES_DESCRIPTION.test(String(original||''));
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const join=SOURCE_PROMO_JOIN_CTA.test(line);
    const explicit=SOURCE_PROMO_CONTACT_CTA.test(line);
    // "Murojaat uchun" may introduce the actual car seller's number.
    const sellerCTA=marketplace && /\bmurojaat\s+uchun\b/iu.test(line) &&
      !/\breklama\b|\bbiz\s+bilan\b/iu.test(line);
    if(join){
      let next=i+1;
      while(next<lines.length && next-i<=4 && !lines[next].trim())next++;
      TELEGRAM_SOURCE_LINK.lastIndex=0;
      if(next<lines.length&&next-i<=4&&TELEGRAM_SOURCE_LINK.test(lines[next])){
        replacements.set(i,'👇 Bizning kanal');
        for(let between=i+1;between<next;between++)
          if(!lines[between].trim())skipped.add(between);
      }else skipped.add(i);
      continue;
    }
    if(!explicit||sellerCTA)continue;
    skipped.add(i);
    let n=i+1;
    while(n<lines.length&&n-i<=5){
      if(!lines[n].trim()){n++;continue;}
      // In marketplace adverts, phone numbers after an admin CTA can still
      // belong to the seller. Preserve them rather than guessing ownership.
      if(marketplace && CONTACT_ONLY_PHONE.test(lines[n]))break;
      if(!isSourceContactOnly(lines[n]))break;
      skipped.add(n++);
    }
  }
  return lines.map((line,i)=>skipped.has(i)?null:(replacements.get(i)||line))
    .filter(line=>line!==null).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function cleanSourceAdvertising(original,cfg={}){
  return replaceSourcePromotions(original,{
    sourceUsername:cfg.source_username,
    targetLink:getTargetPostLink(cfg),
    channelUsername:cfg.target_username,
    adminUsername:cfg.promo_admin_username,
    adminPhone:cfg.promo_admin_phone,
    sourceAdminPhones:cfg.source_admin_phones,
    sourceAdminUsernames:cfg.source_admin_usernames,
    botUsername:cfg.promo_bot_username,
    target_type:cfg.target_type
  });
}

function feedbackLink(value){
  const input=String(value||'').trim();
  if(/^https:\/\/t\.me\/(?:\+[\w-]+|joinchat\/[\w-]+)$/i.test(input))return input;
  const handle=input.match(/^(?:@|https:\/\/t\.me\/)([a-z][a-z0-9_]{4,31})$/i);
  return handle?'https://t.me/'+handle[1]:'';
}

function feedbackEdits(text,cfg){
  if(cfg.feedback_mode!=='replace'&&cfg.feedback_mode!=='remove')return [];
  const link=cfg.feedback_mode==='replace'?feedbackLink(cfg.feedback_link):'';
  const lines=/(?:^[ \t]*(?:[^\p{L}\p{N}\s]+\s*)?(?:otviz|otziv(?:lar)?|otzyv(?:lar)?|feedback|fikrlar|отзыв(?:ы)?)[ \t]*[:：—–-]?[ \t]*(?:@[a-z][a-z0-9_]{4,31}|(?:https?:\/\/)?t\.me\/(?:\+[\w-]+|joinchat\/[\w-]+|[a-z][a-z0-9_]{4,31}))?[ \t]*(?:\r?\n|$))/gimu;
  const matches=[...text.matchAll(lines)];
  if(!matches.length)return link?[{start:text.length,end:text.length,value:(text.trim()?'\n\n':'')+'💬 Fikrlar: '+link}]:[];
  return matches.map((match,index)=>({start:match.index,end:match.index+match[0].length,
    value:link&&index===0?'💬 Fikrlar: '+link+(match[0].endsWith('\n')?'\n':''):''}));
}

function applyFeedbackLink(text,cfg){
  const edits=feedbackEdits(text,cfg);
  for(const {start,end,value} of edits.reverse())text=text.slice(0,start)+value+text.slice(end);
  return text;
}

function buildClonePostText(original,cfg,limit=1024){
  const body=cfg.feedback_mode==='replace'||cfg.feedback_mode==='remove'
    ? applyFeedbackLink(cleanSourceAdvertising(applyFeedbackLink(String(original||''),{feedback_mode:'remove'}),cfg),cfg)
    : cleanSourceAdvertising(original,cfg);
  return joinWithFooter(body,adFooter(cfg),limit);
}

function refreshClonePostText(existing,cfg,limit=1024){
  // The shared source transformer removes any old footer first; its output
  // remains unchanged if a previously edited post is repaired again.
  return buildClonePostText(existing,cfg,limit);
}

module.exports={feedbackLink,feedbackEdits,applyFeedbackLink,contactUsername,adFooter,getTargetPostLink,hasSourcePromotionLink,isSourceContactOnly,stripSourceContactPromotions,cleanSourceAdvertising,buildClonePostText,refreshClonePostText};
