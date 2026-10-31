'use strict';

const {eligibleGroup,nextAllowedGroupTime}=require('./group-announcements-core');

async function runGroupAnnouncementTick({Group,Campaign,Log,activeBots,logger=console,clock=()=>new Date()}) {
  const now=clock();
  const due=await Campaign.find({running:true,next_send_at:{$lte:now}})
    .sort({next_send_at:1}).limit(8).lean();
  let processed=0;
  for(const original of due) {
    const active=activeBots.get(original.bot_key);
    if(!active?.bot?.telegram || active.config?.engine!=='group_announcements') continue;
    const locked=await Campaign.findOneAndUpdate({
      _id:original._id,running:true,next_send_at:{$lte:now},
      $or:[{lock_until:{$exists:false}},{lock_until:{$lte:now}}]
    },{$set:{lock_until:new Date(now.getTime()+3*60*1000)}},{new:true});
    if(!locked)continue;
    processed++;
    try {
      if(locked.sent_count>=locked.max_sends || locked.attempt_count>=locked.max_sends) {
        await Campaign.updateOne({_id:locked._id},{$set:{running:false,next_send_at:null}});
        continue;
      }
      const groups=await Group.find({bot_key:locked.bot_key,active:true}).lean();
      const selected=eligibleGroup(groups,now);
      if(!selected) {
        const time=nextAllowedGroupTime(groups,now);
        const again=time && time.getTime()>now.getTime()
          ? time : new Date(now.getTime()+60*60*1000);
        await Campaign.updateOne({_id:locked._id},
          {$set:{next_send_at:again,last_error:groups.length?'Guruhlardagi 24 soatlik tanaffus':'Ruxsatli guruh yo‘q'}});
        continue;
      }
      // Count each delivery attempt towards the finite cap, even on network failure.
      // This prevents infinite re-sends and ambiguous duplicate deliveries.
      const attempt=Number(locked.attempt_count||0)+1;
      const next=new Date(now.getTime()+Math.max(30,Number(locked.interval_minutes)||60)*60*1000);
      const updated=await Campaign.findOneAndUpdate({
        _id:locked._id,revision:locked.revision,running:true
      },{$inc:{attempt_count:1},$set:{
        next_send_at:next,
        ...(attempt>=locked.max_sends?{running:false,next_send_at:null}:{})
      }},{new:true});
      if(!updated)continue;

      const logKey='r'+String(locked.revision||0)+'-a'+attempt;
      try {
        await Log.create({bot_key:locked.bot_key,attempt_key:logKey,
          chat_id:selected.chat_id,status:'attempted',created_at:now});
      } catch(e) {
        if(e.code===11000)continue;
        throw e;
      }
      // Reserve the group's 24-hour interval before transmission, so a socket
      // hangup cannot cause repeated or duplicated announcements.
      await Group.updateOne({_id:selected._id,active:true},{$set:{last_sent_at:now}});
      const telegram=active.bot.telegram;
      try {
        const me=active.bot.botInfo || await telegram.getMe();
        const member=await telegram.getChatMember(selected.chat_id,me.id);
        if(!['member','creator','administrator'].includes(member?.status) ||
           (member.status==='restricted' && !member.can_send_messages)){
          throw new Error('Bot guruhdan chiqarilgan yoki xabar huquqi yo‘q');
        }
        const copy=await telegram.copyMessage(selected.chat_id,
          locked.source_chat_id,locked.source_message_id,{disable_notification:true});
        await Promise.all([
          Log.updateOne({bot_key:locked.bot_key,attempt_key:logKey},
            {$set:{status:'sent',message_id:copy.message_id}}),
          Campaign.updateOne({_id:locked._id},{$inc:{sent_count:1},$set:{last_error:''}})
        ]);
      } catch(error){
        const text=String(error.description||error.message||error).slice(0,180);
        await Log.updateOne({bot_key:locked.bot_key,attempt_key:logKey},
          {$set:{status:'failed',error:text}});
        await Campaign.updateOne({_id:locked._id},{$set:{last_error:text}});
        if(/kicked|blocked|chat not found|not enough rights|not a member|forbidden|no rights/i.test(text)){
          await Group.updateOne({_id:selected._id},{$set:{active:false}});
        }
        logger.warn('[group announcement]',locked.bot_key,text);
      }
    } catch(error) {
      logger.error('[group announcement runner]',String(error.message||error).slice(0,160));
    } finally {
      await Campaign.updateOne({_id:locked._id},{$set:{lock_until:new Date(0)}}).catch(()=>{});
    }
  }
  return processed;
}

module.exports={runGroupAnnouncementTick};
