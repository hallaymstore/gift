'use strict';

// Run locally: TELEGRAM_API_ID=... TELEGRAM_API_HASH=... npm run telegram:login
// Never send the produced StringSession to a bot, chat, or GitHub repository.
// Paste it only into TELEGRAM_STRING_SESSION in your own Render Environment.
const {TelegramClient} = require('teleproto');
const {StringSession} = require('teleproto/sessions');
const {createInterface} = require('node:readline/promises');

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = String(process.env.TELEGRAM_API_HASH || '').trim();
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
    throw Error('Avval TELEGRAM_API_ID va TELEGRAM_API_HASH sozlang (https://my.telegram.org/apps).');
  }
  const rl = createInterface({input:process.stdin,output:process.stdout});
  const client = new TelegramClient(new StringSession(''),apiId,apiHash,{connectionRetries:3});
  try {
    await client.start({
      phoneNumber:()=>rl.question('Telefon (+998...): '),
      phoneCode:()=>rl.question('Telegram tasdiqlash kodi: '),
      password:()=>rl.question('2FA parol (agar so‘ralsa): '),
      emailAddress:()=>rl.question('Telegram login email (agar so‘ralsa): '),
      emailVerification:async()=>({type:'code',code:await rl.question('Email kodi: ')}),
      onError:error=>console.error('Telegram login xatosi:',String(error.message||error).slice(0,130))
    });
    const user = await client.getMe();
    console.log('✅ Ulandi:',user.username ? '@'+user.username : String(user.id));
    console.log('\nTELEGRAM_STRING_SESSION (MAXFIY):\n'+client.session.save());
    console.log('\n🔒 Bu qiymatni faqat o‘zingizning Render environmentingizga saqlang. Hech kimga yubormang.');
  } finally {
    await client.disconnect().catch(()=>{});
    rl.close();
  }
}
main().catch(error=>{console.error(String(error.message||error));process.exitCode=1;});
