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
