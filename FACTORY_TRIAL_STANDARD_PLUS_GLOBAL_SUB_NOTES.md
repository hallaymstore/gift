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
