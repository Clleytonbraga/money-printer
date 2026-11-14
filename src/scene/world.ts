import * as THREE from 'three';
import { CONFIG } from '../config';
import { BillBody } from '../physics/billBody';
import { Heightfield } from '../physics/heightfield';
import { BillBatch, type BillRecord, type Owner } from './billBatch';
import { animalPortrait, canvasTexture, composeBill, loadBillArt, makePileTexture, type PhotoOptions } from './billTexture';
import { PileMesh } from './pileMesh';
import type { Stage } from './stage';
import type { SavedBill } from '../quota';

const _pt = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _s = new THREE.Vector3();
const _front = new THREE.Vector3(0, 0, 1);

export interface WorldEvents {
  onPrintStart?: () => void;
  onRelease?: () => void;
  onLand?: (impact: number) => void;
  /** A bill this visitor printed came to rest for the first time. */
  onSettle?: (rec: BillRecord, at: THREE.Vector3) => void;
}

/**
 * Owns every bill: the printer queue, the live physics, the instanced
 * batches (one per bill art: plain, and one per uploaded photo), and the
 * pile that older bills melt into.
 */
export class World {
  readonly field = new Heightfield();
  private plain!: BillBatch;
  private readonly photoBatches = new Map<string, BillBatch>();
  /** One batch per animal portrait, for the bills that start on the floor. */
  private animalBatches: BillBatch[] = [];
  private readonly live: BillRecord[] = [];
  /** Settled bills, oldest first, so the oldest can be retired into the pile. */
  private readonly settled: BillRecord[] = [];
  private pile!: PileMesh;
  private readonly queue: { id: number; gold: boolean; owner: Owner | null }[] = [];
  /** Every bill in the room, oldest first, also the ones that only live on as pile height. */
  private readonly all: SavedBill[] = [];
  private printing: BillRecord | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private art!: HTMLCanvasElement | HTMLImageElement;
  /** Bills in the visitor's hand, with their offset from the pointer. */
  private readonly held: { rec: BillRecord; off: THREE.Vector3 }[] = [];
  private readonly grabPlane = new THREE.Plane();
  private readonly hand = new THREE.Vector3();
  private readonly sweepAt = new THREE.Vector3();
  private sweepTime = 0;
  /** 2 while the visitor has the 2x button on. */
  feed = 1;
  /** The last CONFIG.fresh.count bills printed, oldest first. */
  private readonly fresh: BillRecord[] = [];

  constructor(private readonly stage: Stage, private readonly events: WorldEvents = {}) {}

  async init(bills: SavedBill[], photos: Map<string, PhotoOptions>): Promise<void> {
    this.art = await loadBillArt();
    this.plain = new BillBatch(canvasTexture(composeBill(this.art)), CONFIG.pile.visualCap + 64);
    this.stage.scene.add(this.plain.mesh);
    this.pile = new PileMesh(this.field, makePileTexture(composeBill(this.art)));
    this.stage.scene.add(this.pile.mesh);
    const visible = Math.min(bills.length, Math.floor(CONFIG.pile.visualCap * 0.6));
    this.animalBatches = CONFIG.pile.animals.map((emoji) => {
      // Room for an uneven random split of the visible bills.
      const batch = new BillBatch(canvasTexture(composeBill(this.art, animalPortrait(emoji))), Math.ceil((visible / CONFIG.pile.animals.length) * 2) + 8);
      this.stage.scene.add(batch.mesh);
      return batch;
    });
    for (const [key, photo] of photos) this.addPhoto(key, photo);
    this.seedPile(bills, visible);
  }

