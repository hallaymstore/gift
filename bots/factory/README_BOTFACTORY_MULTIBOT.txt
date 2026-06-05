BOTFACTORY MULTIBOT PLATFORM
============================

Bu loyiha bitta Render servisida quyidagilarni ishlatadi:

1) BotFactory — bot tayyorlovchi asosiy bot
2) Doimiy botlar — KinoBot, MultfilmBot, SerialBot, DoramaBot
3) Mijoz yaratgan botlar — Factory orqali token kiritiladi, admin ruxsat bergach avtomatik ishga tushadi

ASOSIY G'OYA
============

Mijoz BotFather orqali o'z bot tokenini oladi va BotFactory botga yuboradi.
BotFactory tokenni tekshiradi, bot turini tanlatadi, nom va admin ID so'raydi.
So'rov adminlarga keladi. Admin @Qoryogdiyev bilan narx/shart kelishilgandan keyin "Ruxsat berish" tugmasini bosadi.
Shundan keyin mijoz boti avtomatik ishga tushadi.

Mijoz bot ichida admin panel orqali kontent qo'shadi:
- qismli bo'lsa: foydalanuvchiga 3 tadan inline qismlar chiqadi
- qismsiz bo'lsa: foydalanuvchi kod/nom yuborsa post darrov yuboriladi

QO'LLAB-QUVVATLANADIGAN BOT TURLARI
====================================

Factory orqali tanlash mumkin:
- KinoBot
- MultfilmBot
- SerialBot
- DoramaBot
- AnimeBot
- TurkSerialBot
- KursBot
- KitobBot
- FaylBot
- MusicBot

Bularning hammasi bitta universal struktura bilan ishlaydi.

MUHIM XAVFSIZLIK
================

1) Mijoz tokenlari MongoDB ichida ochiq yozilmaydi.
   BOT_TOKEN_SECRET orqali AES-256-GCM bilan shifrlanadi.

2) BOT_TOKEN_SECRET ni keyin almashtirmang.
   Almashtirsangiz, oldin saqlangan mijoz tokenlarini decrypt qilib bo'lmaydi.

3) Chatda ko'rinib qolgan eski bot tokenlarni ishlatmang.
   BotFather orqali yangi token oling.

4) Majburiy obuna ishlashi uchun har bir kontent bot qo'shilgan kanal/guruhda admin bo'lishi kerak.

.env SOZLASH
============

.env faylda asosiylari:

MONGODB_URL=mongodb+srv://...
ADMIN_IDS=6606638731,901126203
FACTORYBOT_TOKEN=BotFactory tokeni
OWNER_USERNAME=@Qoryogdiyev
BOT_TOKEN_SECRET=uzun_random_secret
WEBHOOK_SECRET=uzun_random_webhook_secret

Doimiy botlar uchun ixtiyoriy tokenlar:

KINOBOT_TOKEN=
MULTFILMBOT_TOKEN=
SERIALBOT_TOKEN=
DORAMABOT_TOKEN=

Agar doimiy token bo'sh bo'lsa, o'sha bot ishga tushmaydi.
FactoryBot token bo'lsa, mijozlar bot yaratish so'rovini yubora oladi.

RENDERDA ISHLATISH
==================

Build command:

npm install

Start command:

npm start

Render Environment Variables ichiga .env dagi qiymatlarni kiriting.
Render odatda RENDER_EXTERNAL_URL ni o'zi beradi.

LOCAL ISHLATISH
===============

.env ichida URL bo'sh bo'lsa, botlar polling rejimida ishlaydi:

npm install
npm start

BOTFACTORY MIJOZ UCHUN ISHLASH TARTIBI
======================================

1) Mijoz BotFactory botga /start bosadi
2) "Bot tayyorlash" ni bosadi
3) BotFather tokenini yuboradi
4) Bot turi tanlanadi: Kino/Multfilm/Serial/Dorama/Anime...
5) Bot nomi kiritiladi
6) Admin ID kiritiladi
7) So'rov adminlarga boradi
8) Admin narx/shartni kelishib, "Ruxsat berish" tugmasini bosadi
9) Bot avtomatik ishga tushadi
10) Mijoz o'z botiga /start bosib admin paneldan boshqaradi

KONTENT BOT ADMIN PANELI
========================

Har bir mijoz botida:

- Kontent qo'shish
- Qism qo'shish
- Kontent ro'yxati
- Statistika
- Kontent o'chirish
- Qism o'chirish
- Broadcast
- Majburiy kanal/guruh qo'shish
- Obuna ro'yxati/o'chirish

KONTENT QO'SHISH
================

Admin "Kontent qo'shish" tugmasini bosadi.
Bot so'raydi:

Bu qismli bo'ladimi?

1) Ha, qismli
   - nom/kod/tavsif kiritiladi
   - keyin qismlar alohida qo'shiladi

2) Yo'q, bitta to'liq post
   - post/video/document forward qilinadi
   - nom/kod/tavsif kiritiladi
   - foydalanuvchi kod yuborsa post darrov ketadi

QISM QO'SHISH
=============

Format:

kod | qism_raqami | ixtiyoriy qism nomi

Misol:

poytaxt | 1 | 1-qism

Keyin video/document/post forward qilinadi.
Caption, premium emoji va formatlar copyMessage orqali saqlanishga harakat qiladi.

BOSHQARUV VA BAZA
=================

MongoDB collectionlar:

- multibot_users
- multibot_subscriptions
- multibot_contents
- multibot_content_parts
- multibot_managed_bots

Har bir bot ma'lumotlari bot_key orqali ajraladi.
Mijoz botlarining bot_key qiymati m_<MongoId> ko'rinishida bo'ladi.

YANGI BOT TURINI QO'SHISH
=========================

bots.config.js ichida typePresets ga yangi preset qo'shing.
Masalan:

mytype: {
  key: 'mytype',
  title: 'MyBot',
  item: 'kontent',
  itemTitle: 'Kontent',
  itemPlural: 'kontentlar',
  itemPluralTitle: 'Kontentlar',
  mainEmoji: '🤖',
  addEmoji: '➕',
  listEmoji: '📚',
  codeExamples: 'test1, kod7',
  welcomeLine: 'Kontent nomi yoki kodini yuboring.'
}

Factory typeRows funksiyasiga kerak bo'lsa type nomini qo'shing.

STATUS ENDPOINT
===============

Render URL ochilganda:

/
/status

/status orqali aktiv botlar, kontentlar va pending requestlarni ko'rish mumkin.

