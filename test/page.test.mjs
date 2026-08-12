import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { merge } from '../netlify/functions/state.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function makeServer() {
  const server = { ops: {}, calls: 0, fail: false };
  server.fetch = (url, init) => {
    server.calls++;
    if (server.fail) return Promise.reject(new Error('rete assente'));
    const body = JSON.parse(init.body);
    server.ops = merge(server.ops, body.ops);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ops: server.ops }),
    });
  };
  return server;
}

function open(server, seedStorage) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://pilascat.github.io/piano-croazia/',
    beforeParse(w) {
      w.fetch = server ? server.fetch : undefined;
      if (seedStorage) w.localStorage.setItem('piano-croazia:ops', seedStorage);
    },
  });
  return dom;
}

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function items(doc, list) {
  return [...doc.querySelectorAll(`.check[data-list="${list}"] li`)]
    .map((li) => li.querySelector('.txt').textContent.trim());
}
function count(doc, list) {
  return doc.querySelector(`[data-count-for="${list}"]`).textContent;
}
function firstBox(doc, list) {
  return doc.querySelector(`.check[data-list="${list}"] input[type=checkbox]`);
}
function fire(dom, el, type) {
  el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
}

test('la pagina si monta con tutte le liste', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.check[data-list]').length, 9);
  assert.equal(doc.querySelectorAll('.listctl .addrow').length, 9);
  assert.equal(items(doc, 'bbq').length, 5);
  assert.equal(items(doc, 'dacasa').length, 26);
  assert.equal(count(doc, 'bbq'), '0 / 5');
});

test('il campo chi lo porta esiste solo dove serve', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.check[data-list="dacasa"] .who').length, 26);
  assert.equal(doc.querySelectorAll('.check[data-list="tosano"] .who').length, 0);
  assert.equal(doc.querySelectorAll('.check[data-list="bbq"] .who').length, 0);
});

test('la roba da barbecue non e piu nella spesa di Tosano', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const tosano = items(doc, 'tosano').join(' ').toLowerCase();
  assert.ok(!tosano.includes('carbonella'));
  assert.ok(!tosano.includes('accendifuoco'));
  assert.ok(!tosano.includes('olio'));
  assert.ok(items(doc, 'bbq').join(' ').toLowerCase().includes('carbonella'));
});

test('spuntare aggiorna il contatore e finisce sul server', async (t) => {
  const server = makeServer();
  const dom = open(server);
  t.after(() => dom.window.close());
  await flush();
  const doc = dom.window.document;
  const box = firstBox(doc, 'bbq');
  box.checked = true;
  fire(dom, box, 'change');
  assert.equal(count(doc, 'bbq'), '1 / 5');
  dom.window.__piano.sync();
  await flush();
  const checked = Object.entries(server.ops).filter(([k, o]) => k.startsWith('c|') && o.v === 1);
  assert.equal(checked.length, 1);
});

test('una modifica fatta mentre si sta gia sincronizzando non si perde', async (t) => {
  const server = makeServer();
  let sbloccaPrimaChiamata;
  const vera = server.fetch;
  let prima = true;
  server.fetch = (url, init) => {
    if (prima) {
      prima = false;
      return new Promise((res) => {
        sbloccaPrimaChiamata = () => res(vera(url, init));
      });
    }
    return vera(url, init);
  };

  const dom = open(server);
  t.after(() => dom.window.close());
  const doc = dom.window.document;

  const box = firstBox(doc, 'bbq');
  box.checked = true;
  fire(dom, box, 'change');
  dom.window.__piano.sync();

  sbloccaPrimaChiamata();
  await new Promise((r) => setTimeout(r, 1400));

  const checked = Object.entries(server.ops).filter(([k, o]) => k.startsWith('c|') && o.v === 1);
  assert.equal(checked.length, 1, 'la spunta doveva raggiungere il server al push successivo');
});

test('due telefoni: la spunta di uno arriva all altro', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  const box = firstBox(a.window.document, 'bbq');
  box.checked = true;
  fire(a, box, 'change');
  a.window.__piano.sync();
  await flush();

  assert.equal(count(b.window.document, 'bbq'), '0 / 5');
  b.window.__piano.sync();
  await flush();
  assert.equal(count(b.window.document, 'bbq'), '1 / 5');
  assert.equal(firstBox(b.window.document, 'bbq').checked, true);
});

