# Delivery / Map / Payment upgrade

Ushbu versiyada restoran mini app quyidagi darajada kuchaytirildi:

## Qo‘shilgan imkoniyatlar

1. **Xaritadan lokatsiya belgilash**
   - Mijoz `Joriy lokatsiyam` tugmasi orqali GPS lokatsiyasini oladi.
   - Mijoz xaritadan pin qo‘yishi yoki pinni surib aniq manzil tanlashi mumkin.
   - Xaritada restoran nuqtasi va mijoz nuqtasi ko‘rinadi.

2. **Masofa asosida delivery narxi**
   - Backend restoran koordinatasi va mijoz koordinatasi orasidagi masofani Haversine formulasi bilan hisoblaydi.
   - Admin paneldan quyidagilar boshqariladi:
     - restoran `lat/lng`,
     - bazaviy yetkazish narxi,
     - bazaviy radius / km,
     - har qo‘shimcha km narxi,
     - maksimal hudud,
     - hududdan tashqariga ham narx berish / bermaslik.
   - Default: 3 km ichida 12 000 so‘m, keyingi har 1 km uchun 5 000 so‘m.

3. **Admin panelda masofa va live holat**
   - Buyurtmada mijoz lokatsiyasi, restoran lokatsiyasi, masofa, delivery narxi ko‘rinadi.
   - Mijoz live location yoqsa, admin panelda har 8 soniyada yangilanadigan `yaqinlashmoqda`, `uzoqlashmoqda`, `barqaror` holatlari ko‘rinadi.
   - Admin mijoz va restoran lokatsiyasini Google Maps’da ochishi mumkin.

4. **To‘lov turlari**
   - `Yetkazib berganda naqd`.
   - `Olib ketganda naqd`.
   - `Click/Payme/boshqa ilova orqali` payment link.
   - `Kartaga o‘tkazma + screenshot` fallback.
   - Screenshot faqat `CARD_TRANSFER` tanlanganda majburiy.

5. **Admin sozlamalari**
   - `Click`, `Payme`, `Boshqa to‘lov havolasi` maydonlari qo‘shildi.
   - Naqd to‘lovlarni yoqish/o‘chirish mumkin.
   - `Hozirgi lokatsiyani qo‘yish` tugmasi restoran koordinatasini admin qurilmasidan olishga yordam beradi.

## Muhim eslatmalar

- Browser GPS API faqat HTTPS domen yoki localhost’da ishlaydi.
- Telegram Mini App uchun `PUBLIC_URL` va `WEBAPP_URL` haqiqiy HTTPS bo‘lishi kerak.
- Haqiqiy avtomatik to‘lov uchun Click/Payme merchant API integratsiyasi kerak. Bu versiyada foydalanuvchini to‘lov ilovasiga olib boruvchi “avtoto‘lovga yaqin” linkli variant qo‘shildi.
- `.env` faylida bot token va Cloudinary kalitlari bor. Zip faylni ommaga tarqatmang.

## GPS aniqligi bo‘yicha tuzatish

Ushbu kichik patchda `Joriy lokatsiyam` funksiyasi kuchaytirildi:

- `maximumAge: 0` qilindi, ya’ni eski/cached koordinata ishlatilmaydi.
- GPS bir necha marta o‘lchanadi va eng yaxshi aniqlikdagi natija tanlanadi.
- Aniqlik past bo‘lsa mijozga ogohlantirish chiqadi.
- Qidiruv maydoni qo‘shildi: masalan, `Mug‘lon Kasbi`, `Kasbi Qashqadaryo` deb qidirib pin qo‘yish mumkin.
- Live location faqat yetarlicha aniq GPS kelganda adminga yuboriladi. Juda taxminiy koordinata admin panelga noto‘g‘ri nuqta sifatida yuborilmaydi.
- Admin panelda lokatsiya manbasi va GPS aniqligi ko‘rinadi.
