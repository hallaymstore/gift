# Factory global majburiy obuna tuzatishi

Ushbu versiyada BotFactory admini qo'shgan global majburiy obunalar barcha yaratilgan botlarda ishlaydi.

## Muhim yechim

- Yaratilgan mijoz botlarni kanal/guruhlarga admin qilish shart emas.
- Faqat asosiy FactoryBot o'sha kanal/guruhlarga admin qilinadi.
- Har bir mijoz bot foydalanuvchi obunasini FactoryBot tokeni orqali tekshiradi.
- Global obuna FactoryBotning o'zida ham ishlaydi.

## Admin menyu

FactoryBot admin menyusiga qo'shildi:

- 🌐 Global kanal qoʻshish
- 🌐 Global guruh qoʻshish
- 🌐 Global obunalar
- 🌐 Global obuna oʻchirish

## Qanday qo'shiladi

Public kanal/guruh uchun:

```text
@kanal_username
https://t.me/kanal_username
```

Private kanal/guruh uchun:

```text
-1001234567890
```

Invite link `https://t.me/+...` orqali Telegram getChatMember tekshiruvini bajara olmaydi. Private chatlar uchun `-100...` chat ID kerak.

## Talab

FactoryBot kanal/guruhda admin bo'lishi kerak. Mijozlar yaratgan botlarni u yerlarga qo'shish shart emas.