test('due telefoni: una voce aggiunta compare sull altro', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  const form = a.window.document
    .querySelector('.check[data-list="bbq"]').nextElementSibling.querySelector('.addrow');
  form.querySelector('input').value = 'Sacco per la cenere';
  form.dispatchEvent(new a.window.Event('submit', { bubbles: true, cancelable: true }));
  a.window.__piano.sync();
  await flush();

  b.window.__piano.sync();
  await flush();
  assert.ok(items(b.window.document, 'bbq').includes('Sacco per la cenere'));
  assert.equal(count(b.window.document, 'bbq'), '0 / 6');
});

test('due telefoni: chi porta cosa si propaga', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  const who = a.window.document.querySelector('.check[data-list="dacasa"] .who');
  who.value = 'Filippo';
  fire(a, who, 'input');
  a.window.__piano.sync();
  await flush();

  b.window.__piano.sync();
  await flush();
  assert.equal(b.window.document.querySelector('.check[data-list="dacasa"] .who').value, 'Filippo');
});

test('due telefoni: togliere una voce la toglie anche all altro', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  const prima = items(a.window.document, 'bbq').length;
  const li = a.window.document.querySelector('.check[data-list="bbq"] li');
  const testo = li.querySelector('.txt').textContent.trim();
  li.querySelector('.rm').dispatchEvent(new a.window.MouseEvent('click', { bubbles: true }));
  a.window.__piano.sync();
  await flush();

  b.window.__piano.sync();
  await flush();
  assert.equal(items(b.window.document, 'bbq').length, prima - 1);
  assert.ok(!items(b.window.document, 'bbq').includes(testo));
});

test('modifiche simultanee su voci diverse non si cancellano a vicenda', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  const boxA = firstBox(a.window.document, 'bbq');
  boxA.checked = true;
  fire(a, boxA, 'change');

  const boxesB = b.window.document.querySelectorAll('.check[data-list="bbq"] input[type=checkbox]');
  boxesB[2].checked = true;
  fire(b, boxesB[2], 'change');

  a.window.__piano.sync();
  b.window.__piano.sync();
  await flush(10);
  a.window.__piano.sync();
  await flush(10);

  assert.equal(count(a.window.document, 'bbq'), '2 / 5');
  assert.equal(count(b.window.document, 'bbq'), '2 / 5');
});

test('senza rete si continua a lavorare e non si perde niente', async (t) => {
  const server = makeServer();
  server.fail = true;
  const a = open(server);
  t.after(() => a.window.close());
  await flush();

  const doc = a.window.document;
  assert.match(doc.getElementById('sync').textContent, /Non sincronizzato/);

  const box = firstBox(doc, 'bbq');
  box.checked = true;
  fire(a, box, 'change');
  assert.equal(count(doc, 'bbq'), '1 / 5');

  server.fail = false;
  a.window.__piano.sync();
  await flush();
  assert.match(doc.getElementById('sync').textContent, /Sincronizzato alle/);
  assert.equal(Object.keys(server.ops).length, 1);
});

test('lo stato locale sopravvive alla chiusura della pagina', async (t) => {
  const server = makeServer();
  const a = open(server);
  const box = firstBox(a.window.document, 'bbq');
  box.checked = true;
  fire(a, box, 'change');
  const store = a.window.localStorage.getItem('piano-croazia:ops');
  a.window.close();

  const b = open(null, store);
  t.after(() => b.window.close());
  assert.equal(count(b.window.document, 'bbq'), '1 / 5');
});

test('le spunte fatte col vecchio formato non si perdono', async (t) => {
  const legacy = JSON.stringify({
    checked: { 'bbq|b|carbonella o bricchetti 4 kg': 1 },
    removed: {}, custom: {}, owner: {},
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://pilascat.github.io/piano-croazia/',
    beforeParse(w) {
      w.fetch = makeServer().fetch;
      w.localStorage.setItem('piano-croazia:v2', legacy);
    },
  });
  t.after(() => dom.window.close());
  assert.equal(count(dom.window.document, 'bbq'), '1 / 5');
});

test('il testo scritto a mano non viene interpretato come HTML', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const form = doc.querySelector('.check[data-list="bbq"]').nextElementSibling
    .querySelector('.addrow');
  form.querySelector('input').value = '<img src=x onerror=alert(1)>';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(doc.querySelectorAll('.check[data-list="bbq"] img').length, 0);
  assert.equal(items(doc, 'bbq')[5], '<img src=x onerror=alert(1)>');
});

test('un nome con virgolette non rompe il campo', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const who = doc.querySelector('.check[data-list="dacasa"] .who');
  who.value = 'Filippo "il capo"';
  fire(dom, who, 'input');
  dom.window.__piano.sync();
  const li = who.closest('li');
  li.querySelector('.rm').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const restore = doc.querySelector('.check[data-list="dacasa"]').nextElementSibling
    .querySelector('[data-act="restore"]');
  restore.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(items(doc, 'dacasa').length, 26);
});

