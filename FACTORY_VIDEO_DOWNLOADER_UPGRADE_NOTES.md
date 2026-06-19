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
