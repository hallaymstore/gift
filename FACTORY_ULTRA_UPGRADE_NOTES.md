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
