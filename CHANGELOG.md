# CHANGELOG

Ildizdagi *_UPGRADE_NOTES.md fayllari shu yerga yig'ildi.

---

## FACTORY_CHANNEL_GROUP_REQUEST_LINK_UPGRADE_NOTES

# Factory bot kanal/guruh obuna va yo‘nalishlar upgrade

Ushbu versiyada faqat `bots/factory` qismi kengaytirildi. `bots/giftgo`, `bots/course`, `bots/social` va ularning frontend/server fayllariga tegilmadi.

## Qo‘shilganlar

### 1. Yaratilgan bot xabarlari pastida footer
Yaratilgan mijoz botlari foydalanuvchiga yuboradigan xabarlar ostida quyidagilar ko‘rinadi:
- botning username/linki: `@botusername — https://t.me/botusername`;
- bot admini lokal majburiy obuna sifatida qo‘shgan kanal/guruh linklari;
- Standard tarifda BotFactory marketing matni.

Plus tarifda BotFactory marketing matni chiqmaydi, lekin botning o‘z linki va admin qo‘shgan kanal/guruhlar chiqadi.

### 2. Public va private/zayavka obunalar
Factory global obunalari va har bir yaratilgan botning lokal obunalari endi quyidagi formatlarni qabul qiladi:

```text
@kanal
https://t.me/kanal
Kanal nomi | https://t.me/+privateInvite | zayavka
Kanal nomi | -1001234567890 | zayavka
```

Private/zayavka tekshiruvi uchun tegishli bot o‘sha kanal/guruhda admin bo‘lishi kerak. User zayavka yuborganda `chat_join_request` update orqali DB’ga yoziladi va “Obunani tekshirish” bosilganda ruxsat beriladi.

### 3. Konkurs bot uchun alohida obuna menyulari
Konkurs/Giveaway bot admin paneliga qo‘shildi:
- `➕ Konkurs kanali`
- `➕ Konkurs guruhi`
- `📋 Konkurs obunalari`

Bu menyular ham public, private invite va zayavka formatlarini qabul qiladi.

### 4. Chat join request saqlanishi
FactoryBot va barcha yaratilgan botlarda `chat_join_request` handler qo‘shildi. Bu zayavka yuborgan userlarni MongoDB’da saqlaydi.

### 5. Webhook allowed_updates kengaytirildi
Yaratilgan botlarning webhook sozlamasiga `chat_join_request` qo‘shildi.

## Muhim Telegram shartlari
- Private/zayavka kanalda requestni aniqlash uchun bot kanal/guruhda admin bo‘lishi kerak.
- VIP invite link yaratish uchun bot maxfiy kanal/guruhda invite link yaratish huquqiga ega admin bo‘lishi kerak.
- Faqat invite link berilib, bot kanal/guruhda admin qilinmasa, Telegram API orqali zayavkani tekshirib bo‘lmaydi.

## Tekshiruv
Root loyiha bo‘yicha sintaksis tekshirildi:

```bash
npm run check
```

Natija: `server.js`, `giftgo`, `course`, `social`, `factory` fayllari `node --check`dan o‘tdi.

---

## FACTORY_CHAT_LEARNING_CONTEST_SAFE_FIX_NOTES

# Factory: Suhbatchi bot + Konkurs xavfsiz tarqatish tuzatishlari

## 1. Yangi bot turi: Suhbatchi Gap O‘rganuvchi Bot

Factory menyusiga `🧠 Suhbatchi bot` turi qo‘shildi.

Bot faqat guruhlarda ishlaydi:
- guruh a'zolari reply qilib yozgan savol-javoblarni o‘rganadi;
- reply qilingan eski xabar savol/kalit sifatida olinadi;
- replydagi yangi xabar javob sifatida saqlanadi;
- keyingi o‘xshash xabarlarga eng yaqin mos javobni tez qaytaradi;
- har bir guruhning o‘rganilgan bazasi alohida saqlanadi;
- ma'lumotlar MongoDB’da turadi, server qayta deploy bo‘lsa ham o‘chmaydi.

