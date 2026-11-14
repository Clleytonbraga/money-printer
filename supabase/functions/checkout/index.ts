// POST { device, pack, returnTo }  -> { url }            start a Stripe Checkout
// POST { session }                 -> { paid, pack }     the visitor is back: credit it now
// Without the STRIPE_SECRET_KEY secret it answers { simulated: true } and the
// site falls back to the simulated purchase.
import { cors, credit, json, PACKS, stripe } from '../_shared/stripe.ts';

// Where Stripe may send the visitor back to. Add the real domain here when there is one.
const SITES = ['https://clleytonbraga.github.io/money-printer/', 'http://localhost:', 'http://127.0.0.1:'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ simulated: true });
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.session === 'string') {
      if (!/^cs_[A-Za-z0-9_]+$/.test(body.session)) return json({ error: 'bad session' }, 400);
      const session = await stripe(`checkout/sessions/${body.session}`);
      const paid = await credit(session);
      return paid === null ? json({ error: 'not paid' }, 402) : json({ paid, pack: session.metadata.pack });
    }
    const pack = PACKS[body.pack];
    const device = typeof body.device === 'string' ? body.device.toLowerCase() : '';
    const back = String(body.returnTo ?? '');
    if (!pack || !/^[0-9a-f-]{36}$/.test(device)) return json({ error: 'bad request' }, 400);
    if (!SITES.some((s) => back.startsWith(s))) return json({ error: 'bad returnTo' }, 400);
    const session = await stripe('checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(pack.cents),
      'line_items[0][price_data][product_data][name]': pack.name,
      'line_items[0][price_data][product_data][description]': 'Toy money. Ink only buys prints on The Money Printer.',
      client_reference_id: device,
      'metadata[pack]': body.pack,
      success_url: `${back}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: back,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
