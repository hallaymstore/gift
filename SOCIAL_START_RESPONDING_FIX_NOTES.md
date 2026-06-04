# Social bot /start responding fix

- Akkount savdo bot `/start` javob bermay qolishiga sabab: Social bot boot jarayonida MongoDB ulanishini kutib, ulanish xatosida child process exit qilayotgan edi.
- Endi HTTP server va Telegram webhook birinchi ishga tushadi.
- MongoDB ulanishi background retry bilan davom etadi.
- `/start`, `/id`, menu button va mini app tugmalari MongoDB tayyor bo'lmasa ham ishlaydi.
- Ma'lumot yozadigan admin/user APIlar esa avvalgidek `requirePersistentDatabase()` orqali faqat MongoDB tayyor bo'lganda saqlaydi. Shu sabab ma'lumotlar localga yozilib yo'qolib ketmaydi.
- Webhook xato bersa avtomatik retry qo'shildi.
