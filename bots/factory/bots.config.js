'use strict';

/**
 * BotFactory MultiBot sozlamalari.
 *
 * staticBots — o'zingizning doimiy botlaringiz. Tokenlar .env ichida turadi.
 * typePresets — mijozlar BotFactory orqali tanlaydigan bot turlari.
 *
 * Hamma tur bir xil universal struktura bilan ishlaydi:
 * - qismsiz kontent: kod/nom yozilsa post darrov yuboriladi
 * - qismli kontent: kod/nom yozilsa 3 tadan inline qismlar chiqadi
 */

const typePresets = {
  kino: {
    key: 'kino',
    title: 'KinoBot',
    item: 'kino',
    itemTitle: 'Kino',
    itemPlural: 'kinolar',
    itemPluralTitle: 'Kinolar',
    mainEmoji: '🎬',
    addEmoji: '🎥',
    listEmoji: '🎞',
    codeExamples: 'avatar, avatar_1, kino7',
    welcomeLine: 'Kino nomi yoki kodini yuboring.'
  },
  multfilm: {
    key: 'multfilm',
    title: 'MultfilmBot',
    item: 'multfilm',
    itemTitle: 'Multfilm',
    itemPlural: 'multfilmlar',
    itemPluralTitle: 'Multfilmlar',
    mainEmoji: '🧸',
    addEmoji: '🎥',
    listEmoji: '🎞',
    codeExamples: 'tom_jerry, multfilm7, shrek',
    welcomeLine: 'Multfilm nomi yoki kodini yuboring.'
  },
  serial: {
    key: 'serial',
    title: 'SerialBot',
    item: 'serial',
    itemTitle: 'Serial',
    itemPlural: 'seriallar',
    itemPluralTitle: 'Seriallar',
    mainEmoji: '📺',
    addEmoji: '➕',
    listEmoji: '📚',
    codeExamples: 'poytaxt, poytaxt_uz, kocha',
    welcomeLine: 'Serial nomi yoki kodini yuboring.'
  },
  dorama: {
    key: 'dorama',
    title: 'DoramaBot',
    item: 'dorama',
    itemTitle: 'Dorama',
    itemPlural: 'doramalar',
    itemPluralTitle: 'Doramalar',
    mainEmoji: '🎭',
    addEmoji: '➕',
    listEmoji: '📚',
    codeExamples: 'queen_of_tears, dorama1, goblin',
    welcomeLine: 'Dorama nomi yoki kodini yuboring.'
  },
  anime: {
    key: 'anime',
    title: 'AnimeBot',
    item: 'anime',
    itemTitle: 'Anime',
    itemPlural: 'animelar',
    itemPluralTitle: 'Animelar',
    mainEmoji: '🌸',
    addEmoji: '➕',
    listEmoji: '📚',
    codeExamples: 'naruto, one_piece, anime7',
    welcomeLine: 'Anime nomi yoki kodini yuboring.'
  },
  turkserial: {
    key: 'turkserial',
    title: 'TurkSerialBot',
    item: 'turk serial',
    itemTitle: 'Turk serial',
    itemPlural: 'turk seriallar',
    itemPluralTitle: 'Turk seriallar',
    mainEmoji: '🇹🇷',
    addEmoji: '➕',
    listEmoji: '📚',
    codeExamples: 'osman, yargi, turk1',
    welcomeLine: 'Turk serial nomi yoki kodini yuboring.'
  },
  kurs: {
    key: 'kurs',
    title: 'KursBot',
    item: 'kurs',
    itemTitle: 'Kurs',
    itemPlural: 'kurslar',
    itemPluralTitle: 'Kurslar',
    mainEmoji: '🎓',
    addEmoji: '➕',
    listEmoji: '📚',
    codeExamples: 'smm, frontend, nodejs',
    welcomeLine: 'Kurs nomi yoki kodini yuboring.'
  },
  kitob: {
    key: 'kitob',
    title: 'KitobBot',
    item: 'kitob',
    itemTitle: 'Kitob',
    itemPlural: 'kitoblar',
    itemPluralTitle: 'Kitoblar',
    mainEmoji: '📚',
    addEmoji: '➕',
    listEmoji: '📖',
    codeExamples: 'python, biznes, kitob7',
    welcomeLine: 'Kitob nomi yoki kodini yuboring.'
  },
  fayl: {
    key: 'fayl',
    title: 'FaylBot',
    item: 'fayl',
    itemTitle: 'Fayl',
    itemPlural: 'fayllar',
    itemPluralTitle: 'Fayllar',
    mainEmoji: '📦',
    addEmoji: '➕',
    listEmoji: '🗂',
    codeExamples: 'apk1, zip7, file2026',
    welcomeLine: 'Fayl nomi yoki kodini yuboring.'
  },
  music: {
    key: 'music',
    title: 'MusicBot',
    item: 'musiqa',
    itemTitle: 'Musiqa',
    itemPlural: 'musiqalar',
    itemPluralTitle: 'Musiqalar',
    mainEmoji: '🎵',
    addEmoji: '➕',
    listEmoji: '🎧',
    codeExamples: 'hit2026, remix, music7',
    welcomeLine: 'Musiqa nomi yoki kodini yuboring.'
  }
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
