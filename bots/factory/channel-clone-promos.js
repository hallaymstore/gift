'use strict';

// Transform only Telegram promotional contacts, not arbitrary names, prices,
// phone numbers, external URLs or attribution to the original performer.
// This runs on every Branded post and also when editing previously sent posts.
const URLS=/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+|s\/[A-Za-z][A-Za-z0-9_]{4,31}|[A-Za-z][A-Za-z0-9_]{4,31}(?:\/\d+)?)(?:\?[^\s)]*)?/giu;
const HANDLES=/@[A-Za-z][A-Za-z0-9_]{4,31}/g;
const STANDALONE_HANDLE=/^\s*@[A-Za-z][A-Za-z0-9_]{4,31}\s*$/u;
const STANDALONE_PHONE=/^\s*(?:[^\p{L}\p{N}+]{0,12})?\+?998[\d\s()\-]{8,20}\s*$/u;
const OLD_FOOTER=/^\s*(?:📢\s*kanalimiz|🤖\s*botimiz|📩\s*reklama(?:\s+va\s+hamkorlik)?\s+uchun)\s*:/iu;
const FOOTER_ONLY=/^\s*(?:(?:📢|🤖|📩)\s*)?(?:kanalimiz|botimiz|reklama(?:\s+va\s+hamkorlik)?\s+uchun)\s*:\s*(?:@[A-Za-z][A-Za-z0-9_]{4,31})?\s*$/iu;
const SELLER=/\b(?:sotuvchi|seller|продавец|sotiladi|savdo|narxi|цена|muallif|author|ijrochi|boshlo?vchi|doktor)\b/iu;
const MARKET=/\b(?:narxi|sotiladi|sotuvchi|цена|продается|mashina|avtomobil|nexia|cobalt|телефон\s+продавца)\b/iu;
const ADMIN=/\b(?:biz\s+bilan(?:\s+telegram\s+orqali)?\s+bog['’ʼ‘]?lan(?:ing|ish)|telegram\s+orqali\s+bog['’ʼ‘]?lan(?:ing|ish)|murojaat\s+uchun|reklama\s+uchun|hamkorlik\s+uchun|navbat\s+olish\s+uchun|admin(?:istrator)?(?:\s+lichka(?:si)?)?|lichkasi|buyurtma\s+uchun|bog['’ʼ‘]?lanish\s+uchun|по\s+рекламе|админ(?:истратор)?)\b/iu;
const CHANNEL=/\b(?:kanal(?:imiz|ga|i|ni)?|guruh(?:imizga|imiz|ga|i|ni)?|channel|group|obuna|join|follow|manba|источник|канал|групп(?:а|у|е)|подписаться)\b/iu;
const BOT=/\b(?:bot(?:imiz|ga|i)?|бот(?:а|у)?)\b/iu;
const JOIN=/(?:\bguruhimizga\s+qo['’ʼ‘]?shiling\b|\bkanalimizga\s+qo['’ʼ‘]?shiling\b|\bbizning\s+kanal\b|бизнинг\s+канал|наш\s+канал)/iu;
const DIRECTIONAL=/^\s*[👇👉👆➡️📢🔗📌]\s*[^\d@\n]{3,90}$/u;
const SOURCE_MARK=/^\s*(?:📌\s*)?(?:manba|источник)\s*:/iu;

function basicHandle(value){
  const match=String(value||'').trim().match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/);
  return match?match[1]:'';
}
function decoration(line){
  return !/[\p{L}\p{N}@]/u.test(String(line||''));
}
function friendlyChannelLabel(cfg){
  return ['group','supergroup'].includes(String(cfg.target_type||'').toLowerCase())
    ? '👇 Bizning guruh':'👇 Bizning kanal';
}
function normalizeLine(line){return String(line||'').trim();}
function sanitizeFooterInput(lines){
  const result=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    // Previously copied messages may already contain one or several of our
    // canonical footers. Strip ALL of them before attaching exactly one.
    if(OLD_FOOTER.test(line)||FOOTER_ONLY.test(line)){
      if(/:\s*$/.test(line)&&i+1<lines.length && STANDALONE_HANDLE.test(lines[i+1]))
        i++;
      continue;
    }
    result.push(line);
  }
  return result;
}

