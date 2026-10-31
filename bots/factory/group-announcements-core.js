'use strict';

const MIN_INTERVAL_MINUTES = 30;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const MAX_TOTAL_SENDS = 100;
const MIN_GROUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function parseInterval(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = s.match(/^(\d{1,5})(s|sec|soniya|m|min|daqiqa|h|soat|d|kun)?$/);
  if (!match) return null;
  const quantity = Number(match[1]);
  const unit = match[2] || 'm';
  let minutes = quantity;
  if (['s','sec','soniya'].includes(unit)) minutes = quantity/60;
  if (['h','soat'].includes(unit)) minutes = quantity*60;
  if (['d','kun'].includes(unit)) minutes = quantity*1440;
  return Number.isInteger(minutes) &&
    minutes >= MIN_INTERVAL_MINUTES &&
    minutes <= MAX_INTERVAL_MINUTES ? minutes : null;
}

function parseSendLimit(raw) {
  if (!/^\d{1,3}$/.test(String(raw || '').trim())) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_TOTAL_SENDS ? n : null;
}

function eligibleGroup(groups, now = new Date()) {
  const ts = new Date(now).getTime();
  const ready = (groups || []).filter(g => g.active &&
    (!g.last_sent_at || ts - new Date(g.last_sent_at).getTime() >= MIN_GROUP_COOLDOWN_MS));
  ready.sort((a,b) => new Date(a.last_sent_at||0)-new Date(b.last_sent_at||0));
  return ready[0] || null;
}

function nextAllowedGroupTime(groups, now = new Date()) {
  const active = (groups||[]).filter(g=>g.active);
  if (!active.length) return null;
  const values = active.map(g =>
    g.last_sent_at ? new Date(g.last_sent_at).getTime() + MIN_GROUP_COOLDOWN_MS : now.getTime());
  return new Date(Math.max(now.getTime(),Math.min(...values)));
}
module.exports = { MIN_INTERVAL_MINUTES, MAX_TOTAL_SENDS, MIN_GROUP_COOLDOWN_MS,
  parseInterval, parseSendLimit, eligibleGroup, nextAllowedGroupTime };
