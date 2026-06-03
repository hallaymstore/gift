# Bot token / webhook fix

Agar `/start` bosilganda boshqa bot javob bersa, serverda ishlayotgan `BOT_TOKEN` eski bot tokeni bo'ladi.
Telegramda xabarni qaysi bot yuborishini kod yoki UI emas, aynan `BOT_TOKEN` belgilaydi.

## To'g'ri sozlash

1. BotFather'dan yangi GiftGo bot tokenini oling.
2. Hosting environment variables yoki `.env` ichida quyidagilarni yangilang:
   - `BOT_TOKEN=...` — yangi bot tokeni
   - `BOT_EXPECTED_USERNAME=...` — yangi bot username, @ belgisiz
   - `PUBLIC_URL=https://sizning-domainingiz`
   - `WEBAPP_URL=https://sizning-domainingiz`
3. Eski bot webhookini BotFather tokeni eski bo'lgan loyihadan tozalang yoki eski servisni to'xtating.
4. Yangi servisni restart qiling.
5. Logda `Telegram bot ulandi: @...` chiqishini tekshiring.

## Nima yangilandi

- Server start bo'lganda Telegram `getMe` orqali token qaysi botga tegishli ekanini tekshiradi.
- `settings.botUsername` avtomatik haqiqiy bot username bilan sync bo'ladi.
- `BOT_EXPECTED_USERNAME` bilan mos kelmasa logda ogohlantirish chiqadi.
- Webhook o'rnatishda `drop_pending_updates: true` ishlatiladi.
- Admin API `/api/admin/bot/status` endi token tegishli bo'lgan bot username/nomini ham qaytaradi.

## Muhim

`.env` faylidagi tokenlar maxfiy. Zipni ommaga tashlamang.
