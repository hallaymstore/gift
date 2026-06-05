# BotFactory umumiy eʼlon tuzatishlari

Ushbu versiyada BotFactory adminining `📣 Umumiy eʼlon` funksiyasi qayta ishlangan.

## Tuzatilgan muammo
Oldingi versiyada FactoryBot chatidagi xabar boshqa mijoz botlari orqali `copyMessage` bilan yuborilayotgan edi. Telegram Bot API bo‘yicha boshqa bot FactoryBotning private chatidagi xabarni ko‘ra olmaydi, shuning uchun umumiy eʼlon xatolik berishi yoki yuborilmasligi mumkin edi.

## Yangi yechim
- FactoryBot foydalanuvchilariga xabar FactoryBotning o‘zi orqali yuboriladi.
- Mijozlar yaratgan aktiv botlarning foydalanuvchilariga xabar o‘sha mijoz botlari nomidan yuboriladi.
- Matn, rasm, video, animation/gif, document, audio, voice, sticker va forward qilingan media xabarlar qo‘llab-quvvatlanadi.
- Media xabarlar uchun FactoryBot vaqtinchalik file link oladi va boshqa botlar shu link orqali foydalanuvchiga yuboradi.
- Broadcastdan oldin tasdiqlangan, lekin runtime’da hali turmagan managed botlar avtomatik ishga tushirishga harakat qiladi.
- Bot bloklangan yoki chat topilmagan foydalanuvchilar `is_blocked=true` sifatida belgilanadi.
- Yakunda botlar bo‘yicha alohida statistika chiqadi.

## Eslatma
Katta auditoriyaga media broadcast yuborilganda Telegram limitlari sabab yuborish sekinroq bo‘lishi normal. Bu atayin qilingan: botlar spam-limitga tushib qolmasligi uchun yuborishlar orasida kichik kutish bor.
