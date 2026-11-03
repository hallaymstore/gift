'use strict';
const {Telegraf,Markup,session}=require('telegraf');
const {telegramChatRef,telegramHandle}=require('./channel-publisher');
const {countSourcePosts}=require('./channel-clone-count');
const {describeRelayError}=require('./channel-clone-errors');
const {contactUsername,adFooter,getTargetPostLink,refreshClonePostText}=require('./channel-clone-branding');
const {createOrReuseInvite,forgetRouteInvite}=require('./channel-clone-invite');
const {parsePeerReference,sourceRefLabel,sourceKey,resolveSourcePeer,listJoinedGroups,validateSourceReference}=require('./channel-clone-peers');
const {normalizePhone,normalizeUsername,detectSourceAdminCandidates}=require('./channel-clone-contacts');

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
    ['📥 Manba kanal/guruh','📤 Bizning kanal/guruh'],
    ['➕ Shu manzilga manba','🧭 Manbalar ro‘yxati'],
    ['👥 Aʼzo bo‘lgan guruhlar'],
    ['🤖 Reklama botini ulash','📩 Reklama admini'],
    ['🪪 Admin kontaktlari'],
    ['🔗 Bot havolasini uzish','🗑 Admin havolasini uzish'],
    ['🔌 Ulangan kanallar','❌ Kanallarni uzish'],
    ['▶️ Sinxronlash','⏸ To‘xtatish'],
    ['🔄 Eski postlarni qayta tekshirish','📊 Holat'],
    ['🔁 Xatoni qayta sinash'],
    ['🔢 Manba postlarini sanash','⏱ Postlash intervali'],
    ['🏆 TOP 10','🏆 TOP 20'],
    ['🧪 Ulanishni tekshirish','🎨 Post formati'],
    ['📋 Post imzosi','🔗 Bizning taklif havolamiz'],
    ['🧹 Eski postlar matnini tuzatish'],
    ['🔁 Eski username/linklarni almashtirish']
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
  const replyHelp=ctx=>ctx.reply('📡 CHANNEL / GROUP CLONE BOT\n\nManba: ochiq kanal/guruh @username yoki MTProto akkauntingiz aʼzo bo‘lgan xususiy guruh IDsi.\nMaqsad: o‘zingiz admin bo‘lgan kanal yoki guruh.\n\nBir nechta manbani bitta maqsadga biriktirish mumkin. Har bir manbaning tarixi va intervali alohida yuritiladi. Faqat ulashishga ruxsat etilgan kontentni ko‘chiring; himoyalangan xabarlar o‘tkazib yuboriladi.',menu());
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
      routeLabel(r,i+1)+' | '+(sourceRefLabel(r)||'manbasiz')+
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
    return ctx.reply('✅ Faol yo‘nalish: '+(found.route_title||id)+'\n📥 '+(sourceRefLabel(found)||'ulanmagan')+
      '\n📤 '+(found.target_username?'@'+found.target_username:found.target_title||found.target_chat_id||'ulanmagan')+'\n⏱ '+Number(found.publish_interval_minutes||0)+' daqiqa',menu());
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
      '\n📥 '+(sourceRefLabel(r)||'—')+
      ' → 📤 '+(r.target_username?'@'+r.target_username:'—')+
      '\n'+(r.auto_enabled?'🟢 Ishlamoqda':'⏸ To‘xtagan')+
      ' · ⏱ '+Number(r.publish_interval_minutes||0)+' daq'+
      (r.promo_bot_username?' · 🤖 @'+r.promo_bot_username:'')+
       (r.promo_admin_username?' · 📩 @'+r.promo_admin_username:'')+
      (r.protected_skipped?'\n🔒 Himoyalangan, o‘tkazib yuborilgan: '+Number(r.protected_skipped):'')+
      (r.history_last_error?'\n⚠️ '+describeRelayError(r.history_last_error,100):''));
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
  bot.hears('📩 Reklama admini',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step='promo_admin';
    const current=await load(ctx);
    return ctx.reply('📩 Reklama va e’lonlar uchun bog‘lanadigan Telegram username’ni yuboring.\n\nMisol: @admin_username yoki https://t.me/admin_username\n\nHozir: '+(current?.promo_admin_username?'@'+current.promo_admin_username:'ulanmagan')+'\nPostga: 📩 Reklama uchun: @admin_username',menu());
  });
  bot.hears('🗑 Admin havolasini uzish',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    await Config.updateOne({bot_key:routeKey(ctx)},{$set:{promo_admin_username:''}},{upsert:true});
    return ctx.reply('✅ Reklama admini olib tashlandi. Yangi postlarda admin username chiqmaydi.',menu());
  });
  bot.hears('🪪 Admin kontaktlari',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const cfg=await load(ctx);
    if(!cfg)return ctx.reply('❌ Avval yo‘nalishni tanlang.',menu());
    const phones=(cfg.source_admin_phones||[]).map(x=>'☎️ '+x);
    const users=(cfg.source_admin_usernames||[]).map(x=>'👤 @'+x);
    return ctx.reply('🪪 HAR BIR MANBA UCHUN ADMIN KONTAKTLARI\n\n'+
      '📥 Manba: '+sourceRefLabel(cfg)+'\n'+
      '📤 Bizning reklama admini: '+(cfg.promo_admin_username?'@'+cfg.promo_admin_username:'sozlanmagan')+
      '\n☎️ Bizning reklama telefonimiz: '+(cfg.promo_admin_phone||'sozlanmagan')+
      '\n\n🔎 TASDIQLANGAN MANBA KONTAKTLARI:\n'+
      ([...phones,...users].join('\n')||'Hozircha yo‘q')+
      '\n\n⚠️ Bot hech qachon barcha telefonlarni ko‘r-ko‘rona almashtirmaydi. Faqat shu manba uchun SIZ tasdiqlagan raqam va username’lar almashtiriladi. Sotuvchilar/mijozlar raqamlari saqlanadi.',
      Markup.inlineKeyboard([
        [Markup.button.callback('📱 Bizning admin raqamimiz','clone:contacts:ownphone')],
        [Markup.button.callback('➕ Manba admin raqami','clone:contacts:addphone'),
          Markup.button.callback('➕ Manba admin username','clone:contacts:adduser')],
        [Markup.button.callback('🔎 Manbadan adminlarni aniqlash','clone:contacts:scan')],
        [Markup.button.callback('➖ Manba kontaktini olib tashlash','clone:contacts:remove')],
        [Markup.button.callback('🗑 Barcha manba kontaktlarini tozalash','clone:contacts:clear')]
      ]));
  });
  bot.action(/^clone:contacts:(ownphone|addphone|adduser|remove|scan|clear|clearok|cancel)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    const action=ctx.match[1],key=routeKey(ctx);
    if(action==='cancel'){
      ctx.session.step=null;ctx.session.contactCandidates=null;
      return ctx.reply('✅ Amal bekor qilindi.',menu());
    }
    const cfg=await load(ctx);
    if(!cfg)return ctx.reply('❌ Yo‘nalish topilmadi.',menu());
    if(action==='clear'){
      return ctx.reply('⚠️ Faqat '+(cfg.route_title||sourceRefLabel(cfg))+
        ' manbasining tasdiqlangan admin raqamlari va username’larini o‘chiramizmi?'+
        '\nBizning admin telefonimiz saqlanadi.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🗑 Ha, tozalash','clone:contacts:clearok')],
          [Markup.button.callback('Bekor qilish','clone:contacts:cancel')]
        ]));
    }
    if(action==='clearok'){
      await Config.updateOne({bot_key:key},{$set:{
        source_admin_phones:[],source_admin_usernames:[]
      }});
      return ctx.reply('✅ Faqat shu manbaning tasdiqlangan admin kontaktlari tozalandi.',menu());
    }
    if(['ownphone','addphone','adduser','remove'].includes(action)){
      ctx.session.contactRoute=key;
      ctx.session.step='contact_'+action;
      const help={
        ownphone:'📱 O‘Z reklama adminimizning raqamini yuboring.\nMasalan: +998901234567\n«-» — raqamni o‘chirish.\n⚠️ Raqam post imzosida ommaga ko‘rinadi.',
        addphone:'☎️ MANBA ADMIN RAQAMI\nManbaning reklama/admin raqamini aniq kiriting.\nMasalan: +998910021877\nFaqat shu raqam postlarda bizning reklama raqamimizga almashtiriladi. Sotuvchi va mijoz raqamlari o‘zgarmaydi.',
        adduser:'👤 MANBA ADMIN USERNAME\nManbaning reklama admini username’ini kiriting.\nMasalan: @Tabriklar_admin02\nFaqat shu manbada bizning admin username’imizga almashtiriladi.',
        remove:'➖ OLIB TASHLASH\nTasdiqlangan manba kontakti — telefon yoki @username kiriting. Shu manbaning tasdiqlangan ro‘yxatidan o‘chiriladi.'
      };
      return ctx.reply(help[action]+'\n\nBekor qilish: /cancel',menu());
    }
    if(action==='scan'){
      if(!sourceKey(cfg)||!sessionReady())
        return ctx.reply('❌ Manba kanal/guruh va MTProto sessiyasi talab etiladi.',menu());
      try{
        const candidates=await withUserSession(async client=>{
          const peer=await resolveSourcePeer(client,cfg);
          const recent=await client.getMessages(peer,{limit:80});
          return detectSourceAdminCandidates(recent);
        });
        if(!candidates.length)return ctx.reply('🔎 So‘nggi 80 xabardan ishonchli reklama admin kontakti topilmadi.'+
          '\n➕ Manba admin raqami yoki username orqali qo‘lda qo‘shishingiz mumkin.',menu());
        ctx.session.contactRoute=key;
        ctx.session.contactCandidates=candidates;
        return ctx.reply('🔎 MANBA ADMINLARIDAN TOPILGAN NOMZODLAR\n\n'+
          candidates.map((c,i)=>(i+1)+'. '+(c.kind==='phone'?'☎️ ':'👤 ')+c.value+
            ' ('+c.count+' marta)\n   '+String(c.example||'').slice(0,100)).join('\n\n').slice(0,3300)+
          '\n\n⚠️ Bu avtomatik TOPILGAN nomzodlar, hali tasdiqlanmagan. Faqat haqiqiy reklama/admin kontaktini tanlang. Sotuvchining raqamini tasdiqlamang.',
          Markup.inlineKeyboard(candidates.map((c,i)=>[
            Markup.button.callback('✅ '+(c.kind==='phone'?'☎️ ':'👤 ')+c.value,
              'clone:contacts:approve:'+i)
          ])));
      }catch(error){
        return ctx.reply('❌ Manba kontaktlarini aniqlab bo‘lmadi: '+describeRelayError(error,160),menu());
      }
    }
  });
  bot.action(/^clone:contacts:approve:(\d{1,2})$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    const key=routeKey(ctx);
    if(ctx.session.contactRoute!==key)
      return ctx.reply('⚠️ Yo‘nalish o‘zgargan. Kandidatlarni qayta aniqlang.',menu());
    const candidate=ctx.session.contactCandidates?.[Number(ctx.match[1])];
    if(!candidate)return ctx.reply('⚠️ Nomzod eskirgan, yana 🔎 Manbadan adminlarni aniqlash tugmasini bosing.',menu());
    const field=candidate.kind==='phone'?'source_admin_phones':'source_admin_usernames';
    const value=candidate.kind==='phone'?normalizePhone(candidate.value):normalizeUsername(candidate.value);
    if(!value)return ctx.reply('❌ Noto‘g‘ri kontakt.',menu());
    await Config.updateOne({bot_key:key},{$addToSet:{[field]:value}});
    return ctx.reply('✅ Tasdiqlandi: '+(candidate.kind==='phone'?'☎️ ':'👤 ')+value+
      '\nFaqat shu manbaning postlarida almashtiriladi.'+
      (candidate.kind==='phone'?'\n📱 Bizning admin telefonimiz ham belgilangan bo‘lishi kerak.':''),menu());
  });
  bot.hears('📋 Post imzosi',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const current=await load(ctx);
    const branded=(current?.clone_format||'branded')==='branded';
    return ctx.reply('📋 TANLANGAN YO‘NALISH POST IMZOSI\n\n'+
      (adFooter(current)||'Hozircha reklama havolalari yo‘q.')+
      '\n\n🧑‍💼 Tasdiqlangan manba admin telefonlari: '+(current?.source_admin_phones||[]).length+
      '\n👤 Tasdiqlangan manba admin username’lari: '+(current?.source_admin_usernames||[]).length+
      '\n\n🔗 Manba linki o‘rniga: '+(getTargetPostLink(current)||'Maqsad kanalni ulang')+
      '\n\n✏️ Faqat Branded formatda bu imzo post matni yoki captionga qo‘shiladi.'+
      (branded?'\n✅ Branded faol':'\n⚠️ Original format faol: post asl holicha saqlanadi, reklama imzosi qo‘shilmaydi.')+
      '\n\n🤖 Reklama botini ulash, 📩 Reklama admini va 📤 Bizning kanal orqali o‘zgartiring.',menu());
  });
  bot.hears('🔗 Bizning taklif havolamiz',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const cfg=await load(ctx);
    if(!cfg?.target_chat_id)return ctx.reply('❌ Avval 📤 Bizning kanal ni ulang.',menu());
    const link=await createOrReuseInvite({cfg,telegram:ctx.telegram,Config,force:true});
    const isInvite=/^https:\/\/t\.me\/(?:\+|joinchat\/)/.test(link);
    return ctx.reply((isInvite?'✅ Kanalga taklif havolasi tayyor.':'ℹ️ Taklif havolasi yaratish huquqi yetarli bo‘lmagani uchun ommaviy kanal havolasidan foydalaniladi.')+
      '\n🔗 '+(link||'Maqsad kanal havolasi topilmadi')+
      '\n\n'+(isInvite?'Bir kanal uchun bitta saqlangan havola barcha postlarga ishlatiladi.':
      'Maxsus taklif havolasi uchun botga Invite Users (foydalanuvchilarni taklif qilish) admin huquqini bering va tugmani qayta bosing.')+
      '\n\nManba linki mavjud Branded postlar aynan shu havolaga almashtiriladi.',menu());
  });
  bot.hears('📥 Manba kanal/guruh',async ctx=>{if(!permitted(ctx))return;ctx.session.step='source';return ctx.reply('📥 Manba: @kanal, @guruh yoki o‘zingiz aʼzo bo‘lgan xususiy guruh IDsi (-100...).\n👥 Aʼzo bo‘lgan guruhlar orqali ID ni toping.');});
  bot.hears('📤 Bizning kanal/guruh',async ctx=>{if(!permitted(ctx))return;ctx.session.step='target';return ctx.reply('📤 O‘zingiz admin bo‘lgan kanal/guruh @username yoki guruh ID sini (-100...) yuboring. Kloner botni ham admin qiling.');});
  async function withUserSession(fn){
    if(!sessionReady())throw new Error('MTProto akkaunti sozlanmagan.');
    const {TelegramClient}=require('teleproto');
    const {StringSession}=require('teleproto/sessions');
    const client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
      Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
    try{await client.connect();return await fn(client);}
    finally{await client.disconnect().catch(()=>{});}
  }
  bot.hears('👥 Aʼzo bo‘lgan guruhlar',async ctx=>{
    if(!permitted(ctx))return;
    try{
      const groups=await withUserSession(client=>listJoinedGroups(client,500,{fresh:true}));
      if(!groups.length)return ctx.reply('📭 MTProto akkauntingiz aʼzo bo‘lgan guruhlar topilmadi.',menu());
      const output=groups.slice(0,35).map((g,i)=>(i+1)+'. '+g.title.slice(0,45)+
        '\n   '+(g.username?'@'+g.username:g.id));
      return ctx.reply('👥 MTProto akkauntingiz aʼzo bo‘lgan guruhlar ('+groups.length+'):\n\n'+output.join('\n\n')+
        '\n\n📥 Manba kanal/guruh tugmasini bosing va @username yoki guruh ID sini yuboring.',menu());
    }catch(e){return ctx.reply('❌ Guruhlar ro‘yxati: '+describeRelayError(e,150),menu());}
  });
  bot.hears('➕ Shu manzilga manba',async ctx=>{
    if(!permitted(ctx))return;
    const selected=await load(ctx);
    if(!selected?.target_chat_id)return ctx.reply('❌ Avval 📤 Bizning kanal/guruh ni ulang.',menu());
    if(await Config.countDocuments(routesQuery())>=20)return ctx.reply('⚠️ 20 ta yo‘nalish limiti to‘lgan.',menu());
    ctx.session.step='add_source';ctx.session.addSourceToRoute=routeKey(ctx);
    return ctx.reply('➕ YANA BIR MANBA\n\n📤 Maqsad: '+(selected.target_username?'@'+selected.target_username:selected.target_title||selected.target_chat_id)+
      '\n\nYangi manba @kanal, @guruh yoki aʼzo bo‘lgan guruh ID sini yuboring.\nHar bir manba alohida tarix va interval bilan ishlaydi.',menu());
  });
  bot.hears('🧭 Manbalar ro‘yxati',async ctx=>{
    if(!permitted(ctx))return;
    const selected=await load(ctx);
    if(!selected?.target_chat_id)return ctx.reply('❌ Avval maqsad kanal yoki guruhni tanlang.',menu());
    const routes=await Config.find({...routesQuery(),target_chat_id:selected.target_chat_id})
      .sort({createdAt:1}).limit(20).lean();
    return ctx.reply('🧭 BITTA MANZILGA ULANGAN MANBALAR\n📤 '+(selected.target_username?'@'+selected.target_username:selected.target_title||selected.target_chat_id)+
      '\n\n'+routes.map((c,i)=>(i+1)+'. '+sourceRefLabel(c)+' '+(c.auto_enabled?'🟢':'⏸')+
      ' | ⏱ '+humanInterval(c.publish_interval_minutes)).join('\n')+
      '\n\n➕ Shu manzilga manba orqali yana qo‘shishingiz mumkin.',menu());
  });
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
    const selectedKey=routeKey(ctx);
    if(counting){await ctx.reply('🔄 Boshqa yo‘nalishning postlari hozir sanalmoqda.',menu());return null;}
    if(!sessionReady()){await ctx.reply('❌ Telegram sessiyasi sozlanmagan.',menu());return null;}
    counting=true;
    let client;
    try{
      await ctx.reply('🔎 Manba kanal/guruh xabarlari sanalmoqda. Natijada jami va media turlari ko‘rsatiladi.',menu());
      const {TelegramClient}=require('teleproto');
      const {StringSession}=require('teleproto/sessions');
      client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
        Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
      await client.connect();
      const result=await countSourcePosts(client,cfg);
      const current=await Config.findOne({bot_key:selectedKey}).lean();
      if(sourceKey(current)!==sourceKey(cfg)||current?.target_chat_id!==cfg.target_chat_id)
        throw new Error('Manba yoki maqsad kanal o‘zgardi. Qayta urinib ko‘ring.');
      await Config.updateOne({bot_key:selectedKey,source_username:cfg.source_username||'',source_chat_id:cfg.source_chat_id||'',target_chat_id:cfg.target_chat_id},
        {$set:{source_stats:result}});
      const sent=await Log.countDocuments({bot_key:selectedKey,status:'sent',target_chat_id:cfg.target_chat_id,
        source_key:{$regex:'^public:'+sourceKey(cfg)+':'}});
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
    if(!sourceKey(cfg))return ctx.reply('❌ Avval manba kanal yoki guruhni ulang.',menu());
    void recount(ctx,cfg).catch(e=>console.warn('[clone] background source count:',String(e.message||e).slice(0,120)));
  });
  const humanInterval=mins=>{
    const n=Number(mins)||0;
    if(!n)return '⚡ Intervalsiz';
    if(n%1440===0)return (n/1440)+' kun';
    if(n%60===0)return (n/60)+' soat';
    return n+' daqiqa';
  };
  async function updateRouteInterval(ctx,key,value){
    const n=Number(value);
    if(!Number.isSafeInteger(n)||n<0||n>1440)
      return ctx.reply('❌ Interval 0–1440 daqiqa bo‘lishi kerak.',menu());
    const configRow=await Config.findOne({bot_key:key,$or:[{owner_bot_key:cloneKey},{bot_key:cloneKey}]}).lean();
    if(!configRow)return ctx.reply('❌ Bu kanal yo‘nalishi topilmadi.',menu());
    const next=n>0?new Date(Date.now()+n*60000):null;
    await Config.updateOne({bot_key:key},{$set:{publish_interval_minutes:n,next_publish_at:next}});
    const label=configRow.route_title||(key===cloneKey?'Asosiy yo‘nalish':'Kanal yo‘nalishi');
    return ctx.reply('✅ '+label+' uchun interval: '+humanInterval(n)+
      '\n📥 '+(configRow.source_username?'@'+configRow.source_username:'manbasiz')+
      '\n📤 '+(configRow.target_username?'@'+configRow.target_username:'kanalsiz')+
      '\n\n'+(n?'Eski va yangi postlar bitta navbatda yuboriladi. Boshqa kanallar intervali o‘zgarmaydi.':'Postlar navbatda kutmaydi; imkon qadar tez yuboriladi.')+
      '\nTelegram so‘rov cheklovi sabab real yuborish vaqti biroz kechikishi mumkin.',menu());
  }
  bot.hears('⏱ Postlash intervali',async ctx=>{
    if(!permitted(ctx))return;
    ctx.session.step=null;
    const cfg=await load(ctx);
    if(!cfg)return ctx.reply('❌ Yo‘nalish topilmadi. 🗂 Yo‘nalishlar ni oching.',menu());
    const name=cfg.route_title||(routeKey(ctx)===cloneKey?'Asosiy yo‘nalish':'Kanal yo‘nalishi');
    return ctx.reply('⏱ '+name+' — POSTLASH INTERVALI'+
      '\n📥 '+(cfg.source_username?'@'+cfg.source_username:'ulanmagan')+
      '\n📤 '+(cfg.target_username?'@'+cfg.target_username:'ulanmagan')+
      '\n\nHozir: '+humanInterval(cfg.publish_interval_minutes)+
      '\n\nTanlangan vaqt faqat SHU yo‘nalishga tegishli. Eski va yangi postlarning hammasi bitta navbatda chiqariladi.',Markup.inlineKeyboard([
      [1,5,10,30].map(n=>Markup.button.callback(n+' daq','clone:interval:'+n)),
      [60,180,360,1440].map(n=>Markup.button.callback(humanInterval(n),'clone:interval:'+n)),
      [Markup.button.callback('✏️ O‘zim vaqt kiritaman','clone:interval:custom')],
      [Markup.button.callback('⚡ Intervalsiz','clone:interval:0')]
    ]));
  });
  bot.action('clone:interval:custom',async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    ctx.session.step='interval_custom';
    ctx.session.intervalRoute=routeKey(ctx);
    return ctx.reply('✏️ Faqat tanlangan kanal yo‘nalishi uchun intervalni daqiqada yozing.\nMisol: 2, 7, 15, 45, 90, 240 yoki 1440.\n0 — intervalsiz.\n\n❌ Bekor qilish: /cancel',menu());
  });
  bot.action(/^clone:interval:(0|1|5|10|30|60|180|360|1440)$/,async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    return updateRouteInterval(ctx,routeKey(ctx),Number(ctx.match[1]));
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
    if(!c?.target_chat_id||!sourceKey(c))return ctx.reply('Avval manba va maqsadni ulang.',menu());
    if(!sessionReady())return ctx.reply('Telegram sessiyasi mavjud emas.',menu());
    if(c.history_enabled&&!c.history_completed&&c.auto_enabled)return ctx.reply('🔄 Sinxronlash avvaldan ishlamoqda.',menu());
    if(counting)return ctx.reply('🔄 Postlar sanalayotgan paytda boshqa yo‘nalishni boshlash mumkin emas. Birozdan so‘ng qayta bosing.',menu());
    const selectedKey=routeKey(ctx);
    const chatId=ctx.chat.id;
    // A full channel history count may take minutes; never keep a Telegram
    // webhook open while counting. Launch only when the scan has succeeded.
    void (async()=>{
      const stats=await recount(ctx,c);
      if(!stats)return;
      const saved=await Config.updateOne({
        bot_key:selectedKey,source_username:c.source_username||'',source_chat_id:c.source_chat_id||'',target_chat_id:c.target_chat_id
      },{$set:{auto_enabled:true,history_enabled:true,history_completed:false,
        history_last_error:'',history_retry_at:null,history_error_count:0}});
      if(!saved.matchedCount)return ctx.telegram.sendMessage(chatId,'⚠️ Kanal sozlamasi o‘zgargan, sinxronlash boshlanmadi.');
      await ctx.telegram.sendMessage(chatId,
        '✅ '+(c.route_title||'Tanlangan yo‘nalish')+' ishga tushirildi!\n📥 '+sourceRefLabel(c)+
        '\n📤 '+(c.target_username?'@'+c.target_username:(c.target_title||c.target_chat_id))+'\n📚 '+stats.total+' ta tarixiy post tekshirildi. Dublikatlar yuborilmaydi.');
    })().catch(e=>{
      console.warn('[clone] start background:',String(e.message||e).slice(0,170));
      void ctx.telegram.sendMessage(chatId,'❌ Sinxronlash boshlanmadi: '+String(e.message||e).slice(0,150)).catch(()=>{});
    });
    return;
  });
  bot.hears('⏸ To‘xtatish',async ctx=>{if(!permitted(ctx))return;await Config.updateOne({bot_key:routeKey(ctx)},{$set:{auto_enabled:false,history_enabled:false}});return ctx.reply('⏸ Sinxronlash to‘xtatildi.',menu());});
  bot.hears('🔄 Eski postlarni qayta tekshirish',async ctx=>{
    if(!permitted(ctx))return;const c=await load(ctx);
    if(!sourceKey(c)||!c?.target_chat_id)return ctx.reply('Avval manba va maqsadni ulang.',menu());
    if(c.history_enabled&&!c.history_completed)return ctx.reply('🔄 Sinxronlash davom etmoqda.',menu());
    await Config.updateOne({bot_key:routeKey(ctx)},{$set:{auto_enabled:true,history_enabled:true,history_completed:false,history_cursor:0,history_ceiling:0,history_last_error:'',history_retry_at:null,history_error_count:0}});
    return ctx.reply('✅ Tarix qayta tekshiriladi. Ilgari yuborilgan postlar MongoDB jurnalidan aniqlanadi.',menu());
  });
  bot.hears('🧪 Ulanishni tekshirish',async ctx=>{
    if(!permitted(ctx))return;
    const c=await load(ctx);
    if(!sourceKey(c)||!c?.target_chat_id)return ctx.reply('❌ Manba va maqsadni ulang.',menu());
    let client;
    try {
      const me=await ctx.telegram.getMe();
      const member=await ctx.telegram.getChatMember(c.target_chat_id,me.id);
      if(member.status!=='creator'&&member.status!=='administrator')
        return ctx.reply('❌ Bot maqsad kanalga post joylay olmaydi. Botga Post Messages huquqini bering.',menu());
      if(!sessionReady())return ctx.reply('❌ Render user sessiyasi mavjud emas.',menu());
      const {TelegramClient}=require('teleproto');
      const {StringSession}=require('teleproto/sessions');
      client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
        Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
      await client.connect();
      const messages=await client.getMessages(await resolveSourcePeer(client,c),{limit:20});
      const sample=messages.find(x=>x && !x.action && (x.media||x.message));
      if(!sample)return ctx.reply('⚠️ Manbadan nusxalanadigan post topilmadi.',menu());
      if(sample.noforwards||sample.noForwards||sample.chat?.noforwards||sample.chat?.noForwards)
        return ctx.reply('🔒 Manba kanal nusxalashdan himoyalangan. Ushbu postni avtomatik uzatish mumkin emas. Kanal egasidan ruxsat yoki asl fayllarni so‘rang.',menu());
      try {
        const test=await ctx.telegram.copyMessage(ctx.from.id,c.source_username?'@'+c.source_username:c.source_chat_id,Number(sample.id),
          {caption:'🧪 Kanal klonlash sinovi (kanalingizga yuborilmadi)'});
        await ctx.reply('✅ Bot API manba postni nusxalashga ruxsat oldi. Maqsad botining admin huquqi ham bor. Sinov xabari: '+test.message_id,menu());
      } catch(e) {
        if(/CHAT_FORWARDS_RESTRICTED|protected content|message is protected/i.test(String(e.description||e.message||e)))
          return ctx.reply('🔒 Telegram nusxalashni rad etdi: manba egasi kontentni himoyalagan. Asl faylni yoki manba egasining ruxsatini oling.',menu());
        const reason=describeRelayError(e,135);
        await ctx.reply('ℹ️ MTProto akkauntingiz manba '+(c.source_type==='group'?'guruh':'kanal')+' xabarlarini o‘qiy oladi.'+
          '\nBot API to‘g‘ridan-to‘g‘ri nusxa olmadi: '+reason+
          '\n\nSinxronlash media fayllarini ruxsat doirasida bot orqali qayta yuborishni, matnlar uchun esa botning matn yuborish usulini sinaydi. Katta media va cheklangan postlar o‘tkazilmasligi mumkin.',menu());
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
    const retryAt=c?.history_retry_at?new Date(c.history_retry_at).getTime():0;
    const retryMinutes=retryAt>Date.now()?Math.ceil((retryAt-Date.now())/60000):0;
    return ctx.reply('📊 CHANNEL / GROUP CLONE\nYo‘nalish: '+(c?.route_title||'Asosiy')+'\nManba: '+(sourceRefLabel(c)||'yo‘q')+
      '\nMaqsad: '+(c?.target_username?'@'+c.target_username:(c?.target_title||'yo‘q'))+
      '\nKuzatuv: '+(c?.auto_enabled?'yoqilgan':'o‘chiq')+
      '\n⏱ Interval: '+humanInterval(c?.publish_interval_minutes)+
      (c?.next_publish_at&&Number(c.publish_interval_minutes)>0?'\n🕒 Navbatdagi vaqt (server): '+new Date(c.next_publish_at).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):'')+
      '\nYuborilgan: '+sent+
      '\n🔒 Himoyalangan postlar: '+Number(c?.protected_skipped||0)+
      (c?.protected_last_at?'\n🔒 Oxirgi himoyalangan ID: '+Number(c?.protected_last_post_id||0):'')+
      (c?.protected_warning?'\nℹ️ '+String(c.protected_warning).slice(0,190):'')+
      '\nTarixiy ID: '+Number(c?.history_cursor||0)+
      (c?.promo_bot_username?'\n🤖 Reklama boti: @'+c.promo_bot_username:'')+
       (c?.promo_admin_username?'\n📩 Reklama admini: @'+c.promo_admin_username:'')+
       (c?.promo_admin_phone?'\n☎️ Bizning reklama telefoni: '+c.promo_admin_phone:'')+
       '\n🪪 Manba adminlari: '+(c?.source_admin_phones||[]).length+' raqam / '+(c?.source_admin_usernames||[]).length+' username'+
       (c?.target_invite_link?'\n🔗 Kanal taklif havolasi tayyor':'')+
       '\n🎨 Post formati: '+(c?.clone_format||'branded')+
       (c?.source_stats?'\n📚 Jami: '+c.source_stats.total+' | 🖼 '+c.source_stats.photo+' | 🎬 '+c.source_stats.video+' | 🎵 '+c.source_stats.audio+' | 📁 '+c.source_stats.document+' | 📎 '+c.source_stats.links:'')+
      (c?.history_last_error?'\n⚠️ '+describeRelayError(c.history_last_error,190):'')+
      (retryMinutes?'\n⏳ Qayta urinish: taxminan '+retryMinutes+' daqiqadan keyin':'')+
      (c?.history_error_count?'\n🔄 Ketma-ket xatolar: '+Number(c.history_error_count):'')+
      (c?.history_enabled&&!c?.history_completed?'\n📚 Tarix sinxroni davom etmoqda':'')+
      (retryMinutes?'\n💡 Hozir sinash: 🔁 Xatoni qayta sinash':'') ,menu());
  });
  bot.hears('🔁 Xatoni qayta sinash',async ctx=>{
    if(!permitted(ctx))return;
    const key=routeKey(ctx);
    const current=await load(ctx);
    if(!sourceKey(current)||!current?.target_chat_id)
      return ctx.reply('❌ Bu yo‘nalish uchun manba va maqsad kanal belgilanmagan.',menu());
    if(!current.auto_enabled)
      return ctx.reply('⏸ Yo‘nalish to‘xtatilgan. Avval ▶️ Sinxronlash ni bosing.',menu());
    if(!current.history_retry_at&&!current.history_last_error)
      return ctx.reply('✅ Hozircha xatolik yo‘q, nazorat odatdagidek davom etmoqda.',menu());
    await Config.updateOne({bot_key:key,auto_enabled:true},{$set:{
      history_retry_at:null,history_error_count:0,history_last_error:''
    }});
    return ctx.reply('✅ '+(current.route_title||'Tanlangan yo‘nalish')+
      ' qayta urinish navbatiga qo‘yildi.\n📚 Tarixiy ID: '+Number(current.history_cursor||0)+
      '\n⚠️ Oldingi muvaffaqiyatli postlar qayta yuborilmaydi; xato bergan joydan davom etadi.'+
      '\n🔎 Natijani 📊 Holat orqali tekshiring.',menu());
  });
  let repairing=false;
  const repairLabels=['🧹 Eski postlar matnini tuzatish','🔁 Eski username/linklarni almashtirish'];
  const repairQuery=(key,target)=>({
    bot_key:key,target_chat_id:target,status:'sent',target_message_id:{$gt:0}
  });
  const brief=(text,max=440)=>String(text||'').trim().slice(0,max);
  async function previewOldPostRepair(ctx){
    if(!permitted(ctx))return;
    if(repairing)return ctx.reply('🔄 Boshqa tahrirlash davom etmoqda.',menu());
    const cfg=await load(ctx);
    if(!cfg?.target_chat_id||!sessionReady())
      return ctx.reply('❌ Oldingi xabarlarni tekshirish uchun maqsad kanal/guruh va Telegram sessiyasi kerak.',menu());
    if((cfg.clone_format||'branded')!=='branded')
      return ctx.reply('⚠️ Avval 🎨 Post formati orqali Branded rejimini tanlang.',menu());
    try{
      const key=routeKey(ctx);
      const total=await Log.countDocuments(repairQuery(key,cfg.target_chat_id));
      if(!total)return ctx.reply('📭 Ushbu yo‘nalish orqali yuborilgan va tahrirlashga mos postlar topilmadi.',menu());
      cfg.target_post_link=await createOrReuseInvite({cfg,telegram:ctx.telegram,Config});
      const recent=await Log.find(repairQuery(key,cfg.target_chat_id))
        .sort({_id:-1}).limit(12).lean();
      const target=cfg.target_username?'@'+cfg.target_username:cfg.target_chat_id;
      let sample=null;
      try{
        await withUserSession(async client=>{
          for(const log of recent){
            const found=await client.getMessages(target,{ids:Number(log.target_message_id)});
            const post=Array.isArray(found)?found[0]:found;
            if(!post)continue;
            const before=String(post.message||'');
            const after=refreshClonePostText(before,cfg,post.media?1024:4096);
            if(after&&after!==before.trim()){
              sample={before,after};
              break;
            }
          }
        });
      }catch(error){
        return ctx.reply('❌ Oldingi postlar namunasini o‘qib bo‘lmadi: '+
          describeRelayError(error,170)+'\nBotingiz yoki MTProto akkauntingiz guruh/kanal xabarlarini o‘qiy olishini tekshiring.',menu());
      }
      ctx.session.repairRouteKey=key;
      ctx.session.repairTarget=String(cfg.target_chat_id);
      let description='🔎 ESKI XABARLARDAGI USERNAME VA HAVOLALARNI ALMASHTIRISH\n\n'+
        '📤 '+(cfg.target_username?'@'+cfg.target_username:cfg.target_title||cfg.target_chat_id)+
        '\n📚 Tekshiriladigan Cloner xabarlari: '+total+
        '\n\n📢 Manba kanal/guruh → bizning kanal/guruh\n'+
        '📩 Manba reklama admini → @'+(cfg.promo_admin_username||'sozlanmagan')+
        '\n🤖 Manba bot → '+(cfg.promo_bot_username?'@'+cfg.promo_bot_username:'o‘z kanalimiz')+
        '\n\nCloner yuborgan xabarlar matni/captioni tahrirlanadi; media qayta yuklanmaydi.';
      if(sample)description+='\n\nOLDIN:\n'+brief(sample.before)+
        '\n\nKEYIN:\n'+brief(sample.after);
      else description+='\n\nℹ️ So‘nggi 12 ta postda o‘zgarish topilmadi; eski xabarlar tekshirilishi mumkin.';
      return ctx.reply(description.slice(0,3900),Markup.inlineKeyboard([
        [Markup.button.callback('✅ Almashtirishni boshlash','clone:repair:confirm')],
        [Markup.button.callback('❌ Bekor qilish','clone:repair:cancel')]
      ]));
    }catch(error){
      return ctx.reply('❌ Tekshiruv xatosi: '+describeRelayError(error,175),menu());
    }
  }
  bot.hears(repairLabels,previewOldPostRepair);
  bot.action('clone:repair:cancel',async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    ctx.session.repairRouteKey=null;ctx.session.repairTarget=null;
    return ctx.reply('✅ Ommaviy tahrirlash bekor qilindi. Hech bir post o‘zgartirilmadi.',menu());
  });
  bot.action('clone:repair:confirm',async ctx=>{
    if(!permitted(ctx))return ctx.answerCbQuery('Ruxsat yo‘q');
    await ctx.answerCbQuery();
    const key=ctx.session.repairRouteKey;
    const targetId=ctx.session.repairTarget;
    ctx.session.repairRouteKey=null;ctx.session.repairTarget=null;
    if(repairing)return ctx.reply('🔄 Tahrirlash davom etmoqda.',menu());
    if(!key||routeKey(ctx)!==key)
      return ctx.reply('⚠️ Tasdiqlash eskirgan. Avval menyudan qayta tekshiring.',menu());
    const cfg=await Config.findOne({bot_key:key}).lean();
    if(!cfg?.target_chat_id||String(cfg.target_chat_id)!==targetId)
      return ctx.reply('❌ Maqsad kanali o‘zgargan. Tahrirlashni qayta tekshiring.',menu());
    if((cfg.clone_format||'branded')!=='branded'||!sessionReady())
      return ctx.reply('⚠️ Branded rejimi va MTProto sessiyasi kerak.',menu());
    repairing=true;
    try{
      cfg.target_post_link=await createOrReuseInvite({cfg,telegram:ctx.telegram,Config});
      await ctx.reply('🔁 Tahrirlash boshlandi. Faqat '+(cfg.route_title||'tanlangan')+
        ' yo‘nalishining Cloner yuborgan eski postlari ko‘rib chiqiladi.',menu());
    }catch(error){
      repairing=false;
      return ctx.reply('❌ Tahrirlash boshlanmadi: '+describeRelayError(error,170),menu());
    }
    void (async()=>{
      let client,edited=0,failed=0,checked=0,unchanged=0;
      try{
        const {TelegramClient}=require('teleproto');
        const {StringSession}=require('teleproto/sessions');
        client=new TelegramClient(new StringSession(process.env.TELEGRAM_STRING_SESSION),
          Number(process.env.TELEGRAM_API_ID),process.env.TELEGRAM_API_HASH,{connectionRetries:3});
        await client.connect();
        const target=cfg.target_username?'@'+cfg.target_username:cfg.target_chat_id;
        let after=null;
        while(true){
          const query=repairQuery(key,cfg.target_chat_id);
          if(after)query._id={$gt:after};
          const items=await Log.find(query).sort({_id:1}).limit(50).lean();
          if(!items.length)break;
          for(const item of items){
            after=item._id;checked++;
            try{
              const found=await client.getMessages(target,{ids:Number(item.target_message_id)});
              const post=Array.isArray(found)?found[0]:found;
              if(!post){failed++;continue;}
              const before=String(post.message||'');
              const updated=refreshClonePostText(before,cfg,post.media?1024:4096);
              if(!updated||updated===before.trim()){unchanged++;continue;}
              try{
                if(post.media)
                  await ctx.telegram.editMessageCaption(cfg.target_chat_id,item.target_message_id,undefined,updated);
                else
                  await ctx.telegram.editMessageText(cfg.target_chat_id,item.target_message_id,undefined,updated);
              }catch(botError){
                // Channel admins cannot necessarily edit posts sent by other
                // accounts. MTProto fallback only works where Telegram permits.
                await client.editMessage(target,{message:Number(item.target_message_id),text:updated});
              }
              edited++;
            }catch(error){
              failed++;
              console.warn('[clone] prior post text edit failed',String(item.target_message_id),
                describeRelayError(error,130));
            }
            await new Promise(resolve=>setTimeout(resolve,400));
          }
          if(checked%500===0)
            await ctx.reply('🔄 Tekshirildi: '+checked+' | ✏️ '+edited+' | ⚠️ '+failed).catch(()=>{});
        }
        await ctx.reply('✅ ESKI XABARLARNI TEKSHIRISH YAKUNLANDI\n\n'+
          '📚 Tekshirildi: '+checked+'\n✏️ Almashtirildi: '+edited+
          '\n➖ O‘zgarishsiz: '+unchanged+'\n⚠️ Xato: '+failed,menu());
      }catch(error){
        await ctx.reply('❌ Tahrirlash xatosi: '+describeRelayError(error,175),menu()).catch(()=>{});
      }finally{
        if(client)await client.disconnect().catch(()=>{});
        repairing=false;
      }
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
    if(choice==='source'||choice==='all')Object.assign($set,{source_username:'',source_chat_id:'',source_title:'',source_type:'',source_cursor:0,source_admin_phones:[],source_admin_usernames:[]});
    if(choice==='target'||choice==='all')Object.assign($set,{target_chat_id:'',target_username:'',target_title:'',target_invite_link:'',target_invite_chat_id:'',target_invite_attempt_at:null});
    await Config.updateOne({bot_key:routeKey(ctx)},{$set},{upsert:true});
    ctx.session.step=null;
    return ctx.reply('✅ Ulanish uzildi. Avval yuborilgan postlar jurnali saqlandi; takroriy yuborilmaydi.',menu());
  });
  bot.on('text',async ctx=>{
    if(!permitted(ctx)||!ctx.session.step)return;
    const raw=String(ctx.message.text||'').trim();
    if(raw.startsWith('/') || /^(?:📥|📤|▶️|⏸|🔄|📊|🧪|🧹|🔌|❌|🏠|🎨|🔢|⏱|🏆|🤖|🔗|➕|🗂|📩|🗑|📋|👥|🧭|🪪)/u.test(raw))return;
    const step=ctx.session.step;ctx.session.step=null;
    if(step==='interval_custom'){
      const selected=ctx.session.intervalRoute||routeKey(ctx);
      ctx.session.intervalRoute=null;
      if(!/^\d{1,4}$/.test(raw)){
        ctx.session.step='interval_custom';
        ctx.session.intervalRoute=selected;
        return ctx.reply('❌ 0 dan 1440 gacha butun daqiqa kiriting. Masalan: 7 yoki 120.',menu());
      }
      return updateRouteInterval(ctx,selected,Number(raw));
    }
    if(step==='route_title'){
      const title=raw.slice(0,40).trim();
      if(title.length<2)return ctx.reply('❌ Kamida 2 belgi kiriting.',menu());
      const id=cloneKey+':r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
      await Config.create({bot_key:id,owner_bot_key:cloneKey,route_title:title,source_mode:'mtproto',auto_enabled:false});
      await rememberRoute(ctx,id);
      ctx.session.step='source';
      return ctx.reply('✅ '+title+' yo‘nalishi yaratildi!\n\n1/3 📥 Manba @kanal, @guruh yoki -100... guruh ID sini yuboring.',menu());
    }
    if(step.startsWith('contact_')){
      const key=ctx.session.contactRoute;
      if(!key||key!==routeKey(ctx)){
        ctx.session.contactRoute=null;
        return ctx.reply('⚠️ Yo‘nalish o‘zgargan. 🪪 Admin kontaktlari bo‘limini qayta oching.',menu());
      }
      const action=step.slice('contact_'.length);
      if(action==='ownphone'){
        const phone=raw==='-'?'':normalizePhone(raw);
        if(raw!=='-'&&!phone){
          ctx.session.step=step;
          return ctx.reply('❌ +998901234567 kabi haqiqiy raqam kiriting. O‘chirish: -',menu());
        }
        await Config.updateOne({bot_key:key},{$set:{promo_admin_phone:phone}});
        return ctx.reply(phone?'✅ Bizning reklama adminimiz telefoni: '+phone+
          '\nBu raqam ommaviy post imzosiga qo‘shiladi va tasdiqlangan manba raqamlari o‘rnida ishlatiladi.':
          '✅ Reklama admin telefoni o‘chirildi. Manba admin raqamlari endi avtomatik o‘zgartirilmaydi.',menu());
      }
      if(action==='addphone'){
        const phone=normalizePhone(raw);
        if(!phone){
          ctx.session.step=step;
          return ctx.reply('❌ Manbaning raqamini +998901234567 shaklida yuboring.',menu());
        }
        await Config.updateOne({bot_key:key},{$addToSet:{source_admin_phones:phone}});
        return ctx.reply('✅ Shu MANBANING reklama admin raqami tasdiqlandi: '+phone+
          '\n📱 Postlarda faqat aynan shu raqam bizning admin telefonimizga almashtiriladi.'+
          '\nSotuvchilar/mijozlarning boshqa raqamlari o‘zgarishsiz qoladi.',menu());
      }
      if(action==='adduser'){
        const username=normalizeUsername(raw);
        if(!username){
          ctx.session.step=step;
          return ctx.reply('❌ @admin_username shaklida yuboring.',menu());
        }
        await Config.updateOne({bot_key:key},{$addToSet:{source_admin_usernames:username}});
        return ctx.reply('✅ Shu manbaning reklama admin username’i tasdiqlandi: @'+username+
          '\nO‘rniga bizning 📩 Reklama admini username’imiz qo‘yiladi.',menu());
      }
      if(action==='remove'){
        const phone=normalizePhone(raw);
        const user=normalizeUsername(raw);
        if(!phone&&!user){
          ctx.session.step=step;
          return ctx.reply('❌ +998... raqam yoki @username kiriting.',menu());
        }
        await Config.updateOne({bot_key:key},{$pull:phone?
          {source_admin_phones:phone}:{source_admin_usernames:user}});
        return ctx.reply('✅ Shu manbaning tasdiqlangan ro‘yxatidan olib tashlandi: '+(phone||'@'+user),menu());
      }
      return;
    }
    const handle=telegramHandle(raw);
    if(step==='promo_admin'){
      if(!handle){ctx.session.step=step;return ctx.reply('❌ Reklama adminining @username yoki t.me/username havolasini yuboring.',menu());}
      await Config.updateOne({bot_key:routeKey(ctx)},{$set:{promo_admin_username:contactUsername(raw)}},{upsert:true});
      return ctx.reply('✅ Reklama admini: @'+handle+
        '\nAvval yuborilgan postlar uchun 🧹 Eski postlar matnini tuzatish ni bosing.',menu());
    }
    if(step==='promo_bot'){
      if(!handle){ctx.session.step=step;return ctx.reply('❌ Bot @username kiriting.',menu());}
      try{
        const botInfo=await ctx.telegram.getChat('@'+handle);
        if(botInfo.type!=='private'){ctx.session.step=step;return ctx.reply('❌ Bot username’ini yuboring (kanal yoki guruh emas).',menu());}
        await Config.updateOne({bot_key:routeKey(ctx)},{$set:{promo_bot_username:handle}},{upsert:true});
        return ctx.reply('✅ Postlar ostida ko‘rsatiladigan bot: @'+handle,menu());
      }catch(e){ctx.session.step=step;return ctx.reply('❌ Bot username tekshiruvi: '+describeRelayError(e,140),menu());}
    }
    if(step==='source'||step==='add_source'){
      if(!parsePeerReference(raw)){ctx.session.step=step;return ctx.reply('❌ @kanal, @guruh yoki xususiy guruhning -100... ID sini yuboring.',menu());}
      let source;
      try{source=await withUserSession(client=>validateSourceReference(client,raw));}
      catch(e){ctx.session.step=step;return ctx.reply('❌ Manbaga kirish tekshiruvi: '+describeRelayError(e,180)+
        '\nOchiq kanal/guruhni MTProto akkauntingiz o‘qiy olishi, xususiy guruhga esa aʼzo bo‘lishi kerak.',menu());}
      if(step==='add_source'){
        const originalKey=ctx.session.addSourceToRoute;ctx.session.addSourceToRoute=null;
        const target=await Config.findOne({bot_key:originalKey,$or:[
          {owner_bot_key:cloneKey},{bot_key:cloneKey}]}).lean();
        if(!target?.target_chat_id)return ctx.reply('❌ Tanlangan manzil topilmadi. Qayta tanlang.',menu());
        if(await Config.countDocuments(routesQuery())>=20)return ctx.reply('❌ 20 ta yo‘nalish limiti to‘lgan.',menu());
        const existing=await Config.findOne({...routesQuery(),target_chat_id:target.target_chat_id,
          ...(source.source_username?{source_username:source.source_username}:{source_chat_id:source.source_chat_id})
        }).lean();
        if(existing)return ctx.reply('⚠️ Shu manba bu manzilga allaqachon ulangan: '+(existing.route_title||existing.bot_key),menu());
        const id=cloneKey+':r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        await Config.create({
          bot_key:id,owner_bot_key:cloneKey,route_title:(source.source_title||'Manba').slice(0,40),
          ...source,source_mode:'mtproto',
          target_chat_id:target.target_chat_id,target_username:target.target_username||'',
          target_title:target.target_title||'',target_type:target.target_type||'channel',
          target_invite_link:target.target_invite_link||'',
          target_invite_chat_id:target.target_invite_chat_id||'',
          clone_format:target.clone_format||'branded',
          promo_bot_username:target.promo_bot_username||'',
          promo_admin_username:target.promo_admin_username||'',
          promo_admin_phone:target.promo_admin_phone||'',
          source_admin_phones:[],source_admin_usernames:[],
          publish_interval_minutes:Number(target.publish_interval_minutes)||0,
          auto_enabled:false,history_enabled:false,history_completed:false,source_cursor:0,history_cursor:0
        });
        await rememberRoute(ctx,id);
        return ctx.reply('✅ Yangi manba ulandi!\n📥 '+sourceRefLabel(source)+
          '\n📤 '+(target.target_username?'@'+target.target_username:target.target_title||target.target_chat_id)+
          '\n\nBu manba mustaqil yo‘nalish sifatida saqlandi. ▶️ Sinxronlash tugmasini bosing. Boshqa manbalar ishlashda davom etadi.',menu());
      }
      const current=await load(ctx);
      if(sourceKey(current)===sourceKey(source))
        return ctx.reply('✅ Bu manba allaqachon tanlangan: '+sourceRefLabel(source),menu());
      if(current?.target_chat_id){
        const existing=await Config.findOne({...routesQuery(),bot_key:{$ne:routeKey(ctx)},
          target_chat_id:current.target_chat_id,
          ...(source.source_username?{source_username:source.source_username}:{source_chat_id:source.source_chat_id})
        }).lean();
        if(existing)return ctx.reply('⚠️ Bu manba shu maqsadga boshqa yo‘nalishda ulangan: '+existing.route_title,menu());
      }
      await Config.updateOne({bot_key:routeKey(ctx)},{$set:{
        ...source,source_admin_phones:[],source_admin_usernames:[],source_mode:'mtproto',source_cursor:0,
        history_enabled:false,history_completed:false,history_cursor:0,history_ceiling:0,
        history_retry_at:null,history_error_count:0,auto_enabled:false
      }},{upsert:true});
      if(ctx.session.wizard){
        ctx.session.step='target';
        return ctx.reply('✅ Manba: '+sourceRefLabel(source)+
          '\n\n2/3 📤 Endi o‘zingiz admin bo‘lgan kanal/guruh @username yoki -100... ID sini yuboring. Bot ham admin bo‘lishi kerak.',menu());
      }
      return ctx.reply('✅ Manba: '+sourceRefLabel(source)+'. Endi ▶️ Sinxronlash ni bosing.',menu());
    }
    if(step==='target'){
      const parsed=parsePeerReference(raw);
      if(!parsed){ctx.session.step=step;return ctx.reply('❌ Maqsad @kanal, @guruh yoki guruhning -100... ID si bo‘lishi kerak.',menu());}
      try{
        const chat=await ctx.telegram.getChat(parsed.peer);
        if(!['channel','supergroup','group'].includes(chat.type)){
          ctx.session.step=step;return ctx.reply('❌ Maqsad kanal yoki guruh bo‘lishi kerak.',menu());
        }
        const me=await ctx.telegram.getMe();
        const [rights,ownerRights]=await Promise.all([
          ctx.telegram.getChatMember(chat.id,me.id),
          ctx.telegram.getChatMember(chat.id,ctx.from.id)
        ]);
        if(!['creator','administrator'].includes(ownerRights.status)){
          ctx.session.step=step;return ctx.reply('❌ Siz bu kanal/guruhda administrator bo‘lishingiz kerak.',menu());
        }
        if(!['creator','administrator'].includes(rights.status) ||
          (chat.type==='channel' && rights.status==='administrator' && !rights.can_post_messages)){
          ctx.session.step=step;return ctx.reply('❌ Cloner botni shu kanal/guruhga post yozish huquqi bilan administrator qiling.',menu());
        }
        const activeRoute=await load(ctx);
        if(sourceKey(activeRoute)){
          const duplicate=await Config.findOne({...routesQuery(),bot_key:{$ne:routeKey(ctx)},
            target_chat_id:String(chat.id),
            ...(activeRoute.source_username
              ?{source_username:activeRoute.source_username}
              :{source_chat_id:activeRoute.source_chat_id})
          }).lean();
          if(duplicate){
            ctx.session.step=step;
            return ctx.reply('⚠️ Bu manba va maqsad juftligi boshqa yo‘nalishda allaqachon mavjud: '+
              (duplicate.route_title||duplicate.bot_key),menu());
          }
        }
        const existingTarget=activeRoute;
        const changed=Boolean(existingTarget?.target_chat_id &&
          String(existingTarget.target_chat_id)!==String(chat.id));
        const newData={target_chat_id:String(chat.id),target_username:chat.username||parsed.username||'',
          target_title:chat.title||chat.username||'Guruh',target_type:chat.type};
        if(changed){
          forgetRouteInvite({bot_key:routeKey(ctx),target_chat_id:existingTarget.target_chat_id});
          Object.assign(newData,{
            target_invite_link:'',target_invite_chat_id:'',target_invite_attempt_at:null,
            source_cursor:0,history_cursor:0,history_ceiling:0,
            history_completed:false,history_enabled:false,auto_enabled:false,
            history_sent:0,history_skipped:0,history_last_error:'',
            history_retry_at:null,history_error_count:0,top_metrics_cache:null,next_publish_at:null
          });
        }
        await Config.updateOne({bot_key:routeKey(ctx)},{$set:newData},{upsert:true});
        const destination=newData.target_username?'@'+newData.target_username:newData.target_title;
        if(ctx.session.wizard){
          ctx.session.wizard=false;
          return ctx.reply('✅ Yo‘nalish tayyor!\n📥 '+sourceRefLabel(await load(ctx))+
            '\n📤 '+destination+
            '\n\n🤖 Reklama botini ulash, ⏱ Postlash intervali ni tanlash va ▶️ Sinxronlash mumkin.'+
            '\n➕ Shu manzilga manba orqali yana kanal/guruhlar biriktiring.',menu());
        }
        return ctx.reply('✅ Maqsad: '+destination+
          (changed?'\n🔄 Faqat shu yo‘nalish tarixiy navbati yangilandi.':'')+
          '\n▶️ Sinxronlash ni bosing.',menu());
      }catch(e){
        ctx.session.step=step;
        return ctx.reply('❌ Maqsad kanal/guruh tekshiruvi: '+describeRelayError(e,180)+
          '\nBotni guruhga/kanaIga admin qilib qo‘shing, keyin ID yoki @username kiriting.',menu());
      }
    }

  });
  return {key:cloneKey,title:config.title||'Channel Clone Bot',bot,config};
}
module.exports={createChannelCloneBot};
