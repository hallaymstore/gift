'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parsePeerReference,peerIdFromDialog,isGroupEntity,isChannelEntity,
  listJoinedGroups,validateSourceReference,resolveSourcePeer,sourceKey}=require('./channel-clone-peers');
const {scanLive,scanHistory}=require('./public-channel-watcher');

test('public groups/channels and signed private group IDs can be parsed',()=>{
  assert.equal(parsePeerReference('@public_group').peer,'@public_group');
  assert.equal(parsePeerReference('https://t.me/public_group').username,'public_group');
  assert.equal(parsePeerReference('-1001234567890').id,'-1001234567890');
  assert.equal(parsePeerReference('-123456').id,'-123456');
  assert.equal(parsePeerReference('https://t.me/+NotJoined'),null);
});
test('group types are distinct from broadcast channels and private chats',()=>{
  assert.equal(isGroupEntity({className:'Chat'}),true);
  assert.equal(isGroupEntity({className:'Channel',megagroup:true}),true);
  assert.equal(isGroupEntity({className:'Channel',megagroup:false}),false);
  assert.equal(isChannelEntity({className:'Channel',broadcast:true}),true);
  assert.equal(peerIdFromDialog({entity:{className:'Channel',megagroup:true,id:1234567890}}),'-1001234567890');
  assert.equal(peerIdFromDialog({entity:{className:'Chat',id:123456}}),'-123456');
});
test('private groups must exist in the authorized user session dialogs',async()=>{
  const groupPeer={className:'InputPeerChannel',channelId:1234567890};
  const client={
    getDialogs:async()=>[
      {title:'Owner Group',entity:{className:'Channel',megagroup:true,id:1234567890},
        inputEntity:groupPeer},
      {title:'User DM',entity:{className:'User',id:456},inputEntity:{className:'InputPeerUser'}},
      {title:'Announcements',entity:{className:'Channel',id:789,broadcast:true}}
    ],
    getMessages:async(peer)=>{assert.equal(peer,groupPeer);return [{id:1,message:'allowed'}];}
  };
  const groups=await listJoinedGroups(client);
  assert.equal(groups.length,1);
  assert.equal(groups[0].id,'-1001234567890');
  const info=await validateSourceReference(client,'-1001234567890');
  assert.deepEqual(info,{source_username:'',source_chat_id:'-1001234567890',
    source_title:'Owner Group',source_type:'group'});
  assert.equal(await resolveSourcePeer(client,info),groupPeer);
  await assert.rejects(validateSourceReference(client,'-1009999999999'),/topilmadi/);
});
test('public group and public channel are accepted, user DM is rejected',async()=>{
  const client={
    getEntity:async(peer)=>peer==='@a_group'?{className:'Channel',megagroup:true,title:'A Group'}
      :peer==='@a_channel'?{className:'Channel',broadcast:true,title:'News'}
      :{className:'User'},
    getMessages:async()=>[]
  };
  const group=await validateSourceReference(client,'@a_group');
  assert.equal(group.source_type,'group');
  assert.equal(group.source_username,'a_group');
  const channel=await validateSourceReference(client,'@a_channel');
  assert.equal(channel.source_type,'channel');
  await assert.rejects(validateSourceReference(client,'@some_user'),/kanal yoki guruh/);
});
test('watcher reads private group through peer and maintains separate history cursor',async()=>{
  const peer={className:'InputPeerChannel',channelId:1234567890};
  const messages=[{id:1,message:'first'},{id:2,message:'second'}];
  const client={
    getDialogs:async()=>[{title:'My Group',
      entity:{className:'Channel',megagroup:true,id:1234567890},inputEntity:peer}],
    getMessages:async(p,opts)=>{
      assert.equal(p,peer);
      if(opts.reverse)return messages.filter(x=>x.id>Number(opts.minId||0))
        .sort((a,b)=>a.id-b.id).slice(0,opts.limit);
      return [...messages].reverse().slice(0,opts.limit);
    }
  };
  const cfg={bot_key:'source_private',source_username:'',source_chat_id:'-1001234567890',
    source_cursor:0,history_enabled:true,history_completed:false,history_cursor:0,history_ceiling:0};
  const events=[];
  const deliver=async event=>{
    events.push(event.type+':'+(event.message?.id||event.cursor||0));
    if(event.type==='seed'){cfg.source_cursor=event.cursor;cfg.history_ceiling=event.cursor;}
    if(event.type==='history_begin')cfg.history_ceiling=event.ceiling;
    if(event.type==='history_cursor')cfg.history_cursor=event.cursor;
    if(event.type==='history_complete')cfg.history_completed=true;
    if(event.type==='post')return {status:'sent'};
  };
  const log={info:()=>{},warn:()=>{}};
  await scanLive({client,cfg,deliver,log});
  assert.equal(cfg.source_cursor,2);
  await scanHistory({client,cfg,deliver,log});
  assert.ok(events.includes('post:1'));
  assert.ok(events.includes('post:2'));
  assert.equal(sourceKey(cfg),'-1001234567890');
});
