'use strict';

function normalizeInvite(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/(?:\+|joinchat\/)[a-z0-9_-]+\/?$/i);
  return m ? (raw.startsWith('http') ? raw.replace(/\/$/, '') : 'https://' + raw.replace(/\/$/, '')) : '';
}

function isChatId(value) {
  return /^-?\d{6,}$/.test(String(value || '').trim());
}

function publicRef(value) {
  let v = String(value || '').trim();
  if (/^https?:\/\/t\.me\//i.test(v)) v = v.replace(/^https?:\/\/t\.me\//i, '');
  if (/^t\.me\//i.test(v)) v = v.replace(/^t\.me\//i, '');
  if (/^tg:\/\/resolve\?domain=/i.test(v)) v = v.replace(/^tg:\/\/resolve\?domain=/i, '');
  v = v.replace(/^@/, '').replace(/\/$/, '').trim();
  if (isChatId(v)) return v;
  if (/^(?:zayavka|request|tasdiq|approval|yes|true|ha)$/i.test(v)) return '';
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v)) return '@' + v;
  return '';
}

function needsRequest(flag) {
  return /(?:zayavka|so[‘'ʼ]?rov|request|tasdiq|approval)/i.test(String(flag || ''));
}

function parseSubInput(rawInput, type = 'channel') {
  const input = String(rawInput || '').trim();
  if (!input) return null;
  const fields = input.split('|').map(s => s.trim()).filter(Boolean);
  const firstIsExplicitRef = /^@|^-?\d{6,}$|^(?:https?:\/\/)?t\.me\//i.test(fields[0]);
  const otherTarget = fields.slice(1).some(x => Boolean(publicRef(x) || normalizeInvite(x)));
  const hasTitle = fields.length > 1 && !firstIsExplicitRef &&
    (otherTarget || /\s/.test(fields[0]));
  const candidates = hasTitle ? fields.slice(1) : fields;
  const title = hasTitle ? fields[0] : '';
  const ref = candidates.map(publicRef).find(Boolean) || '';
  const invite = candidates.map(normalizeInvite).find(Boolean) || '';
  const ask = candidates.some(needsRequest);
  if (!ref && !invite) return null;

  const privateByLink = !!invite;
  const resolvedTitle = title || (ref.startsWith('@') ? ref : (type === 'group' ? 'Maxfiy guruh' : 'Maxfiy kanal'));
  const url = invite || (ref.startsWith('@') ? 'https://t.me/' + ref.slice(1) : '');
  const req = ask || privateByLink;
  return {
    chat_username: ref.startsWith('@') ? ref : (ref || (resolvedTitle + ' · ' + invite.split('/').pop().slice(-8))),
    chat_ref: ref || undefined,
    chat_id: isChatId(ref) ? ref : undefined,
    type,
    title: resolvedTitle,
    join_url: url || undefined,
    invite_link: invite || undefined,
    is_private_link: privateByLink,
    requires_request: req,
    allow_join_request: req
  };
}

function membershipAccepted(member) {
  if (!member) return false;
  if (member.status === 'creator' || member.status === 'administrator' || member.status === 'member') return true;
  if (member.status === 'restricted') return member.is_member === true;
  return false;
}

function subscriptionChatRef(sub) {
  const options = [sub?.chat_id, sub?.chat_ref, sub?.chat_username];
  for (const v of options) {
    const ref = publicRef(v);
    if (ref) return ref;
  }
  return '';
}

module.exports = { normalizeInvite, isChatId, publicRef, needsRequest, parseSubInput, membershipAccepted, subscriptionChatRef };
