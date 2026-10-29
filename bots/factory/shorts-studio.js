'use strict';

// Admin-only short-video editor for the Factory's content bots.
// Video comes from the admin as a small Telegram upload/forward, not a full movie.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { createOverlayPng } = require('./shorts-overlay');

const INPUT_LIMIT = 19 * 1024 * 1024; // Telegram cloud Bot API download limit: approx. 20 MB.
const OUTPUT_LIMIT = 48 * 1024 * 1024; // Cloud Bot API sendVideo limit: approx. 50 MB.
const EDIT_SECONDS = 30;
let renderInProgress = false;

function ffmpegBinary() {
  try {
    const binary = require('ffmpeg-static');
    if (binary && fs.existsSync(binary)) return binary;
  } catch (_) {}
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function chooseSegment(duration, maxLength = EDIT_SECONDS, random = Math.random) {
  const length = Math.max(1, Math.min(60, Math.floor(Number(maxLength) || EDIT_SECONDS)));
  const sourceDuration = Number(duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= length) return { start: 0, seconds: length };
  const latest = Math.max(0, sourceDuration - length);
  return { start: Math.floor(random() * (latest + 1)), seconds: length };
}

function safeCode(code) {
  const value = String(code || '').trim();
  return /^[a-zA-Z0-9_-]{1,32}$/.test(value) ? value : '';
}

function safeVideoLabel(label) {
  const allowed = new Set(['KINO', 'MULTFILM', 'SERIAL', 'DORAMA', 'ANIME', 'TURK SERIAL', 'KURS', 'KITOB', 'FAYL', 'MUSIQA']);
  const value = String(label || 'KINO').trim().toUpperCase();
  return allowed.has(value) ? value : 'KINO';
}

function safeUsername(username) {
  const value = String(username || '').trim().replace(/^@/, '');
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value) ? value : '';
}

function filterGraph() {
  // No drawtext: overlay is a transparent PNG created by sharp.
  return [
    '[0:v:0]scale=720:760:force_original_aspect_ratio=decrease',
    'pad=720:1280:(ow-iw)/2:(oh-ih)/2:black',
    'setsar=1',
    'format=yuv420p[base];[base][1:v:0]overlay=0:0:shortest=1',
    'format=yuv420p[v]'
  ].join(',');
}

function ffmpegArgs({ input, overlay, output, start = 0, seconds = EDIT_SECONDS }) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, Number(start) || 0)),
    '-i', input,
    '-loop', '1', '-framerate', '24', '-i', overlay,
    '-t', String(Math.max(1, Math.min(60, Number(seconds) || EDIT_SECONDS))),
    '-filter_complex', filterGraph(),
    '-map', '[v]', '-map', '0:a:0?',
    '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-max_muxing_queue_size', '1024', '-movflags', '+faststart', output
  ];
}

function downloadTelegramMedia(fileUrl, outputFile, maxBytes = INPUT_LIMIT) {
  const url = fileUrl instanceof URL ? fileUrl : new URL(String(fileUrl));
  if (url.protocol !== 'https:' || !['api.telegram.org'].includes(url.hostname.toLowerCase())) {
    return Promise.reject(new Error('Telegram fayl URL manzili tekshiruvdan o‘tmadi.'));
  }
  return new Promise((resolve, reject) => {
    const destination = fs.createWriteStream(outputFile, { flags: 'wx' });
    let finished = false;
    let bytes = 0;
    let request;
    function fail(error) {
      if (finished) return;
      finished = true;
      destination.destroy();
      if (request) request.destroy();
      fs.rm(outputFile, { force: true }, () => reject(error));
    }
    request = https.get(url, { timeout: 60000 }, (response) => {
      if (response.statusCode !== 200) return fail(new Error('Telegram video faylini olishda xatolik: HTTP ' + response.statusCode));
      if (Number(response.headers['content-length'] || 0) > maxBytes) return fail(new Error('Video 19 MB dan katta. Uni qisqartirib qayta yuboring.'));
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) return fail(new Error('Video 19 MB chegarasidan oshdi. Video hajmini kichraytiring.'));
      });
      response.on('error', fail);
      response.pipe(destination);
      destination.on('finish', () => {
        if (finished) return;
        finished = true;
        destination.close();
        resolve(bytes);
      });
    });
    request.on('timeout', () => fail(new Error('Telegramdan video yuklash vaqti tugadi.')));
    request.on('error', fail);
    destination.on('error', fail);
  });
}

function runFfmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Video montaj muddati tugadi. Qisqaroq video yuboring.'));
    }, timeoutMs);
    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    }
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', e => finish(new Error('FFmpeg ishga tushmadi: ' + e.message)));
    child.on('close', code => {
      if (code === 0) finish();
      else finish(new Error('Video montaj xatosi: ' + stderr.slice(-450)));
    });
  });
}

async function makeShorts({ telegram, fileId, size, duration, username, code, label, work }) {
  const actualCode = safeCode(code);
  const actualUsername = safeUsername(username);
  if (!actualCode) throw new Error('Kino kodi yaroqsiz.');
  if (!actualUsername) throw new Error('Bot username topilmadi.');
  if (!fileId) throw new Error('Videoni qayta yuboring.');
  if (Number(size) > INPUT_LIMIT) throw new Error('Bu video 19 MB dan katta. 19 MB gacha qisqa video yuboring.');
  if (renderInProgress) throw new Error('Hozir boshqa video montaj qilinyapti. Keyin qayta urinib ko‘ring.');

  renderInProgress = true;
  let directory = '';
  try {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'factory-shorts-'));
    const input = path.join(directory, 'input.mp4');
    const output = path.join(directory, 'shorts.mp4');
    const overlay = await createOverlayPng({
      directory, username: actualUsername, code: actualCode, label: safeVideoLabel(label)
    });
    const link = await telegram.getFileLink(fileId);
    await downloadTelegramMedia(link, input);
    const segment = chooseSegment(duration, EDIT_SECONDS);
    if (typeof work === 'function') await work('editing', segment);
    await runFfmpeg(ffmpegArgs({ input, overlay, output, start: segment.start, seconds: segment.seconds }));
    const stat = await fs.promises.stat(output);
    if (stat.size < 1024 || stat.size > OUTPUT_LIMIT) {
      throw new Error('Tayyor video hajmi Telegram limitiga mos emas.');
    }
    // Send before deleting our temporary source. No user files kept on server.
    if (typeof work === 'function') await work('ready', { output, size: stat.size, segment });
    return { seconds: segment.seconds, start: segment.start, bytes: stat.size };
  } finally {
    renderInProgress = false;
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  INPUT_LIMIT, EDIT_SECONDS, chooseSegment, safeCode, safeUsername, safeVideoLabel,
  filterGraph, ffmpegArgs, downloadTelegramMedia, makeShorts
};
