# Mini App redirect fix

Ushbu versiyada uchta bot uchun Telegram Mini App ochilishidagi `ERR_TOO_MANY_REDIRECTS` va root sahifa ochilib qolish muammolari tuzatildi.

## Tuzatilgan joylar

- `server.js` endi `/giftgo`, `/course`, `/social` yo‘llarida 301/302 redirect qilmaydi.
- Har bir botga `WEBAPP_URL` avtomatik `/giftgo/`, `/course/`, `/social/` ko‘rinishida beriladi.
- Telegram botlarning pastki `Menu` tugmasi deploy vaqtida to‘g‘ri mini app URLga yangilanadi.
- Frontend ichidagi `/api/...` chaqiruvlari endi joriy bot prefiksini o‘zi aniqlaydi.
- `.env` qiymatlari o‘zgartirilmadi.

## Render

Build Command:

```bash
npm install
```

Start Command:

```bash
node server.js
```

Deploydan keyin botlarga `/start` yuboring. Pastki `Menu` tugmasi ham to‘g‘ri mini appga ochilishi kerak.
