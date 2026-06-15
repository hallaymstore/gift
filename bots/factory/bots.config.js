'use strict';

/**
 * BotFactory sozlamalari.
 * engine:
 * - content: kino/multfilm/serial/dorama/kurs/fayl kabi qismli/qismsiz kontent bot
 * - vip: vaqtlik invite link beradigan VIP/maxfiy kanal bot
 * - giveaway: konkurs/giveaway bot
 * - channel_form: kanal egasi uchun custom inputli ariza + autopost bot
 * - group_tools: guruh tozalovchi/antispam/FAQ/salomlashuv bot
 */

const typePresets = {
  kino: { engine: 'content', key: 'kino', title: 'KinoBot', item: 'kino', itemTitle: 'Kino', itemPlural: 'kinolar', itemPluralTitle: 'Kinolar', mainEmoji: '🎬', addEmoji: '🎥', listEmoji: '🎞', codeExamples: 'avatar, avatar_1, kino7', welcomeLine: 'Kino nomi yoki kodini yuboring.' },
  multfilm: { engine: 'content', key: 'multfilm', title: 'MultfilmBot', item: 'multfilm', itemTitle: 'Multfilm', itemPlural: 'multfilmlar', itemPluralTitle: 'Multfilmlar', mainEmoji: '🧸', addEmoji: '🎥', listEmoji: '🎞', codeExamples: 'tom_jerry, multfilm7, shrek', welcomeLine: 'Multfilm nomi yoki kodini yuboring.' },
  serial: { engine: 'content', key: 'serial', title: 'SerialBot', item: 'serial', itemTitle: 'Serial', itemPlural: 'seriallar', itemPluralTitle: 'Seriallar', mainEmoji: '📺', addEmoji: '➕', listEmoji: '📚', codeExamples: 'poytaxt, poytaxt_uz, kocha', welcomeLine: 'Serial nomi yoki kodini yuboring.' },
  dorama: { engine: 'content', key: 'dorama', title: 'DoramaBot', item: 'dorama', itemTitle: 'Dorama', itemPlural: 'doramalar', itemPluralTitle: 'Doramalar', mainEmoji: '🎭', addEmoji: '➕', listEmoji: '📚', codeExamples: 'queen_of_tears, dorama1, goblin', welcomeLine: 'Dorama nomi yoki kodini yuboring.' },
  anime: { engine: 'content', key: 'anime', title: 'AnimeBot', item: 'anime', itemTitle: 'Anime', itemPlural: 'animelar', itemPluralTitle: 'Animelar', mainEmoji: '🌸', addEmoji: '➕', listEmoji: '📚', codeExamples: 'naruto, one_piece, anime7', welcomeLine: 'Anime nomi yoki kodini yuboring.' },
  turkserial: { engine: 'content', key: 'turkserial', title: 'TurkSerialBot', item: 'turk serial', itemTitle: 'Turk serial', itemPlural: 'turk seriallar', itemPluralTitle: 'Turk seriallar', mainEmoji: '🇹🇷', addEmoji: '➕', listEmoji: '📚', codeExamples: 'osman, yargi, turk1', welcomeLine: 'Turk serial nomi yoki kodini yuboring.' },
  kurs: { engine: 'content', key: 'kurs', title: 'KursBot', item: 'kurs', itemTitle: 'Kurs', itemPlural: 'kurslar', itemPluralTitle: 'Kurslar', mainEmoji: '🎓', addEmoji: '➕', listEmoji: '📚', codeExamples: 'smm, frontend, nodejs', welcomeLine: 'Kurs nomi yoki kodini yuboring.' },
  kitob: { engine: 'content', key: 'kitob', title: 'KitobBot', item: 'kitob', itemTitle: 'Kitob', itemPlural: 'kitoblar', itemPluralTitle: 'Kitoblar', mainEmoji: '📚', addEmoji: '➕', listEmoji: '📖', codeExamples: 'python, biznes, kitob7', welcomeLine: 'Kitob nomi yoki kodini yuboring.' },
  fayl: { engine: 'content', key: 'fayl', title: 'FaylBot', item: 'fayl', itemTitle: 'Fayl', itemPlural: 'fayllar', itemPluralTitle: 'Fayllar', mainEmoji: '📦', addEmoji: '➕', listEmoji: '🗂', codeExamples: 'apk1, zip7, file2026', welcomeLine: 'Fayl nomi yoki kodini yuboring.' },
  music: { engine: 'content', key: 'music', title: 'MusicBot', item: 'musiqa', itemTitle: 'Musiqa', itemPlural: 'musiqalar', itemPluralTitle: 'Musiqalar', mainEmoji: '🎵', addEmoji: '➕', listEmoji: '🎧', codeExamples: 'hit2026, remix, music7', welcomeLine: 'Musiqa nomi yoki kodini yuboring.' },

  vip_obuna: { engine: 'vip', key: 'vip_obuna', title: 'VIP Obuna Bot', itemTitle: 'VIP obuna', mainEmoji: '💎', description: 'Maxfiy kanal/guruhga vaqtlik invite link, admin tasdiqlash, oylik dostup.' },
  konkurs: { engine: 'giveaway', key: 'konkurs', title: 'Tech Konkurs Game Bot', itemTitle: 'Konkurs', mainEmoji: '🎮', description: 'Homiy kanal/guruh obunasi, guruh ichida inline qatnashish, referral invite link, TOP-10 reyting, countdown va avtomatik natija.' },
  kanal_ariza: { engine: 'channel_form', key: 'kanal_ariza', title: 'Kanal Ariza + Autopost Bot', itemTitle: 'Ariza bot', mainEmoji: '📢', description: 'Kanal egasi uchun custom inputlar, reklama/akkount savdo arizasi, shifrli kalit, autopost.' },
  reklama_buyurtma: { engine: 'channel_form', key: 'reklama_buyurtma', title: 'Reklama Buyurtma Bot', itemTitle: 'Reklama bot', mainEmoji: '📣', description: 'Reklama buyurtmasi, custom maydonlar, admin tasdiqlash va to‘lovga yo‘naltirish.' },
  group_cleaner: { engine: 'group_tools', key: 'group_cleaner', title: 'Guruh Tozalovchi + AntiSpam Bot', itemTitle: 'Guruh bot', mainEmoji: '🛡', description: 'Kirdi/chiqdi tozalash, anti-link, badword, FAQ, salomlashuv.' },
  faq_support: { engine: 'group_tools', key: 'faq_support', title: 'FAQ + Support Guruh Bot', itemTitle: 'FAQ bot', mainEmoji: '❓', description: 'FAQ javoblar, salomlashuv, guruh qoidalari va admin xabarlari.' }
};

module.exports = {
  typePresets,
  staticBots: [
    { ...typePresets.kino, tokenEnv: 'KINOBOT_TOKEN' },
    { ...typePresets.multfilm, tokenEnv: 'MULTFILMBOT_TOKEN' },
    { ...typePresets.serial, tokenEnv: 'SERIALBOT_TOKEN' },
    { ...typePresets.dorama, tokenEnv: 'DORAMABOT_TOKEN' }
  ]
};
