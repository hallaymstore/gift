BOTFACTORY SAAS — FACTORY BOT YANGILANGAN VERSIYA
=================================================

Bu papkadagi o‘zgarishlar FAQAT bots/factory ichiga qilindi.
GiftGo / Course / Social Garant botlariga tegilmagan.

ASOSIY G‘OYA
------------
Bitta Render server ichida FactoryBot ishlaydi. Mijoz BotFather tokenini kiritadi, bot turini tanlaydi, admin IDlarini kiritadi. So‘rov bosh adminlarga keladi. Bosh admin 1 oyga ruxsat bersa, mijozning boti avtomatik ishga tushadi.

Oylik muddati tugasa bot to‘xtaydi, lekin MongoDB’dagi barcha ma’lumotlar saqlanadi. Admin yana 1 oyga uzaytirsa, bot eski joyidan davom etadi.

YANGI BOT TURLARI
-----------------
1) Media/kontent botlar:
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

2) Kanal egalari uchun:
   - VIP Obuna Bot
     Maxfiy kanal/guruhga vaqtlik invite link beradi. Foydalanuvchi so‘rov yuboradi, shifr oladi, admin tasdiqlasa bot 1 martalik/vaqtlik invite link yaratadi.
   - Konkurs / Giveaway Bot
     Majburiy obuna, qatnashish tugmasi, qatnashchilar, random g‘olib tanlash.
   - Kanal Ariza + Autopost Bot
     Admin o‘zi inputlar qo‘shadi, nomini/tartibini/turini o‘zgartiradi. Foydalanuvchi ariza to‘ldiradi, har so‘rovga maxfiy shifr beriladi. Admin arizani ko‘radi. Autopost uchun kanal, post va interval sozlanadi.
   - Reklama Buyurtma Bot
     Kanal Ariza bot bilan bir xil engine’da ishlaydi. Reklama/akkount savdo/kanal buyurtmalari uchun custom inputlar mos keladi.

3) Guruh egalari uchun:
   - Guruh Tozalovchi + AntiSpam Bot
     Kirdi/chiqdi xabarlarini o‘chiradi, linklarni bloklaydi, taqiqlangan so‘zlarni o‘chiradi, salomlashuv, qoidalar va FAQ ishlaydi.
   - FAQ + Support Guruh Bot
     FAQ, salomlashuv, qoidalar va oddiy antispam funksiyalari.

HAMMA MIJOZ BOTLARIDA BOR FUNKSIYALAR
-------------------------------------
- Bot egasi admin paneli
- Statistika
- Broadcast / e’lon yuborish
- Mahalliy majburiy obuna qo‘shish/o‘chirish
- Factory global majburiy obunalari bilan birga ishlash
- Oylik tarif nazorati
- Server restart/deploydan keyin MongoDB’dan tiklanish
- Tokenlar DB’da AES-256-GCM bilan shifrlangan holda saqlanishi

VIP OBUNA BOT
-------------
Admin sozlaydi:
- Maxfiy kanal/guruh: @username yoki -100 chat_id
- To‘lov/narx matni
- Dostup muddati: masalan 30 kun
- Invite link muddati: masalan 30 daqiqa
- To‘lov uchun admin username

Foydalanuvchi:
- VIP so‘rov yuboradi
- Maxfiy shifr oladi: VIP-AB12CD34
- To‘lovda shu shifrni adminga yuboradi

Admin:
- So‘rovni ko‘radi
- “Link berish” bosadi
- Bot maxfiy kanal/guruhga vaqtlik invite link yaratadi

MUHIM: VIP bot maxfiy kanal/guruhda admin bo‘lishi va Invite link yaratish huquqiga ega bo‘lishi kerak.

KANAL ARIZA + AUTOPOST BOT
--------------------------
Admin inputlarni o‘zi sozlaydi:
Format:
Label | type | required | order | placeholder

Type variantlari:
text, number, phone, url, location, photo, document

Misol:
Kanal nomi | text | ha | 1 | Kanalingiz nomini yozing
Obunachilar soni | number | ha | 2 | Masalan: 15000
Kanal linki | url | ha | 3 | https://t.me/...
Joylashuv | location | yoq | 4 | Lokatsiya yuboring
Skrinshot | photo | yoq | 5 | Rasm yuboring

Har bir input alohida qadam bo‘lib chiqadi. Foydalanuvchi bittadan javob beradi.
Oxirida adminlarga ariza yuboriladi va foydalanuvchiga maxfiy shifr beriladi.

Maxfiy shifr misol:
REQ-AB12CD34

Foydalanuvchi to‘lov/admin bilan yozishganda shu shifrni yuboradi.

Autopost:
- Admin target kanal/guruhni kiritadi
- Post yuboradi/forward qiladi
- Nomi | interval_daqiqa | target_chat yuboradi
- Bot interval bo‘yicha postni kanalga yuboradi

MUHIM: Autopost uchun bot kanal/guruhda admin bo‘lishi kerak.

KONKURS BOT
-----------
Admin:
Konkurs yaratish formati:
Nomi | g‘oliblar soni | tavsif

Misol:
iPhone konkursi | 3 | Kanalga obuna bo‘lib qatnashing

Foydalanuvchi “Qatnashish” tugmasini bosadi. Majburiy obuna tekshiriladi.
Admin “G‘olib tanlash” bosganda random g‘oliblar chiqadi.

GURUH BOT
---------
Funksiyalar:
- Kirdi/chiqdi xabarlarni o‘chirish
- Anti-link
- Taqiqlangan so‘zlar
- Salomlashuv
- /rules
- FAQ: kalit so‘z | javob
- Broadcast
- Statistika

MUHIM: Guruh bot guruhda admin bo‘lishi kerak. Xabarlarni o‘chirish uchun delete huquqi bo‘lishi kerak.

.ENV YANGI NARXLAR
------------------
VIP_OBUNA_MONTHLY_PRICE=100000
KONKURS_MONTHLY_PRICE=70000
KANAL_ARIZA_MONTHLY_PRICE=120000
REKLAMA_BUYURTMA_MONTHLY_PRICE=120000
GROUP_CLEANER_MONTHLY_PRICE=70000
FAQ_SUPPORT_MONTHLY_PRICE=70000

TEKSHIRILDI
-----------
npm run check orqali root server, giftgo, course, social va factory sintaksisi tekshirildi.

