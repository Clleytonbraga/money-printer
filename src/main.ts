import './style.css';
import * as THREE from 'three';
import { Sfx } from './audio/sfx';
import { CONFIG, loadSavedCalibration } from './config';
import { loadBillArt } from './scene/billTexture';
import { Stage } from './scene/stage';
import { World } from './scene/world';
import type { BillRecord } from './scene/billBatch';
import { returned } from './payments';
import { createOwner, loadBills, localBills, place, SERVER, server } from './quota';
import { store } from './state';
import { Ui } from './ui/app';

async function main(): Promise<void> {
  loadSavedCalibration();
  const root = document.getElementById('app')!;
  const stage = new Stage(root);
  const sfx = new Sfx();
  const world = new World(stage, {
    onPrintStart: () => sfx.printer(CONFIG.printer.emergeTime / world.feed),
    onRelease: () => sfx.flick(),
    onLand: (impact) => sfx.land(impact),
    onSettle: (rec, at) => { if (SERVER) place(rec.id, at.x, at.z, rec.body.yaw); },
  });
  // Everybody's bills. Without the server (local dev), a made-up room.
  const room = SERVER
    ? await loadBills().catch((e) => { console.warn(e); return null; })
    : null;
  if (!room) store.set({ count: CONFIG.pile.initialBills });
  await world.init(room?.bills ?? localBills(), room?.photos ?? new Map());

  // Free prints and the paid balance live on the server (see quota.ts).
  const refresh = (): void => { if (SERVER) server('check').catch(console.warn); };
  refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  let asking = false;
  const print = async (): Promise<void> => {
    if (asking) return;
    let s = store.state;
    if (s.free + s.paid <= 0) { store.set({ screen: 'shop', soundOpen: false }); return; }
    const gold = s.free <= 0;
    let q: Awaited<ReturnType<typeof server>> | null = null;
    if (SERVER) {
      asking = true;
      q = await server(gold ? 'paid' : 'free', { owner: gold ? s.mine?.id : undefined }).catch(() => null);
      asking = false;
      if (!q) return; // offline: nothing printed, nothing spent
      if (!q.ok) { store.set({ screen: 'shop', soundOpen: false }); return; }
      s = store.state;
    } else {
      store.set({ free: gold ? s.free : s.free - 1, paid: gold ? s.paid - 1 : s.paid });
    }
    const id = q?.bill ?? s.count + 1;
    store.set({ count: Math.max(s.count, id) });
    world.print(id, gold, gold ? s.mine : null);
  };

  store.subscribe((s) => { world.feed = s.fast ? 2 : 1; });

  const ui = new Ui(root, {
    unlock: () => sfx.unlock(),
    print,
    setSfx: (v) => sfx.setSfx(v),
    setMusic: (v) => sfx.setMusic(v),
    finishLarge: async () => {
      const s = store.state;
      const photo = s.photo ? { image: s.photo, zoom: s.zoom, panX: s.panX, panY: s.panY } : null;
      const mine = { name: s.name.trim(), text: s.text.trim(), link: s.link.trim() };
      store.set({ screen: 'room' }); // close the modal now; the upload can take a moment
      // The server keeps the owner so everybody sees the name and photo on these bills.
      // ponytail: if saving fails the bills still print, but only this page shows the owner.
      const id = SERVER
        ? await createOwner({ ...mine, photo }).catch((e) => { console.warn(e); return `local-${Date.now()}`; })
        : `local-${Date.now()}`;
      if (photo) world.addPhoto(id, photo);
      store.set({ mine: { id, ...mine, photo: !!photo } });
      setTimeout(() => void print(), 400);
    },
  }, await loadBillArt());
  // Back from Stripe with a paid session: the ink is credited, continue the flow.
  void returned().then((pack) => { if (pack) ui.afterPurchase(pack); });

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

// Without WebGL (old device, or the browser turned it off after a GPU crash)
// nothing can be drawn. Show the room and say why, instead of a blank page.
main().catch((err) => {
  console.error(err);
  document.getElementById('app')!.innerHTML = `
    <img class="nogl-photo" src="${CONFIG.photo.src}" alt="">
    <div class="overlay"><div class="card" role="alert">
      <h1>The printer can't start.</h1>
      <p class="lead">This browser has 3D graphics (WebGL) turned off. Close the browser completely and open it again, or try another browser.</p>
    </div></div>`;
});
