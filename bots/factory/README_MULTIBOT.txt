MULTIBOT RENDER PLATFORM v2.0.0
================================

Bu loyiha bitta Render servisida bir nechta Telegram kontent botini ishlatish uchun tayyorlangan.

Ichida tayyor botlar:
1) KinoBot
2) MultfilmBot
3) SerialBot
4) DoramaBot

Eng muhim yangilik:
-------------------
Barcha botlarda endi bitta umumiy qoida bor:

1. Agar kontent QISMSIZ bo'lsa:
   - foydalanuvchi nom/kod yuboradi
   - bot post/video/documentni darrov yuboradi

2. Agar kontent QISMLI bo'lsa:
   - foydalanuvchi nom/kod yuboradi
   - bot qismlarni 3 tadan inline tugma qilib chiqaradi
   - Keyingi/Oldingi tugmalari bilan 50, 100, 1000 ta qism ham bemalol yuradi
   - bot hamma qismlarni RAM/xotiraga yig'maydi, har sahifada MongoDB'dan faqat kerakli 3 ta qism olinadi

Bitta server.js, bitta PORT, bitta MongoDB ishlaydi.
Har bot alohida token bilan ishlaydi va bazadagi ma'lumotlar bot_key orqali ajratiladi.

ISHGA TUSHIRISH
---------------
1. .env faylini to'ldiring:

MONGODB_URL=mongodb+srv://...
ADMIN_IDS=6606638731,901126203
KINOBOT_TOKEN=...
MULTFILMBOT_TOKEN=...
SERIALBOT_TOKEN=...
DORAMABOT_TOKEN=...
WEBHOOK_SECRET=uzun_random_secret

2. Paketlarni o'rnating:

npm install

3. Local ishga tushirish:

npm start

Render sozlamalari:

Build command: npm install
Start command: npm start

Render odatda RENDER_EXTERNAL_URL ni avtomatik beradi.
Agar bermasa, .env ichidagi URL ga Render linkini yozing.
Masalan:
URL=https://sizning-service.onrender.com

MUHIM XAVFSIZLIK
----------------
Oldin chatda yoki kod ichida ko'rinib qolgan tokenlarni ishlatmang.
BotFather orqali yangi token oling.
MongoDB parol ham ko'rinib qolgan bo'lsa, almashtiring.

ADMIN PANEL OQIMI
-----------------
/start bosganda admin panel chiqadi.

Asosiy tugmalar:
- Kontent qo'shish
- Qism qo'shish
- Kontentlar ro'yxati
- Statistika
- Kontent o'chirish
- Qism o'chirish
- Broadcast
- Kanal/guruh qo'shish
- Obuna ro'yxati
- Obuna o'chirish

QISMSIZ KINO/MULTFILM/DORAMA/SERIAL QO'SHISH
--------------------------------------------
1. Admin panelda:
   Kino qo'shish / Multfilm qo'shish / Serial qo'shish / Dorama qo'shish

2. Bot so'raydi:
   Bu kontent qismli bo'ladimi?

3. Tanlang:
   Yo'q, bitta to'liq post

4. Post/video/documentni yuboring yoki kanaldan forward qiling.

5. Bot nom va kod so'raydi:

Format:
Nomi | kodi | ixtiyoriy tavsif

Misol:
Avatar | avatar | Full HD

6. Foydalanuvchi avatar deb yozsa, post/video darrov yuboriladi.

QISMLI KINO/MULTFILM/DORAMA/SERIAL QO'SHISH
--------------------------------------------
1. Admin panelda kontent qo'shishni bosing.

2. Tanlang:
   Ha, qismli

3. Bot nom va kod so'raydi:

Format:
Nomi | kodi | ixtiyoriy tavsif

Misol:
Poytaxt | poytaxt | Uzbek serial
Queen of Tears | queen_of_tears | Koreys doramasi

4. Keyin Admin panelda:
   Qism qo'shish

5. Qism formatini yuboring:

kod | qism_raqami | ixtiyoriy qism nomi

Misol:
poytaxt | 1 | 1-qism
queen_of_tears | 2 | 2-qism

6. Keyin shu qism videosi/document/postini yuboring yoki forward qiling.

7. Foydalanuvchi poytaxt deb yozsa:
   1-qism
   2-qism
   3-qism
   Keyingi

ko'rinishida inline tugmalar chiqadi.

PREMIUM EMOJI VA CAPTION
------------------------
Bot postni copyMessage orqali yuboradi.
Shuning uchun forward qilingan postdagi caption, premium emoji va formatlar maksimal saqlanadi.
Fallback sifatida file_id ham saqlanadi.

BARCHA BOTLARGA YANGI BOT QO'SHISH
----------------------------------
1. .env ichiga token nomini qo'shing:

ANIMEBOT_TOKEN=...

2. bots.config.js ichiga yangi config qo'shing:

{
  key: 'anime',
  title: 'AnimeBot',
  tokenEnv: 'ANIMEBOT_TOKEN',
  item: 'anime',
  itemTitle: 'Anime',
  itemPlural: 'animelar',
  itemPluralTitle: 'Animelar',
  mainEmoji: '🌸',
  addEmoji: '➕',
  listEmoji: '📚',
  codeExamples: 'naruto, one_piece, anime7',
  welcomeLine: 'Anime nomi yoki kodini yuboring.'
}

3. Serverni qayta deploy qiling.

MONGODB KOLLEKSIYALARI
----------------------
multibot_users           - foydalanuvchilar
multibot_subscriptions   - majburiy obuna kanallari/guruhlari
multibot_contents        - kino/multfilm/serial/dorama asosiy kontentlari
multibot_content_parts   - qismli kontent qismlari

/status
-------
Render linkiga /status qo'shib tekshirishingiz mumkin:

https://sizning-service.onrender.com/status

Bu aktiv botlar, foydalanuvchilar, kontentlar, qismlar va obunalar sonini JSON qilib ko'rsatadi.