  /** Register the buyer's photo; returns a key to pass to print(). */
  addPhoto(key: string, photo: PhotoOptions): void {
    const old = this.photoBatches.get(key);
    if (old) { this.stage.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    const batch = new BillBatch(canvasTexture(composeBill(this.art, photo)), 400);
    this.photoBatches.set(key, batch);
    this.stage.scene.add(batch.mesh);
  }

  /** Queue a bill. The printer feeds them one at a time. */
  print(id: number, gold: boolean, owner: Owner | null): void {
    this.queue.push({ id, gold, owner });
  }

  /** The batch whose face this bill wears: its owner's photo, its animal, or plain. */
  private batchFor(owner: Owner | null, animal: number | null): BillBatch {
    const b = (owner?.photo && this.photoBatches.get(owner.id)) || (animal != null && this.animalBatches[animal]) || this.plain;
    return b.full ? this.plain : b;
  }

  update(dt: number): void {
    if (!this.printing && this.queue.length) {
      const job = this.queue.shift()!;
      const batch = this.batchFor(job.owner, null);
      // Keep the number of 3D bills bounded, whichever batch they are in.
      if (batch.full) this.retire(batch);
      else if (this.settled.length >= CONFIG.pile.visualCap) this.retire();
      const body = new BillBody();
      body.feed = this.feed;
      const rec = batch.add({ id: job.id, gold: job.gold, owner: job.owner, body, fresh: true });
      this.live.push(rec);
      this.printing = rec;
      this.events.onPrintStart?.();
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const rec = this.live[i];
      const wasEmerging = rec.body.mode === 'emerging';
      const slept = rec.body.step(dt, this.field);
      if (wasEmerging && rec.body.mode === 'flying') {
        this.printing = null;
        this.events.onRelease?.();
      }
      if (!rec.heard && rec.body.landed) {
        this.events.onLand?.(rec.body.impact);
        rec.heard = true;
      }
      rec.batch.write(rec);
      if (slept) {
        this.live.splice(i, 1);
        this.settled.push(rec);
        if (rec.fresh) this.keepFresh(rec);
        else this.pileAdd(rec, CONFIG.pile.thickness);
      }
    }
    // Asleep bills still finish their crumple; cheap, and only the recent ones.
    for (let i = Math.max(0, this.settled.length - 30); i < this.settled.length; i++) {
      const r = this.settled[i];
      if (Math.abs(r.body.crumple - r.body.crumpleTarget) > 0.01) {
        r.body.step(dt, this.field);
        r.batch.write(r);
      }
    }
    this.seatFresh(dt);
    this.plain.flush();
    for (const b of this.animalBatches) b.flush();
    for (const b of this.photoBatches.values()) b.flush();
    this.pile.update();
  }

  /** Oldest settled bill of this batch becomes part of the pile surface. */
  private retire(batch?: BillBatch): void {
    const i = this.settled.findIndex((r) => (!batch || r.batch === batch) && !r.fresh);
    if (i < 0) return;
    const [r] = this.settled.splice(i, 1);
    r.batch.remove(r);
  }

  /** Bill under the pointer, if any. */
  pick(ndc: THREE.Vector2): BillRecord | null {
    // Fresh bills first, with a generous tap area around their centre.
    const el = this.stage.renderer.domElement;
    let best: BillRecord | null = null;
    let bestD = CONFIG.fresh.pickPx;
    for (const rec of this.fresh) {
      if (rec.body.mode !== 'asleep') continue;
      _pt.copy(rec.body.p).project(this.stage.camera);
      const d = Math.hypot(((_pt.x - ndc.x) * el.clientWidth) / 2, ((_pt.y - ndc.y) * el.clientHeight) / 2);
      if (d < bestD) { bestD = d; best = rec; }
    }
    if (best) return best;
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const batches = this.batches();
    const meshes = batches.map((b) => b.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    // Crumpled bills poke through each other: of the ones right at the surface, the newest is on top.
    let top: BillRecord | null = null;
    for (const h of hits) {
      if (h.instanceId == null || h.distance > hits[0].distance + CONFIG.pile.pickDepth) continue;
      const rec = batches.find((b) => b.mesh === h.object)?.records[h.instanceId];
      if (rec && (!top || rec.id > top.id)) top = rec;
    }
    return top ?? this.dig(ndc);
  }

  private batches(): BillBatch[] {
    return [this.plain, ...this.animalBatches, ...this.photoBatches.values()];
  }

  /**
   * No 3D bill under the pointer, but the pile is made of bills too: find the
   * newest one lying under that spot and bring it back to the surface as a
   * real bill, so every bill ever printed can still be opened.
   */
  private dig(ndc: THREE.Vector2): BillRecord | null {
    if (!this.surfacePoint(ndc, _pt)) return null;
    const { hw, hh } = this.probe;
    for (let i = this.all.length - 1; i >= 0; i--) {
      const s = this.all[i];
      const dx = _pt.x - s.x!, dz = _pt.z - s.z!;
      // Same footprint as Heightfield.deposit.
      const c = Math.cos(s.yaw!), n = Math.sin(s.yaw!);
      if (Math.abs(dx * c + dz * n) > hw || Math.abs(-dx * n + dz * c) > hh) continue;
      for (const b of this.batches()) {
        const shown = b.records.find((r) => r.id === s.id);
        if (shown) return shown;
      }
      if (this.settled.length >= CONFIG.pile.visualCap) this.retire();
      const rec = this.lay(s);
      for (const b of this.batches()) b.flush();
      return rec;
    }
    return null;
  }

  /** A saved bill as a real, settled 3D bill on top of the pile. */
  private lay(s: SavedBill): BillRecord {
    const b = new BillBody();
    b.mode = 'asleep';
    b.q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.25, -s.yaw!, (Math.random() - 0.5) * 0.25));
    b.p.set(s.x!, this.field.height(s.x!, s.z!) + 0.002, s.z!);
    b.crumple = b.crumpleTarget = 0.3 + Math.random() * 0.6;
    const rec = this.batchFor(s.owner, s.animal).add({ id: s.id, gold: s.gold, owner: s.owner, body: b });
    this.settled.push(rec);
    return rec;
  }

