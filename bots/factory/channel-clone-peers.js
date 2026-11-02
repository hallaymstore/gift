'use strict';

const {telegramHandle}=require('./channel-publisher');

function parsePeerReference(raw){
  const value=String(raw||'').trim();
  const handle=telegramHandle(value);
  if(handle)return {kind:'public',username:handle,peer:'@'+handle};
  if(/^-100\d{6,}$/.test(value)||/^-\d{5,}$/.test(value))
    return {kind:'id',id:value,peer:value};
  return null;
}
function peerIdFromDialog(dialog){
  const entity=dialog?.entity;
  const id=String(entity?.id||'');
  if(entity?.className==='Channel' && entity.megagroup===true && /^\d+$/.test(id))
    return '-100'+id;
  if(entity?.className==='Chat' && /^\d+$/.test(id))return '-'+id;
  const direct=String(dialog?.id||'');
  return /^-\d+$/.test(direct)?direct:'';
}
function isGroupEntity(entity){
  return Boolean(entity && (entity.className==='Chat' ||
    (entity.className==='Channel' && entity.megagroup===true)));
}
function isChannelEntity(entity){
  return Boolean(entity && entity.className==='Channel' && entity.megagroup!==true);
}
const dialogsCache=new WeakMap();
async function listJoinedGroups(client,limit=500,{fresh=false}={}){
  const cached=dialogsCache.get(client);
  if(!fresh&&cached&&Date.now()-cached.time<300000)return cached.groups;
  const dialogs=await client.getDialogs({limit});
  const groups=(dialogs||[]).filter(d=>isGroupEntity(d.entity))
    .map(d=>({
      id:peerIdFromDialog(d),
      title:String(d.title||d.entity?.title||'Telegram guruhi'),
      peer:d.inputEntity||d.entity,
      username:telegramHandle(d.entity?.username||'')
    })).filter(x=>x.id&&x.peer);
  dialogsCache.set(client,{time:Date.now(),groups});
  return groups;
}
async function resolvePrivateSourceGroup(client,wanted){
  const groups=await listJoinedGroups(client);
  const group=groups.find(g=>g.id===String(wanted));
  if(!group)throw new Error('Manba guruh MTProto akkaunti aʼzo bo‘lgan guruhlar orasida topilmadi.');
  return group;
}
async function validateSourceReference(client,input){
  const parsed=parsePeerReference(input);
  if(!parsed)throw new Error('Ommaviy @username yoki o‘zingiz aʼzo bo‘lgan guruhning raqamli ID sini yuboring.');
  if(parsed.kind==='id'){
    const group=await resolvePrivateSourceGroup(client,parsed.id);
    await client.getMessages(group.peer,{limit:1});
    return {source_username:group.username,source_chat_id:group.id,
      source_title:group.title,source_type:'group'};
  }
  const entity=await client.getEntity(parsed.peer);
  if(!isGroupEntity(entity)&&!isChannelEntity(entity))
    throw new Error('Manba Telegram kanal yoki guruh bo‘lishi kerak.');
  await client.getMessages(parsed.peer,{limit:1});
  return {source_username:parsed.username,source_chat_id:'',
    source_title:String(entity.title||parsed.username),
    source_type:isGroupEntity(entity)?'group':'channel'};
}
async function resolveSourcePeer(client,cfg){
  const handle=telegramHandle(cfg?.source_username||'');
  if(handle)return '@'+handle;
  const id=String(cfg?.source_chat_id||'');
  if(!/^-?\d+$/.test(id))throw new Error('Manba kanal/guruh belgilanmagan');
  return (await resolvePrivateSourceGroup(client,id)).peer;
}
function sourceRefLabel(cfg={}){
  const handle=telegramHandle(cfg.source_username||'');
  return handle?'@'+handle:(cfg.source_title?cfg.source_title+' ('+cfg.source_chat_id+')':String(cfg.source_chat_id||''));
}
function sourceKey(cfg={}){
  return telegramHandle(cfg.source_username||'').toLowerCase() || String(cfg.source_chat_id||'');
}
module.exports={parsePeerReference,peerIdFromDialog,isGroupEntity,isChannelEntity,
  listJoinedGroups,resolvePrivateSourceGroup,validateSourceReference,resolveSourcePeer,sourceRefLabel,sourceKey};
