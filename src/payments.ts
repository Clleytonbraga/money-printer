import type { Pack } from './state';

/**
 * Payment is step 2 and happens on Stripe's hosted page, off-site.
 *
 * Production version (needs a tiny backend; never put the secret key in the browser):
 *   1. POST /api/checkout { pack }  -> server creates a Stripe Checkout Session
 *      with success_url = https://yoursite/?paid={CHECKOUT_SESSION_ID}
 *   2. window.location = session.url
 *   3. Back on the site, the server verifies the session (webhook
 *      `checkout.session.completed`) and credits the ink. Large -> step 3 (photo).
 *
 * Until then this simulates a successful payment so the whole flow can be tested.
 */
export async function checkout(pack: Pack): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 600));
  console.info(`[payments] simulated purchase: ${pack.label} (${pack.prints} prints, ${pack.price})`);
  return true;
}