Guruh admin buyruqlari:
- `/learn_on` — replylardan o‘rganishni yoqish
- `/learn_off` — o‘rganishni o‘chirish
- `/reply_on` — avtomatik javobni yoqish
- `/reply_off` — avtomatik javobni o‘chirish
- `/learnstats` — o‘rganilgan javoblar statistikasi
- `/forgetall` — shu guruhdagi o‘rganilgan javoblarni tozalash

## 2. Konkurs bot xavfsizligi

Konkurs botdagi homiy va targ‘ibot joylari aniq ajratildi:

- `🤝 Homiy kanal/guruh` — faqat majburiy obuna tekshiruv uchun ishlaydi. E'lon yuborilmaydi.
- `🏠 Konkurs joyi` — konkurs e'loni chiqadigan targ‘ibot guruh/kanal.

`📣 E’lonlarni yuborish` bosilganda endi faqat `host/both` rolidagi joylarga yuboriladi. Homiy kanallarga/guruhlarga konkurs e'loni ketmaydi.

## 3. Maxfiy guruh xavfsizligi

Oldingi xavfli holat: referral uchun host/maxfiy guruhga avtomatik invite link yaratilishi mumkin edi. Bu begona odamlar maxfiy guruhga kirib olishiga sabab bo‘lishi mumkin.

Tuzatildi:
- foydalanuvchiga maxfiy host guruh invite-linki tarqatilmaydi;
- referral faqat bot `start` havolasi orqali yuradi;
- homiy kanal/guruhlar faqat obuna tekshiruv uchun ishlaydi.

## 4. Tezlik

- Suhbatchi bot javoblarni cache orqali qidiradi.
- Konkursdagi homiy tekshiruv va qatnashchilar soni cache bilan ishlaydi.
- E'lonlar parallel yuboriladi.

---

## FACTORY_CONTEST_GAME_UPGRADE_NOTES

# Factory Konkurs Game Bot yangilanishi

## Foydalanuvchi oqimi
1. `/start` bosiladi.
2. Factory global obunalari va konkurs botining lokal kanal/guruhlari tekshiriladi.
3. Ism-familiya so‘raladi.
4. Maishiy texnika rasmi bilan anti-bot tekshiruv chiqadi.
5. To‘g‘ri javobdan keyin qatnashuvchi darhol aktiv bo‘ladi — admin tasdig‘i kerak emas.
6. Asosiy menyu: Reyting, Do‘stlarni taklif qilish, Profil, Qoida.

## Referral
- Har bir haqiqiy, obunadan va CAPTCHA tekshiruvidan o‘tgan do‘st uchun admin belgilagan ball beriladi.
- Standart qiymat: 5 ball.
- Self-referral va takroriy referral hisoblanmaydi.

## Admin oqimi
- Kamida 2 ta umumiy/lokal majburiy obuna sozlanadi.
- `🎮 Yangi konkurs` orqali wizard:
  - nom;
  - sovrin;
  - g‘oliblar soni;
  - muddat (`12h`, `3d`, `2w`);
  - referral ball;
  - tavsif;
  - qoida;
  - ixtiyoriy sovrin rasmi.
- Muddat tugaganda natija avtomatik muzlatiladi va adminlarga TOP-10 hamda g‘oliblar yuboriladi.

## Barqarorlik
- Konkurs, qatnashchilar, ballar va natijalar MongoDB’da saqlanadi.
- Server qayta ishga tushsa onboarding va reyting ma’lumotlari yo‘qolmaydi.
- Eski konkurs/qatnashchi yozuvlari uchun moslik migratsiyasi mavjud.

---

## FACTORY_CONTEST_GROUP_GLOBAL_SUB_UPGRADE_NOTES

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

---

## FACTORY_CONTEST_MULTI_TENANT_ADMIN_UPGRADE

# Konkurs bot: ommaviy multi-admin va tezkor ishlash yangilanishi

## Rollar
- Yaratilgan bot egasi va Factory global adminlari to‘liq admin.
- Oddiy foydalanuvchi o‘z konkursini yaratgach, faqat o‘sha konkurs uchun qisman admin bo‘ladi.
- Qisman admin boshqa foydalanuvchilarning konkurslarini, broadcast yoki umumiy statistikani boshqara olmaydi.

