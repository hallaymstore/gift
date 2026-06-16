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
