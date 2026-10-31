'use strict';
const {Telegraf,Markup,session}=require('telegraf');
const {telegramChatRef,telegramHandle}=require('./channel-publisher');

function createChannelCloneBot({token,adminIds,Config,Log,sessionReady}) {
  if(!token || !/^\d+:[\w-]{20,}$/.test(token))return null;
  const bot=new Telegraf(token);
  bot.use(session({defaultSession:()=>({step:null})}));
  const permitted=ctx=>ctx.chat?.type==='private'&&adminIds.includes(Number(ctx.from?.id));
  const menu=()=>Markup.keyboard([
    ['📥 Manba kanal','📤 Bizning kanal'],
    ['▶️ Sinxronlash','⏸ To‘xtatish'],
    ['🔄 Eski postlarni qayta tekshirish','📊 Holat'],
    ['🧹 Eski postlar matnini tuzatish']
  ]).resize();
  const load=()=>Config.findOne({bot_key:'channel_clone'}).lean();
  const replyHelp=ctx=>ctx.reply('📡 CHANNEL CLONE BOT\n\nManba: ommaviy kanal (@username)\nMaqsad: o‘zingiz admin bo‘lgan kanal.\n\nManba postlar tarixidan olinadi, yangi postlar avtomatik kuzatiladi. Bir xil post takror joylanmaydi. Media serverga yuklanmaydi. Faqat ruxsat etilgan kontentdan foydalaning.',menu());
  bot.start(async ctx=>permitted(ctx)?replyHelp(ctx):ctx.reply('⛔ Ushbu xizmat uchun ruxsat yo‘q.'));
  bot.hears('📥 Manba kanal',async ctx=>{if(!permitted(ctx))return;ctx.session.step='source';return ctx.reply('Manba public kanal @username ni yuboring.');});
  bot.hears('📤 Bizning kanal',async ctx=>{if(!permitted(ctx))return;ctx.session.step='target';return ctx.reply('O‘zingizga tegishli kanal @username ni yuboring. Botga post joylash huquqini bering.');});
  bot.on('text',async ctx=>{
    if(!permitted(ctx)||!ctx.session.step)return;
    const step=ctx.session.step;ctx.session.step=null;
    const handle=telegramHandle(ctx.message.text);
    if(!handle)return ctx.reply('❌ Ommaviy @username kiriting.',menu());
    if(step==='target'){
      try{
        const chat=await ctx.telegram.getChat('@'+handle);
        const me=await ctx.telegram.getMe();
        const rights=await ctx.telegram.getChatMember(chat.id,me.id);
        if(chat.type!=='channel'||!['creator','administrator'].includes(rights.status)||
           (rights.status==='administrator'&&!rights.can_post_messages))
          return ctx.reply('❌ Botni kanalga post joylash huquqi bilan admin qiling.',menu());
        await Config.updateOne({bot_key:'channel_clone'},{$set:{target_chat_id:String(chat.id),target_username:handle,target_title:chat.title||handle}},{upsert:true});
        return ctx.reply('✅ Joylash kanali: @'+handle,menu());
      }catch(e){return ctx.reply('❌ Kanal tekshiruvi: '+String(e.message||e).slice(0,140),menu());}
    }
    if(step==='source'){
      if(!sessionReady())return ctx.reply('⚠️ Telegram user sessiyasi sozlanmagan. Render env: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION.',menu());
      await Config.updateOne({bot_key:'channel_clone'},{$set:{
        source_username:handle,source_mode:'mtproto',source_cursor:0,
        history_enabled:false,history_completed:false,history_cursor:0,history_ceiling:0,
        auto_enabled:false
      }},{upsert:true});
      return ctx.reply('✅ Manba: @'+handle+'. Endi ▶️ Sinxronlash ni bosing.',menu());
    }
  });
  bot.hears('▶️ Sinxronlash',async ctx=>{
    if(!permitted(ctx))return;const c=await load();
    if(!c?.target_chat_id||!c?.source_username)return ctx.reply('Avval ikkala kanalni ulang.',menu());
    if(!sessionReady())return ctx.reply('Telegram sessiyasi mavjud emas.',menu());
    await Config.updateOne({bot_key:'channel_clone'},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_last_error:''}});
    return ctx.reply('✅ Kuzatuv yoqildi. Eski postlar ham sinxronlanadi. Oldin yuborilganlar takrorlanmaydi.',menu());
  });
  bot.hears('⏸ To‘xtatish',async ctx=>{if(!permitted(ctx))return;await Config.updateOne({bot_key:'channel_clone'},{$set:{auto_enabled:false,history_enabled:false}});return ctx.reply('⏸ Sinxronlash to‘xtatildi.',menu());});
  bot.hears('🔄 Eski postlarni qayta tekshirish',async ctx=>{
    if(!permitted(ctx))return;const c=await load();
    if(!c?.source_username||!c?.target_chat_id)return ctx.reply('Avval kanallarni ulang.',menu());
    if(c.history_enabled&&!c.history_completed)return ctx.reply('🔄 Sinxronlash davom etmoqda.',menu());
    await Config.updateOne({bot_key:'channel_clone'},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_cursor:0,history_ceiling:0,history_last_error:''}});
    return ctx.reply('✅ Tarix qayta tekshiriladi. Ilgari yuborilgan postlar MongoDB jurnalidan aniqlanadi.',menu());
  });
  bot.hears('📊 Holat',async ctx=>{
    if(!permitted(ctx))return;const c=await load();const sent=await Log.countDocuments({bot_key:'channel_clone',status:'sent'});
    return ctx.reply('📊 CHANNEL CLONE\nManba: '+(c?.source_username?'@'+c.source_username:'yo‘q')+
      '\nKanal: '+(c?.target_username?'@'+c.target_username:'yo‘q')+
      '\nKuzatuv: '+(c?.auto_enabled?'yoqilgan':'o‘chiq')+'\nYuborilgan: '+sent+
      '\nTarixiy ID: '+Number(c?.history_cursor||0)+
      (c?.history_last_error?'\n⚠️ '+c.history_last_error:''),menu());
  });
  bot.hears('🧹 Eski postlar matnini tuzatish',async ctx=>{
    if(!permitted(ctx))return;
    return ctx.reply('ℹ️ Eski postlarni tahrirlash uchun mavjud Factory kino botidagi “🛠 Kanal postlarini tuzatish” bo‘limidan foydalaning. Clone Bot uchun ommaviy tahrirlash keyingi yangilanishda ulanadi.',menu());
  });
  return {key:'channel_clone',title:'Channel Clone Bot',bot,config:{key:'channel_clone'}};
}
module.exports={createChannelCloneBot};