function edit(dom, li, testo) {
  li.querySelector('.ed').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const box = li.querySelector('.edbox');
  box.value = testo;
  box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

test('si puo correggere il testo di una voce di serie', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const li = doc.querySelector('.check[data-list="bbq"] li');
  edit(dom, li, 'Carbonella, 6 kg');
  assert.equal(items(doc, 'bbq')[0], 'Carbonella, 6 kg');
  assert.equal(items(doc, 'bbq').length, 5);
});

test('correggere il testo non perde la spunta ne il nome', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const li = doc.querySelector('.check[data-list="dacasa"] li');
  const box = li.querySelector('input[type=checkbox]');
  box.checked = true;
  fire(dom, box, 'change');
  const who = li.querySelector('.who');
  who.value = 'Anna';
  fire(dom, who, 'input');

  edit(dom, doc.querySelector('.check[data-list="dacasa"] li'), 'Olio buono');

  const dopo = doc.querySelector('.check[data-list="dacasa"] li');
  assert.equal(dopo.querySelector('.txt').textContent.trim(), 'Olio buono');
  assert.equal(dopo.querySelector('input[type=checkbox]').checked, true);
  assert.equal(dopo.querySelector('.who').value, 'Anna');
  assert.equal(count(doc, 'dacasa'), '1 / 26');
});

test('si puo correggere anche una voce aggiunta a mano', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const form = doc.querySelector('.check[data-list="bbq"]').nextElementSibling
    .querySelector('.addrow');
  form.querySelector('input').value = 'Sacco cenere';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  edit(dom, doc.querySelector('.check[data-list="bbq"] li:last-child'), 'Sacco per la cenere');
  assert.equal(items(doc, 'bbq')[5], 'Sacco per la cenere');
});

test('Escape annulla la correzione', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const li = doc.querySelector('.check[data-list="bbq"] li');
  const originale = li.querySelector('.txt').textContent.trim();
  li.querySelector('.ed').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const box = li.querySelector('.edbox');
  box.value = 'roba a caso';
  box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(items(doc, 'bbq')[0], originale);
});

test('un testo svuotato non cancella la voce', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const li = doc.querySelector('.check[data-list="bbq"] li');
  const originale = li.querySelector('.txt').textContent.trim();
  edit(dom, li, '   ');
  assert.equal(items(doc, 'bbq')[0], originale);
  assert.equal(items(doc, 'bbq').length, 5);
});

test('una correzione fatta con HTML dentro resta testo', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  edit(dom, doc.querySelector('.check[data-list="bbq"] li'), '<b>grassetto</b>');
  assert.equal(doc.querySelectorAll('.check[data-list="bbq"] b').length, 0);
  assert.equal(items(doc, 'bbq')[0], '<b>grassetto</b>');
});

test('due telefoni: una correzione arriva all altro', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  edit(a, a.window.document.querySelector('.check[data-list="bbq"] li'), 'Carbonella, 6 kg');
  a.window.__piano.sync();
  await flush();

  b.window.__piano.sync();
  await flush();
  assert.equal(items(b.window.document, 'bbq')[0], 'Carbonella, 6 kg');
});

test('la correzione piu recente vince fra due telefoni', async (t) => {
  const server = makeServer();
  const a = open(server);
  const b = open(server);
  t.after(() => { a.window.close(); b.window.close(); });
  await flush();

  edit(a, a.window.document.querySelector('.check[data-list="bbq"] li'), 'primo');
  await new Promise((r) => setTimeout(r, 5));
  edit(b, b.window.document.querySelector('.check[data-list="bbq"] li'), 'secondo');

  a.window.__piano.sync();
  await flush();
  b.window.__piano.sync();
  await flush();
  a.window.__piano.sync();
  await flush();

  assert.equal(items(a.window.document, 'bbq')[0], 'secondo');
  assert.equal(items(b.window.document, 'bbq')[0], 'secondo');
});