function replaceSourcePromotions(input,opts={}){
  const cfg=opts||{};
  const channel=basicHandle(cfg.channelUsername);
  const admin=basicHandle(cfg.adminUsername);
  const bot=basicHandle(cfg.botUsername);
  const source=basicHandle(cfg.sourceUsername).toLowerCase();
  const channelMention=channel?'@'+channel:String(cfg.targetLink||'');
  const channelLink=String(cfg.targetLink||'');
  const adminMention=admin?'@'+admin:'';
  const botMention=bot?'@'+bot:channelMention;
  const sourceText=String(input||'').replace(/\r\n?/g,'\n');
  const market=MARKET.test(sourceText);
  const lines=sanitizeFooterInput(sourceText.split('\n'));
  const output=[];
  let pending='',age=0;

  for(let i=0;i<lines.length;i++){
    let line=lines[i],trim=normalizeLine(line);
    if(SOURCE_MARK.test(line))continue; // Original "source" marker isn't our channel
    if(!trim){output.push(line);if(pending)age++;continue;}
    const seller=SELLER.test(line) || (market && /\b(?:tel(?:efon)?|raqam|murojaat\s+uchun)\b/iu.test(line));
    const current=JOIN.test(line)?'channel':ADMIN.test(line)?'admin':
      BOT.test(line)&&!CHANNEL.test(line)?'bot':CHANNEL.test(line)?'channel':'';
    const applicable=current==='admin' && market && !/\b(?:reklama|hamkorlik|biz\s+bilan|admin|lichka|navbat)\b/iu.test(line)
      ? '':current;
    const role=applicable||(age<=8?pending:'');
    const isOwnContact=(value)=>[channel,admin,bot].some(h=>h&&h.toLowerCase()===value.toLowerCase());
    // Keep authors, performers and real marketplace sellers, regardless of
    // how often the post is cloned or repaired.
    const preserveContact=seller && !(/\b(?:reklama|hamkorlik|admin|lichka|biz\s+bilan)\b/iu.test(line));
    if(preserveContact){
      output.push(line);
      pending='';age=0;
      continue;
    }

    let replacedUrl=false;
    URLS.lastIndex=0;
    const changedUrls=line.replace(URLS,(url)=>{
      const last=url.match(/\/([A-Za-z][A-Za-z0-9_]{4,31})(?:\/\d+)?(?:\?.*)?$/);
      const name=last?.[1]||'';
      const looksBot=/bot$/i.test(name);
      const isInvite=/\/(?:\+|joinchat\/)/i.test(url);
      const isPersonal=!isInvite && (role==='admin' || /(?:admin|reklama|lichka)/i.test(name));
      // An explicit seller or author link never enters this branch.
      const selected=isInvite?channelLink:isPersonal?adminMention:role==='bot'||looksBot?botMention:channelLink;
      if(!selected)return '';
      replacedUrl=true;
      if(selected.startsWith('@'))return 'https://t.me/'+selected.slice(1);
      return selected;
    });
    line=changedUrls;
    // Standalone or inline promotional @handles can also occur without URLs.
    // A channel/group invitation may precede a handle by several decorative
    // lines; in that case pending retains the CTA classification.
    const hasExplicitHandle=HANDLES.test(line);HANDLES.lastIndex=0;
    if(hasExplicitHandle){
      line=line.replace(HANDLES,(handle)=>{
        const raw=handle.slice(1);
        if(isOwnContact(raw))return handle;
        if(preserveContact)return handle;
        const chosen=role==='admin'||/(?:admin|reklama|lichka)/i.test(raw)
          ?adminMention:role==='bot'||/bot$/i.test(raw)?botMention:
          role==='channel'||STANDALONE_HANDLE.test(trim)||
          (source&&raw.toLowerCase()===source)?channelMention:'';
        return chosen||handle;
      });
    }
    // Promotional phone belonging to an admin (not a car seller) should be
    // replaced with the configured ad contact; never invent a phone number.
    if(role==='admin'&&!market && STANDALONE_PHONE.test(trim) && adminMention)
      line=adminMention;

    if((JOIN.test(trim)||(DIRECTIONAL.test(trim)&&!ADMIN.test(trim))) &&
      !/@[A-Za-z]/.test(trim) && !/t\.me\//i.test(trim)){
      const upcoming=lines.slice(i+1,i+5).some(x=> {
        URLS.lastIndex=0;return URLS.test(x)||STANDALONE_HANDLE.test(x);
      });
      if(upcoming)line=friendlyChannelLabel(cfg);
    }

    if(line.trim())output.push(line);
    if(applicable){
      pending=applicable;age=0;
    }else if(decoration(trim)){
      if(pending)age++;
    }else if(STANDALONE_HANDLE.test(trim)||replacedUrl||STANDALONE_PHONE.test(trim)){
      // An admin CTA can be followed by both an @handle and a phone. Keep
      // its context across nearby decorated/blank lines until real prose.
      if(role==='admin' && !market && STANDALONE_PHONE.test(trim)){
        pending='';age=0;
      }else if(role==='admin' && !market){pending='admin';age++;}
      else{pending='';age=0;}
    }else{
      pending='';age=0;
    }
  }

  // A single link is enough to drive readers to the destination. Keep it
  // where it first appeared, not copied once for every source invite.
  const seenLinks=new Set(), cleaned=[];
  for(const line of output){
    const value=normalizeLine(line);
    if(channelLink && value===channelLink){
      if(seenLinks.has(channelLink))continue;
      seenLinks.add(channelLink);
    }
    if(value===friendlyChannelLabel(cfg)&&cleaned.some(x=>normalizeLine(x)===value))continue;
    cleaned.push(line);
  }
  return cleaned.join('\n').replace(/[ \t]+\n/g,'\n')
    .replace(/(👇 Bizning (?:kanal|guruh))\n(?:\s*\n)+(?=https:\/\/t\.me\/)/gu,'$1\n')
    .replace(/\n{3,}/g,'\n\n').trim();
}

module.exports={replaceSourcePromotions};
