// Shared by `checkout` and `stripe-webhook`. No Stripe SDK: two REST calls and one HMAC.
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** The ink shop. Prices are decided here, on the server, never by the browser. */
export const PACKS: Record<string, { prints: number; cents: number; name: string }> = {
  small: { prints: 5, cents: 99, name: 'Small ink · 5 prints' },
  medium: { prints: 30, cents: 299, name: 'Medium ink · 30 prints' },
  large: { prints: 120, cents: 999, name: 'Large ink · 120 prints, with your photo' },
};

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

/** Call the Stripe REST API. `params` are sent form-encoded, as Stripe expects. */
export async function stripe(path: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
    body: params && new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `stripe ${res.status}`);
  return data;
}

/** A paid Checkout session becomes ink, once. Returns the new balance, or null if it is not paid. */
export async function credit(session: { id: string; payment_status: string; client_reference_id: string; metadata: { pack: string } }) {
  const pack = PACKS[session.metadata?.pack];
  if (session.payment_status !== 'paid' || !pack || !session.client_reference_id) return null;
  const { data, error } = await db().rpc('credit_purchase', {
    session: session.id, dev: session.client_reference_id, pack_name: session.metadata.pack, n: pack.prints,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