## Har bir konkurs uchun alohida kanal/guruh
- Kanal/guruhlar `GiveawaySource` orqali aynan konkurs ID ga bog‘lanadi.
- `@username`, `-100...` ID yoki private invite link bilan ulash mumkin.
- Bot Telegram API orqali haqiqiy kanal/guruh nomini oladi; inline tugmada ID emas, nom ko‘rinadi.
- Ulanishdan oldin foydalanuvchining o‘sha joyda adminligi va botning post yuborish huquqi tekshiriladi.
- Private kanal/guruh uchun bot invite link yaratadi yoki admin tayyor link beradi.
- Har bir konkursda ulash, ro‘yxat, o‘chirish va barcha ulangan joylarga parallel e’lon yuborish mavjud.

## Ommaviy foydalanish
- Bir xil yaratilgan konkurs botdan ko‘p tashkilotchi foydalanishi mumkin.
- Har bir tashkilotchiga alohida konkurs, qatnashchilar, kanallar, manbalar va statistika saqlanadi.
- `/konkurs` yoki `/contest` buyrug‘i guruh ichida faqat guruh adminiga ishlaydi va uning aktiv konkursini shu guruhga ulab post qiladi.

## Obuna va tezlik
- Factory global obunalari yaratilgan konkurs botda ham private `/start` vaqtida tekshiriladi.
- Konkursning o‘ziga ulangan kanal/guruhlar ham shu konkurs uchun alohida tekshiriladi.
- Global obuna ro‘yxati, a’zolik holati, konkurs manbalari va access holati qisqa TTL cache bilan tezlashtirildi.
- Telegram a’zolik tekshiruvlari parallel bajariladi.
- User statistikasi fon rejimida saqlanadi; asosiy javobni bloklamaydi.

## E’lon va natija
- Inline tugmalar: Konkursga qo‘shilish, Reyting, Qoidalar.
- Qaysi kanal/guruhdan kirgani source code bilan saqlanadi.
- G‘olib: eng ko‘p referral, tasodifiy yoki konkurs egasi tanlovi.
- Muddat tugaganda natija konkurs egasi, yordamchi managerlar va to‘liq adminlarga yuboriladi.

---

## FACTORY_CONTEST_SPONSOR_GROUP_FAST_UPGRADE_NOTES

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

---

## FACTORY_GROUP_MANAGER_UPGRADE_NOTES

# Factory Group Manager Upgrade

## Yangi bot turi
- `group_manager` — ommaviy foydalaniladigan Ultimate Group Manager.
- Botni istalgan foydalanuvchi o‘z guruhiga qo‘shishi mumkin.
- Har bir guruh sozlamalari MongoDB’da `bot_key + chat_id` bo‘yicha alohida saqlanadi.
- Factory bot yaratishda kiritilgan asosiy admin ID barcha guruhlarda to‘liq boshqaruvga ega.
- Guruhning Telegram administratorlari faqat o‘z guruhini boshqaradi.

## Himoya va moderatsiya
- Link/reklama xabarlarini o‘chirish.
- Ruxsatsiz forward xabarlarni bloklash.
- Taqiqlangan so‘zlar.
- Flood/spam himoyasi.
- Kirdi/chiqdi servis xabarlarini o‘chirish.
- Salomlashuv va guruh qoidalari.
- 3 ta warn (sozlanadi) dan keyin avtomatik ban.
- Mute, unmute, kick, ban, unban, pin, delete.
- Ishonchli user va ruxsatli domenlar.
- Guruhga xos avtomatik FAQ/filter javoblari.
- Report va adminlar ro‘yxati.
- Guruh statistikasi va moderatsiya loglari.

## Asosiy buyruqlar
- `/settings`, `/help`, `/rules`, `/groupstats`
- `/warn`, `/warnings`, `/clearwarn`
- `/ban`, `/unban`, `/kick`
- `/mute 10m`, `/unmute`
- `/del`, `/pin`, `/unpin`
- `/setwarnlimit 3`, `/setflood 6 8`
- `/setwelcome ...`, `/welcome on|off`, `/setrules ...`
- `/badword add|del|list`
- `/allowdomain`, `/deldomain`, `/domains`
- `/trust`, `/untrust`
- `/filter`, `/stopfilter`, `/filters`
- `/report`, `/admins`, `/id`

