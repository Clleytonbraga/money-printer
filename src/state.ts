import { CONFIG } from './config';
import type { BillRecord, Owner } from './scene/billBatch';

export type Screen = 'room' | 'shop' | 'pay' | 'photo' | 'preview' | 'bill';
export type PackId = 'small' | 'medium' | 'large';

export interface Pack {
  id: PackId;
  label: string;
  prints: number;
  price: string;
  per: string;
  popular?: boolean;
  /** Only this pack lets the buyer put a photo on the bills. */
  photo?: boolean;
}

export const PACKS: Record<PackId, Pack> = {
  small: { id: 'small', label: 'Small', prints: 5, price: '$0.99', per: '$0.20 per bill' },
  medium: { id: 'medium', label: 'Medium', prints: 30, price: '$2.99', per: '$0.10 per bill', popular: true },
  large: { id: 'large', label: 'Large', prints: 120, price: '$9.99', per: '$0.08 per bill', photo: true },
};

export interface State {
  screen: Screen;
  /** Free (green) prints left. */
  free: number;
  /** When the free prints come back, on the performance.now() clock (server mode only). */
  freeResetAt: number | null;
  /** Paid (gold) prints left. */
  paid: number;
  /** Bills printed by everyone (from the server; the house bills in local dev). */
  count: number;
  pack: PackId;
  soundOpen: boolean;
  /** The 2x button: the printer feeds paper twice as fast. */
  fast: boolean;
  sfx: number;
  music: number;
  /** The buyer's photo, while they are in the Large flow. */
  photo: HTMLImageElement | null;
  zoom: number;
  /** Photo position inside the circle, -1..1 (see PhotoOptions). */
  panX: number;
  panY: number;
  name: string;
  text: string;
  link: string;
  /** What the buyer's gold bills carry once they press Print. */
  mine: Owner | null;
  openBill: BillRecord | null;
  shared: boolean;
}

// v2: the room now starts with fewer bills, so counts saved before that are dropped.
const SAVE_KEY = 'money-printer:wallet2';

function loadWallet(): Pick<State, 'free' | 'paid'> {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { const { free, paid } = JSON.parse(raw); return { free, paid }; }
  } catch { /* ignore */ }
  return { free: CONFIG.freeInk, paid: 0 };
}

type Listener = (s: State, prev: State) => void;

class Store {
  state: State = {
    screen: 'room',
    ...loadWallet(),
    count: 0,
    freeResetAt: null,
    pack: 'medium',
    soundOpen: false,
    fast: false,
    sfx: 80,
    music: 40,
    photo: null,
    zoom: 1.4,
    panX: 0,
    panY: 0,
    name: '',
    text: '',
    link: '',
    mine: null,
    openBill: null,
    shared: false,
  };
  private listeners: Listener[] = [];

  get ink(): number {
    return this.state.free + this.state.paid;
  }

  set(patch: Partial<State>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    try {
      const { free, paid } = this.state;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ free, paid }));
    } catch { /* ignore */ }
    for (const l of this.listeners) l(this.state, prev);
  }

  subscribe(l: Listener): void {
    this.listeners.push(l);
  }
}

export const store = new Store();
