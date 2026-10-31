'use strict';
const {Telegraf,Markup,session}=require('telegraf');
const {telegramChatRef,telegramHandle}=require('./channel-publisher');
const {countSourcePosts}=require('./channel-clone-count');

function createChannelCloneBot({token,adminIds,Config,Log,sessionReady,config={key:'channel_clone'}}) {
  const cloneKey=config.key||'channel_clone';
  if(!token || !/^\d+:[\w-]{20,}$/.test(token))return null;
  const bot=new Telegraf(token);
  bot.use(session({defaultSession:()=>({step:null,activeRoute:cloneKey,routeLoaded:false,wizard:false})}));
  const permitted=ctx=>ctx.chat?.type==='private'&&adminIds.includes(Number(ctx.from?.id));
  bot.use(async(ctx,next)=>{
    if(!ctx.from||!ctx.session||ctx.session.routeLoaded)return next();
    ctx.session.routeLoaded=true;
    try{
      const base=await Config.findOne({bot_key:cloneKey}).select('active_route_by_user').lean();
      const remembered=base?.active_route_by_user?.[String(ctx.from.id)];
      if(remembered&&remembered!==cloneKey){
        const exists=await Config.exists({bot_key:remembered,owner_bot_key:cloneKey});
        if(exists)ctx.session.activeRoute=remembered;
      }
    }catch(e){console.warn('[clone] restored route:',String(e.message||e).slice(0,120));}
    return next();
  });

  const menu=()=>Markup.keyboard([
    ['➕ Yangi yo‘nalish','🗂 Yo‘nalishlar'],
    ['📊 Barcha yo‘nalishlar','⏸ Hammasini to‘xtatish'],
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
  const routeKey=ctx=>ctx?.session?.activeRoute||cloneKey;
  const routesQuery=()=>({$or:[{bot_key:cloneKey},{owner_bot_key:cloneKey}]});
  async function rememberRoute(ctx,key){
    ctx.session.activeRoute=key;
    ctx.session.routeLoaded=true;
    await Config.updateOne({bot_key:cloneKey},
      {$set:{['active_route_by_user.'+String(ctx.from.id)]:key}},{upsert:true});
  }
  const routeLabel=(c,i)=>String(c.route_title||(c.bot_key===cloneKey?'Asosiy kanal':'Yo‘nalish '+i)).slice(0,40);
  const load=ctx=>Config.findOne({bot_key:routeKey(ctx)}).lean();
  const replyHelp=ctx=>ctx.reply('📡 CHANNEL CLONE BOT\n\nManba: ommaviy kanal (@username)\nMaqsad: o‘zingiz admin bo‘lgan kanal.\n\nManba postlar tarixidan olinadi, yangi postlar avtomatik kuzatiladi. Bir xil post takror joylanmaydi. Media serverga yuklanmaydi. Faqat ruxsat etilgan kontentdan foydalaning.',menu());
  bot.start(async ctx=>{ctx.session.step=null;ctx.session.wizard=false;return permitted(ctx)?replyHelp(ctx):ctx.reply('⛔ Ushbu xizmat uchun ruxsat yo‘q.');});
  bot.command('cancel',async ctx=>{ctx.session.step=null;ctx.session.wizard=false;return ctx.reply('✅ Amal bekor qilindi.',menu());});
  bot.hears('➕ Yangi yo‘nalish',async ctx=>{
    if(!permitted(ctx))return;
    const existing=await Config.countDocuments(routesQuery());
    if(existing>=20)return ctx.reply('⚠️ Bitta botda maksimal 20 ta yo‘nalish.',menu());
    ctx.session.wizard=true;
    ctx.session.step='route_title';
    return ctx.reply('➕ Yangi yo‘nalishga nom bering (masalan: Musiqa, Yangiliklar).',menu());
  });
  bot.hears('🗂 Yo‘nalishlar',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const configs=await Config.find(routesQuery()).sort({createdAt:1}).limit(20).lean();
    if(!configs.length)return ctx.reply('Hozircha yo‘nalish yo‘q. ➕ Yangi yo‘nalish ni bosing.',menu());
    const rows=configs.map((r,i)=>[Markup.button.callback((r.bot_key===routeKey(ctx)?'✅ ':'')+
      routeLabel(r,i+1)+' | '+(r.source_username?'@'+r.source_username:'manbasiz')+
      ' → '+(r.target_username?'@'+r.target_username:'kanalsiz')+(r.auto_enabled?' 🟢':' ⏸'),'clone:route:'+r.bot_key)]);
    rows.push([Markup.button.callback('🗑 Tanlangan yo‘nalishni o‘chirish','clone:route:delete:ask')]);
    return ctx.reply('🗂 Yo‘nalishlar (tanlash uchun bosing):',Markup.inlineKeyboard(rows));
  });
  bot.action(/^clone:route:(.+)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    const id=ctx.match[1];
    if(id==='delete:ask'){
      if(routeKey(ctx)===cloneKey)return ctx.reply('⚠️ Asosiy yo‘nalishni o‘chirish o‘rniga kanallarini uzing.',menu());
      return ctx.reply('Tanlangan yo‘nalishni o‘chirasizmi? Yuborilgan postlar jurnali saqlanadi.',
        Markup.inlineKeyboard([[Markup.button.callback('🗑 Tasdiqlash','clone:delete:yes'),
          Markup.button.callback('Bekor qilish','clone:delete:no')]]));
    }
    const found=await Config.findOne({bot_key:id,$or:[{owner_bot_key:cloneKey},{bot_key:cloneKey}]}).lean();
    if(!found)return ctx.reply('❌ Yo‘nalish topilmadi.',menu());
    await rememberRoute(ctx,id);
    ctx.session.step=null;
    ctx.session.wizard=false;
    return ctx.reply('✅ Faol yo‘nalish: '+(found.route_title||id)+'\n📥 '+(found.source_username||'ulanmagan')+
      '\n📤 '+(found.target_username||'ulanmagan')+'\n⏱ '+Number(found.publish_interval_minutes||0)+' daqiqa',menu());
  });
  bot.action(/^clone:delete:(yes|no)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    if(ctx.match[1]==='no')return ctx.reply('Bekor qilindi.',menu());
    const key=routeKey(ctx);
    if(key===cloneKey)return ctx.reply('Asosiy yo‘nalishni o‘chirib bo‘lmaydi.',menu());
    await Config.deleteOne({bot_key:key,owner_bot_key:cloneKey});
    await rememberRoute(ctx,cloneKey);
    return ctx.reply('✅ Yo‘nalish o‘chirildi. Endi asosiy yo‘nalish tanlangan.',menu());
  });
  bot.hears('📊 Barcha yo‘nalishlar',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const configs=await Config.find(routesQuery()).sort({createdAt:1}).limit(20).lean();
    if(!configs.length)return ctx.reply('📭 Yo‘nalishlar yo‘q. ➕ Yangi yo‘nalish tugmasini bosing.',menu());
    const lines=configs.map((r,i)=>
      (r.bot_key===routeKey(ctx)?'✅ ':'')+(i+1)+'. '+routeLabel(r,i+1)+
      '\n📥 '+(r.source_username?'@'+r.source_username:'—')+
      ' → 📤 '+(r.target_username?'@'+r.target_username:'—')+
      '\n'+(r.auto_enabled?'🟢 Ishlamoqda':'⏸ To‘xtagan')+
      ' · ⏱ '+Number(r.publish_interval_minutes||0)+' daq'+
      (r.promo_bot_username?' · 🤖 @'+r.promo_bot_username:'')+
      (r.history_last_error?'\n⚠️ '+String(r.history_last_error).slice(0,100):''));
    return ctx.reply('📊 JAMI YO‘NALISHLAR: '+configs.length+
      '\n🟢 Faol: '+configs.filter(x=>x.auto_enabled).length+
      '\n⏸ To‘xtagan: '+configs.filter(x=>!x.auto_enabled).length+'\n\n'+lines.join('\n\n'),menu());
  });
  bot.hears('⏸ Hammasini to‘xtatish',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    return ctx.reply('Barcha yo‘nalishlarni to‘xtatishga rozimisiz?',Markup.inlineKeyboard([
      [Markup.button.callback('⏸ Ha, hammasini to‘xtatish','clone:pause:all')],
      [Markup.button.callback('Bekor qilish','clone:pause:cancel')]
    ]));
  });
  bot.action(/^clone:pause:(all|cancel)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    if(ctx.match[1]==='cancel')return ctx.reply('Bekor qilindi.',menu());
    const result=await Config.updateMany(routesQuery(),{$set:{auto_enabled:false,history_enabled:false}});
    ctx.session.step=null;
    return ctx.reply('⏸ '+result.modifiedCount+' ta yo‘nalish to‘xtatildi. Ularni 🗂 Yo‘nalishlar orqali alohida qayta yoqishingiz mumkin.',menu());
  });
  bot.hears('🤖 Reklama botini ulash',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step='promo_bot';
    return ctx.reply('🤖 Post ostida ko‘rsatiladigan O‘Z botingiz username’ini yuboring: @MyBot yoki https://t.me/MyBot.\n\nBu klonlash boti tokenini almashtirmaydi; faqat reklama havolasini belgilaydi.',menu());
  });
  bot.hears('🔗 Bot havolasini uzish',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    await Config.updateOne({bot_key:routeKey(ctx)},{$set:{promo_bot_username:''}},{upsert:true});
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
      const current=await load(ctx);
      if(current?.source_username!==cfg.source_username)throw new Error('Manba kanal o‘zgardi. Qayta urinib ko‘ring.');
      await Config.updateOne({bot_key:routeKey(ctx),source_username:cfg.source_username},
        {$set:{source_stats:result}});
      const sent=await Log.countDocuments({bot_key:routeKey(ctx),status:'sent',target_chat_id:cfg.target_chat_id,
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
    const cfg=await load(ctx);
    if(!cfg?.source_username)return ctx.reply('❌ Avval manba kanalni ulang.',menu());
    await recount(ctx,cfg);
  });
  bot.hears('⏱ Postlash intervali',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const cfg=await load(ctx);
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
    await Config.updateOne({bot_key:routeKey(ctx)},{$set:{publish_interval_minutes:value,next_publish_at:value?new Date(Date.now()+value*60000):null}},{upsert:true});
    return ctx.reply('✅ Interval: '+(value?value+' daqiqa':'intervalsiz')+'. Tarixiy navbat shu tezlikda chiqariladi.',menu());
  });
  // Avoid blocking Telegram webhook updates while MTProto statistics are read.
  // Large ID batches caused FloodWait and 90-second webhook timeouts.
  const topCalculating=new Set();
  const TOP_CACHE_MS=15*60*1000;
  function topOutput(rows,limit,channel,total){
    const link=p=>channel?'https://t.me/'+channel+'/'+p.id:'Post ID: '+p.id;
    const viewsTop=[...rows].sort((a,b)=>b.views-a.views).slice(0,limit);
    const reactionsTop=[...rows].sort((a,b)=>b.reactions-a.reactions).slice(0,limit);
    return '🏆 TOP '+limit+' (so‘nggi '+total+' ta yuborilgan post asosida)\n\n'+
      '👁 KO‘RISH BO‘YICHA\n'+
      viewsTop.map((p,i)=>(i+1)+'. '+p.views+' ko‘rish | '+p.reactions+' reaksiya\n'+link(p)).join('\n')+
      '\n\n❤️ REAKSIYA BO‘YICHA\n'+
      reactionsTop.map((p,i)=>(i+1)+'. '+p.reactions+' reaksiya | '+p.views+' ko‘rish\n'+link(p)).join('\n')+
      '\n\nℹ️ Natija 15 daqiqagacha keshda saqlanadi.';
  }
  async function sendTopText(telegram,chatId,text){
    // Telegram messages are capped at 4096 characters. Split only at line breaks.
    while(text.length){
      if(text.length<=3900){
        await telegram.sendMessage(chatId,text,{disable_web_page_preview:true});
        break;
      }
      const at=text.lastIndexOf('\n',3900);
      const cut=at>500?at:3900;
      await telegram.sendMessage(chatId,text.slice(0,cut),{disable_web_page_preview:true});
      text=text.slice(cut).trimStart();
    }
  }
  async function showTop(ctx,limit){
    if(!permitted(ctx))return;
    const route=routeKey(ctx);
    const cfg=await load(ctx);
    if(!cfg?.target_chat_id||!sessionReady())return ctx.reply('❌ Kanal va sessiya sozlanmagan.',menu());
    const chatId=ctx.chat.id;
    const channel=String(cfg.target_username||'').replace(/^@/,'');
    const cache=cfg.top_metrics_cache;
    if(cache?.rows?.length&&new Date(cache.at).getTime()+TOP_CACHE_MS>Date.now()&&cache.channel===channel){
      return sendTopText(ctx.telegram,chatId,topOutput(cache.rows,limit,channel,cache.total||cache.rows.length));
    }
    if(topCalculating.has(route)){
      return ctx.reply('🔄 Ushbu kanal reytingi allaqachon hisoblanmoqda. Natija tayyor bo‘lgach shu chatga yuboriladi.',menu());
    }
    // Acknowledge immediately so webhook does not wait for Telegram FloodWait.
    await ctx.reply('🔎 TOP '+limit+' statistikasi hisoblanmoqda. Shu paytda boshqa menyularni ishlatishingiz mumkin.',menu());
    topCalculating.add(route);
    const telegram=ctx.telegram;
    void (async()=>{
      let client;
      try{
        // A small batch avoids multi-minute Telegram MTProto FloodWait.
        const logs=await Log.find({bot_key:route,target_chat_id:cfg.target_chat_id,status:'sent',target_message_id:{$gt:0}})
          .sort({createdAt:-1}).limit(60).select('target_message_id').lean();
        if(!logs.length){
          await telegram.sendMessage(chatId,'📭 Hali yuborilgan postlar yo‘q.');
          return;
        }
        const {TelegramClient}=require('teleproto');
        const {StringSession}=require('teleproto/sessions');
        client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
          Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:2});
        await client.connect();
        const peer=channel?'@'+channel:cfg.target_chat_id;
        const ids=[...new Set(logs.map(x=>Number(x.target_message_id)).filter(x=>x>0))];
        const messages=await client.getMessages(peer,{ids});
        const rows=[];
        for(const m of Array.isArray(messages)?messages:[messages]){
          if(!m?.id)continue;
          const reactions=(m.reactions?.results||[]).reduce((n,p)=>n+Number(p.count||0),0);
          rows.push({id:Number(m.id),views:Number(m.views||0),reactions});
        }
        if(!rows.length){
          await telegram.sendMessage(chatId,'⚠️ Yuborilgan postlar bor, lekin ularning ko‘rish va reaksiya statistikasi Telegram sessiyasiga ko‘rinmayapti.');
          return;
        }
        await Config.updateOne({bot_key:route},{$set:{
          top_metrics_cache:{at:new Date(),rows,channel,total:logs.length}
        }});
        await sendTopText(telegram,chatId,topOutput(rows,limit,channel,logs.length));
      }catch(e){
        const reason=String(e.message||e).slice(0,170);
        console.warn('[clone top] metrics unavailable',route,reason);
        await telegram.sendMessage(chatId,
          '⚠️ TOP statistikasini hozir olish imkoni yo‘q: '+reason+
          '\nTelegram FloodWait qo‘ygan bo‘lsa, birozdan so‘ng qayta urinib ko‘ring.').catch(()=>{});
      }finally{
        topCalculating.delete(route);
        if(client)await client.disconnect().catch(()=>{});
      }
    })();
  }
  bot.hears('🏆 TOP 10',ctx=>showTop(ctx,10));
  bot.hears('🏆 TOP 20',ctx=>showTop(ctx,20));
  bot.hears('▶️ Sinxronlash',async ctx=>{
    if(!permitted(ctx))return;const c=await load(ctx);
    if(!c?.target_chat_id||!c?.source_username)return ctx.reply('Avval ikkala kanalni ulang.',menu());
    if(!sessionReady())return ctx.reply('Telegram sessiyasi mavjud emas.',menu());
    if(c.history_enabled&&!c.history_completed&&c.auto_enabled)return ctx.reply('🔄 Sinxronlash avvaldan ishlamoqda.',menu());
    const stats=await recount(ctx,c);
    if(!stats)return;
    await Config.updateOne({bot_key:routeKey(ctx),source_username:c.source_username},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_last_error:'',history_retry_at:null,history_error_count:0}});
    return ctx.reply('✅ Kuzatuv yoqildi. Eski postlar ham sinxronlanadi. Oldin yuborilganlar takrorlanmaydi.',menu());
  });
  bot.hears('⏸ To‘xtatish',async ctx=>{if(!permitted(ctx))return;await Config.updateOne({bot_key:routeKey(ctx)},{$set:{auto_enabled:false,history_enabled:false}});return ctx.reply('⏸ Sinxronlash to‘xtatildi.',menu());});
  bot.hears('🔄 Eski postlarni qayta tekshirish',async ctx=>{
    if(!permitted(ctx))return;const c=await load(ctx);
    if(!c?.source_username||!c?.target_chat_id)return ctx.reply('Avval kanallarni ulang.',menu());
    if(c.history_enabled&&!c.history_completed)return ctx.reply('🔄 Sinxronlash davom etmoqda.',menu());
    await Config.updateOne({bot_key:routeKey(ctx)},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_cursor:0,history_ceiling:0,history_last_error:'',history_retry_at:null,history_error_count:0}});
    return ctx.reply('✅ Tarix qayta tekshiriladi. Ilgari yuborilgan postlar MongoDB jurnalidan aniqlanadi.',menu());
  });
  bot.hears('🧪 Ulanishni tekshirish',async ctx=>{
    if(!permitted(ctx))return;
    const c=await load(ctx);
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
    const cfg=await load(ctx);
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
    await Config.updateOne({bot_key:routeKey(ctx)},{$set:{clone_format:ctx.match[1]}},{upsert:true});
    ctx.session.step=null;
    return ctx.reply('✅ Post formati: '+ctx.match[1]+'. Bu sozlama faqat yangi nusxalanadigan postlarga qo‘llanadi.',menu());
  });
  bot.hears('📊 Holat',async ctx=>{
    if(!permitted(ctx))return;const c=await load(ctx);const sent=await Log.countDocuments({bot_key:routeKey(ctx),target_chat_id:c?.target_chat_id,status:'sent'});
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
    const cfg=await load(ctx);
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
          const query={bot_key:routeKey(ctx),target_chat_id:cfg.target_chat_id,status:'sent',target_message_id:{$gt:0}};
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
    const c=await load(ctx);
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
      history_cursor:0,history_ceiling:0,history_last_error:'',history_retry_at:null,history_error_count:0};
    if(choice==='source'||choice==='all')Object.assign($set,{source_username:'',source_chat_id:'',source_cursor:0});
    if(choice==='target'||choice==='all')Object.assign($set,{target_chat_id:'',target_username:'',target_title:''});
    await Config.updateOne({bot_key:routeKey(ctx)},{$set},{upsert:true});
    ctx.session.step=null;
    return ctx.reply('✅ Ulanish uzildi. Avval yuborilgan postlar jurnali saqlandi; takroriy yuborilmaydi.',menu());
  });
  bot.on('text',async ctx=>{
    if(!permitted(ctx)||!ctx.session.step)return;
    const raw=String(ctx.message.text||'').trim();
    if(raw.startsWith('/') || /^(?:📥|📤|▶️|⏸|🔄|📊|🧪|🧹|🔌|❌|🏠|🎨|🔢|⏱|🏆|🤖|🔗|➕|🗂)/u.test(raw))return;
    const step=ctx.session.step;ctx.session.step=null;
    if(step==='route_title'){
      const title=raw.slice(0,40).trim();
      if(title.length<2)return ctx.reply('❌ Kamida 2 belgi kiriting.',menu());
      const id=cloneKey+':r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
      await Config.create({bot_key:id,owner_bot_key:cloneKey,route_title:title,source_mode:'mtproto',auto_enabled:false});
      await rememberRoute(ctx,id);
      ctx.session.step='source';
      return ctx.reply('✅ '+title+' yo‘nalishi yaratildi!\n\n1/3 📥 Manba kanal @username ni yuboring.',menu());
    }
    const handle=telegramHandle(ctx.message.text);
    if(!handle)return ctx.reply('❌ Ommaviy @username kiriting.',menu());
    if(step==='promo_bot'){
      try{
        const botInfo=await ctx.telegram.getChat('@'+handle);
        if(botInfo.type!=='private')return ctx.reply('❌ Bot username’ini yuboring (kanal emas).',menu());
        await Config.updateOne({bot_key:routeKey(ctx)},{$set:{promo_bot_username:handle}},{upsert:true});
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
        const sourceForRoute=(await load(ctx))?.source_username;
        if(sourceForRoute){
          const clash=await Config.findOne({
            $and:[routesQuery(),{bot_key:{$ne:routeKey(ctx)}},
              {source_username:sourceForRoute,target_chat_id:String(chat.id)}]
          }).select('route_title').lean();
          if(clash)return ctx.reply('⚠️ Shu manba va maqsad kanal juftligi boshqa yo‘nalishda mavjud: '+(clash.route_title||'Asosiy')+
            '. Ikkita bir xil yo‘nalish kanalingizda takroriy postlar chiqarishi mumkin.',menu());
        }
        const existingTarget=await load(ctx);
        const changedTarget=Boolean(existingTarget?.target_chat_id&&String(existingTarget.target_chat_id)!==String(chat.id));
        const newTargetData={target_chat_id:String(chat.id),target_username:handle,target_title:chat.title||handle};
        if(changedTarget)Object.assign(newTargetData,{
          source_cursor:0,history_cursor:0,history_ceiling:0,
          history_completed:false,history_enabled:false,auto_enabled:false,
          history_sent:0,history_skipped:0,history_last_error:'',
          history_retry_at:null,history_error_count:0,top_metrics_cache:null,
          next_publish_at:null
        });
        await Config.updateOne({bot_key:routeKey(ctx)},{$set:newTargetData},{upsert:true});
        if(ctx.session.wizard){
          ctx.session.wizard=false;
          return ctx.reply('✅ Yo‘nalish tayyor!\n📥 Manba: @'+(await load(ctx))?.source_username+
            '\n📤 Kanal: @'+handle+
            '\n\n3/3 🤖 Reklama botini ulash (ixtiyoriy), ⏱ Postlash intervali ni tanlang va ▶️ Sinxronlash tugmasini bosing.\n\nBoshqa kanal juftligini yaratish uchun ➕ Yangi yo‘nalish ni bosing.',menu());
        }
        return ctx.reply('✅ Joylash kanali: @'+handle+(changedTarget?'\n🔄 Yangi kanal uchun tarixiy navbat qayta boshlanadi. Oldingi kanal postlari o‘zgarmaydi.':'')+'\n▶️ Sinxronlash ni bosing.',menu());
      }catch(e){return ctx.reply('❌ Kanal tekshiruvi: '+String(e.message||e).slice(0,140),menu());}
    }
    if(step==='source'){
      if(!sessionReady())return ctx.reply('⚠️ Telegram user sessiyasi sozlanmagan. Render env: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION.',menu());
      await Config.updateOne({bot_key:routeKey(ctx)},{$set:{
        source_username:handle,source_mode:'mtproto',source_cursor:0,
        history_enabled:false,history_completed:false,history_cursor:0,history_ceiling:0,
        auto_enabled:false
      }},{upsert:true});
      if(ctx.session.wizard){
        ctx.session.step='target';
        return ctx.reply('✅ Manba: @'+handle+'\n\n2/3 📤 Endi O‘Z kanalingiz @username ni yuboring. Kloner bot kanal administratori bo‘lishi kerak.',menu());
      }
      return ctx.reply('✅ Manba: @'+handle+'. Endi ▶️ Sinxronlash ni bosing.',menu());
    }
  });
  return {key:cloneKey,title:config.title||'Channel Clone Bot',bot,config};
}
module.exports={createChannelCloneBot};