  /** A bill joins (or leaves) the pile height. Bills under the table are not part of it. */
  private pileAdd(rec: BillRecord, thickness: number): void {
    const b = rec.body;
    if (this.field.height(b.p.x, b.p.z, b.p.y) < this.field.height(b.p.x, b.p.z)) return;
    this.field.deposit(b.p.x, b.p.z, b.yaw, b.hw * 2, b.hh * 2, thickness);
  }

  /** A printed bill came to rest: it joins the fresh ones, and the oldest of them blends into the pile. */
  private keepFresh(rec: BillRecord): void {
    const F = CONFIG.fresh;
    rec.seatVersion = -1;
    if (this.fresh.includes(rec)) return; // picked up and put down again
    // Save the spot it slides to (see seatFresh), the one this visitor sees, not where it first stopped.
    const seat = this.seatFor(rec, 0);
    this.all.push({ id: rec.id, gold: rec.gold, x: seat.x, z: seat.z, yaw: rec.body.yaw, animal: null, owner: rec.owner });
    this.events.onSettle?.(rec, seat);
    this.makeFresh(rec);
    while (this.fresh.length > F.count) {
      const old = this.fresh.shift()!;
      old.fresh = false;
      old.body.crumpleTarget = old.crumpleLater ?? old.body.crumpleTarget;
      // It may be in the visitor's hand right now; then it joins the pile when it lands.
      if (old.body.mode === 'asleep') this.pileAdd(old, CONFIG.pile.thickness);
    }
  }

  /** Fresh bills stay flat until they blend in (they are not part of the pile height yet). */
  private makeFresh(rec: BillRecord): void {
    rec.fresh = true;
    rec.seatVersion = -1;
    rec.crumpleLater = rec.body.crumpleTarget;
    rec.body.crumple = Math.min(rec.body.crumple, CONFIG.fresh.crumple);
    rec.body.crumpleTarget = CONFIG.fresh.crumple;
    this.fresh.push(rec);
  }

  /** Can the camera see this point, or is the pile or the table in the way? */
  private visible(pt: THREE.Vector3): boolean {
    const o = this.stage.camera.position;
    const d = o.distanceTo(pt);
    _dir.copy(pt).sub(o).divideScalar(d);
    // Only the last stretch of the ray can be blocked; stop short of the bill itself.
    // Crumpled bills stick up above the pile surface: the ray needs that much room.
    for (let t = Math.max(0.5, d - 2.5); t < d - 0.1; t += 0.03) {
      _s.copy(o).addScaledVector(_dir, t);
      if (_s.y < this.field.height(_s.x, _s.z, _s.y) + CONFIG.fresh.clearance) return false;
    }
    return true;
  }

