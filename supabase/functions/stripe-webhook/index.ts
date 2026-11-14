// Stripe calls this when a payment completes, even if the visitor closed the tab.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (whsec_...).
import { credit } from '../_shared/stripe.ts';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Stripe-Signature: t=<unix>,v1=<hmac sha256 of "t.payload">. Rejects forgeries and replays older than 5 min. */
async function verified(payload: string, header: string | null): Promise<boolean> {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=') as [string, string]));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('STRIPE_WEBHOOK_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`)));
  // Constant-time compare.
  let diff = want.length ^ parts.v1.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (parts.v1.charCodeAt(i) || 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  const payload = await req.text();
  if (!(await verified(payload, req.headers.get('stripe-signature')))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    await credit(event.data.object);
  }
  return new Response('ok');
});
