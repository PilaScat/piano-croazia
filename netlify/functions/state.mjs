import { getStore } from '@netlify/blobs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
  'content-type': 'application/json',
};

const MAX_BYTES = 512 * 1024;
const MAX_KEYS = 5000;

export function merge(base, incoming) {
  const out = base && typeof base === 'object' ? { ...base } : {};
  if (!incoming || typeof incoming !== 'object') return out;
  for (const k of Object.keys(incoming)) {
    const b = incoming[k];
    if (!b || typeof b !== 'object' || typeof b.t !== 'number') continue;
    const a = out[k];
    if (!a || typeof a.t !== 'number' || b.t > a.t) {
      out[k] = { v: b.v, t: b.t };
    } else if (b.t === a.t && JSON.stringify(b.v) > JSON.stringify(a.v)) {
      out[k] = { v: b.v, t: b.t };
    }
  }
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const store = getStore({ name: 'piano-croazia', consistency: 'strong' });

  if (req.method === 'GET') {
    const doc = (await store.get('ops', { type: 'json' })) || {};
    return json({ ops: doc });
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: 'too_large' }, 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body.ops !== 'object' || body.ops === null) {
    return json({ error: 'bad_shape' }, 400);
  }
  if (Object.keys(body.ops).length > MAX_KEYS) return json({ error: 'too_many_keys' }, 413);

  const current = (await store.get('ops', { type: 'json' })) || {};
  const merged = merge(current, body.ops);
  await store.setJSON('ops', merged);
  return json({ ops: merged });
};

export const config = { path: '/api/state' };
