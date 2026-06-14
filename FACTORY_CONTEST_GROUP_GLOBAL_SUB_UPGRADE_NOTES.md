# Factory Konkurs / Global Subscription Upgrade

## Konkurs bot
- Kanal va guruhlarga konkurs postini inline tugmalar bilan yuborish qo‘shildi.
- Admin private panelidan `📣 Konkursni tarqatish` orqali @username yoki chat IDga post yuboradi.
- Guruh adminlari guruh ichida `/konkurs` yoki `/contest` buyrug‘i bilan aktiv konkurs postini chiqarishi mumkin.
- `🎉 Konkursga qo‘shilish`, `🏆 Reyting`, `📜 Qoidalar` tugmalari bot private chatiga deep-link orqali yo‘naltiradi.
- Har bir kanal/guruh uchun alohida manba kodi yaratiladi; foydalanuvchi qaysi manbadan kirgani MongoDB’da saqlanadi.
- Admin panelga `📍 Manba statistikasi` qo‘shildi: bosishlar, qatnashuvchilar va postlar soni.
- G‘olib aniqlash usullari: eng ko‘p do‘st taklif qilgan, tasodifiy, admin tanlovi.
- Admin tanlovida qatnashchilar inline tugmalar bilan belgilanadi va tanlov yakunlanadi.

## Global majburiy obuna
- FactoryBot va yaratilgan botlarda global obuna faqat private chatdagi foydalanishda tekshiriladi.
- Kanal/guruhga yangi odam qo‘shilganda yoki guruhdagi oddiy xabarlarda obuna ogohlantirishi yuborilmaydi.
- Konkurs botida `/start` bosilganda global va lokal konkurs obunalari tekshiriladi.
- Global obunani FactoryBot tokeni tekshiradi; faqat FactoryBot kanal/guruhda admin bo‘lishi yetarli.

## Tekshiruv
- `npm run check` muvaffaqiyatli yakunlandi.
