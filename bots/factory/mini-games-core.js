'use strict';

const crypto = require('node:crypto');
const NUMBER_MIN = 1;
const NUMBER_MAX = 50;
const MAX_GUESSES = 6;
const DAILY_ROUNDS = 3;
const SUPPORT_STAR_AMOUNTS = Object.freeze([10, 25, 50]);

function newNumberRound() {
  return { type: 'number', answer: crypto.randomInt(NUMBER_MIN, NUMBER_MAX + 1), tries: 0 };
}

function makeMathRound() {
  const x = crypto.randomInt(5, 31);
  const y = crypto.randomInt(2, 26);
  const op = crypto.randomInt(0, 3);
  if (op === 0) return { type: 'math', question: x + ' + ' + y, answer: x + y, tries: 0 };
  if (op === 1) return { type: 'math', question: (x + y) + ' - ' + y, answer: x, tries: 0 };
  const a = crypto.randomInt(2, 11);
  const b = crypto.randomInt(2, 11);
  return { type: 'math', question: a + ' × ' + b, answer: a * b, tries: 0 };
}

function scoreNumberWin(tries) {
  return Math.max(30, 120 - Math.max(0, tries - 1) * 15);
}

function resolveGuess(round, raw) {
  if (!round || !['number', 'math'].includes(round.type)) return { type: 'invalid_round' };
  const str = String(raw || '').trim();
  if (!/^-?\d{1,4}$/.test(str)) return { type: 'invalid_input' };
  const number = Number(str);
  if (round.type === 'number' && (number < NUMBER_MIN || number > NUMBER_MAX)) return { type: 'out_of_range' };
  const tries = Math.max(0, Number(round.tries) || 0) + 1;
  if (number === Number(round.answer)) {
    return { type: 'won', tries, points: round.type === 'number' ? scoreNumberWin(tries) : Math.max(10, 60 - (tries - 1) * 15) };
  }
  const limit = round.type === 'number' ? MAX_GUESSES : 3;
  if (tries >= limit) return { type: 'lost', tries, answer: Number(round.answer) };
  return {
    type: 'retry', tries,
    hint: round.type === 'number' ? (number < round.answer ? 'KATTAROQ son kiriting ⬆️' : 'KICHIKROQ son kiriting ⬇️') : 'Yana urinib ko‘ring!'
  };
}

function utcDay(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

function safeStarAmount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && SUPPORT_STAR_AMOUNTS.includes(number) ? number : null;
}

function isSupportPayment(payment) {
  if (!payment || payment.currency !== 'XTR') return false;
  const amount = safeStarAmount(payment.total_amount);
  return amount !== null && payment.invoice_payload === 'support:' + amount;
}

module.exports = {
  NUMBER_MIN, NUMBER_MAX, MAX_GUESSES, DAILY_ROUNDS, SUPPORT_STAR_AMOUNTS,
  newNumberRound, makeMathRound, scoreNumberWin, resolveGuess, utcDay,
  safeStarAmount, isSupportPayment
};
