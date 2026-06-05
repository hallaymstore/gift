BOTFACTORY MULTIBOT PLATFORM — OYLIK TARIFLI SAAS
=================================================

Bu loyiha bitta Render servisida quyidagilarni ishlatadi:

1) FactoryBot — bot tayyorlovchi asosiy bot
2) KinoBot / MultfilmBot / SerialBot / DoramaBot / AnimeBot / KursBot / KitobBot va boshqalar
3) Mijoz yaratgan botlar — har biri alohida token bilan, lekin bitta server va bitta MongoDB ichida

ASOSIY YANGILIKLAR
==================

✅ Yaratish bepul, ishlashi oylik tarif/ruxsat bilan
✅ Admin har bir botni 1 oyga tasdiqlaydi
✅ Har oyning bot tasdiqlangan sanasida muddat tugaydi
✅ Muddat tugasa bot funksiyalari to'xtaydi
✅ Admin "1 oyga uzaytirish" bossa bot yana kelgan joyidan ishlaydi
✅ Server qayta deploy/restart bo'lsa ham ma'lumotlar yo'qolmaydi
✅ Kinolar, qismlar, userlar, statistikalar MongoDB'da saqlanadi
✅ Barcha yaratilgan botlarga umumiy e'lon yuborish bor
✅ Har bir botning alohida statistikasi bor
✅ Umumiy statistika bor
✅ FactoryBot'ning o'z statistikasi bor
✅ Bot username, owner username, owner ID yoki bot nomi orqali qidirish bor
✅ Bot tarif narxlarini admin paneldan o'zgartirish mumkin

ENV SOZLASH
===========

.env faylda eng muhim sozlamalar:

MONGODB_URL=...
ADMIN_IDS=6606638731,901126203
FACTORYBOT_TOKEN=...
OWNER_USERNAME=@Qoryogdiyev
BOT_TOKEN_SECRET=uzun_random_secret
WEBHOOK_SECRET=uzun_random_webhook_secret

Oylik tariflar:

DEFAULT_MONTHLY_PRICE=50000
KINO_MONTHLY_PRICE=50000
MULTFILM_MONTHLY_PRICE=50000
SERIAL_MONTHLY_PRICE=70000
DORAMA_MONTHLY_PRICE=70000
KURS_MONTHLY_PRICE=100000

ESLATMA: BOT_TOKEN_SECRET ni keyin almashtirmang. Aks holda DB'da shifrlangan mijoz tokenlarini qayta o'qib bo'lmaydi.

ISHGA TUSHIRISH
===============

npm install
npm start

Render:

Build command: npm install
Start command: npm start

FactoryBot menyusi:

- 🤖 Bot tayyorlash
- 📋 Mening botlarim
- 💰 Narxlar
- ☎️ Admin bilan kelishish

Asosiy admin menyusi:

- ✏️ Narx o'zgartirish
- 💰 Tarif narxlari
- 📣 Umumiy e'lon
- 🔍 Bot qidirish
- 📋 Barcha botlar
- 📊 Umumiy statistika
- 🏭 Factory statistikasi
- 🛂 Kutilayotgan so'rovlar
- ⏳ To'lovi tugaganlar

MIJOZ BOT YARATISH TARTIBI
==========================

1. Mijoz BotFather'dan yangi bot ochadi va token oladi.
2. FactoryBot ichida "🤖 Bot tayyorlash" bosadi.
3. Tokenni yuboradi.
4. Bot turini tanlaydi: KinoBot, MultfilmBot, SerialBot, DoramaBot...
5. Bot nomini kiritadi.
6. Admin ID kiritadi.
7. So'rov asosiy adminlarga keladi.
8. Admin mijoz bilan narx/to'lovni kelishadi.
9. Admin "✅ Ruxsat berish / 1 oy aktiv qilish" tugmasini bosadi.
10. Bot ishga tushadi.

OYLIK TO'LOV LOGIKASI
=====================

- Birinchi tasdiqlash vaqti: billing_started_at
- Keyingi to'lov sanasi: current_period_end
- Bot 1 oyga aktiv bo'ladi.
- current_period_end kelganda bot holati expired bo'ladi.
- Bot ichidagi kontent/userlar o'chmaydi.
- Admin "✅ 1 oyga uzaytirish" bossa current_period_end yana 1 oyga cho'ziladi.
- Bot yana ishlashda davom etadi.

BOT ICHIDAGI KONTENT STRUKTURASI
================================

Hamma botlar bir xil universal strukturada:

1) Qismsiz kontent
   - Kod/nom yuborilsa post darrov yuboriladi.

2) Qismli kontent
   - Kod/nom yuborilsa 3 tadan inline tugma chiqadi.
   - Oldingi/Keyingi tugmalari bor.
   - 50, 100, 1000 ta qism bo'lsa ham bot RAM'ga hammasini yuklamaydi.
   - MongoDB'dan faqat kerakli 3 ta qism olinadi.

UMUMIY E'LON
============

Asosiy admin "📣 Umumiy e'lon" bosadi va matn/rasm/video/fayl/forward yuboradi.
E'lon barcha aktiv yaratilgan botlarning foydalanuvchilariga o'sha bot nomidan yuboriladi.

STATISTIKA
==========

Umumiy statistika:
- jami yaratilgan botlar
- aktiv botlar
- kutilayotgan botlar
- muddati tugagan botlar
- barcha userlar
- barcha kontentlar
- barcha qismlar
- FactoryBot userlari
- umumiy e'lonlar soni

Har bir bot statistikasi:
- userlar
- aktiv/bloklagan userlar
- kontentlar
- qismli/qismsiz kontent
- qismlar
- majburiy obunalar
- ko'rishlar/qidiruvlar

MUHIM XAVFSIZLIK
================

- Mijoz tokenlari MongoDB'da ochiq saqlanmaydi.
- Tokenlar BOT_TOKEN_SECRET bilan AES-256-GCM orqali shifrlanadi.
- Eski token/parollar chatda ko'rinib qolgan bo'lsa BotFather va MongoDB parollarini almashtiring.

