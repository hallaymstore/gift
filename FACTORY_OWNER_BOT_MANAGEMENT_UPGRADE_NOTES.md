# Factory Owner Bot Management Upgrade

Qo‘shildi: FactoryBot foydalanuvchilari o‘zlari yaratgan botlarni FactoryBot ichidan boshqarishi mumkin.

## Yangi imkoniyatlar

### User / bot egasi uchun
- `📋 Mening botlarim` endi faqat ro‘yxat emas, har bir bot uchun boshqaruv tugmasini chiqaradi.
- Har bir botda:
  - `🔎 Batafsil / boshqarish`
  - `🔄 Qayta ishga tushirish`
  - `🔐 API token almashtirish`
  - `👨‍💻 Admin ID almashtirish`
  - `🗑 Botni o‘chirish`
  - `☎️ Asosiy admin bilan kelishish`

### Asosiy admin / owner uchun
- `🔍 Bot qidirish`, `📋 Barcha botlar`, pending/expired/detail oynalarida ham boshqaruv tugmalari kengaytirildi.
- Owner istalgan mijoz botida:
  - 1 oyga uzaytiradi
  - to‘xtatadi
  - qayta ishga tushiradi
  - API token almashtiradi
  - admin IDlarni almashtiradi
  - botni butunlay o‘chiradi

## Texnik ishlash tartibi

### API token almashtirish
- Token BotFather token formatida tekshiriladi.
- Telegram `getMe()` orqali haqiqiy bot ekanligi tekshiriladi.
- Token boshqa aktiv/pending/disabled/expired factory botga ulangan bo‘lsa, qabul qilinmaydi.
- Eski webhook tozalanadi.
- Token MongoDB’da AES-256-GCM bilan qayta shifrlanadi.
- Bot approved + enabled bo‘lsa, yangi token bilan avtomatik qayta ishga tushadi.

### Admin ID almashtirish
- Yangi admin IDlar vergul bilan qabul qilinadi.
- Bot egasi ID avtomatik adminlar ichiga qo‘shiladi.
- Bot aktiv bo‘lsa, adminlar yangilangandan keyin runtime qayta ishga tushiriladi.

### Botni o‘chirish
- Ikki bosqichli tasdiqlash qo‘shildi.
- Runtime to‘xtatiladi.
- Webhook tozalanadi.
- Factory DB’dan bot yozuvi va shu `bot_key`ga tegishli userlar, obunalar, kontent, statistika, arizalar, konkurslar, group/chat learning/video downloader ma’lumotlari o‘chiriladi.
- Telegram token BotFather’dan avtomatik revoke qilinmaydi; xavfsizlik uchun tokenni BotFather’dan qo‘lda revoke/delete qilish kerak.

## Tekshiruv

`npm run check` bajarildi va barcha server fayllari sintaksisdan o‘tdi.
