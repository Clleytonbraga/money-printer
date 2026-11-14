/**
 * Free prints: 3 per 24 h, counted on the server per IP and per device
 * (supabase/functions/print). Paid prints: a balance kept on the server for
 * this device (there is no login). The device clock is never trusted: the server
 * answers with how many are left and how many seconds until they come back.
 *
 * Without VITE_SUPABASE_URL (local dev) SERVER is false and the wallet in
 * localStorage is used as before.
 */
import { CONFIG } from './config';
import type { Owner } from './scene/billBatch';
import type { PhotoOptions } from './scene/billTexture';
import { store } from './state';

export const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const SERVER = !!BASE && !!KEY;

export interface Quota {
  /** The action was accepted (for a check: at least one free print is left). */
  ok: boolean;
  free: number;
  /** Seconds until the free prints come back; null while none are blocked. */
  resetIn: number | null;
  /** Paid prints this device still has. */
  paid: number;
  /** Bills printed by everyone. */
  count: number;
  /** Number of the bill this call printed. */
  bill?: number;
}

export function device(): string {
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
export async function server(action: 'check' | 'free' | 'paid' | 'buy', extra: Record<string, unknown> = {}): Promise<Quota> {
  const q: Quota = await call({ action, ...extra });
  store.set({
    free: q.free, paid: q.paid, count: Math.max(q.count, store.state.count),
    freeResetAt: q.resetIn == null ? null : performance.now() + q.resetIn * 1000,
  });
  return q;
}

async function call(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/functions/v1/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ device: device(), ...body }),
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

/** A bill already in the room. x/z/yaw are null when its page closed before it landed. */
export interface SavedBill {
  id: number;
  gold: boolean;
  x: number | null;
  z: number | null;
  yaw: number | null;
  animal: number | null;
  owner: Owner | null;
}

/** Everybody's bills, and the owners' photos already loaded (keyed by owner id). */
export async function loadBills(): Promise<{ bills: SavedBill[]; photos: Map<string, PhotoOptions> }> {
  const res = await fetch(`${BASE}/rest/v1/rpc/list_bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: '{}',
  });
  if (!res.ok) throw new Error(`bills ${res.status}`);
  type Row = { id: string; name: string; text: string; link: string; photo: string | null; zoom: number; panX: number; panY: number };
  const data: { bills: [number, boolean, number | null, number | null, number | null, number | null, string | null][]; owners: Row[] } = await res.json();
  const owners = new Map<string, Owner>();
  const photos = new Map<string, PhotoOptions>();
  // ponytail: every photo loads before the room shows; load lazily once there are many owners.
  await Promise.all(data.owners.map(async (o) => {
    owners.set(o.id, { id: o.id, name: o.name, text: o.text, link: o.link, photo: !!o.photo });
    if (!o.photo) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = `${BASE}/storage/v1/object/public/photos/${o.photo}`;
    try {
      await image.decode();
      photos.set(o.id, { image, zoom: o.zoom, panX: o.panX, panY: o.panY });
    } catch { owners.get(o.id)!.photo = false; }
  }));
  const bills = data.bills.map(([id, gold, x, z, yaw, animal, owner]) =>
    ({ id, gold, x, z, yaw, animal, owner: owner ? owners.get(owner) ?? null : null }));
  store.set({ count: bills.length ? bills[bills.length - 1].id : 0 });
  return { bills, photos };
}

/** Save the Large buyer's name, text, link and photo. Returns the owner id the bills carry. */
export async function createOwner(o: { name: string; text: string; link: string; photo: PhotoOptions | null }): Promise<string> {
  let photo = '';
  if (o.photo) {
    // Send a small JPEG: the bill only engraves a ~370 px circle.
    const img = o.photo.image;
    const k = Math.min(1, 512 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    photo = c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  const r = await call({ action: 'owner', name: o.name, text: o.text, link: o.link, photo, zoom: o.photo?.zoom, panX: o.photo?.panX, panY: o.photo?.panY });
  if (!r.owner) throw new Error(r.error ?? 'owner');
  return r.owner;
}

/** Tell the server where this device's bill came to rest, so everyone sees it there. */
export function place(id: number, x: number, z: number, yaw: number): void {
  call({ action: 'place', bill: id, x, z, yaw }).catch(console.warn);
}

/** The house bills the room starts with when there is no server (local dev). */
export function localBills(): SavedBill[] {
  const n = CONFIG.pile.initialBills;
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  return Array.from({ length: n }, (_, k) => ({
    id: k + 1, gold: Math.random() < 0.15, x: gauss() * 0.65, z: 0.825 + gauss() * 0.4,
    yaw: Math.random() * Math.PI * 2, animal: Math.floor(Math.random() * CONFIG.pile.animals.length), owner: null,
  }));
}

/** "5h 12m" / "12m" for the shop. */
export function formatWait(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
