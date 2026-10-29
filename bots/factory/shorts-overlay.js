'use strict';

// Raster graphics avoid FFmpeg's optional drawtext filter entirely.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function overlaySvg(username, code, label = 'KINO') {
  const botText = '@' + String(username || '').replace(/^@/, '');
  const codeText = String(label || 'KINO').toUpperCase() + ' KODI: ' + String(code || '');
  const botSize = Math.min(57, Math.max(23, Math.floor(645 / Math.max(7, botText.length * 0.61))));
  const codeSize = Math.min(64, Math.max(22, Math.floor(630 / Math.max(7, codeText.length * 0.60))));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">',
    '<defs><linearGradient id="top" x1="0" x2="1" y1="0" y2="0"><stop stop-color="#0B0E15"/><stop offset="1" stop-color="#111D29"/></linearGradient>',
    '<linearGradient id="bottom" x1="0" x2="1" y1="0" y2="0"><stop stop-color="#0B0E15"/><stop offset="1" stop-color="#121B24"/></linearGradient></defs>',
    '<rect x="0" y="0" width="720" height="260" fill="url(#top)"/>',
    '<rect x="0" y="1020" width="720" height="260" fill="url(#bottom)"/>',
    '<rect x="248" y="48" width="224" height="5" rx="2.5" fill="#27DBE9"/>',
    '<g font-family="DejaVu Sans, sans-serif" text-anchor="middle">',
    '<text x="360" y="107" font-size="29" font-weight="700" letter-spacing="7" fill="#9FCAD0">TELEGRAM</text>',
    '<text x="360" y="187" font-size="' + botSize + '" font-weight="900" fill="#FFFFFF">' + escapeXml(botText) + '</text>',
    '<text x="360" y="1099" font-size="26" font-weight="700" letter-spacing="3" fill="#9FCAD0">BOTDAN TOPING</text>',
    '<text x="360" y="1183" font-size="' + codeSize + '" font-weight="900" fill="#FFD74F">' + escapeXml(codeText) + '</text>',
    '<text x="360" y="1238" font-size="22" fill="#C5CEDB">Kodni Telegram botga yuboring</text>',
    '</g><rect x="0" y="258" width="720" height="3" fill="#1FCDD8"/>',
    '<rect x="0" y="1018" width="720" height="3" fill="#1FCDD8"/></svg>'
  ].join('');
}

async function createOverlayPng({ directory, username, code, label }) {
  if (!directory) throw new Error('Vaqtinchalik video papkasi topilmadi.');
  const target = path.join(directory, 'overlay.png');
  await sharp(Buffer.from(overlaySvg(username, code, label)), { density: 72 })
    .resize(360, 640, { kernel: 'lanczos2' })
    .png({ compressionLevel: 4 })
    .toFile(target);
  const { size } = await fs.promises.stat(target);
  if (size < 1024) throw new Error('Shorts overlay rasmini yaratib bo‘lmadi.');
  return target;
}

module.exports = { overlaySvg, createOverlayPng, escapeXml };
