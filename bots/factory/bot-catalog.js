'use strict';
// 🧭 Bot katalogi: token yuborishdan OLDIN bot maqsadi tanlanadi.
// Kino/Serial/Multfilm/Anime/Turk serial/Dorama — bitta "Media platforma" ichida,
// har bir yo'nalish o'z funksiyalari va default menyusi bilan ajratiladi.

// Default menyu tugma IDlari createContentBot ichidagi USER_BTN kalitlariga mos.
const MEDIA_PURPOSES = {
  kino: {
    emoji: '🎬', title: 'Kino', parts: false,
    menu: [['top', 'fresh'], ['random', 'favs'], ['help']],
    features: ['Kod/nom bo‘yicha tezkor qidiruv', '🔥 Top, 🆕 Yangi, 🎲 Tasodifiy kino', '⭐ Saqlanganlar', 'Deep-link ulashish va inline qidiruv', '🔒 Forwarddan himoya']
  },
  serial: {
    emoji: '📺', title: 'Serial', parts: true,
    menu: [['fresh', 'top'], ['favs', 'random'], ['help']],
    features: ['Qismli kontent: ▶️ keyingi qism tugmasi', 'Ketma-ket qism yuklash (ommaviy)', '🆕 Yangi qismlar birinchi o‘rinda', '⭐ Saqlangan seriallar', 'Kanal postlaridan avto-import']
  },
  turkserial: {
    emoji: '🇹🇷', title: 'Turk serial', parts: true,
    menu: [['fresh', 'top'], ['favs', 'random'], ['help']],
    features: ['Ko‘p qismli turk seriallar', '▶️ Keyingi qism', 'Ommaviy qism yuklash', '🆕 Har haftalik yangi qismlar', '⭐ Saqlanganlar']
  },
  dorama: {
    emoji: '🎭', title: 'Dorama', parts: true,
    menu: [['fresh', 'top'], ['favs', 'random'], ['help']],
    features: ['Koreys/Xitoy doramalari qismlari bilan', '▶️ Keyingi qism', 'Ommaviy yuklash', '🔥 Top doramalar', '⭐ Saqlanganlar']
  },
  anime: {
    emoji: '🌸', title: 'Anime', parts: true,
    menu: [['fresh', 'top'], ['random', 'favs'], ['help']],
    features: ['Sezon/qism bo‘yicha anime', '▶️ Keyingi qism', 'Ongoing animelar uchun 🆕 Yangilari', '🎲 Tasodifiy anime', '⭐ Saqlanganlar']
  },
  multfilm: {
    emoji: '🧸', title: 'Multfilm', parts: false,
    menu: [['top', 'random'], ['fresh', 'favs'], ['help']],
    features: ['Bolalar uchun multfilmlar', '🎲 Tasodifiy multfilm (bolalar uchun qulay)', '🔥 Top multfilmlar', '⭐ Saqlanganlar', '🔒 Forwarddan himoya']
  }
};

const LIBRARY_PURPOSES = ['kurs', 'kitob', 'fayl', 'music'];

const CATEGORIES = [
  { key: 'media', emoji: '🎬', title: 'Media platforma', hint: 'Kino • Serial • Anime • Dorama • Turk serial • Multfilm', purposes: Object.keys(MEDIA_PURPOSES) },
  { key: 'library', emoji: '📚', title: 'Kontent kutubxona', hint: 'Kurs • Kitob • Fayl • Musiqa', purposes: LIBRARY_PURPOSES },
  { key: 'channel', emoji: '📢', title: 'Kanal egalari uchun', hint: 'Kloner • VIP • Ariza • Reklama • Konkurs • Yuklovchi', purposes: ['channel_clone', 'vip_obuna', 'kanal_ariza', 'reklama_buyurtma', 'konkurs', 'video_downloader'] },
  { key: 'group', emoji: '👥', title: 'Guruh egalari uchun', hint: 'Menejer • Qo‘riqchi • Tozalovchi • FAQ • Suhbatchi • E’lon', purposes: ['group_manager', 'qoriqchi', 'group_cleaner', 'faq_support', 'suhbatchi', 'group_announcements'] },
  { key: 'fun', emoji: '🎮', title: 'O‘yin botlari', hint: 'Mini Games', purposes: ['mini_games'], ownerOnly: true }
];

function getCategory(key) {
  return CATEGORIES.find((c) => c.key === key) || null;
}

function categoryForType(typeKey) {
  return CATEGORIES.find((c) => c.purposes.includes(typeKey)) || null;
}

// presets — TYPE_PRESETS; faqat mavjud turlar ko'rsatiladi.
function availablePurposes(categoryKey, presets) {
  const cat = getCategory(categoryKey);
  if (!cat) return [];
  return cat.purposes.filter((k) => presets && presets[k] && presets[k].title);
}

function visibleCategories(presets, { isOwner = false } = {}) {
  return CATEGORIES.filter((c) => (!c.ownerOnly || isOwner) && availablePurposes(c.key, presets).length);
}

function purposeLabel(typeKey, preset = {}) {
  const media = MEDIA_PURPOSES[typeKey];
  if (media) return `${media.emoji} ${media.title}`;
  return `${preset.mainEmoji || '🤖'} ${preset.itemTitle || preset.title || typeKey}`;
}

function purposeDetails(typeKey, preset = {}) {
  const media = MEDIA_PURPOSES[typeKey];
  const lines = [`${purposeLabel(typeKey, preset)} yo‘nalishi tanlandi.`];
  if (media) {
    lines.push('', `📦 Format: ${media.parts ? 'qismli (sezon/qism)' : 'qismsiz (bitta video)'}`, '✨ Shu yo‘nalish uchun ajratilgan funksiyalar:');
    for (const f of media.features) lines.push(`• ${f}`);
  } else if (preset.description) {
    lines.push('', `📋 Imkoniyatlar: ${preset.description}`);
  }
  return lines.join('\n');
}

// Yo'nalishga mos default foydalanuvchi menyusi (USER_BTN kalitlari).
function defaultUserMenu(typeKey) {
  const media = MEDIA_PURPOSES[typeKey];
  return (media ? media.menu : [['top', 'fresh'], ['random', 'favs'], ['help']]).map((row) => row.slice());
}

function isPartsPurpose(typeKey) {
  return Boolean(MEDIA_PURPOSES[typeKey]?.parts);
}

module.exports = {
  MEDIA_PURPOSES,
  CATEGORIES,
  getCategory,
  categoryForType,
  availablePurposes,
  visibleCategories,
  purposeLabel,
  purposeDetails,
  defaultUserMenu,
  isPartsPurpose
};
