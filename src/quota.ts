/**
 * Free prints: 3 per 24 h, counted on the server per IP and per device
 * (supabase/functions/print). Paid prints: a balance kept on the server for
 * this device (there is no login). The device clock is never trusted: the server
 * answers with how many are left and how many seconds until they come back.
 *
 * Without VITE_SUPABASE_URL (local dev) SERVER is false and the wallet in
 * localStorage is used as before.
 */
import { store } from './state';

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const SERVER = !!BASE && !!KEY;

export interface Quota {
  /** The action was accepted (for a check: at least one free print is left). */
  ok: boolean;
  free: number;
  /** Seconds until the free prints come back; null while none are blocked. */
  resetIn: number | null;
  /** Paid prints this device still has. */
  paid: number;
}

function device(): string {
  const k = 'money-printer:device';
  let id = localStorage.getItem(k);
  if (!id) localStorage.setItem(k, (id = crypto.randomUUID()));
  return id;
}

/**
 * One call for everything the server keeps: 'check' reads, 'free' and 'paid'
 * spend one print, 'buy' credits a pack (simulated payment until Stripe).
 * The answer is written to the store, so the wallet always shows the server's numbers.
 */
export async function server(action: 'check' | 'free' | 'paid' | 'buy', pack?: string): Promise<Quota> {
  const res = await fetch(`${BASE}/functions/v1/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ device: device(), action, pack }),
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
  const q: Quota = await res.json();
  store.set({ free: q.free, paid: q.paid, freeResetAt: q.resetIn == null ? null : performance.now() + q.resetIn * 1000 });
  return q;
}

/** "5h 12m" / "12m" for the shop. */
export function formatWait(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
