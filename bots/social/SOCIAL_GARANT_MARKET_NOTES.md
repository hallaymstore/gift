# Social Garant Market qo‘shimchasi

Bu bot ijtimoiy tarmoq hisoblari, reklama kanallari, PUBG hisoblari va garant bitimlar uchun qo‘shildi.

## Yo‘llar

- Mini app: `/social/`
- Admin panel: `/social/admin`
- Webhook: `/social/telegram/webhook`
- Health: `/social/api/health`

## Asosiy imkoniyatlar

- YouTube, Instagram, TikTok, Telegram, PUBG, reklama kanallari uchun so‘rov qabul qiladi.
- Sotuvchi, xaridor, hisob havolasi, obunachi, monetizatsiya, narx va screenshot inputlari bor.
- Admin Telegramiga avtomatik xabar yuboradi.
- Admin panelda xizmat qo‘shish/o‘chirish, so‘rov statusini o‘zgartirish mumkin.
- Oq background, qizil va qora rang uyg‘unligi bilan tayyorlangan.

## Render env

Root loyihada quyidagilarni qo‘shing:

```env
SOCIAL_BOT_TOKEN=...
SOCIAL_BOT_EXPECTED_USERNAME=...
SOCIAL_ADMIN_TELEGRAM_USERNAME=Youtube_Admini
SOCIAL_ADMIN_TELEGRAM_URL=https://t.me/Youtube_Admini
SOCIAL_ADMIN_PASSWORD=strong-password
SOCIAL_ADMIN_TELEGRAM_IDS=6606638731
```

Agar umumiy `MONGODB_URI` kiritilgan bo‘lsa, social bot avtomatik `social_garant_market` bazasini ishlatadi.
