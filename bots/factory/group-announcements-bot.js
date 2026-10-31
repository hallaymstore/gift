'use strict';

const {parseInterval,parseSendLimit} = require('./group-announcements-core');

function attachGroupAnnouncer({bot,config,adminIds,Markup,Group,Campaign,Log,utils}) {
  const key = String(config.key);
  const admins = new Set((adminIds || []).map(Number));
  const isAdmin = id => admins.has(Number(id));
  const menu = () => Markup.keyboard([
    ['📝 E’lon tanlash','⏱ Interval'],
    ['🎯 Jami limit','📋 Ruxsatli guruhlar'],
    ['▶️ Boshlash','⏸ To‘xtatish'],
    ['👁 Ko‘rish','📊 Holat']
  ]).resize();
  const intro = '📢 GURUH E’LONLARI\n\n' +
    'Faqat guruh administratori ruxsat bergan guruhlarga e’lon yuboradi.\n' +
    'Guruhda: /allowannounce — ruxsat, /stopannounce — bekor qilish.\n\n' +
    'Admin: e’lon → interval (30m, 1h, 2h, 24h) → jami limit → ▶️ Boshlash.\n' +
    'Bitta guruhga 24 soatda ko‘pi bilan 1 marta e’lon boradi.\n' +
    'Shaxsiy Telegram akkauntingiz emas, ushbu bot nomidan yuboriladi.';

  async function assertGroupAdmin(ctx) {
    if (!['group','supergroup'].includes(ctx.chat?.type) || !ctx.from?.id) return false;
    const member = await ctx.telegram.getChatMember(ctx.chat.id,ctx.from.id);
    return ['creator','administrator'].includes(member?.status);
  }

  // Explicit group-admin approval must happen inside the destination group.
  bot.command('allowannounce',async ctx=>{
    if (!['group','supergroup'].includes(ctx.chat?.type)) return ctx.reply('Bu buyruq guruhda ishlaydi.');
    if (!await assertGroupAdmin(ctx)) return ctx.reply('⛔ Faqat guruh administratori ruxsat bera oladi.');
    try {
      const me = ctx.botInfo || await ctx.telegram.getMe();
      const botMember = await ctx.telegram.getChatMember(ctx.chat.id,me.id);
      if (botMember.status === 'left' || botMember.status === 'kicked' ||
          (botMember.status === 'restricted' && !botMember.can_send_messages)) {
        return ctx.reply('❌ Bot bu guruhga xabar yubora olmaydi.');
      }
      await Group.updateOne({bot_key:key,chat_id:String(ctx.chat.id)},
        {$set:{title:String(ctx.chat.title||'Guruh').slice(0,140),
          approved_by:Number(ctx.from.id),approved_at:new Date(),active:true}},
        {upsert:true});
      return ctx.reply('✅ Guruh e’lonlari uchun ruxsat berildi.\n' +
        'Faqat ushbu bot egasi rejalagan e’lonlar keladi; 24 soatda ko‘pi bilan 1 ta.\n' +
        'Bekor qilish: /stopannounce');
    } catch(error) {
      console.warn('Group opt-in failed',key,String(error.message||error).slice(0,150));
      return ctx.reply('❌ Guruhni ulab bo‘lmadi. Botning xabar yuborish huquqini tekshiring.');
    }
  });
  bot.command('stopannounce',async ctx=>{
    if (!['group','supergroup'].includes(ctx.chat?.type)) return;
    if(!await assertGroupAdmin(ctx)) return ctx.reply('⛔ Faqat guruh administratori bekor qila oladi.');
    await Group.updateOne({bot_key:key,chat_id:String(ctx.chat.id)},{$set:{active:false}});
    return ctx.reply('⛔ Ushbu guruhga avtomatik e’lon yuborish o‘chirildi.');
  });

  bot.start(ctx=>ctx.reply(isAdmin(ctx.from?.id)?intro:'ℹ️ Bu bot faqat ruxsatli guruhlarga e’lon joylaydi.',isAdmin(ctx.from?.id)?menu():undefined));
  bot.command('help',ctx=>ctx.reply(intro,isAdmin(ctx.from?.id)?menu():undefined));
  bot.command('admin',ctx=>isAdmin(ctx.from?.id)?ctx.reply(intro,menu()):ctx.reply('⛔ Admin uchun.'));
  bot.command('cancel',ctx=>{
    if(!isAdmin(ctx.from?.id))return;
    ctx.session.mode=null;
    return ctx.reply('✅ Amal bekor qilindi.',menu());
  });

  async function getCampaign() {
    return Campaign.findOneAndUpdate({bot_key:key},{$setOnInsert:{
      interval_minutes:60,max_sends:10,sent_count:0,running:false}},
      {upsert:true,new:true,setDefaultsOnInsert:true});
  }
  async function status(ctx) {
    const [campaign,groups] = await Promise.all([
      getCampaign(),Group.find({bot_key:key,active:true}).select('title chat_id last_sent_at').lean()
    ]);
    return ctx.reply('📊 E’LON BOTI\n\n' +
      '👥 Ruxsatli guruhlar: '+groups.length+'\n' +
      '📝 Xabar: '+(campaign.source_message_id?'tanlangan':'tanlanmagan')+'\n' +
      '⏱ Interval: '+campaign.interval_minutes+' daqiqa\n' +
      '🎯 Chegara: '+campaign.max_sends+' ta\n' +
      '✅ Yuborildi: '+campaign.sent_count+' ta\n' +
      '📡 Holat: '+(campaign.running?'🟢 Ishlayapti':'⏸ To‘xtatilgan')+
      (campaign.next_send_at?'\n🕒 Keyingi reja: '+new Date(campaign.next_send_at).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):'') +
      '\n\nRuxsatli guruhlar: '+(groups.map(g=>String(g.title||g.chat_id).slice(0,38)).join(', ')||'yo‘q'),menu());
  }
  async function privateAction(ctx,fn) {
    if(ctx.chat?.type!=='private')return;
    if(!isAdmin(ctx.from?.id))return ctx.reply('⛔ Admin uchun.');
    return fn(ctx);
  }

  bot.hears('📊 Holat',ctx=>privateAction(ctx,status));
  bot.command('status',ctx=>privateAction(ctx,status));
  bot.hears('📋 Ruxsatli guruhlar',ctx=>privateAction(ctx,async()=>{
    const gs=await Group.find({bot_key:key,active:true}).sort({approved_at:-1}).limit(30).lean();
    return ctx.reply(gs.length?'✅ Ruxsatli guruhlar:\n\n'+gs.map((g,i)=>(i+1)+'. '+g.title+' (ID '+g.chat_id+')').join('\n'):
      'Guruhlar yo‘q.\nGuruhda admin /allowannounce yuborishi kerak.',menu());
  }));
  bot.hears('📝 E’lon tanlash',ctx=>privateAction(ctx,()=>{
    ctx.session.mode='announcement_message';
    return ctx.reply('📝 E’lon matni, rasm, video yoki boshqa post yuboring.\n' +
      'Shu xabar keyinchalik ruxsatli guruhlarga bot nomidan nusxalanadi.\n/cancel — bekor qilish.',menu());
  }));
  bot.hears('⏱ Interval',ctx=>privateAction(ctx,()=>{
    ctx.session.mode='announcement_interval';
    return ctx.reply('⏱ Oraliq yuboring: 30m, 1h, 2h, 12h yoki 24h.\n' +
      'Kamida 30 daqiqa, har guruhga ko‘pi bilan bir marta / 24 soat.',menu());
  }));
  bot.hears('🎯 Jami limit',ctx=>privateAction(ctx,()=>{
    ctx.session.mode='announcement_limit';
    return ctx.reply('🎯 Jami nechta guruhga xabar yuborilsin? 1–100 sonini kiriting.\n' +
      'Limit tugagach kampaniya avtomatik to‘xtaydi.',menu());
  }));
  bot.hears('▶️ Boshlash',ctx=>privateAction(ctx,async()=>{
    const [campaign,count]=await Promise.all([getCampaign(),Group.countDocuments({bot_key:key,active:true})]);
    if (!campaign.source_message_id) return ctx.reply('❌ Avval “📝 E’lon tanlash” orqali post yuboring.',menu());
    if (!count) return ctx.reply('❌ Ruxsat bergan guruh yo‘q. Guruh admini /allowannounce yuborsin.',menu());
    if (campaign.running) return ctx.reply('🟢 Kampaniya allaqachon ishlayapti.',menu());
    await Campaign.updateOne({bot_key:key},{$set:{
      running:true,sent_count:0,next_send_at:new Date(Date.now()+1000),
      lock_until:new Date(0),last_error:''
    },$inc:{revision:1}});
    return ctx.reply('✅ E’lon navbati ishga tushdi. Faqat ruxsatli guruhlarga yuboriladi.\n' +
      '⏸ To‘xtatish tugmasi istalgan payt ishlaydi.',menu());
  }));
  bot.hears('⏸ To‘xtatish',ctx=>privateAction(ctx,async()=>{
    await Campaign.updateOne({bot_key:key},{$set:{running:false,next_send_at:null}});
    return ctx.reply('⏸ Kampaniya to‘xtatildi.',menu());
  }));
  bot.hears('👁 Ko‘rish',ctx=>privateAction(ctx,async()=>{
    const c=await getCampaign();
    if(!c.source_message_id)return ctx.reply('📝 Avval xabar tanlang.',menu());
    try{return await ctx.telegram.copyMessage(ctx.chat.id,c.source_chat_id,c.source_message_id);}
    catch(e){return ctx.reply('⚠️ Saqlangan xabarni ko‘rsatib bo‘lmadi, yangi e’lon yuboring.',menu());}
  }));

  // One handler for text and supported media in the bot owner's private chat.
  async function receiveInput(ctx) {
    if(ctx.chat?.type!=='private'||!isAdmin(ctx.from?.id))return;
    const mode=ctx.session?.mode;
    if(!['announcement_message','announcement_interval','announcement_limit'].includes(mode))return;
    const txt=String(ctx.message?.text||'').trim();
    if (txt.startsWith('/')) return;
    if(mode==='announcement_interval') {
      const minutes=parseInterval(txt);
      if(minutes===null)return ctx.reply('❌ Noto‘g‘ri interval. Misol: 30m, 1h, 24h. Eng kam 30 daqiqa.',menu());
      await Campaign.updateOne({bot_key:key},{$set:{interval_minutes:minutes,running:false}}, {upsert:true});
      ctx.session.mode=null;
      return ctx.reply('✅ Interval: '+minutes+' daqiqa. O‘zgargach kampaniya pauzaga o‘tdi.',menu());
    }
    if(mode==='announcement_limit') {
      const n=parseSendLimit(txt);
      if(n===null)return ctx.reply('❌ 1–100 oralig‘idagi sonni kiriting.',menu());
      await Campaign.updateOne({bot_key:key},{$set:{max_sends:n,running:false}}, {upsert:true});
      ctx.session.mode=null;
      return ctx.reply('✅ Jami '+n+' ta xabar limiti saqlandi.',menu());
    }
    const msg=ctx.message;
    const copyable=Boolean(msg?.text||msg?.photo||msg?.video||msg?.document||msg?.animation||msg?.audio);
    if(!copyable)return ctx.reply('❌ Matn, rasm, video, audio yoki hujjat yuboring.',menu());
    if(msg.has_protected_content)return ctx.reply('❌ Himoyalangan post nusxalanmaydi.',menu());
    await Campaign.updateOne({bot_key:key},{$set:{
      source_chat_id:ctx.chat.id,source_message_id:msg.message_id,
      running:false,next_send_at:null,sent_count:0
    }},{upsert:true});
    ctx.session.mode=null;
    return ctx.reply('✅ E’lon saqlandi. “👁 Ko‘rish” bilan tekshiring, keyin ▶️ Boshlash.',menu());
  }
  bot.on('message',receiveInput);
  bot.catch((err,ctx)=>console.error('[Group announcement bot]',key,ctx.update?.update_id,String(err.message||err).slice(0,150)));
  return bot;
}
module.exports={attachGroupAnnouncer};