  /** Keep every fresh bill in view and on top of the pile, whatever landed on it since. */
  private seatFresh(dt: number): void {
    const F = CONFIG.fresh;
    this.fresh.forEach((rec, n) => {
      const b = rec.body;
      if (b.mode !== 'asleep') return;
      if (rec.seatVersion !== this.field.version) {
        rec.seatVersion = this.field.version;
        this.seatFor(rec, n);
      }
      if (b.p.distanceToSquared(rec.seat!) < 1e-8) return;
      b.p.lerp(rec.seat!, Math.min(1, (dt / F.slideTime) * 3));
      rec.batch.write(rec);
    });
  }

  /** Where a fresh bill rests: on top of the pile, slid toward the camera until it can be seen. */
  private seatFor(rec: BillRecord, n: number): THREE.Vector3 {
    const F = CONFIG.fresh;
    const b = rec.body;
    const seat = (rec.seat ??= new THREE.Vector3()).copy(b.p);
    // Newer bills rest a hair higher, so two on the same spot do not flicker.
    const top = (): number => this.field.height(seat.x, seat.z, b.p.y + 0.05) + F.lift + n * 0.003;
    seat.y = top();
    for (let k = 0; k < 40 && !this.visible(seat); k++) {
      seat.z += F.slideStep; // toward the camera
      seat.y = top();
    }
    return seat;
  }

  /** Put a settled bill back into the simulation. False when too many are awake. */
  private wake(rec: BillRecord): boolean {
    const i = this.settled.indexOf(rec);
    if (i < 0) return rec.body.mode === 'flying';
    if (this.live.length >= CONFIG.touch.maxAwake) return false;
    this.settled.splice(i, 1);
    const b = rec.body;
    if (!rec.fresh) this.pileAdd(rec, -CONFIG.pile.thickness);
    b.wake();
    this.live.push(rec);
    return true;
  }

  /** Point of the floor, table or pile under the pointer. */
  private surfacePoint(ndc: THREE.Vector2, out: THREE.Vector3): boolean {
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const { origin, direction } = this.raycaster.ray;
    // ponytail: marching in 2 cm steps is plenty for a pointer; no mesh raycast needed.
    for (let t = 0.5; t < 14; t += 0.02) {
      out.copy(origin).addScaledVector(direction, t);
      if (out.y <= this.field.height(out.x, out.z)) return true;
    }
    return false;
  }

  /** Start of a drag: forget the previous stroke. */
  sweepStart(): void {
    this.sweepTime = 0;
  }

  /** Drag through the bills: the ones near the pointer are pushed along. Returns how many moved. */
  sweep(ndc: THREE.Vector2): number {
    const T = CONFIG.touch;
    const pt = _pt;
    if (!this.surfacePoint(ndc, pt)) return 0;
    const now = performance.now();
    const dt = Math.max((now - this.sweepTime) / 1000, 1 / 120);
    const first = this.sweepTime === 0;
    _vel.copy(pt).sub(this.sweepAt).divideScalar(dt).setY(0).clampLength(0, T.sweepMaxSpeed);
    this.sweepAt.copy(pt);
    this.sweepTime = now;
    if (first || _vel.lengthSq() < 0.01) return 0;
    let moved = 0;
    for (let i = this.settled.length - 1; i >= 0; i--) {
      const rec = this.settled[i];
      const b = rec.body;
      if (Math.hypot(b.p.x - pt.x, b.p.z - pt.z) > T.sweepRadius || Math.abs(b.p.y - pt.y) > 0.08) continue;
      if (!this.wake(rec)) break;
      b.v.copy(_vel).multiplyScalar(T.sweepPush * (0.6 + Math.random() * 0.8));
      b.v.y = T.sweepLift * (0.4 + Math.random());
      b.w.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
      moved++;
    }
    this.field.shove(pt.x, pt.z, _vel.x, _vel.z, T.sweepRadius);
    return moved;
  }

