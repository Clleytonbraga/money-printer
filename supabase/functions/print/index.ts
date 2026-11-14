// POST { device: uuid, action, pack? } -> { ok, free, resetIn, paid }
//   action 'check' reads the quota and the balance
//          'free'  spends one free print  (3 per 24 h, per IP and per device)
//          'paid'  spends one paid print  (balance of this device)
//          'buy'   credits a pack. SIMULATED PAYMENT: until Stripe is wired,
//                  anyone can call this. The Stripe webhook must replace it.
// Secrets: IP_SALT (any long random string).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PACKS: Record<string, number> = { small: 5, medium: 30, large: 120 };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const device = typeof body.device === 'string' ? body.device.toLowerCase() : '';
  if (!/^[0-9a-f-]{36}$/.test(device)) return json({ error: 'bad device' }, 400);
  // `check: true/false` is the first version of this API; keep old pages working.
  const action: string = body.action ?? (body.check ? 'check' : 'free');

  // The IP comes from the platform's proxy, never from the request body.
  // cf-connecting-ip cannot be set by the visitor; x-forwarded-for is the fallback.
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (!ip) return json({ error: 'no ip' }, 400);
  // Only a salted hash is stored, not the IP itself.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Deno.env.get('IP_SALT') + ip));
  const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const delta = action === 'paid' ? -1 : action === 'buy' ? PACKS[body.pack] : 0;
  if (delta === undefined) return json({ error: 'bad pack' }, 400);

  const [quota, wallet] = await Promise.all([
    db.rpc('take_free_print', { ip_key: `ip:${hash}`, dev_key: `dev:${device}`, dry_run: action !== 'free' }),
    db.rpc('wallet_change', { dev: device, delta }),
  ]);
  if (quota.error || wallet.error) return json({ error: (quota.error ?? wallet.error)!.message }, 500);

  // A refused paid print returns null from wallet_change: the balance is 0.
  const ok = action === 'paid' ? wallet.data !== null : action === 'buy' ? true : quota.data.ok;
  return json({ ok, free: quota.data.free, resetIn: quota.data.resetIn, paid: wallet.data ?? 0 });
});
