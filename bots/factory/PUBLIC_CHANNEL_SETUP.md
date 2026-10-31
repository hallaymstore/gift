# Begona public kanal postlarini kuzatish (FactoryBot)

Bu modul manba public kanalga botni admin qilmasdan **Telegram foydalanuvchi akkaunt sessiyasi** orqali yangi postlarni olishga xizmat qiladi. Postlarni o'zingizning kanalingizga `@y808bot` kabi Factory kontent boti joylaydi.

## Talablar
- Postni o'z kanalingizda qayta tarqatishga ruxsat bo'lishi kerak. Manba nomi post tavsifida saqlanadi; himoyalangan `noforwards` postlar nusxalanmaydi.
- Post joylash kanalingizda aynan kontent boti admin, **Post Messages** huquqi bilan.
- Manba **ochiq** (`@username`) kanal bo'lishi kerak; u yerda admin bo'lish shart emas.
- Avtomat kuzatuv uchun alohida Telegram foydalanuvchi akkaunti sessiyasi zarur. Oddiy Bot API yetarli emas.

## Sessiyani o'z kompyuteringizda yaratish

1. https://my.telegram.org/apps manzilidan `api_id` va `api_hash` oling.
2. Loyihani lokal kompyuterga clone qiling va `npm install` bajaring (yoki `cd bots/factory && npm install`).
3. **Windows PowerShell** misol:

```powershell
$env:TELEGRAM_API_ID="YOUR_API_ID"
$env:TELEGRAM_API_HASH="YOUR_API_HASH"
node bots/factory/telegram-login.js
```

4. Telegram login uchun telefon raqami, kod va (agar bo'lsa) 2FA parolni **faqat o'z kompyuteringizdagi terminalga** kiriting.
5. Konsol bergan `TELEGRAM_STRING_SESSION` qiymatini boshqalarga yubormang, GitHubga commit qilmang. Bu **to'liq Telegram akkaunt login kaliti** hisoblanadi.
6. Render `gift` servisining **Environment** bo'limiga uchta secret qo'ying: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_STRING_SESSION`. Deploy qayta ishga tushadi.
7. Kino bot admin menyusi → `📣 Kanal postlari` → `📢 Joylash kanalini ulash` → `📡 Manba kanalni kuzatish` → `@Kino_Trenduzz`.

## Cheklovlar
- Endi yangi manba ulanganda **eski postlar ham** sinxronlash navbatiga tushadi: oldindan yangi postlar uchun baseline yoziladi, tarixiy postlar esa eng eskisidan boshlab yuboriladi. Eski konfiguratsiyalar uchun admin menyusida **📚 Eski postlarni sinxronlash** tugmasini bir marta bosish kerak.
- Yangi postlar har **12 soniyada** tekshiriladi; oldingi cursor'dan boshlab 20 tagacha yangi post qatorma-qator olinadi. Eski postlar har **20 soniyada 3 tagacha** olinadi; juda katta arxivni to'liq ko'chirish ancha vaqt oladi. Postlar chegaralar va Telegram/Render imkoniyatlariga qarab o‘tkazilishi mumkin.
- Hozircha bitta videoning/media-faylning hajmi 18 MB dan oshmasligi lozim; muqova, video, oddiy hujjat va text asosiy turlardir. Albomlar bitta butun post bo'lib birlashtirilmaydi.
- Himoyalangan kontentni aylanib o'tmaydi. Telegram yoki MTProto cheklovlari sabab xabarni yuborib bo'lmasa, logda xato qoladi. **📋 Postlash holati** orqali arxivda joylangan va o‘tkazilgan postlar sanog‘i hamda oxirgi xatoni ko‘rish mumkin. **⏸ Tarixni to‘xtatish** eski postlar oqimini pauza qiladi, yangi postlar kuzatuvi davom etadi.
- Foydalanuvchi sessiyasi sozlanmagan holatda **admin kanalga qo'shmasdan avtomatik kuzatuv faol emas**. Lekin `📥 Forward → kanal` orqali qo'lda ko'plab postlar yuborish davom etadi.
- Telegram akkauntingizdan avtomatlashtirish bilan ko'p/tezkor qayta joylash spam cheklovlari yoki akkount risklarini tug'dirishi mumkin. Faqat o'zingiz boshqaradigan yoki qayta tarqatishga ruxsat etilgan manbalarni ishlating.
