/**
 * Free prints: 3 per 24 h, counted on the server per IP and per device
 * (supabase/functions/print). The device clock is never trusted: the server
 * answers with how many are left and how many seconds until they come back.
 *
 * Without VITE_SUPABASE_URL (local dev) SERVER is false and the wallet in
 * localStorage is used as before.
 */
const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const SERVER = !!BASE && !!KEY;

export interface Quota {
  /** The print was accepted (or, for a check, at least one is left). */
  ok: boolean;
  free: number;
  /** Seconds until the free prints come back; null while none are blocked. */
  resetIn: number | null;
}

function device(): string {
  const k = 'money-printer:device';
  let id = localStorage.getItem(k);
  if (!id) localStorage.setItem(k, (id = crypto.randomUUID()));
  return id;
}

async function call(check: boolean): Promise<Quota> {
  const res = await fetch(`${BASE}/functions/v1/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ device: device(), check }),
  });
  if (!res.ok) throw new Error(`quota ${res.status}`);
  return res.json();
}

export const getQuota = (): Promise<Quota> => call(true);
export const takeFreePrint = (): Promise<Quota> => call(false);

/** "5h 12m" / "12m" for the shop. */
export function formatWait(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
