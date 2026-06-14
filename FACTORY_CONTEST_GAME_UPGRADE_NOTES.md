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
