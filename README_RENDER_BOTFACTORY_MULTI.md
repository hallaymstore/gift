# Render Multi Bot + BotFactory

Bu arxiv bitta Render serverda quyidagilarni yuritadi:

- `/giftgo/` — SovgaGo mini app bot
- `/course/` — KurslarGo mini app bot
- `/social/` — Akkount Savdo / Garant Market mini app bot
- `/factory/` — BotFactory, ya'ni bot yaratuvchi bot

## Render sozlamasi

```bash
Build Command: npm install
Start Command: node server.js
```

## Muhim envlar

Root mini app botlar avvalgidek ishlaydi:

```env
PUBLIC_URL=https://sizning-render-url.onrender.com
MONGODB_URI=mongodb+srv://...

GIFTGO_BOT_TOKEN=...
COURSE_BOT_TOKEN=...
SOCIAL_BOT_TOKEN=...
```

BotFactory uchun:

```env
FACTORYBOT_TOKEN=...
ADMIN_IDS=6606638731
WEBHOOK_SECRET=multi_bot_super_secret_2026_change_me
BOT_TOKEN_SECRET=multi_bot_super_secret_2026_change_me
OWNER_USERNAME=@Qoryogdiyev
```

Agar `MONGODB_URL` alohida yozilmasa, BotFactory rootdagi `MONGODB_URI`dan foydalanadi.

## BotFactory yo'li

BotFactory webhook URLlar rootga emas, `/factory` prefiksi bilan o'rnatiladi:

```txt
https://sizning-render-url.onrender.com/factory/webhook/...
```

Mijoz yaratgan botlar DBda tokeni shifrlangan holda saqlanadi. Server qayta yoqilganda tasdiqlangan botlar MongoDBdan qayta ishga tushadi.

## Yangi bot turi qo'shish

BotFactory turlari:

```txt
bots/factory/bots.config.js
```

shu fayldagi `typePresets` ichiga qo'shiladi.