## Tezlik
- Guruh sozlamalari 30 soniyalik cache bilan ishlaydi.
- Admin statusi 30 soniyalik cache bilan tekshiriladi.
- Whitelist va auto-reply natijalari cache qilinadi.
- Oddiy user/message statistikasi javobni bloklamasdan fon rejimida yoziladi.

## Kerakli Telegram admin huquqlari
- Xabarlarni o‘chirish.
- Foydalanuvchilarni bloklash/cheklash.
- Xabarlarni pin qilish.

---

## FACTORY_OWNER_BOT_MANAGEMENT_UPGRADE_NOTES

# Factory Owner Bot Management Upgrade

Qo‘shildi: FactoryBot foydalanuvchilari o‘zlari yaratgan botlarni FactoryBot ichidan boshqarishi mumkin.

## Yangi imkoniyatlar

### User / bot egasi uchun
- `📋 Mening botlarim` endi faqat ro‘yxat emas, har bir bot uchun boshqaruv tugmasini chiqaradi.
- Har bir botda:
  - `🔎 Batafsil / boshqarish`
  - `🔄 Qayta ishga tushirish`
  - `🔐 API token almashtirish`
  - `👨‍💻 Admin ID almashtirish`
  - `🗑 Botni o‘chirish`
  - `☎️ Asosiy admin bilan kelishish`

### Asosiy admin / owner uchun
- `🔍 Bot qidirish`, `📋 Barcha botlar`, pending/expired/detail oynalarida ham boshqaruv tugmalari kengaytirildi.
- Owner istalgan mijoz botida:
  - 1 oyga uzaytiradi
  - to‘xtatadi
  - qayta ishga tushiradi
  - API token almashtiradi
  - admin IDlarni almashtiradi
  - botni butunlay o‘chiradi

## Texnik ishlash tartibi

### API token almashtirish
- Token BotFather token formatida tekshiriladi.
- Telegram `getMe()` orqali haqiqiy bot ekanligi tekshiriladi.
- Token boshqa aktiv/pending/disabled/expired factory botga ulangan bo‘lsa, qabul qilinmaydi.
- Eski webhook tozalanadi.
- Token MongoDB’da AES-256-GCM bilan qayta shifrlanadi.
- Bot approved + enabled bo‘lsa, yangi token bilan avtomatik qayta ishga tushadi.

### Admin ID almashtirish
- Yangi admin IDlar vergul bilan qabul qilinadi.
- Bot egasi ID avtomatik adminlar ichiga qo‘shiladi.
- Bot aktiv bo‘lsa, adminlar yangilangandan keyin runtime qayta ishga tushiriladi.

### Botni o‘chirish
- Ikki bosqichli tasdiqlash qo‘shildi.
- Runtime to‘xtatiladi.
- Webhook tozalanadi.
- Factory DB’dan bot yozuvi va shu `bot_key`ga tegishli userlar, obunalar, kontent, statistika, arizalar, konkurslar, group/chat learning/video downloader ma’lumotlari o‘chiriladi.
- Telegram token BotFather’dan avtomatik revoke qilinmaydi; xavfsizlik uchun tokenni BotFather’dan qo‘lda revoke/delete qilish kerak.

## Tekshiruv

`npm run check` bajarildi va barcha server fayllari sintaksisdan o‘tdi.

---

## FACTORY_QORIQCHI_GROUP_GROWTH_UPGRADE_NOTES

# Factory Qo‘riqchi / Guruh Manager kengaytmasi

Ushbu versiyada Factory platformaga qo‘riqchi/guruh manager botlari uchun quyidagilar qo‘shildi:

- Majburiy kanal/guruh obunasi: `/set @kanal`, `/unlink`.
- Majburiy odam qo‘shish tizimi: `/add 10`, `/add off`, `/textforce`, `/text_time`.
- Odam qo‘shganlarni hisoblash: `/mymembers`, `/yourmembers`, `/top`, `/delson`, `/clean`.
- Imtiyoz va balans boshqaruvi: `/priv`, `/deforce`, `/plus`.
- Dirty/badword cheklovi: `/dirty`.
- Guruhlar uchun slash-command tavsiyalari: `/` yozilganda bot buyruqlari Telegram menyusida chiqadi.
- `qoriqchi` nomli yangi bot turi qo‘shildi: Qo‘riqchi + Aʼzo Yig‘uvchi Bot.

Bot faqat guruh/superguruhda ishlaydi. To‘liq ishlashi uchun botga quyidagi admin huquqlari kerak:

- xabarlarni o‘chirish;
- userlarni cheklash/ban qilish;
- pin qilish;
- aʼzolarni ko‘rish.

---

## FACTORY_TRIAL_STANDARD_PLUS_GLOBAL_SUB_NOTES

# Factory SaaS upgrade notes

- Yangi botlar endi 3 kun bepul sinov bilan avtomatik `approved + enabled` bo'ladi.
- Sinov tugaganda bot `expired` bo'ladi, admin `1 oyga uzaytirish` orqali tiklaydi.
- Tariflar qo'shildi: `standard` va `plus`.
- Standard tarifdagi yaratilgan botlarning foydalanuvchilarga yuborgan xabarlari ostida quruvchi bot marketing matni qo'shiladi.
- Plus tarifda marketing/watermark qo'shilmaydi.
- Global majburiy obuna yaratilgan botlarning adminlariga ham chiqadi; faqat asosiy Factory adminlari bypass qilinadi.
- Global obuna tekshiruvi FactoryBot tokeni orqali bajariladi, shuning uchun faqat FactoryBot kanal/guruhda admin bo'lishi yetarli.

Optional ENV:
- FACTORY_TRIAL_DAYS=3
- BUILDER_BOT_USERNAME=@quruvchiuzbot
- STANDARD_WATERMARK_TEXT=...
- FACTORY_PLUS_PRICE_MULTIPLIER=2
- FACTORY_PLUS_MONTHLY_PRICE=...

---

## FACTORY_ULTRA_UPGRADE_NOTES

# Factory Ultra Upgrade

Faqat `bots/factory/server.js` va `bots/factory/bots.config.js` o‘zgardi. GiftGo / Course / Social botlariga tegilmagan.
Yangi env o‘zgaruvchi kerak emas. MongoDB’dagi eski ma’lumotlar o‘z holicha ishlaydi (yangi maydonlar ixtiyoriy).

## Tuzatilgan eski xatolar

- **Video Downloader hech qanday linkni tanimas edi.** Fayl boshidagi `const URL = ...` global `URL` klassini to‘sib qo‘ygani uchun `new URL(link)` doim xato berib, har bir link “noto‘g‘ri” deb rad etilardi. Endi `NodeURL` ishlatiladi (yt-dlp’ni avtomatik yuklab olishdagi redirect ham shu sabab buzilgan edi).
- **Guruhga kim qancha odam qo‘shgani saqlanmas edi.** `saveGroupMember` bir vaqtda `$set.status` va `$setOnInsert.status` yozgani uchun MongoDB “conflict” xatosi berardi. Natijada Qo‘riqchi/Group Manager’dagi majburiy odam qo‘shish (`/add`), `/mymembers`, `/top` hisoblari yangilanmasdi. Tuzatildi.
- KinoBot ichida konkurs botidan tasodifan ko‘chib qolgan “📍 Manba statistikasi” handleri olib tashlandi (u `latestGiveaway is not defined` xatosini berardi).

## 🎬 Kontent botlar (Kino, Multfilm, Serial, Dorama, Anime, Turk serial, Kurs, Kitob, Fayl, Music)

