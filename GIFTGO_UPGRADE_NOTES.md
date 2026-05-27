# GiftGo Hybrid Platform Upgrade

Bu versiya restoran app bazasidan universal gul/sovg'a delivery platformaga moslashtirildi.

## Asosiy imkoniyatlar

- Gul, sovg'a box, tort, shirinlik, ichimlik, fast food va boshqa mahsulot turlari.
- Oldindan buyurtma rejimi: admin sozlagan minimal kun bo'yicha qabul/yetkazish sanasi majburiy.
- Tezkor random gul rejimi: 1 kun ichidagi buyurtma, minimal summa va mijoz roziligi majburiy.
- Xarita/lokatsiya: mijoz pin qo'yadi, GPS oladi yoki manzil qidiradi.
- Km bo'yicha yetkazish narxi: baza narx, baza km, har km narx, max km admin paneldan boshqariladi.
- To'lov usullari: Click/Payme/boshqa link, karta+chek, yetkazilganda naqd, olib ketganda naqd.
- Promokodlar: foiz, fixed summa, bepul delivery, birinchi xaridga faqat, kategoriya/product cheklovlari.
- Mahsulot darajasida promo: product qo'shishda promoCode va promoDiscountPercent berish mumkin.
- Birinchi xarid chegirmasi: default 10 000 so'm.
- Referral: mijoz o'z referral linkini Telegram chatlarga ulashadi.
- Bonus/keshbek karta: yakunlangan buyurtmada cashback bonus beriladi, bonusni keyingi buyurtmada ishlatish mumkin.
- Admin panel: dashboard, orders, products, promocodes, customers, delivery, settings.
- Live location: mijoz aktiv buyurtma paytida lokatsiyani yangilab borishi mumkin.

## Tezkor random gul qoidasi

Admin paneldagi Settings bo'limida:

- expressRandomEnabled
- expressMaxLeadHours
- expressRandomMinAmount
- expressAgreementText

sozlanadi. Mijoz `Tezkor random gul` rejimini tanlasa, `noComplaintAgreement` belgilanmasa buyurtma o'tmaydi.

## Deploy eslatma

1. `.env` ichidagi `PUBLIC_URL`, `WEBAPP_URL`, `BOT_TOKEN`, `MONGODB_URI`, `Cloudinary` qiymatlarini tekshiring.
2. Productionda `REQUIRE_TELEGRAM_AUTH=true` va `ALLOW_PASSWORD_ADMIN=false` qiling.
3. Admin kirishi uchun `.env` ichida `ADMIN_TELEGRAM_IDS` ga Telegram User ID kiriting.
4. BotFather'da Mini App domeni va menu button sozlamalarini tekshiring.

## Muhim xavfsizlik

Zip ichidagi `.env` faylda maxfiy tokenlar bo'lishi mumkin. Uni ommaga yubormang.
