'use strict';

// FactoryBot media postlaridagi boshqa BOT username/linklarini
// faqat ruxsat etilgan boshqariladigan botlar uchun yangilaydi.
function configuredBots() {
  return new Set(String(process.env.FACTORY_AUTO_BRAND_BOTS || 'y808bot')
    .split(',')
    .map((name) => name.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean));
}

function shouldAutoBrand(username) {
  return configuredBots().has(String(username || '').trim().replace(/^@/, '').toLowerCase());
}

function normalizedCode(value) {
  const code = String(value || '').trim();
  return /^[a-z0-9_-]{1,32}$/i.test(code) ? code : '';
}

function isBotHandle(name, sourceText, index) {
  if (/bot$/i.test(name)) return true;
  const line = sourceText.slice(Math.max(0, index - 70), index).split('\n').pop();
  return /(?:botimiz|botim|kinobot|kino bot|film bot|bot)\s*[:：\-–]?\s*$/i.test(line);
}

function rewriteBotLink(raw, target, code) {
  return String(raw || '').replace(
    /((?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([A-Za-z][A-Za-z0-9_]{4,31})(?:\?start=[A-Za-z0-9_-]+)?/gi,
    (full, prefix, handle, offset, input) => {
      if (handle.toLowerCase() === target.toLowerCase() || !isBotHandle(handle, input, offset)) return full;
      return prefix + target + (code ? '?start=c_' + code : '');
    }
  );
}

function brandText(source, originalEntities, targetUsername, contentCode) {
  const text = String(source || '');
  const username = String(targetUsername || '').trim().replace(/^@/, '');
  const entities = Array.isArray(originalEntities) ? originalEntities : [];
  if (!shouldAutoBrand(username) || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
    return { text, entities, changed: false };
  }

  const code = normalizedCode(contentCode);
  const edits = [];
  const urls = /((?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([A-Za-z][A-Za-z0-9_]{4,31})(?:\?start=[A-Za-z0-9_-]+)?/gi;
  for (const match of text.matchAll(urls)) {
    const handle = match[2];
    if (handle.toLowerCase() === username.toLowerCase() || !isBotHandle(handle, text, match.index)) continue;
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[1] + username + (code ? '?start=c_' + code : '')
    });
  }

  const mentions = /@([A-Za-z][A-Za-z0-9_]{4,31})\b/g;
  for (const match of text.matchAll(mentions)) {
    const handle = match[1];
    if (handle.toLowerCase() === username.toLowerCase() || !isBotHandle(handle, text, match.index)) continue;
    edits.push({ start: match.index, end: match.index + match[0].length, value: '@' + username });
  }

  edits.sort((a, b) => a.start - b.start);
  const disjoint = [];
  for (const edit of edits) {
    if (!disjoint.length || edit.start >= disjoint[disjoint.length - 1].end) disjoint.push(edit);
  }

  let result = '';
  let position = 0;
  for (const edit of disjoint) {
    result += text.slice(position, edit.start) + edit.value;
    position = edit.end;
  }
  result += text.slice(position);

  // Telegram entity offset/length are UTF-16, like JS string indices.
  const mapOffset = (offset, endBoundary) => {
    let shift = 0;
    for (const edit of disjoint) {
      const delta = edit.value.length - (edit.end - edit.start);
      if (offset < edit.start) break;
      if (offset > edit.end || (offset === edit.end && endBoundary)) {
        shift += delta;
        continue;
      }
      if (offset === edit.end) return edit.start + shift + edit.value.length;
      if (offset === edit.start && !endBoundary) return edit.start + shift;
      return edit.start + shift + (endBoundary ? edit.value.length : 0);
    }
    return offset + shift;
  };

  let entityChanged = false;
  const adjusted = entities.map((entity) => {
    const next = { ...entity };
    const start = Number(entity.offset || 0);
    const end = start + Number(entity.length || 0);
    next.offset = mapOffset(start, false);
    next.length = Math.max(0, mapOffset(end, true) - next.offset);
    if (next.type === 'text_link' && next.url) {
      const replacedUrl = rewriteBotLink(next.url, username, code);
      if (replacedUrl !== next.url) {
        next.url = replacedUrl;
        entityChanged = true;
      }
    }
    return next;
  }).filter((entity) => entity.length > 0);

  return { text: result, entities: adjusted, changed: disjoint.length > 0 || entityChanged };
}

module.exports = { shouldAutoBrand, brandText };
