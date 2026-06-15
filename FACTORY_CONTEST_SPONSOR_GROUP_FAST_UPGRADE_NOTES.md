# Factory Konkurs Bot — Sponsor/Guruh/Referral yangilanishi

## Asosiy o‘zgarishlar

- Rasmli anti-bot/captcha bosqichi butunlay olib tashlandi.
- Konkurs e’lonidagi `Konkursga qo‘shilish (N)` inline tugmasi guruh/kanalning o‘zida ishlaydi.
- Tugma bosilganda homiy kanallar/guruhlar va Factory global obunalari parallel tekshiriladi.
- Obuna bajarilgan bo‘lsa, foydalanuvchiga faqat o‘ziga ko‘rinadigan Telegram callback oynasida muvaffaqiyat xabari chiqadi.
- Qatnashchilar soni e’lon inline tugmasida avtomatik yangilanadi.
- Har bir konkurs uchun alohida:
  - konkurs o‘tadigan asosiy guruh/kanal;
  - majburiy homiy kanal/guruhlar;
  - e’lon yuboriladigan joylar;
  - manba va qatnashchi statistikasi saqlanadi.
- `-100...` ID bilan ulangan chatlarda ham Telegram’dan haqiqiy nom olinadi.
- Konkurs botini yaratishda kiritilgan asosiy admin ID to‘liq admin huquqiga ega.
- Boshqa foydalanuvchilar o‘z konkurslarini yaratib, faqat o‘z konkurslarini boshqarishi mumkin.

## Guruh buyruqlari

- `/konkurs` yoki `/contest` — guruh admini o‘z aktiv konkursini shu guruhga ulaydi va e’lon qiladi.
- `/reyting` yoki `/top` — TOP-10 reytingni guruhda ko‘rsatadi.
- `/statistika` yoki `/stat` — aktiv konkurs umumiy statistikasini ko‘rsatadi.

## Referral

- Bot referral deep-link saqlanib qolgan.
- Konkurs o‘tadigan guruh uchun har bir faol qatnashchiga alohida Telegram invite-link yaratiladi.
- Bot `chat_member` update orqali qaysi shaxsiy invite-link bilan yangi odam kirganini qayd etadi.
- Yangi foydalanuvchi homiy obunalaridan o‘tib konkursga qo‘shilgach, taklif qilgan odamga ball/referral yoziladi.

## G‘oliblar

- Eng ko‘p taklif qilganlar.
- Tasodifiy tanlash.
- Admin tanlovi.
- Konkurs tugagach natija ulangan kanal/guruhlarga avtomatik e’lon qilinadi.
- Admin konkurs tugagandan keyin qo‘shimcha g‘olib tanlab, barcha ulangan joylarga e’lon qilishi mumkin.

## Tezlik

- MongoDB connection pool kengaytirildi.
- Homiylar, a’zolik tekshiruvi, manbalar va qatnashchilar soni qisqa cache bilan ishlaydi.
- Telegram `getChatMember` tekshiruvlari parallel bajariladi.
- User statistikasi fon rejimida saqlanadi.
- E’lon inline tugmalari 800 ms debounce bilan yangilanadi.

## Telegram cheklovi

Telegram guruhda botga bitta foydalanuvchiga alohida oddiy xabar ko‘rsatishga ruxsat bermaydi. Shu sababli `Qo‘shildingiz` xabari callback alert ko‘rinishida faqat tugmani bosgan foydalanuvchiga ko‘rsatiladi. Bu talab qilinayotgan maxfiy tasdiqning Telegram API’dagi eng to‘g‘ri usuli.