test('la fusione di roba comune in Da casa non perde niente', async (t) => {
  const t0 = 1786531403397;
  const vecchio = {
    'c|comune|b|2 frigo portatili grandi con siberini': { v: 1, t: t0 },
    'o|comune|b|2 frigo portatili grandi con siberini': { v: 'Scat e Pier', t: t0 + 1 },
    'c|comune|b|carte da gioco o un gioco da tavolo': { v: 1, t: t0 + 2 },
    'o|comune|b|carte da gioco o un gioco da tavolo': { v: 'Mery e Pier', t: t0 + 3 },
    'n|comune|mspyqm45f3ly1': { v: { text: 'Drone' }, t: t0 + 4 },
    'o|comune|c|mspyqm45f3ly1': { v: 'Scat', t: t0 + 5 },
    'c|comune|c|mspyqm45f3ly1': { v: 1, t: t0 + 6 },
    'c|dacasa|b|biscotti': { v: 1, t: t0 + 7 },
    'o|dacasa|b|biscotti': { v: 'Scat', t: t0 + 8 },
  };
  const dom = open(makeServer(), JSON.stringify(vecchio));
  t.after(() => dom.window.close());
  const doc = dom.window.document;

  assert.equal(doc.querySelectorAll('.check[data-list="comune"]').length, 0);

  const righe = [...doc.querySelectorAll('.check[data-list="dacasa"] li')];
  const trova = (testo) => righe.find((li) => li.querySelector('.txt').textContent.includes(testo));

  const frigo = trova('frigo portatili');
  assert.ok(frigo, 'i frigo devono essere finiti in Da casa');
  assert.equal(frigo.querySelector('input[type=checkbox]').checked, true);
  assert.equal(frigo.querySelector('.who').value, 'Scat e Pier');

  const carte = trova('Carte da gioco');
  assert.equal(carte.querySelector('.who').value, 'Mery e Pier');

  const drone = trova('Drone');
  assert.ok(drone, 'la voce aggiunta a mano deve sopravvivere');
  assert.equal(drone.querySelector('input[type=checkbox]').checked, true);
  assert.equal(drone.querySelector('.who').value, 'Scat');

  const biscotti = trova('Biscotti');
  assert.equal(biscotti.querySelector('.who').value, 'Scat');
});

test('la fusione e idempotente e non resuscita voci tolte', async (t) => {
  const t0 = 1786531403397;
  const vecchio = {
    'c|comune|b|1 ciabatta multipresa': { v: 1, t: t0 },
    'r|comune|b|cavatappi e apribottiglie': { v: 1, t: t0 + 1 },
  };
  const primo = open(makeServer(), JSON.stringify(vecchio));
  const dopoUnGiro = primo.window.localStorage.getItem('piano-croazia:ops');
  const testiPrimo = items(primo.window.document, 'dacasa');
  primo.window.close();

  const secondo = open(makeServer(), dopoUnGiro);
  t.after(() => secondo.window.close());
  assert.deepEqual(items(secondo.window.document, 'dacasa'), testiPrimo);
  assert.ok(!testiPrimo.some((x) => x.includes('Cavatappi')), 'la voce tolta resta tolta');
});

test('spostare una voce fra liste porta con se spunta e nome', async (t) => {
  const dom = open(makeServer());
  t.after(() => dom.window.close());
  const doc = dom.window.document;

  const li = doc.querySelector('.check[data-list="dacasa"] li');
  const testo = li.querySelector('.txt').textContent.trim();
  const box = li.querySelector('input[type=checkbox]');
  box.checked = true;
  fire(dom, box, 'change');
  const who = li.querySelector('.who');
  who.value = 'Anna';
  fire(dom, who, 'input');

  li.querySelector('.mv').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const sel = li.querySelector('.mvsel');
  assert.ok(sel);
  assert.equal(sel.options.length, 9);
  sel.value = 'valigia';
  fire(dom, sel, 'change');

  assert.ok(!items(doc, 'dacasa').includes(testo));
  assert.ok(items(doc, 'valigia').includes(testo));
  const moved = [...doc.querySelectorAll('.check[data-list="valigia"] li')]
    .find((x) => x.querySelector('.txt').textContent.trim() === testo);
  assert.equal(moved.querySelector('input[type=checkbox]').checked, true);
  assert.equal(moved.querySelector('.who'), null,
    'fuori da Da casa il campo chi non esiste');

  const ops = dom.window.__piano.ops();
  assert.equal(ops['o|valigia|c|' + moved.dataset.key.split('|c|')[1]].v, 'Anna',
    'il nome resta in memoria e torna se la voce viene rimessa in Da casa');

  moved.querySelector('.mv').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const back = moved.querySelector('.mvsel');
  back.value = 'dacasa';
  fire(dom, back, 'change');
  const tornata = [...doc.querySelectorAll('.check[data-list="dacasa"] li')]
    .find((x) => x.querySelector('.txt').textContent.trim() === testo);
  assert.equal(tornata.querySelector('.who').value, 'Anna');
  assert.equal(tornata.querySelector('input[type=checkbox]').checked, true);
});
