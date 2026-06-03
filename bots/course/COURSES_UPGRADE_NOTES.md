# EduCourse kurs platformasi yangilanishi

Ushbu versiyada eski sovg‘a/delivery oqimi o‘rniga Telegram Mini App uchun kurslar platformasi qo‘shildi va asosiy UI shu modelga moslashtirildi.

## Qo‘shilgan imkoniyatlar

- Kurs turkumlari: IT, SMM, Grafik Dizayn, AI kabi pullik yo‘nalishlar.
- Har bir turkum uchun alohida darslar sahifasi.
- YouTube havolasi orqali videodarsni mini app ichida iframe bilan ko‘rish.
- Dars tafsilot sahifasi: video, tavsif, teglar, resurs linklari.
- Turkum bo‘yicha pullik kirish: foydalanuvchi turkumni sotib oladi.
- To‘lov ilovasi linklari: Paynet, Click, Uzum, Xazna, Payme, boshqa havola.
- Foydalanuvchi chek rasmini yuklaydi.
- Admin chekni tasdiqlasa, turkum ochiladi; rad etsa, darslar qulflangan qoladi.
- Admin panelda kurs turkumlari, videodarslar, to‘lov so‘rovlari va sozlamalar boshqariladi.
- Cloudinary sozlanmagan bo‘lsa, chek rasmlari lokal `public/uploads/course-payments` papkasiga saqlanadi.

## Yangi API endpointlar

### Foydalanuvchi

- `GET /api/courses/bootstrap`
- `GET /api/courses/categories/:id/lessons`
- `GET /api/courses/lessons/:id`
- `GET /api/courses/my/purchases`
- `POST /api/courses/purchase/:categoryId`

### Admin

- `GET /api/admin/course-dashboard`
- `GET /api/admin/course-categories`
- `POST /api/admin/course-categories`
- `PATCH /api/admin/course-categories/:id`
- `DELETE /api/admin/course-categories/:id`
- `GET /api/admin/course-lessons`
- `POST /api/admin/course-lessons`
- `PATCH /api/admin/course-lessons/:id`
- `DELETE /api/admin/course-lessons/:id`
- `GET /api/admin/course-purchases`
- `PATCH /api/admin/course-purchases/:id`

## Ishga tushirish

```bash
npm install
npm run check
npm start
```

Admin kirish uchun productionda `ADMIN_TELEGRAM_IDS` ni sozlang. Lokal testda parol bilan kirish kerak bo‘lsa `.env` ichida `ALLOW_PASSWORD_ADMIN=true` qiling.
