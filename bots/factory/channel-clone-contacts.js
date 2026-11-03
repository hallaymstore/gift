'use strict';

// Contact matching is opt-in and scoped to one SOURCE route. Do not
// infer that every phone in a post belongs to its advertising administrator.
const PHONE_RE=/(?<!\d)\+?998(?:[\s().()-]*\d){9}(?!\d)/g;
const HANDLE_RE=/@[A-Za-z][A-Za-z0-9_]{4,31}/g;
const ADMIN_CONTEXT=/(?:\badmin(?:istrator)?\b|\breklama\b|\bhamkorlik\b|\blichka(?:si)?\b|\bnavbat\s+olish\b|\bmuroja[at]*\s+uchun\b|\bbiz\s+bilan\b|\bbog['’ʼ‘]?lan(?:ing|ish)\b|\bbuyurtma\s+uchun\b|\bkontakt\s+admin\b|админ|реклама|заказ)/iu;
const SELLER_CONTEXT=/(?:\bsotuvchi\b|\btelefon\s+raqami\b|\btel(?:efon)?\b|\bsotiladi\b|\bnarxi\b|\bпpoдавец\b|\bпродавец\b|\bцена\b)/iu;
const SALES_CONTEXT=/(?:\bnarxi\b|\bsotiladi\b|\bsotuvchi\b|\bavtomobil\b|\bmashina\b|\bnexia\b|\bcobalt\b|\bцена\b|\bпродам\b)/iu;

function normalizePhone(value){
  const raw=String(value||'').trim().replace(/[\s().-]/g,'');
  if(!/^\+?998\d{9}$/.test(raw))return '';
  return '+'+raw.replace(/^\+/,'');
}
function normalizeUsername(value){
  const raw=String(value||'').trim().replace(/^@/,'');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(raw)?raw:'';
}
function findPhones(text){
  const out=[];const seen=new Set();
  for(const match of String(text||'').matchAll(PHONE_RE)){
    const phone=normalizePhone(match[0]);
    if(phone&&!seen.has(phone)){seen.add(phone);out.push(phone);}
  }
  return out;
}
function findUsernames(text){
  const out=[];const seen=new Set();
  for(const match of String(text||'').matchAll(HANDLE_RE)){
    const name=normalizeUsername(match[0]);
    if(name&&!seen.has(name.toLowerCase())){seen.add(name.toLowerCase());out.push(name);}
  }
  return out;
}
function replaceApprovedPhoneContacts(text,opts={}){
  const own=normalizePhone(opts.adminPhone);
  const approved=new Set((Array.isArray(opts.sourceAdminPhones)?opts.sourceAdminPhones:[])
    .map(normalizePhone).filter(Boolean));
  if(!own||!approved.size)return String(text||'');
  return String(text||'').replace(PHONE_RE,(matched)=>{
    const canonical=normalizePhone(matched);
    if(!canonical||canonical===own||!approved.has(canonical))return matched;
    return own;
  });
}
function sourceAdminUsernameSet(list){
  return new Set((Array.isArray(list)?list:[]).map(normalizeUsername).filter(Boolean)
    .map(x=>x.toLowerCase()));
}
function detectSourceAdminCandidates(messages,{marketplace=false}={}){
  const found=new Map();
  const entries=Array.isArray(messages)?messages:[];
  for(const post of entries){
    const text=String(post?.message||post?.caption||'');
    if(!text)continue;
    const market=marketplace||SALES_CONTEXT.test(text);
    const lines=text.replace(/\r\n?/g,'\n').split('\n');
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim();
      const phones=findPhones(line);
      const usernames=findUsernames(line);
      if(!phones.length&&!usernames.length)continue;
      // Check a nearby CTA, tolerating 1–3 blank/emoji separator lines.
      const context=lines.slice(Math.max(0,i-5),i+1)
        .filter(x=>x.trim()).slice(-4).join(' ');
      const stronglyLabeled=ADMIN_CONTEXT.test(context);
      const sellerLabeled=SELLER_CONTEXT.test(line)||
        (market&&SELLER_CONTEXT.test(context) &&
         !/(?:\badmin\b|\breklama\b|\blichka\b)/iu.test(context));
      if(!stronglyLabeled||sellerLabeled)continue;
      // For vehicle/sales posts, only strongly advertising-labeled contact
      // counts as a candidate, not a generic "murojaat uchun" seller phone.
      if(market && !/(?:\badmin\b|\breklama\b|\blichka\b|\bhamkorlik\b)/iu.test(context))
        continue;
      for(const [kind,values] of [['phone',phones],['username',usernames]]){
        for(const value of values){
          const id=kind+':'+value.toLowerCase();
          const existing=found.get(id)||{kind,value,count:0,example:''};
          existing.count++;
          if(!existing.example)existing.example=lines.slice(Math.max(0,i-2),i+1)
            .join(' ').trim().slice(0,160);
          found.set(id,existing);
        }
      }
    }
  }
  return [...found.values()].sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value))
    .slice(0,16);
}

module.exports={normalizePhone,normalizeUsername,findPhones,findUsernames,
  replaceApprovedPhoneContacts,sourceAdminUsernameSet,detectSourceAdminCandidates};