  /** Pick a bill up (settled, or caught in mid-air). */
  grab(rec: BillRecord, ndc: THREE.Vector2): boolean {
    if (!this.wake(rec)) return false;
    rec.body.mode = 'held';
    this.held.push({ rec, off: new THREE.Vector3() });
    // The hand moves in a wall facing the camera, so pointer up = lift.
    this.grabPlane.setFromNormalAndCoplanarPoint(_front, rec.body.p);
    this.moveHeld(ndc);
    return true;
  }

  /** Still holding still: one more nearby bill joins the handful. */
  grabMore(): void {
    const T = CONFIG.touch;
    if (!this.held.length || this.held.length >= T.handfulMax) return;
    let best: BillRecord | null = null;
    let bestD = T.handfulRadius;
    for (const rec of this.settled) {
      const d = rec.body.p.distanceTo(this.hand);
      if (d < bestD) { bestD = d; best = rec; }
    }
    if (!best || !this.wake(best)) return;
    best.body.mode = 'held';
    const r = () => Math.random() - 0.5;
    this.held.push({ rec: best, off: new THREE.Vector3(r() * 0.07, r() * 0.04, r() * 0.05) });
  }

  moveHeld(ndc: THREE.Vector2): void {
    if (!this.held.length) return;
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    if (!this.raycaster.ray.intersectPlane(this.grabPlane, this.hand)) return;
    const floor = this.field.height(this.hand.x, this.hand.z) + 0.03;
    this.hand.y = THREE.MathUtils.clamp(this.hand.y, floor, CONFIG.touch.maxLift);
    for (const h of this.held) h.rec.body.target.copy(this.hand).add(h.off);
  }

  /** Let go: the bills fall with the speed the hand had. Returns how many. */
  drop(): number {
    const n = this.held.length;
    for (const { rec } of this.held) {
      const b = rec.body;
      b.wake();
      b.v.clampLength(0, CONFIG.touch.throwMax);
      b.w.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
    }
    this.held.length = 0;
    return n;
  }

  /** Size of one bill on the floor, for footprints. */
  private readonly probe = new BillBody();

  /**
   * Build the pile from everybody's bills without simulating them: drop each
   * footprint where it came to rest, then lay the bills with an owner and the
   * most recent ones on top as real, crumpled bills.
   */
  private seedPile(bills: SavedBill[], visible: number): void {
    const { hw, hh } = this.probe;
    // Bills with an owner first (they are what people come back to open), then the newest.
    const owned = bills.filter((s) => s.owner);
    const shown = new Set(owned.slice(-visible));
    for (let i = bills.length - 1; i >= 0 && shown.size < visible; i--) shown.add(bills[i]);
    for (const s of bills) {
      if (s.x == null || s.z == null || s.yaw == null) {
        // Its page closed before it landed: a spot picked from its number, the same for everyone.
        const r = (k: number) => { const v = Math.sin(s.id * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
        const gauss = (k: number) => (r(k) + r(k + 1) + r(k + 2) - 1.5) / 1.5;
        s.x = gauss(0) * 0.65; s.z = 0.825 + gauss(3) * 0.4; s.yaw = r(6) * Math.PI * 2;
      }
      this.all.push(s);
      // No per-bill relaxing here: that took ~0.6 s on a laptop and seconds on a phone.
      if (!shown.has(s)) this.field.deposit(s.x, s.z, s.yaw, hw * 2, hh * 2, CONFIG.pile.thickness, false);
    }
    this.field.relaxAll(200);
    // The real bills go on last, oldest first: each one rests on the ones before it.
    // The newest few, whoever printed them, are fresh: on top, flat, first to be picked.
    const firstFresh = bills.length - CONFIG.fresh.count;
    bills.forEach((s, i) => {
      if (!shown.has(s)) return;
      const rec = this.lay(s);
      if (i < firstFresh) this.field.deposit(s.x!, s.z!, s.yaw!, hw * 2, hh * 2, CONFIG.pile.thickness, false);
      else this.makeFresh(rec);
    });
    for (const b of this.batches()) b.flush();
    this.pile.update();
  }
}