- Foydalanuvchi menyusi: **🔥 Top**, **🆕 Yangilari**, **🎲 Tasodifiy**, **⭐ Saqlanganlarim**, **ℹ️ Yordam**.
- Har bir postda tugmalar: **⭐ Saqlash / 💔 olib tashlash**, **↗️ Ulashish**; qismlarda **⬅️ oldingi / keyingi ▶️ qism** va **📋 Barcha qismlar**.
- **Deep link**: `t.me/bot?start=c_<kod>` — kanalga joylangan havola bosilsa, kontent darrov ochiladi. Obuna bo‘lmagan user obunadan keyin avtomatik shu kontentni oladi.
- **Inline qidiruv**: istalgan chatda `@bot avatar` yozib qidirish. BotFather’da `/setinline` yoqilishi kerak.
- Admin: **✏️ Tahrirlash** (`kod | yangi nom | yangi tavsif`), **🔒 Kontent himoyasi** (forward va saqlashni taqiqlash, `protect_content`).
- **Ketma-ket qism yuklash**: 1-qismni saqlagach bot keyingi bo‘sh qism raqamini o‘zi so‘raydi. Videolarni ketma-ket forward qilish kifoya.
- Saqlagandan keyin admin ulashish havolasini oladi. Statistikaga 24 soatlik yangi/faol userlar va saqlanganlar soni qo‘shildi.

## 💎 VIP Obuna Bot

- **Bir nechta tarif**: `Nomi | kun | narx` (masalan, Haftalik / Oylik / 3 oylik).
- User chek (skrinshot) yuboradi, chek adminga rasm ko‘rinishida **✅ Tasdiqlash / ❌ Rad etish** tugmalari bilan boradi.
- **👤 Mening obunam**: holat, tugash sanasi, qolgan kunlar.
- **Eslatma** muddat tugashidan 3 kun va 1 kun oldin keladi, ichida **🔄 Uzaytirish** tugmasi bor.
- Uzaytirishda qolgan kunlar ustiga qo‘shiladi. User kanalda bo‘lsa, yangi link yaratilmaydi.
- Admin: **⏰ Tugayotganlar** (7 kun), **➕ Qo‘lda VIP berish** (`user_id | kun`), **➖ VIPdan chiqarish**.
- Statistikada konversiya foizi va muddati tugaganlar soni bor.

## 📢 Kanal Ariza / Reklama Buyurtma

- User menyusi: **📝 Ariza yuborish**, **📂 Mening arizalarim** (holat va admin izohi), **☎️ Admin bilan aloqa**.
- Har bir arizada admin uchun tugmalar: **✅ Tasdiqlash**, **❌ Rad etish**, **💰 To‘landi**, **✉️ Javob yozish**. Javob matn, rasm yoki fayl ko‘rinishida bot orqali userga boradi.
- Rasm, fayl va lokatsiya javoblar adminga media ko‘rinishida yuboriladi.
- **🆕 Yangi arizalar**, **🔎 Shifr bo‘yicha qidirish**, **⚡ Autopost hozir yuborish**. Statistika holatlar bo‘yicha.

## 🧠 Suhbatchi

- Matn bilan birga **stiker, rasm, gif, ovozli xabar va video** bilan javob berishni ham o‘rganadi.
- O‘zbekcha qo‘shimchalarni tushunadi (dars ≈ darslar ≈ darsimiz).
- Yangi buyruqlar:
  - `/teach savol | javob` — qo‘lda o‘rgatish;
  - `/forget` — botning noto‘g‘ri javobiga reply qilinadi;
  - `/learned` — TOP-15 ro‘yxat;
  - `/setscore 0.45` — moslik aniqligi;
  - `/chance 70` — javob berish ehtimoli;
  - `/mention_on`, `/mention_off`.
- Botning o‘z xabariga berilgan reply o‘rganilmaydi (aylanma o‘rganish bo‘lmaydi).

## 📥 Video Downloader

- Platformalar: YouTube, Instagram, TikTok, **Facebook, X (Twitter), Pinterest, Threads, Snapchat, Likee, VK, Vimeo, Reddit, Dailymotion**.
- Link matn ichida bo‘lsa ham topiladi. Guruhda faqat link bor xabarga javob beradi.
- Format menyusi video muqovasi va ko‘rishlar soni bilan chiqadi.
- **⚡ Kesh**: bir xil link va format qayta so‘ralsa, Telegram `file_id` orqali soniyalar ichida yuboriladi (qayta yuklanmaydi).
- Admin: **⚙️ Kunlik limit** (har bir user uchun 24 soatda N ta), **🗑 Keshni tozalash**. Statistika platformalar va kesh bo‘yicha.

