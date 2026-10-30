'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NUMBER_MIN, NUMBER_MAX, MAX_GUESSES, DAILY_ROUNDS, newNumberRound, makeMathRound, resolveGuess, utcDay, safeStarAmount, isSupportPayment } = require('./mini-games-core');

test('number game always selects 1–50', () => {
  assert.equal(NUMBER_MIN,1);
  assert.equal(NUMBER_MAX,50);
  for(let i=0;i<300;i++){
    const r=newNumberRound();
    assert.equal(r.type,'number');
    assert.ok(r.answer>=1 && r.answer<=50);
    assert.equal(r.tries,0);
  }
  assert.equal(MAX_GUESSES,6);
  assert.equal(DAILY_ROUNDS,3);
});
test('correct guesses award virtual points, not money', () => {
  const r={type:'number',answer:21,tries:0};
  const v=resolveGuess(r,'21');
  assert.equal(v.type,'won');
  assert.equal(v.points,120);
  assert.equal(v.tries,1);
});
test('wrong guesses receive higher/lower hints and end after 6 tries', () => {
  assert.equal(resolveGuess({type:'number',answer:21,tries:0},'11').hint,'KATTAROQ son kiriting ⬆️');
  assert.equal(resolveGuess({type:'number',answer:21,tries:0},'40').hint,'KICHIKROQ son kiriting ⬇️');
  const v=resolveGuess({type:'number',answer:21,tries:5},'12');
  assert.equal(v.type,'lost');
  assert.equal(v.answer,21);
});
test('rejects invalid/outside-range guesses without charging attempt', () => {
  assert.equal(resolveGuess({type:'number',answer:15,tries:2},'-1').type,'out_of_range');
  assert.equal(resolveGuess({type:'number',answer:15,tries:2},'abc').type,'invalid_input');
  assert.equal(resolveGuess({type:'number',answer:15,tries:2},'51').type,'out_of_range');
});
test('math round answer matches its expression', () => {
  for(let i=0;i<100;i++){
    const m=makeMathRound();
    const terms=m.question.split(' ');
    const x=Number(terms[0]);
    const y=Number(terms[2]);
    const answer=terms[1]==='+'?x+y:terms[1]==='-'?x-y:x*y;
    assert.equal(m.answer,answer);
    assert.equal(resolveGuess(m,String(m.answer)).type,'won');
  }
});
test('date and payment validations cannot create a cash wager',()=>{
  assert.equal(utcDay(new Date('2026-10-30T00:00:00Z')),'2026-10-30');
  assert.equal(safeStarAmount(123),null);
  assert.equal(isSupportPayment({currency:'UZS',total_amount:10000,invoice_payload:'support:10000'}),false);
});
