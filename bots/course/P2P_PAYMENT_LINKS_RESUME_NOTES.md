# P2P to‘lov linklari va checkout resume

Qo‘shilganlar:

- Paynet, Click, Uzum Bank va Xazna uchun alohida payment method tanlash.
- Karta raqam nusxalash flow o‘rniga to‘lov ilovasiga/linkiga yo‘naltirish.
- Mijoz to‘lov ilovasiga chiqib ketishidan oldin checkout draft `localStorage`ga saqlanadi.
- Mijoz qaytib kirganda savat, forma ma’lumotlari, payment method, lokatsiya va promokod draftdan tiklanadi.
- Screenshot fayli brauzer xavfsizligi sabab saqlanmaydi; mijoz qaytgach screenshotni qayta tanlaydi.
- Server faqat `PAYNET`, `CLICK`, `UZUM`, `XAZNA` providerlaridan birini qabul qiladi va screenshot majburiy qoladi.
- Admin panelda buyurtma kartasida to‘lov provider nomi ko‘rinadi.
- Admin sozlamalariga payment linklarni tahrirlash maydonlari qo‘shildi.

Muhim:

- `.env` fayliga tegilmagan.
- Bu linklar P2P/QR yo‘naltirish linklari, merchant avtomatik callback emas. To‘lov admin screenshot orqali tasdiqlanadi.
