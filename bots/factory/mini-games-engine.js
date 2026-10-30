'use strict';

// Fully free game engine. Credits have no cash value or withdrawal pathway.
function attachMiniGames({bot, config, adminIds, Player, Markup, utils, core}) {
  const {newNumberRound, makeMathRound, resolveGuess, utcDay, DAILY_ROUNDS} = core;
  const key = String(config.key);
  const isAdmin = id => (adminIds || []).includes(Number(id));
  const menu = () => Markup.keyboard([
    ['🎲 Sonni top', '🧠 Matematik test'],
    ['🪙 Virtual ball', '🏆 TOP-10'],
    ['🎁 Kunlik bonus', '❌ To‘xtatish']
  ]).resize();
  const welcome = '🎮 BEPUL MINI GAMES\n\n🎲 1–50 sonni 6 urinishda toping.\n' +
    '🧠 Matematik topshiriqlarni bajaring.\n🎁 Har kuni 3 ta bepul raund va virtual ball.\n\n' +
    '❗ Pul tikish, pul yutish va virtual ballni pulga almashtirish yo‘q.';

  async function player(ctx) {
    return Player.findOneAndUpdate(
      {bot_key:key,user_id:ctx.from.id},
      {$setOnInsert:{score:0,wins:0,games_completed:0,daily_rounds:0,active_round:null},
       $set:{username:ctx.from.username||'',first_name:ctx.from.first_name||''}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
  }

  bot.use(async(ctx,next)=>{
    if(!ctx.from || ctx.chat?.type!=='private') return next();
    if(['check_subscription','noop'].includes(ctx.callbackQuery?.data)) return next();
    if(isAdmin(ctx.from.id)) return next();
    try {
      if(!await utils.checkAllSubscriptions(ctx.from.id)) return utils.sendSubscriptionWarning(ctx);
    } catch(e) {return ctx.reply('⏳ Obuna tekshiruvi vaqtincha ishlamayapti.');}
    return next();
  });
  bot.action('check_subscription',ctx=>utils.handleSubscriptionCallback(ctx,menu,'✅ Obuna tasdiqlandi!'));
  bot.start(async ctx=>{
    await utils.saveUser(ctx,true);
    await player(ctx);
    return ctx.reply(welcome,menu());
  });
  bot.command('help',ctx=>ctx.reply(welcome,menu()));
  bot.command('games',ctx=>ctx.reply('🎮 O‘yin tanlang:',menu()));

  async function startRound(ctx,type) {
    try {
      await player(ctx);
      const today=utcDay();
      await Player.updateOne({bot_key:key,user_id:ctx.from.id,daily_day:{$ne:today}},
        {$set:{daily_day:today,daily_rounds:0,active_round:null}});
      const p=await Player.findOne({bot_key:key,user_id:ctx.from.id}).lean();
      if(p?.active_round) return ctx.reply('🎯 Oldingi raund tugamagan. Uni yakunlang yoki ❌ To‘xtatish ni bosing.',menu());
      if(Number(p.daily_rounds||0)>=DAILY_ROUNDS) return ctx.reply('📅 Bugungi 3 ta bepul raund tugadi. Ertaga qayting.',menu());
      const round=type==='math'?makeMathRound():newNumberRound();
      const saved=await Player.findOneAndUpdate(
        {bot_key:key,user_id:ctx.from.id,active_round:null,daily_rounds:{$lt:DAILY_ROUNDS}},
        {$inc:{daily_rounds:1},$set:{active_round:round}},{new:true});
      if(!saved) return ctx.reply('⚠️ Raundni qayta boshlang.');
      return ctx.reply(type==='math'?'🧠 '+round.question+' = ?\n3 ta urinish.':
        '🎲 1–50 oralig‘idagi yashirin sonni 6 urinishda toping. Raqam yozing.',menu());
    } catch(e) {
      console.error('Mini games start:',String(e.message||e).slice(0,160));
      return ctx.reply('⏳ Baza bilan ulanishda xatolik.');
    }
  }

  bot.hears('🎲 Sonni top',ctx=>startRound(ctx,'number'));
  bot.hears('🧠 Matematik test',ctx=>startRound(ctx,'math'));
  bot.command('number',ctx=>startRound(ctx,'number'));
  bot.command('math',ctx=>startRound(ctx,'math'));

  bot.hears('❌ To‘xtatish',async ctx=>{
    await Player.updateOne({bot_key:key,user_id:ctx.from.id},{$set:{active_round:null}});
    return ctx.reply('⏹ Raund to‘xtatildi. Kunlik urinish qaytarilmaydi.',menu());
  });
  bot.hears('🪙 Virtual ball',async ctx=>{
    const p=await player(ctx);
    return ctx.reply('🪙 Balans: '+p.score+' virtual ball\n🏆 Yutuqlar: '+p.wins+
      '\n🎯 Raundlar: '+p.games_completed+'\n📅 Bugungi urinishlar: '+
      (p.daily_day===utcDay()?p.daily_rounds:0)+'/'+DAILY_ROUNDS+
      '\n\n❗ Bu pulli hamyon emas. Ball yechilmaydi.',menu());
  });
  bot.hears('🎁 Kunlik bonus',async ctx=>{
    await player(ctx);
    const day=utcDay();
    const p=await Player.findOneAndUpdate({bot_key:key,user_id:ctx.from.id,last_bonus_day:{$ne:day}},
      {$inc:{score:20},$set:{last_bonus_day:day}},{new:true});
    return ctx.reply(p?'🎁 Bepul +20 virtual ball qo‘shildi.':'✅ Bugungi bonus olingan.',menu());
  });
  bot.hears('🏆 TOP-10',async ctx=>{
    const list=await Player.find({bot_key:key}).sort({score:-1,wins:-1,user_id:1}).limit(10).lean();
    return ctx.reply('🏆 TOP-10\n\n'+(list.length?list.map((p,i)=>
      (i+1)+'. '+String(p.first_name||p.username||'O‘yinchi').slice(0,32)+' — '+p.score+' ball').join('\n'):
      'Hali ishtirokchilar yo‘q.'),menu());
  });
  bot.command('admin',async ctx=>{
    if(!isAdmin(ctx.from?.id)) return ctx.reply('⛔ Ruxsat yo‘q.');
    const people=await Player.countDocuments({bot_key:key});
    const total=await Player.aggregate([{$match:{bot_key:key}},{$group:{_id:null,rounds:{$sum:'$games_completed'}}}]);
    return ctx.reply('👑 Mini Games admin\n\n👥 O‘yinchilar: '+people+
      '\n🎯 Tugagan raundlar: '+(total[0]?.rounds||0)+
      '\n\n💸 Real pul tikish, deposit va withdraw o‘chirilgan.',menu());
  });

  bot.on('text',async ctx=>{
    const text=String(ctx.message?.text||'').trim();
    if(!text||text.startsWith('/')) return;
    const p=await Player.findOne({bot_key:key,user_id:ctx.from.id}).lean();
    if(!p?.active_round) return ctx.reply('🎮 O‘yin tanlang.',menu());
    const result=resolveGuess(p.active_round,text);
    if(result.type==='invalid_input') return ctx.reply('⚠️ Butun son yuboring.');
    if(result.type==='out_of_range') return ctx.reply('⚠️ Son 1–50 oralig‘ida bo‘lsin.');
    if(result.type==='invalid_round') return ctx.reply('⚠️ Raund topilmadi.',menu());
    const match={bot_key:key,user_id:ctx.from.id,'active_round.type':p.active_round.type,
      'active_round.answer':p.active_round.answer,'active_round.tries':p.active_round.tries};
    const update=result.type==='retry'
      ?{$set:{'active_round.tries':result.tries}}
      :{$set:{active_round:null},$inc:{score:result.type==='won'?result.points:0,
        wins:result.type==='won'?1:0,games_completed:1}};
    const saved=await Player.findOneAndUpdate(match,update,{new:true});
    if(!saved) return ctx.reply('🔄 Oldingi javob qayta ishlangan. Keyingi urinishni yuboring.');
    if(result.type==='retry') return ctx.reply('❌ '+result.hint+'\nUrinish: '+
      result.tries+'/'+(p.active_round.type==='number'?6:3));
    if(result.type==='won') return ctx.reply('🎉 Topdingiz! '+result.tries+
      ' urinishda.\n🪙 +'+result.points+' virtual ball.\nJami: '+saved.score+' ball.',menu());
    return ctx.reply('🙃 Urinishlar tugadi. Javob: '+result.answer+'. Yangi raund tanlang.',menu());
  });
  bot.catch((err,ctx)=>console.error('Mini Games update '+ctx.update?.update_id+':',String(err.message||err).slice(0,160)));
  return bot;
}
module.exports={attachMiniGames};
