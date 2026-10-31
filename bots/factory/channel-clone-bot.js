'use strict';
const {Telegraf,Markup,session}=require('telegraf');
const {telegramChatRef,telegramHandle}=require('./channel-publisher');

function createChannelCloneBot({token,adminIds,Config,Log,sessionReady,config={key:'channel_clone'}}) {
  const cloneKey=config.key||'channel_clone';
  if(!token || !/^\d+:[\w-]{20,}$/.test(token))return null;
  const bot=new Telegraf(token);
  bot.use(session({defaultSession:()=>({step:null})}));
  const permitted=ctx=>ctx.chat?.type==='private'&&adminIds.includes(Number(ctx.from?.id));
  const menu=()=>Markup.keyboard([
    ['📥 Manba kanal','📤 Bizning kanal'],
    ['🔌 Ulangan kanallar','❌ Kanallarni uzish'],
    ['▶️ Sinxronlash','⏸ To‘xtatish'],
    ['🔄 Eski postlarni qayta tekshirish','📊 Holat'],
    ['🧪 Ulanishni tekshirish'],
    ['🧹 Eski postlar matnini tuzatish']
  ]).resize();
  const load=()=>Config.findOne({bot_key:cloneKey}).lean();
  const replyHelp=ctx=>ctx.reply('📡 CHANNEL CLONE BOT\n\nManba: ommaviy kanal (@username)\nMaqsad: o‘zingiz admin bo‘lgan kanal.\n\nManba postlar tarixidan olinadi, yangi postlar avtomatik kuzatiladi. Bir xil post takror joylanmaydi. Media serverga yuklanmaydi. Faqat ruxsat etilgan kontentdan foydalaning.',menu());
  bot.start(async ctx=>{ctx.session.step=null;return permitted(ctx)?replyHelp(ctx):ctx.reply('⛔ Ushbu xizmat uchun ruxsat yo‘q.');});
  bot.command('cancel',async ctx=>{ctx.session.step=null;return ctx.reply('✅ Amal bekor qilindi.',menu());});
  bot.hears('📥 Manba kanal',async ctx=>{if(!permitted(ctx))return;ctx.session.step='source';return ctx.reply('Manba public kanal @username ni yuboring.');});
  bot.hears('📤 Bizning kanal',async ctx=>{if(!permitted(ctx))return;ctx.session.step='target';return ctx.reply('O‘zingizga tegishli kanal @username ni yuboring. Botga post joylash huquqini bering.');});
  bot.hears('▶️ Sinxronlash',async ctx=>{
    if(!permitted(ctx))return;const c=await load();
    if(!c?.target_chat_id||!c?.source_username)return ctx.reply('Avval ikkala kanalni ulang.',menu());
    if(!sessionReady())return ctx.reply('Telegram sessiyasi mavjud emas.',menu());
    if(c.history_enabled&&!c.history_completed&&c.auto_enabled)return ctx.reply('🔄 Sinxronlash avvaldan ishlamoqda.',menu());
    await Config.updateOne({bot_key:cloneKey},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_last_error:''}});
    return ctx.reply('✅ Kuzatuv yoqildi. Eski postlar ham sinxronlanadi. Oldin yuborilganlar takrorlanmaydi.',menu());
  });
  bot.hears('⏸ To‘xtatish',async ctx=>{if(!permitted(ctx))return;await Config.updateOne({bot_key:cloneKey},{$set:{auto_enabled:false,history_enabled:false}});return ctx.reply('⏸ Sinxronlash to‘xtatildi.',menu());});
  bot.hears('🔄 Eski postlarni qayta tekshirish',async ctx=>{
    if(!permitted(ctx))return;const c=await load();
    if(!c?.source_username||!c?.target_chat_id)return ctx.reply('Avval kanallarni ulang.',menu());
    if(c.history_enabled&&!c.history_completed)return ctx.reply('🔄 Sinxronlash davom etmoqda.',menu());
    await Config.updateOne({bot_key:cloneKey},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_cursor:0,history_ceiling:0,history_last_error:''}});
    return ctx.reply('✅ Tarix qayta tekshiriladi. Ilgari yuborilgan postlar MongoDB jurnalidan aniqlanadi.',menu());
  });
  bot.hears('🧪 Ulanishni tekshirish',async ctx=>{
    if(!permitted(ctx))return;
    const c=await load();
    if(!c?.source_username||!c?.target_chat_id)return ctx.reply('❌ Manba va joylash kanallarini ulang.',menu());
    let client;
    try {
      const me=await ctx.telegram.getMe();
      const member=await ctx.telegram.getChatMember(c.target_chat_id,me.id);
      if(member.status!=='creator'&&!(member.status==='administrator'&&member.can_post_messages))
        return ctx.reply('❌ Bot maqsad kanalga post joylay olmaydi. Botga Post Messages huquqini bering.',menu());
      if(!sessionReady())return ctx.reply('❌ Render user sessiyasi mavjud emas.',menu());
      const {TelegramClient}=require('teleproto');
      const {StringSession}=require('teleproto/sessions');
      client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
        Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
      await client.connect();
      const messages=await client.getMessages('@'+c.source_username,{limit:20});
      const sample=messages.find(x=>x && !x.action && (x.media||x.message));
      if(!sample)return ctx.reply('⚠️ Manbadan nusxalanadigan post topilmadi.',menu());
      try {
        const test=await ctx.telegram.copyMessage(ctx.from.id,'@'+c.source_username,Number(sample.id),
          {caption:'🧪 Kanal klonlash sinovi (kanalingizga yuborilmadi)'});
        await ctx.reply('✅ Bot API manba postni nusxalashga ruxsat oldi. Maqsad botining admin huquqi ham bor. Sinov xabari: '+test.message_id,menu());
      } catch(e) {
        await ctx.reply('⚠️ Telegram akkaunti manbani o‘qiydi, lekin sizning bot Bot API orqali uni nusxalay olmaydi.\nSabab: '+String(e.description||e.message||e).slice(0,190)+
          '\n\nBunday manba uchun akkauntning maqsad kanalga postlash huquqi yoki ruxsatli boshqa uzatish mexanizmi kerak.',menu());
      }
    }catch(e){return ctx.reply('❌ Tekshirish xatosi: '+String(e.message||e).slice(0,190),menu());}
    finally{if(client)await client.disconnect().catch(()=>{});}
  });
  bot.hears('📊 Holat',async ctx=>{
    if(!permitted(ctx))return;const c=await load();const sent=await Log.countDocuments({bot_key:cloneKey,status:'sent'});
    return ctx.reply('📊 CHANNEL CLONE\nManba: '+(c?.source_username?'@'+c.source_username:'yo‘q')+
      '\nKanal: '+(c?.target_username?'@'+c.target_username:'yo‘q')+
      '\nKuzatuv: '+(c?.auto_enabled?'yoqilgan':'o‘chiq')+'\nYuborilgan: '+sent+
      '\nTarixiy ID: '+Number(c?.history_cursor||0)+
      (c?.history_last_error?'\n⚠️ '+c.history_last_error:''),menu());
  });
  let repairing=false;
  bot.hears('🧹 Eski postlar matnini tuzatish',async ctx=>{
    if(!permitted(ctx))return;
    if(repairing)return ctx.reply('🔄 Tahrirlash davom etmoqda.',menu());
    const cfg=await load();
    if(!cfg?.target_chat_id||!sessionReady())return ctx.reply('❌ Kanal va Telegram sessiyasi kerak.',menu());
    repairing=true;
    await ctx.reply('🛠 Avval joylangan postlar qayta yuborilmasdan tahrirlanmoqda.',menu());
    void (async()=>{
      let client,edited=0,failed=0,checked=0;
      try{
        const {TelegramClient}=require('teleproto');
        const {StringSession}=require('teleproto/sessions');
        client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
          Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
        await client.connect();
        const target=cfg.target_username?'@'+cfg.target_username:cfg.target_chat_id;
        let after=null;
        while(true){
          const query={bot_key:cloneKey,status:'sent',target_message_id:{$gt:0}};
          if(after)query._id={$gt:after};
          const items=await Log.find(query).sort({_id:1}).limit(50).lean();
          if(!items.length)break;
          for(const item of items){
            after=item._id;checked++;
            try{
              const result=await client.getMessages(target,{ids:Number(item.target_message_id)});
              const post=Array.isArray(result)?result[0]:result;
              if(!post)continue;
              const before=String(post.message||'');
              const afterText=before.split('\n').filter(line=>!/^\\s*(?:📌\\s*)?Manba\\s*:/iu.test(line))
                .join('\n').replace(/\n{3,}/g,'\n\n').trim();
              if(afterText && afterText!==before.trim()){
                try {
                  if(post.media)await ctx.telegram.editMessageCaption(cfg.target_chat_id,item.target_message_id,undefined,afterText);
                  else await ctx.telegram.editMessageText(cfg.target_chat_id,item.target_message_id,undefined,afterText);
                } catch(e) {
                  await client.editMessage(target,{message:Number(item.target_message_id),text:afterText});
                }
                edited++;
              }
            }catch(e){failed++;console.warn('clone post edit failed',item.target_message_id,String(e.message||e).slice(0,120));}
            await new Promise(resolve=>setTimeout(resolve,400));
          }
        }
        await ctx.reply('✅ Tekshirildi: '+checked+'\n✏️ Tahrirlandi: '+edited+'\n⚠️ Xato: '+failed,menu());
      }catch(e){await ctx.reply('❌ Xato: '+String(e.message||e).slice(0,150),menu()).catch(()=>{});}
      finally{if(client)await client.disconnect().catch(()=>{});repairing=false;}
    })();
  });
  bot.hears('🔌 Ulangan kanallar',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const c=await load();
    return ctx.reply('🔌 Ulangan kanallar\n\n📥 Manba: '+(c?.source_username?'@'+c.source_username:'ulanmagan')
      +'\n📤 Maqsad: '+(c?.target_username?'@'+c.target_username:'ulanmagan')
      +'\n📡 Kuzatuv: '+(c?.auto_enabled?'yoqilgan':'o‘chiq'),menu());
  });
  bot.hears('❌ Kanallarni uzish',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    return ctx.reply('Qaysi ulanishni uzamiz?',Markup.inlineKeyboard([
      [Markup.button.callback('📥 Manbani uzish','clone:remove:source')],
      [Markup.button.callback('📤 Maqsadni uzish','clone:remove:target')],
      [Markup.button.callback('❌ Ikkalasini uzish','clone:remove:all')],
      [Markup.button.callback('Bekor qilish','clone:remove:cancel')]
    ]));
  });
  bot.action(/^clone:remove:(source|target|all|cancel)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    const choice=ctx.match[1];
    if(choice==='cancel')return ctx.reply('Bekor qilindi.',menu());
    const $set={auto_enabled:false,history_enabled:false,history_completed:false,
      history_cursor:0,history_ceiling:0,history_last_error:''};
    if(choice==='source'||choice==='all')Object.assign($set,{source_username:'',source_chat_id:'',source_cursor:0});
    if(choice==='target'||choice==='all')Object.assign($set,{target_chat_id:'',target_username:'',target_title:''});
    await Config.updateOne({bot_key:cloneKey},{$set},{upsert:true});
    ctx.session.step=null;
    return ctx.reply('✅ Ulanish uzildi. Avval yuborilgan postlar jurnali saqlandi; takroriy yuborilmaydi.',menu());
  });
  bot.on('text',async ctx=>{
    if(!permitted(ctx)||!ctx.session.step)return;
    const raw=String(ctx.message.text||'').trim();
    if(raw.startsWith('/') || /^(?:📥|📤|▶️|⏸|🔄|📊|🧪|🧹|🔌|❌|🏠)/u.test(raw))return;
    const step=ctx.session.step;ctx.session.step=null;
    const handle=telegramHandle(ctx.message.text);
    if(!handle)return ctx.reply('❌ Ommaviy @username kiriting.',menu());
    if(step==='target'){
      try{
        const chat=await ctx.telegram.getChat('@'+handle);
        const me=await ctx.telegram.getMe();
        const rights=await ctx.telegram.getChatMember(chat.id,me.id);
        const ownerRights=await ctx.telegram.getChatMember(chat.id,ctx.from.id);
        if(!['creator','administrator'].includes(ownerRights.status))
          return ctx.reply('❌ Maqsad kanalga faqat uning administratori ulanishi mumkin.',menu());
        if(chat.type!=='channel'||!['creator','administrator'].includes(rights.status)||
           (rights.status==='administrator'&&!rights.can_post_messages))
          return ctx.reply('❌ Botni kanalga post joylash huquqi bilan admin qiling.',menu());
        await Config.updateOne({bot_key:cloneKey},{$set:{target_chat_id:String(chat.id),target_username:handle,target_title:chat.title||handle}},{upsert:true});
        return ctx.reply('✅ Joylash kanali: @'+handle,menu());
      }catch(e){return ctx.reply('❌ Kanal tekshiruvi: '+String(e.message||e).slice(0,140),menu());}
    }
    if(step==='source'){
      if(!sessionReady())return ctx.reply('⚠️ Telegram user sessiyasi sozlanmagan. Render env: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION.',menu());
      await Config.updateOne({bot_key:cloneKey},{$set:{
        source_username:handle,source_mode:'mtproto',source_cursor:0,
        history_enabled:false,history_completed:false,history_cursor:0,history_ceiling:0,
        auto_enabled:false
      }},{upsert:true});
      return ctx.reply('✅ Manba: @'+handle+'. Endi ▶️ Sinxronlash ni bosing.',menu());
    }
  });
  return {key:cloneKey,title:config.title||'Channel Clone Bot',bot,config};
}
module.exports={createChannelCloneBot};
