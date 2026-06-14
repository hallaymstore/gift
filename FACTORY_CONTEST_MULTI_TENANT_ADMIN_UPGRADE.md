# Konkurs bot: ommaviy multi-admin va tezkor ishlash yangilanishi

## Rollar
- Yaratilgan bot egasi va Factory global adminlari to‘liq admin.
- Oddiy foydalanuvchi o‘z konkursini yaratgach, faqat o‘sha konkurs uchun qisman admin bo‘ladi.
- Qisman admin boshqa foydalanuvchilarning konkurslarini, broadcast yoki umumiy statistikani boshqara olmaydi.

## Har bir konkurs uchun alohida kanal/guruh
- Kanal/guruhlar `GiveawaySource` orqali aynan konkurs ID ga bog‘lanadi.
- `@username`, `-100...` ID yoki private invite link bilan ulash mumkin.
- Bot Telegram API orqali haqiqiy kanal/guruh nomini oladi; inline tugmada ID emas, nom ko‘rinadi.
- Ulanishdan oldin foydalanuvchining o‘sha joyda adminligi va botning post yuborish huquqi tekshiriladi.
- Private kanal/guruh uchun bot invite link yaratadi yoki admin tayyor link beradi.
- Har bir konkursda ulash, ro‘yxat, o‘chirish va barcha ulangan joylarga parallel e’lon yuborish mavjud.

## Ommaviy foydalanish
- Bir xil yaratilgan konkurs botdan ko‘p tashkilotchi foydalanishi mumkin.
- Har bir tashkilotchiga alohida konkurs, qatnashchilar, kanallar, manbalar va statistika saqlanadi.
- `/konkurs` yoki `/contest` buyrug‘i guruh ichida faqat guruh adminiga ishlaydi va uning aktiv konkursini shu guruhga ulab post qiladi.

## Obuna va tezlik
- Factory global obunalari yaratilgan konkurs botda ham private `/start` vaqtida tekshiriladi.
- Konkursning o‘ziga ulangan kanal/guruhlar ham shu konkurs uchun alohida tekshiriladi.
- Global obuna ro‘yxati, a’zolik holati, konkurs manbalari va access holati qisqa TTL cache bilan tezlashtirildi.
- Telegram a’zolik tekshiruvlari parallel bajariladi.
- User statistikasi fon rejimida saqlanadi; asosiy javobni bloklamaydi.

## E’lon va natija
- Inline tugmalar: Konkursga qo‘shilish, Reyting, Qoidalar.
- Qaysi kanal/guruhdan kirgani source code bilan saqlanadi.
- G‘olib: eng ko‘p referral, tasodifiy yoki konkurs egasi tanlovi.
- Muddat tugaganda natija konkurs egasi, yordamchi managerlar va to‘liq adminlarga yuboriladi.
