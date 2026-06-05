# One Server BotFactory + Social + Mini Apps

Bu yig‘ilgan versiya bitta Render servisida ishlaydi.

## Yo‘llar
- `/giftgo/` — SovgaGo
- `/course/` — KurslarGo
- `/social/` — Akkount Savdo / Garant Market
- `/factory/` — Bot yaratuvchi BotFactory serveri

## Render
Build Command:
```bash
npm install
```
Start Command:
```bash
node server.js
```

## Muhim ENV
BotFactory `/start` javob berishi uchun Render ENV ichida quyidagilar to‘g‘ri bo‘lishi shart:

```env
MONGODB_URI=...
FACTORYBOT_TOKEN=...
ADMIN_TELEGRAM_IDS=6606638731
# yoki
ADMIN_IDS=6606638731
```

`FACTORYBOT_TOKEN` o‘rniga `BOTFACTORY_TOKEN`, `BOTFACTORY_BOT_TOKEN`, `FACTORY_BOT_TOKEN` nomlari ham qo‘llab-quvvatlanadi.

## Nima tuzatildi
- Factory alohida server sifatida emas, root `server.js` ichida child process sifatida yuradi.
- Factory webhook URL endi root domen + `/factory/webhook/...` qilib o‘rnatiladi.
- `MONGODB_URL` bo‘lmasa ham rootdagi `MONGODB_URI` ishlatiladi.
- `ADMIN_IDS` bo‘lmasa `ADMIN_TELEGRAM_IDS` ishlatiladi.
- `telegraf` root dependency’ga qo‘shildi, Render `npm install` qilganda factory bot ham ishlaydi.
- Har bir child bot crash bo‘lsa root server uni qayta ishga tushiradi.
