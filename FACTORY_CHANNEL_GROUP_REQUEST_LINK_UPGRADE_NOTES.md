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
