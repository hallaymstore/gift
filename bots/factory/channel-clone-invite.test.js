'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOrReuseInvite,forgetRouteInvite}=require('./channel-clone-invite');

function mockConfig(initial={}){
  const data={...initial};
  return {
    data,
    findOne(){
      return {select(){return {lean:async()=>({...data})};}};
    },
    async updateOne(_where, update){
      Object.assign(data,update.$set);
      return {matchedCount:1,modifiedCount:1};
    }
  };
}
test('creates destination invite only once and stores the reusable URL',async()=>{
  const cfg={bot_key:'route-a',target_chat_id:'-1000000000111',target_username:'my_channel'};
  const db=mockConfig({});
  let calls=0;
  const telegram={createChatInviteLink:async(chatId,params)=>{
    assert.equal(chatId,cfg.target_chat_id);
    assert.equal(params.name,'Cloner branded post');
    calls++;
    return {invite_link:'https://t.me/+OwnedInvitationLink'};
  }};
  const result=await Promise.all(Array.from({length:5},()=>createOrReuseInvite({cfg,telegram,Config:db})));
  assert.deepEqual(result,Array(5).fill('https://t.me/+OwnedInvitationLink'));
  assert.equal(calls,1);
  assert.equal(db.data.target_invite_chat_id,cfg.target_chat_id);
  forgetRouteInvite(cfg);
  assert.equal(await createOrReuseInvite({cfg,telegram,Config:db}),result[0]);
  assert.equal(calls,1);
});

test('no invite privilege falls back to public channel rather than source',async()=>{
  const cfg={bot_key:'route-b',target_chat_id:'-1000000000222',target_username:'my_public_channel'};
  const db=mockConfig();
  const link=await createOrReuseInvite({cfg,telegram:{createChatInviteLink:async()=>{throw Error('not enough rights');}},Config:db});
  assert.equal(link,'https://t.me/my_public_channel');
});

test('a new target cannot reuse another destination private invite',async()=>{
  const cfg={bot_key:'route-c',target_chat_id:'-1000000000333',target_username:'second_channel'};
  const db=mockConfig({target_invite_link:'https://t.me/+FromOldChannel',target_invite_chat_id:'-1000000000011'});
  const link=await createOrReuseInvite({cfg,telegram:{createChatInviteLink:async()=>({invite_link:'https://t.me/+SecondChannelInvite'})},Config:db});
  assert.equal(link,'https://t.me/+SecondChannelInvite');
});
