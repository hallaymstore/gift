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
async function listJoinedGroups(client,limit=500){
  const dialogs=await client.getDialogs({limit});
  return (dialogs||[]).filter(d=>isGroupEntity(d.entity))
    .map(d=>({
      id:peerIdFromDialog(d),
      title:String(d.title||d.entity?.title||'Telegram guruhi'),
      peer:d.inputEntity||d.entity,
      username:telegramHandle(d.entity?.username||'')
    })).filter(x=>x.id&&x.peer);
}
async function resolvePrivateSourceGroup(client,wanted){
  const groups=await listJoinedGroups(client);
  const group=groups.find(g=>g.id===String(wanted));
  if(!group)throw new Error('Manba guruh MTProto akkaunti aʼzo bo‘lgan guruhlar orasida topilmadi.');
  return group;
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
  listJoinedGroups,resolvePrivateSourceGroup,resolveSourcePeer,sourceRefLabel,sourceKey};
