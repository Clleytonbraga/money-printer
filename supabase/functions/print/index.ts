// POST { device: uuid, action, ... } -> { ok, free, resetIn, paid, count, bill?, owner? }
//   action 'check' reads the quota, the balance and the global count
//          'free'  spends one free print  (3 per 24 h, per IP and per device) and records the bill
//          'paid'  spends one paid print  (balance of this device) and records the bill;
//                  `owner` (from 'owner') puts the buyer's name/photo on it
//          'buy'   credits a pack without payment. Only works while the
//                  STRIPE_SECRET_KEY secret is not set (prototype mode).
//          'owner' { name, text, link, photo?: base64 JPEG, zoom, panX, panY } -> { owner: uuid }
//          'place' { bill, x, z, yaw } records where this device's bill came to rest (once)
// Secrets: IP_SALT (any long random string).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PACKS: Record<string, number> = { small: 5, medium: 30, large: 120 };
const BOUNDS = [-2.6, 2.6, -1.4, 2.2]; // CONFIG.pile.bounds
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const UUID = /^[0-9a-f-]{36}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const device = typeof body.device === 'string' ? body.device.toLowerCase() : '';
  if (!UUID.test(device)) return json({ error: 'bad device' }, 400);
  // `check: true/false` is the first version of this API; keep old pages working.
  const action: string = body.action ?? (body.check ? 'check' : 'free');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (action === 'place') {
    const [x0, x1, z0, z1] = BOUNDS;
    const { error } = await db.from('bills')
      .update({ x: num(body.x, x0, x1, 0), z: num(body.z, z0, z1, 0.8), yaw: num(body.yaw, -10, 10, 0) })
      .eq('id', Number(body.bill) || 0).eq('device', device).is('x', null);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  if (action === 'owner') {
    // Only a visitor with paid ink can put a name and photo on bills.
    const { data: bal } = await db.rpc('wallet_change', { dev: device, delta: 0 });
    if (!bal) return json({ error: 'no paid ink' }, 403);
    let link = str(body.link, 200);
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    if (link && !URL.canParse(link)) link = '';
    let photo: string | null = null;
    if (typeof body.photo === 'string' && body.photo) {
      const bytes = Uint8Array.from(atob(body.photo), (c) => c.charCodeAt(0));
      if (bytes.length > 300_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ error: 'bad photo' }, 400);
      photo = `${crypto.randomUUID()}.jpg`;
      const up = await db.storage.from('photos').upload(photo, bytes, { contentType: 'image/jpeg' });
      if (up.error) return json({ error: up.error.message }, 500);
    }
    const { data, error } = await db.from('owners').insert({
      device, name: str(body.name, 40), text: str(body.text, 140), link, photo,
      zoom: num(body.zoom, 1, 3, 1.4), pan_x: num(body.panX, -1, 1, 0), pan_y: num(body.panY, -1, 1, 0),
    }).select('id').single();
    return error ? json({ error: error.message }, 500) : json({ owner: data.id });
  }

  // The IP comes from the platform's proxy, never from the request body.
  // cf-connecting-ip cannot be set by the visitor; x-forwarded-for is the fallback.
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (!ip) return json({ error: 'no ip' }, 400);
  // Only a salted hash is stored, not the IP itself.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Deno.env.get('IP_SALT') + ip));
  const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // With Stripe configured, ink is only credited by a real payment (see `checkout`).
  if (action === 'buy' && Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'pay with checkout' }, 403);
  const delta = action === 'paid' ? -1 : action === 'buy' ? PACKS[body.pack] : 0;
  if (delta === undefined) return json({ error: 'bad pack' }, 400);

  const [quota, wallet] = await Promise.all([
    db.rpc('take_free_print', { ip_key: `ip:${hash}`, dev_key: `dev:${device}`, dry_run: action !== 'free' }),
    db.rpc('wallet_change', { dev: device, delta }),
  ]);
  if (quota.error || wallet.error) return json({ error: (quota.error ?? wallet.error)!.message }, 500);

  // A refused paid print returns null from wallet_change: the balance is 0.
  const ok = action === 'paid' ? wallet.data !== null : action === 'buy' ? true : quota.data.ok;
  let bill: number | undefined;
  if (ok && (action === 'free' || action === 'paid')) {
    // A gold bill carries its owner only if that owner belongs to this device.
    let owner: string | null = null;
    if (action === 'paid' && typeof body.owner === 'string' && UUID.test(body.owner)) {
      const { data } = await db.from('owners').select('id').eq('id', body.owner).eq('device', device).maybeSingle();
      owner = data?.id ?? null;
    }
    const ins = await db.from('bills').insert({ gold: action === 'paid', owner, device }).select('id').single();
    if (ins.error) return json({ error: ins.error.message }, 500);
    bill = ins.data.id;
  }
  const last = await db.from('bills').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
  return json({ ok, free: quota.data.free, resetIn: quota.data.resetIn, paid: wallet.data ?? 0, count: last.data?.id ?? 0, bill });
});
