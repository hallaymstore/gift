# GiftGo Premium Admin + Services + Card Payment Upgrade

## Asosiy o‘zgarishlar

- `.env` fayli o‘zgartirilmadi.
- Foydalanuvchi paneli saqlandi va to‘lov modeli faqat oldindan karta o‘tkazmasi + screenshot + admin tasdiq holatiga tushirildi.
- Admin panel user panelga mos premium compact mobile UI qilingan: pastki navbar, kichik radius, ixcham card/input/buttonlar.
- Admin buyurtmalariga filtrlar qo‘shildi: qidiruv, to‘lov holati, order status, order mode, delivery/pickup, sana oralig‘i.
- Xizmatlar uchun yangi `SERVICE` productType qo‘shildi.
- Standart xizmatlar seed qilindi: telefon orqali tabrik, audio/video montaj, gitara bilan qo‘shiqchi, dekorativ yozuv.
- Support kontaktlar qo‘shildi:
  - telefon: `+998887660800`
  - Telegram: `@Qoryogdiyev`
- Bot `/start` xabarida mini app, admin panel, qo‘ng‘iroq va Telegram chat tugmalari chiqadi.
- Mini app ichida muammo bo‘yicha qo‘ng‘iroq va Telegram chatga o‘tish tugmalari bor.
- Foydalanuvchi checkout qismida rejalashtirish note qo‘shildi.
- Admin uchun order ichida admin note va renotif qo‘shildi: yo‘q, har 3 soat, har 6 soat, har 12 soat, har kuni.
- Renotif background interval orqali admin chatga eslatma yuboradi.

## To‘lov modeli

Buyurtma server tomonda ham faqat `CARD_TRANSFER` qilib majburlandi. Screenshot bo‘lmasa order qabul qilinmaydi.

Naqd to‘lov UI’dan olib tashlandi, server esa har qanday paymentMethod yuborilsa ham `CARD_TRANSFER` sifatida qabul qiladi.

## Muhim

Cloudinary sozlanmagan bo‘lsa rasm/screenshot upload ishlamaydi. `.env` ichidagi mavjud qiymatlar saqlangan.
