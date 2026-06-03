# Render Multi Bot Server

Bu loyiha bir nechta Telegram Mini App botni bitta Render Web Service ichida ishga tushiradi:

- GiftGo: `/giftgo/`
- EduCourse: `/course/`
- Garant Market: `/social/`

Tashqi port faqat bitta: Render bergan `PORT`. Ichkarida esa har bir bot alohida child-process sifatida ishlaydi.

## Ishga tushirish

```bash
npm install
node server.js
```

Tekshirish:

```bash
npm run check
```

## Render sozlamalari

Render Web Service oching:

- Build Command: `npm install`
- Start Command: `node server.js`
- Environment: Node

Environment variables `.env.example` bo‘yicha kiritiladi.

## URLlar

`PUBLIC_URL=https://your-service.onrender.com` bo‘lsa:

### GiftGo

- Web app: `https://your-service.onrender.com/giftgo/`
- Admin: `https://your-service.onrender.com/giftgo/admin`
- Webhook: `https://your-service.onrender.com/giftgo/telegram/webhook`

### EduCourse

- Web app: `https://your-service.onrender.com/course/`
- Admin: `https://your-service.onrender.com/course/admin`
- Webhook: `https://your-service.onrender.com/course/telegram/webhook`

### Garant Market

- Web app: `https://your-service.onrender.com/social/`
- Admin: `https://your-service.onrender.com/social/admin`
- Webhook: `https://your-service.onrender.com/social/telegram/webhook`

`AUTO_SET_WEBHOOK=true` bo‘lsa, har bir bot o‘z webhook manzilini avtomatik Telegramga ulaydi.

## Garant Market nima qo‘shadi?

- Oq background, qizil va qora rang uyg‘unligi.
- Ijtimoiy tarmoq hisoblari: YouTube, Instagram, TikTok, Telegram, PUBG Mobile, reklama kanallari.
- Kerakli inputlar: platforma, username/link, auditoriya, monetizatsiya, narx, sotuvchi, xaridor, Telegram, telefon, screenshotlar.
- Garant bitim tartibi va admin Telegramiga o‘tish tugmasi.
- Admin panelda xizmat qo‘shish/o‘chirish, so‘rov statusini boshqarish.

## Social bot uchun muhim envlar

```env
SOCIAL_BOT_TOKEN=...
SOCIAL_BOT_EXPECTED_USERNAME=...
SOCIAL_ADMIN_PASSWORD=strong-password
SOCIAL_ADMIN_TELEGRAM_IDS=6606638731
SOCIAL_ADMIN_TELEGRAM_USERNAME=Youtube_Admini
SOCIAL_ADMIN_TELEGRAM_URL=https://t.me/Youtube_Admini
```

## Yangi bot qo‘shish

1. `bots/newbot/` papka yarating.
2. Botning `server.js` va `public/` fayllarini shu papkaga joylang.
3. Root `server.js` ichidagi `bots` massiviga yangi obyekt qo‘shing:

```js
{
  key: 'newbot',
  title: 'NewBot',
  prefix: 'NEWBOT',
  basePath: '/newbot',
  dir: path.join(__dirname, 'bots', 'newbot'),
  script: path.join(__dirname, 'bots', 'newbot', 'server.js'),
  port: Number(process.env.NEWBOT_INTERNAL_PORT || 4104),
  defaultDbName: 'newbot_platform'
}
```

4. `.env` ga `NEWBOT_BOT_TOKEN`, `NEWBOT_BOT_EXPECTED_USERNAME`, kerak bo‘lsa `NEWBOT_MONGODB_URI` qo‘shing.

## Muhim

Yangi frontendlarda API so‘rovlar `./api/...` shaklida yozilgan. Eski frontendlar ichida absolute `/api/...` ishlatilgan bo‘lsa ham, root server Referer bo‘yicha kerakli botga proksi qilishga harakat qiladi.
