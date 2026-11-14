// POST { device: uuid, check?: boolean } -> { ok, free, resetIn }
// Spends one free print (or only reads the quota when `check` is true).
// Secrets: IP_SALT (any long random string). Deploy: supabase functions deploy print
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { device, check } = await req.json().catch(() => ({}));
  if (typeof device !== 'string' || !/^[0-9a-f-]{36}$/i.test(device)) return json({ error: 'bad device' }, 400);

  // The IP comes from the platform's proxy, never from the request body.
  // cf-connecting-ip cannot be set by the visitor; x-forwarded-for is the fallback.
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (!ip) return json({ error: 'no ip' }, 400);
  // Only a salted hash is stored, not the IP itself.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Deno.env.get('IP_SALT') + ip));
  const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await db.rpc('take_free_print', {
    ip_key: `ip:${hash}`,
    dev_key: `dev:${device.toLowerCase()}`,
    dry_run: !!check,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
});
