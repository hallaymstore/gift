'use strict';
const {Telegraf,Markup,session}=require('telegraf');
const {telegramChatRef,telegramHandle}=require('./channel-publisher');
const {countSourcePosts}=require('./channel-clone-count');

function createChannelCloneBot({token,adminIds,Config,Log,sessionReady,config={key:'channel_clone'}}) {
  const cloneKey=config.key||'channel_clone';
  if(!token || !/^\d+:[\w-]{20,}$/.test(token))return null;
  const bot=new Telegraf(token);
  bot.use(session({defaultSession:()=>({step:null})}));
  const permitted=ctx=>ctx.chat?.type==='private'&&adminIds.includes(Number(ctx.from?.id));
  const menu=()=>Markup.keyboard([
    ['📥 Manba kanal','📤 Bizning kanal'],
    ['🤖 Reklama botini ulash','🔗 Bot havolasini uzish'],
    ['🔌 Ulangan kanallar','❌ Kanallarni uzish'],
    ['▶️ Sinxronlash','⏸ To‘xtatish'],
    ['🔄 Eski postlarni qayta tekshirish','📊 Holat'],
    ['🔢 Manba postlarini sanash','⏱ Postlash intervali'],
    ['🏆 TOP 10','🏆 TOP 20'],
    ['🧪 Ulanishni tekshirish','🎨 Post formati'],
    ['🧹 Eski postlar matnini tuzatish']
  ]).resize();
  const load=()=>Config.findOne({bot_key:cloneKey}).lean();
  const replyHelp=ctx=>ctx.reply('📡 CHANNEL CLONE BOT\n\nManba: ommaviy kanal (@username)\nMaqsad: o‘zingiz admin bo‘lgan kanal.\n\nManba postlar tarixidan olinadi, yangi postlar avtomatik kuzatiladi. Bir xil post takror joylanmaydi. Media serverga yuklanmaydi. Faqat ruxsat etilgan kontentdan foydalaning.',menu());
  bot.start(async ctx=>{ctx.session.step=null;return permitted(ctx)?replyHelp(ctx):ctx.reply('⛔ Ushbu xizmat uchun ruxsat yo‘q.');});
  bot.command('cancel',async ctx=>{ctx.session.step=null;return ctx.reply('✅ Amal bekor qilindi.',menu());});
  bot.hears('🤖 Reklama botini ulash',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step='promo_bot';
    return ctx.reply('🤖 Post ostida ko‘rsatiladigan O‘Z botingiz username’ini yuboring: @MyBot yoki https://t.me/MyBot.\n\nBu klonlash boti tokenini almashtirmaydi; faqat reklama havolasini belgilaydi.',menu());
  });
  bot.hears('🔗 Bot havolasini uzish',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    await Config.updateOne({bot_key:cloneKey},{$set:{promo_bot_username:''}},{upsert:true});
    return ctx.reply('✅ Reklama boti havolasi uzildi. Yangi postlarda kloner bot havolasi chiqmaydi.',menu());
  });
  bot.hears('📥 Manba kanal',async ctx=>{if(!permitted(ctx))return;ctx.session.step='source';return ctx.reply('Manba public kanal @username ni yuboring.');});
  bot.hears('📤 Bizning kanal',async ctx=>{if(!permitted(ctx))return;ctx.session.step='target';return ctx.reply('O‘zingizga tegishli kanal @username ni yuboring. Botga post joylash huquqini bering.');});
  let counting=false;
  const formatCounts=(n,sent=0)=>'📊 MANBA KANAL TAHLILI\n\n📚 Jami postlar: '+n.total+
    '\n🖼 Rasmlar: '+n.photo+'\n🎬 Videolar: '+n.video+
    '\n🎵 Audio: '+n.audio+'\n📁 Fayllar: '+n.document+
    '\n✨ Stikerlar: '+n.sticker+'\n🎞 GIF/animatsiya: '+n.animation+
    '\n📝 Faqat matn: '+n.text+'\n📎 Linkli postlar: '+n.links+
    '\n❓ Boshqa media: '+n.other+
    '\n✅ Avval yuborilgan: '+sent+
    '\n📥 Qolgan (taxminiy): '+Math.max(0,n.total-sent)+
    '\n\nℹ️ Linkli postlar boshqa turlar bilan kesishishi mumkin.';
  async function recount(ctx,cfg){
    if(counting){await ctx.reply('🔄 Postlar hozir sanalmoqda.',menu());return null;}
    if(!sessionReady()){await ctx.reply('❌ Telegram sessiyasi sozlanmagan.',menu());return null;}
    counting=true;
    let client;
    try{
      await ctx.reply('🔎 Manba kanal tarixi sanalmoqda. Natijada jami va media turlari ko‘rsatiladi.',menu());
      const {TelegramClient}=require('teleproto');
      const {StringSession}=require('teleproto/sessions');
      client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
        Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
      await client.connect();
      const result=await countSourcePosts(client,cfg.source_username);
      const current=await load();
      if(current?.source_username!==cfg.source_username)throw new Error('Manba kanal o‘zgardi. Qayta urinib ko‘ring.');
      await Config.updateOne({bot_key:cloneKey,source_username:cfg.source_username},
        {$set:{source_stats:result}});
      const sent=await Log.countDocuments({bot_key:cloneKey,status:'sent',
        source_key:{$regex:'^public:'+cfg.source_username.toLowerCase()+':'}});
      await ctx.reply(formatCounts(result,sent),menu());
      return result;
    }catch(e){
      await ctx.reply('❌ Postlarni sanash xatosi: '+String(e.message||e).slice(0,180),menu()).catch(()=>{});
      return null;
    }finally{if(client)await client.disconnect().catch(()=>{});counting=false;}
  }
  bot.hears('🔢 Manba postlarini sanash',async ctx=>{
    if(!permitted(ctx))return;
    const cfg=await load();
    if(!cfg?.source_username)return ctx.reply('❌ Avval manba kanalni ulang.',menu());
    await recount(ctx,cfg);
  });
  bot.hears('⏱ Postlash intervali',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const cfg=await load();
    return ctx.reply('⏱ Hozirgi interval: '+Number(cfg?.publish_interval_minutes||0)+' daqiqa\n0 = tarixiy postlar navbat bilan imkon qadar tez yuboriladi. Yangi postlar odatdagidek kuzatiladi.',Markup.inlineKeyboard([
      [1,5,10,30].map(n=>Markup.button.callback(n+' daqiqa','clone:interval:'+n)),
      [60,180,360,1440].map(n=>Markup.button.callback(n>=60?(n/60)+' soat':n+' daq','clone:interval:'+n)),
      [Markup.button.callback('⚡ Intervalsiz','clone:interval:0')]
    ]));
  });
  bot.action(/^clone:interval:(0|1|5|10|30|60|180|360|1440)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    const value=Number(ctx.match[1]);
    await Config.updateOne({bot_key:cloneKey},{$set:{publish_interval_minutes:value,next_publish_at:value?new Date(Date.now()+value*60000):null}},{upsert:true});
    return ctx.reply('✅ Interval: '+(value?value+' daqiqa':'intervalsiz')+'. Tarixiy navbat shu tezlikda chiqariladi.',menu());
  });
  async function showTop(ctx,limit){
    if(!permitted(ctx))return;
    const cfg=await load();
    if(!cfg?.target_chat_id||!sessionReady())return ctx.reply('❌ Kanal va sessiya sozlanmagan.',menu());
    const logs=await Log.find({bot_key:cloneKey,status:'sent',target_message_id:{$gt:0}}).sort({createdAt:-1}).limit(1000).lean();
    if(!logs.length)return ctx.reply('📭 Hali yuborilgan postlar yo‘q.',menu());
    let client;
    try{
      const {TelegramClient}=require('teleproto');
      const {StringSession}=require('teleproto/sessions');
      client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
      await client.connect();
      const peer=cfg.target_username?'@'+cfg.target_username:cfg.target_chat_id;
      const rows=[];
      for(let i=0;i<logs.length;i+=100){
        const chunk=logs.slice(i,i+100),ids=chunk.map(x=>Number(x.target_message_id));
        const messages=await client.getMessages(peer,{ids});
        for(const m of Array.isArray(messages)?messages:[messages]){
          if(!m?.id)continue;
          const reactions=(m.reactions?.results||[]).reduce((n,r)=>n+Number(r.count||0),0);
          rows.push({id:Number(m.id),views:Number(m.views||0),reactions});
        }
      }
      const channel=String(cfg.target_username||'').replace(/^@/,'');
      const link=p=>channel?'https://t.me/'+channel+'/'+p.id:'Post ID: '+p.id;
      const viewsTop=[...rows].sort((a,b)=>b.views-a.views).slice(0,limit);
      const reactionsTop=[...rows].sort((a,b)=>b.reactions-a.reactions).slice(0,limit);
      const output='🏆 TOP '+limit+' POSTLAR (oxirgi '+logs.length+' ta jurnal)\n\n'
        +'👁 KO‘RISH BO‘YICHA\n'+viewsTop.map((p,i)=>(i+1)+'. '+p.views+' ko‘rish | '+p.reactions+' reaksiya\n'+link(p)).join('\n')
        +'\n\n❤️ REAKSIYA BO‘YICHA\n'+reactionsTop.map((p,i)=>(i+1)+'. '+p.reactions+' reaksiya | '+p.views+' ko‘rish\n'+link(p)).join('\n');
      for(let i=0;i<output.length;i+=3700)await ctx.reply(output.slice(i,i+3700),{disable_web_page_preview:true});
    }catch(e){await ctx.reply('⚠️ TOP hisoblash xatosi: '+String(e.message||e).slice(0,160),menu());}
    finally{if(client)await client.disconnect().catch(()=>{});}
  }
  bot.hears('🏆 TOP 10',ctx=>showTop(ctx,10));
  bot.hears('🏆 TOP 20',ctx=>showTop(ctx,20));
  bot.hears('▶️ Sinxronlash',async ctx=>{
    if(!permitted(ctx))return;const c=await load();
    if(!c?.target_chat_id||!c?.source_username)return ctx.reply('Avval ikkala kanalni ulang.',menu());
    if(!sessionReady())return ctx.reply('Telegram sessiyasi mavjud emas.',menu());
    if(c.history_enabled&&!c.history_completed&&c.auto_enabled)return ctx.reply('🔄 Sinxronlash avvaldan ishlamoqda.',menu());
    const stats=await recount(ctx,c);
    if(!stats)return;
    await Config.updateOne({bot_key:cloneKey,source_username:c.source_username},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_last_error:''}});
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
  bot.hears('🎨 Post formati',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const cfg=await load();
    return ctx.reply('🎨 Post ko‘rinishi: '+((cfg?.clone_format||'branded')==='original'?'Original':'Branded')+
      '\n\nOriginal: Telegram imkon berganda matn, custom emoji va formatlashni saqlaydi.\nBranded: bot va kanal nomini qo‘shadi; ayrim custom emoji formatlari yo‘qolishi mumkin.',
      Markup.inlineKeyboard([
        [Markup.button.callback('✨ Original format','clone:format:original')],
        [Markup.button.callback('📢 Branded format','clone:format:branded')]
      ]));
  });
  bot.action(/^clone:format:(original|branded)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    await Config.updateOne({bot_key:cloneKey},{$set:{clone_format:ctx.match[1]}},{upsert:true});
    ctx.session.step=null;
    return ctx.reply('✅ Post formati: '+ctx.match[1]+'. Bu sozlama faqat yangi nusxalanadigan postlarga qo‘llanadi.',menu());
  });
  bot.hears('📊 Holat',async ctx=>{
    if(!permitted(ctx))return;const c=await load();const sent=await Log.countDocuments({bot_key:cloneKey,status:'sent'});
    return ctx.reply('📊 CHANNEL CLONE\nManba: '+(c?.source_username?'@'+c.source_username:'yo‘q')+
      '\nKanal: '+(c?.target_username?'@'+c.target_username:'yo‘q')+
      '\nKuzatuv: '+(c?.auto_enabled?'yoqilgan':'o‘chiq')+'\nYuborilgan: '+sent+
      '\nTarixiy ID: '+Number(c?.history_cursor||0)+
      (c?.source_stats?'\n📚 Jami: '+c.source_stats.total+' | 🖼 '+c.source_stats.photo+' | 🎬 '+c.source_stats.video+' | 🎵 '+c.source_stats.audio+' | 📁 '+c.source_stats.document+' | 📎 '+c.source_stats.links:'')+
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
    if(raw.startsWith('/') || /^(?:📥|📤|▶️|⏸|🔄|📊|🧪|🧹|🔌|❌|🏠|🎨|🔢|⏱|🏆|🤖|🔗)/u.test(raw))return;
    const step=ctx.session.step;ctx.session.step=null;
    const handle=telegramHandle(ctx.message.text);
    if(!handle)return ctx.reply('❌ Ommaviy @username kiriting.',menu());
    if(step==='promo_bot'){
      try{
        const botInfo=await ctx.telegram.getChat('@'+handle);
        if(botInfo.type!=='private')return ctx.reply('❌ Bot username’ini yuboring (kanal emas).',menu());
        await Config.updateOne({bot_key:cloneKey},{$set:{promo_bot_username:handle}},{upsert:true});
        return ctx.reply('✅ Postlar ostida ko‘rsatiladigan bot: @'+handle,menu());
      }catch(e){return ctx.reply('❌ Bot username’i tekshirib bo‘lmadi: '+String(e.message||e).slice(0,140),menu());}
    }
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