## 🛡 Guruh botlari (Group Manager, Qo‘riqchi, Tozalovchi, FAQ)

- **🤖 Captcha**: yangi a’zo “✅ Men odamman” tugmasini bosmaguncha yoza olmaydi. Vaqt tugasa guruhdan chiqariladi. Buyruq: `/captcha on|off|120`.
- **🚷 Anti-bot**: admin bo‘lmagan user qo‘shgan botlar avtomatik chiqariladi (standart: yoqilgan).
- **📢 Anti-kanal**: kanal nomidan yozilgan xabarlar o‘chiriladi va kanal bloklanadi.
- **🌙 Tungi rejim**: `/night 23-7` (Toshkent vaqti). Shu oraliqda faqat adminlar yozadi.
- Hammasi `/settings` panelidan tugma bilan yoqiladi yoki o‘chiriladi.

## 🎮 Konkurs

Bu engine allaqachon eng boy engine edi (referal, TOP-10, captcha, manba statistikasi, countdown, uch xil g‘olib tanlash rejimi), shuning uchun o‘zgartirilmadi.

## Tekshiruv

- In-memory MongoDB va soxta Telegram API bilan 90 ta avtomatik tekshiruv o‘tdi. Barcha 20 bot turi yaratiladi va `/start`ga javob beradi.
- Factory server to‘liq ishga tushdi: `/` 200, `/status` 200, noto‘g‘ri secret bilan webhook 403.

---

## FACTORY_VIDEO_DOWNLOADER_UPGRADE_NOTES

# Factory Video Downloader Bot qo‘shildi

Qo‘shilgan yangi bot turi:

- `video_downloader` — **Video Downloader Bot**
- Factory menyusida: `📥 Video yuklovchi • Yuklovchi`
- Qo‘llab-quvvatlanadigan platformalar: YouTube, Instagram, TikTok public linklari

## User funksiyalari

1. User botga YouTube / Instagram / TikTok public link yuboradi.
2. Bot video ma’lumotini tekshiradi.
3. Format tanlash chiqadi:
   - 360p
   - 480p
   - 720p
   - 1080p
   - Eng yaxshi
   - Audio
   - MP3
4. Bot faylni Telegramga video/audio/document sifatida yuboradi.

## Admin funksiyalari

- Majburiy kanal/guruh obunasi umumiy tizim bilan ishlaydi.
- Broadcast ishlaydi.
- Statistika:
  - userlar
  - muvaffaqiyatli yuklashlar
  - xatolar
  - video/audio soni
- Vaqtinchalik eski download papkalarini tozalash tugmasi qo‘shildi.

## Texnik ishlash

Bot `yt-dlp` orqali public videolarni yuklaydi. Kod avval quyidagilarni tekshiradi:

1. `YTDLP_PATH` env qiymati
2. local temporary binary
3. serverdagi `yt-dlp`
4. `python3 -m yt_dlp`
5. `python -m yt_dlp`
6. Hech biri topilmasa, `ALLOW_YTDLP_DOWNLOAD=true` bo‘lsa yt-dlp standalone binary avtomatik yuklab olinadi.

MP3 konvertatsiya serverda `ffmpeg` bo‘lsa ishlaydi. Agar ffmpeg bo‘lmasa, MP3 tugmasida original audio stream yuboriladi.

## Muhim env sozlamalari

```env
VIDEO_DOWNLOADER_MONTHLY_PRICE=100000
VIDEO_DL_MAX_MB=49
VIDEO_DL_TIMEOUT_MS=480000
YTDLP_PATH=
FFMPEG_PATH=ffmpeg
ALLOW_YTDLP_DOWNLOAD=true
```

## Muhim cheklovlar

- Private/restricted/cookie talab qiladigan videolar yuklanmaydi.
- DRM yoki himoyalangan kontentni aylanib o‘tish qo‘shilmagan.
- Telegram bot fayl limiti sabab juda katta videolarda pastroq format tanlash kerak.
- Botdan faqat o‘zingizga tegishli yoki yuklab olishga ruxsat berilgan public kontentlar uchun foydalanish tavsiya qilinadi.
