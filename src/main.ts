import './style.css';
import * as THREE from 'three';
import { Sfx } from './audio/sfx';
import { CONFIG, loadSavedCalibration } from './config';
import { loadBillArt } from './scene/billTexture';
import { Stage } from './scene/stage';
import { World } from './scene/world';
import type { BillRecord } from './scene/billBatch';
import { getQuota, SERVER, takeFreePrint, type Quota } from './quota';
import { store } from './state';
import { Ui } from './ui/app';

async function main(): Promise<void> {
  loadSavedCalibration();
  const root = document.getElementById('app')!;
  const stage = new Stage(root);
  const sfx = new Sfx();
  const world = new World(stage, {
    onPrintStart: () => sfx.printer(CONFIG.printer.emergeTime),
    onRelease: () => sfx.flick(),
    onLand: (impact) => sfx.land(impact),
  });
  await world.init();

  // Free prints are counted on the server (3 per 24 h per IP and device).
  const applyQuota = (q: Quota): void =>
    store.set({ free: q.free, freeResetAt: q.resetIn == null ? null : performance.now() + q.resetIn * 1000 });
  const refreshQuota = (): void => { if (SERVER) getQuota().then(applyQuota).catch(console.warn); };
  refreshQuota();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuota(); });

  let asking = false;
  const print = async (): Promise<void> => {
    if (asking) return;
    let s = store.state;
    if (s.free + s.paid <= 0) { store.set({ screen: 'shop', soundOpen: false }); return; }
    const gold = s.free <= 0;
    if (!gold && SERVER) {
      asking = true;
      const q = await takeFreePrint().catch(() => null);
      asking = false;
      if (!q) return; // offline: nothing printed, nothing spent
      applyQuota(q);
      if (!q.ok) { store.set({ screen: 'shop', soundOpen: false }); return; }
      s = store.state;
    } else {
      store.set({ free: gold ? s.free : s.free - 1, paid: gold ? s.paid - 1 : s.paid });
    }
    const id = s.count + 1;
    store.set({ count: id });
    const owner = gold ? s.mine : null;
    world.print(id, gold, owner, owner?.photo ? s.mineKey : null);
  };

  new Ui(root, {
    unlock: () => sfx.unlock(),
    print,
    setSfx: (v) => sfx.setSfx(v),
    setMusic: (v) => sfx.setMusic(v),
    finishLarge: () => {
      const s = store.state;
      let key: string | null = null;
      if (s.photo) {
        key = `photo-${Date.now()}`;
        world.addPhoto(key, { image: s.photo, zoom: s.zoom });
      }
      store.set({
        mine: { name: s.name.trim(), text: s.text.trim(), link: s.link.trim(), photo: !!s.photo },
        mineKey: key,
        screen: 'room',
      });
      setTimeout(() => void print(), 400);
    },
  }, await loadBillArt());

  // Click a bill in the room to open it.
  const ndc = new THREE.Vector2();
  const canvas = stage.renderer.domElement;
  // Tap = open the bill. Drag = spread the bills. Press and hold = pick up.
  const T = CONFIG.touch;
  type Gesture = { x: number; y: number; t: number; rec: BillRecord | null; mode: 'pending' | 'sweep' | 'hold' };
  let g: Gesture | null = null;
  let holdTimer = 0;
  let moreTimer = 0;
  let lastRustle = 0;
  const far = (e: PointerEvent): boolean => g !== null && Math.hypot(e.clientX - g.x, e.clientY - g.y) > T.tapPx;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || g) return;
    sfx.unlock();
    canvas.setPointerCapture(e.pointerId);
    const rec = world.pick(stage.ndc(e, ndc));
    g = { x: e.clientX, y: e.clientY, t: performance.now(), rec, mode: 'pending' };
    if (!rec) return;
    holdTimer = window.setTimeout(() => {
      if (!g || !world.grab(rec, ndc)) return;
      g.mode = 'hold';
      canvas.style.cursor = 'grabbing';
      moreTimer = window.setInterval(() => world.grabMore(), T.handfulEveryMs);
    }, T.holdMs);
  });
  let lastHover = 0;
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (!g) {
      if (now - lastHover < 80) return;
      lastHover = now;
      canvas.style.cursor = world.pick(stage.ndc(e, ndc)) ? 'grab' : '';
      return;
    }
    stage.ndc(e, ndc);
    if (g.mode === 'pending' && far(e)) {
      clearTimeout(holdTimer);
      g.mode = 'sweep';
      world.sweepStart();
    }
    if (g.mode === 'sweep' && world.sweep(ndc) && now - lastRustle > 120) {
      lastRustle = now;
      sfx.land(1);
    }
    if (g.mode === 'hold') {
      // The handful only grows while the hand is still.
      if (far(e)) clearInterval(moreTimer);
      world.moveHeld(ndc);
    }
  });
  const end = (e: PointerEvent): void => {
    if (!g) return;
    clearTimeout(holdTimer);
    clearInterval(moreTimer);
    const { mode, rec, t } = g;
    g = null;
    canvas.style.cursor = '';
    if (mode === 'hold' && world.drop()) sfx.flick();
    const tap = e.type === 'pointerup' && mode === 'pending' && performance.now() - t < T.tapMs;
    if (tap && rec) store.set({ screen: 'bill', openBill: rec, shared: false, soundOpen: false });
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  if (new URLSearchParams(location.search).has('debug')) {
    const { openDebug } = await import('./debug');
    openDebug(stage, world, print);
  }

  const clock = new THREE.Clock();
  const loop = (): void => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    world.update(dt);
    stage.render();
    requestAnimationFrame(loop);
  };
  loop();
}

void main();
