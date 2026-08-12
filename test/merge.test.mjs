import assert from 'node:assert/strict';
import test from 'node:test';
import { merge } from '../netlify/functions/state.mjs';

test('una chiave nuova entra', () => {
  assert.deepEqual(merge({}, { a: { v: 1, t: 5 } }), { a: { v: 1, t: 5 } });
});

test('vince la scrittura piu recente', () => {
  const r = merge({ a: { v: 'vecchio', t: 5 } }, { a: { v: 'nuovo', t: 9 } });
  assert.equal(r.a.v, 'nuovo');
});

test('una scrittura piu vecchia non sovrascrive', () => {
  const r = merge({ a: { v: 'nuovo', t: 9 } }, { a: { v: 'vecchio', t: 5 } });
  assert.equal(r.a.v, 'nuovo');
});

test('a parita di orario il risultato non dipende dall ordine', () => {
  const x = { a: { v: 'Anna', t: 7 } };
  const y = { a: { v: 'Bruno', t: 7 } };
  assert.deepEqual(merge(x, y), merge(y, x));
});

test('le chiavi degli altri non vengono toccate', () => {
  const r = merge({ a: { v: 1, t: 1 } }, { b: { v: 2, t: 1 } });
  assert.deepEqual(r, { a: { v: 1, t: 1 }, b: { v: 2, t: 1 } });
});

test('due persone che modificano voci diverse non si perdono', () => {
  const server = {};
  const filippo = { 'c|tosano|b|birra': { v: 1, t: 100 } };
  const marco = { 'c|tosano|b|acqua': { v: 1, t: 101 } };
  const dopo = merge(merge(server, filippo), marco);
  assert.equal(dopo['c|tosano|b|birra'].v, 1);
  assert.equal(dopo['c|tosano|b|acqua'].v, 1);
});

test('togliere la spunta si propaga, non viene riesumata', () => {
  const server = { 'c|x': { v: 1, t: 100 } };
  const dopo = merge(server, { 'c|x': { v: 0, t: 200 } });
  assert.equal(dopo['c|x'].v, 0);
  const vecchioClient = merge(dopo, { 'c|x': { v: 1, t: 100 } });
  assert.equal(vecchioClient['c|x'].v, 0);
});

test('la cancellazione di una voce aggiunta resta cancellata', () => {
  const server = { 'n|bbq|abc': { v: { text: 'Cenere' }, t: 10 } };
  const dopo = merge(server, { 'n|bbq|abc': { v: null, t: 20 } });
  assert.equal(dopo['n|bbq|abc'].v, null);
  const risincronizzaVecchio = merge(dopo, { 'n|bbq|abc': { v: { text: 'Cenere' }, t: 10 } });
  assert.equal(risincronizzaVecchio['n|bbq|abc'].v, null);
});

test('voci malformate vengono ignorate', () => {
  const r = merge({ a: { v: 1, t: 1 } }, {
    b: null, c: 'stringa', d: { v: 1 }, e: { v: 1, t: 'non un numero' }, f: { v: 2, t: 3 },
  });
  assert.deepEqual(Object.keys(r).sort(), ['a', 'f']);
});

test('incoming non valido non azzera lo stato', () => {
  assert.deepEqual(merge({ a: { v: 1, t: 1 } }, null), { a: { v: 1, t: 1 } });
  assert.deepEqual(merge({ a: { v: 1, t: 1 } }, 'x'), { a: { v: 1, t: 1 } });
});

test('la fusione e idempotente', () => {
  const a = { x: { v: 1, t: 5 }, y: { v: 'n', t: 6 } };
  assert.deepEqual(merge(a, a), a);
});

test('la fusione non muta gli argomenti', () => {
  const base = { a: { v: 1, t: 1 } };
  const inc = { a: { v: 2, t: 2 } };
  merge(base, inc);
  assert.equal(base.a.v, 1);
  assert.equal(inc.a.t, 2);
});

test('tre dispositivi convergono qualunque sia l ordine', () => {
  const a = { k1: { v: 1, t: 10 }, k2: { v: 'a', t: 30 } };
  const b = { k1: { v: 0, t: 20 }, k3: { v: 'b', t: 15 } };
  const c = { k2: { v: 'c', t: 25 }, k3: { v: 'c', t: 40 } };
  const o1 = merge(merge(a, b), c);
  const o2 = merge(merge(c, a), b);
  const o3 = merge(merge(b, c), a);
  assert.deepEqual(o1, o2);
  assert.deepEqual(o2, o3);
  assert.equal(o1.k1.v, 0);
  assert.equal(o1.k2.v, 'a');
  assert.equal(o1.k3.v, 'c');
});
