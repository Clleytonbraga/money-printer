import { BASE, device, KEY, SERVER, server } from './quota';
import { store, type Pack, type PackId } from './state';

const call = async (body: object): Promise<Record<string, unknown>> => {
  const res = await fetch(`${BASE}/functions/v1/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  return res.json();
};

/**
 * Step 2 of the purchase. With Stripe configured on the server the visitor
 * leaves for Stripe's hosted page ('redirect') and comes back with ?paid=...
 * (see `returned`). Otherwise the purchase is simulated: 'paid' right away.
 */
export async function checkout(pack: Pack): Promise<'paid' | 'redirect' | 'failed'> {
  if (!SERVER) {
    store.set({ paid: store.state.paid + pack.prints }); // local dev: the wallet lives in the browser
    return 'paid';
  }
  try {
    const r = await call({ device: device(), pack: pack.id, returnTo: location.origin + location.pathname });
    if (typeof r.url === 'string') { location.href = r.url; return 'redirect'; }
    if (!r.simulated) return 'failed';
    await server('buy', pack.id);
    return 'paid';
  } catch {
    return 'failed';
  }
}

/**
 * Back from Stripe? Ask the server to confirm the session and credit the ink
 * (the webhook does the same; whichever comes first wins, the other is a no-op).
 * Returns the pack that was bought, or null.
 */
export async function returned(): Promise<PackId | null> {
  const session = new URLSearchParams(location.search).get('paid');
  if (!session || !SERVER) return null;
  history.replaceState(null, '', location.pathname); // a reload must not ask again
  const r = await call({ session }).catch(() => ({}) as Record<string, unknown>);
  if (typeof r.paid !== 'number') return null;
  store.set({ paid: r.paid });
  return r.pack as PackId;
}
