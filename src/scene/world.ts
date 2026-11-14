import * as THREE from 'three';
import { CONFIG } from '../config';
import { BillBody } from '../physics/billBody';
import { Heightfield } from '../physics/heightfield';
import { BillBatch, type BillRecord, type Owner } from './billBatch';
import { canvasTexture, composeBill, loadBillArt, makePileTexture, type PhotoOptions } from './billTexture';
import { PileMesh } from './pileMesh';
import type { Stage } from './stage';

const _pt = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _front = new THREE.Vector3(0, 0, 1);

export interface WorldEvents {
  onPrintStart?: () => void;
  onRelease?: () => void;
  onLand?: (impact: number) => void;
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
  private readonly live: BillRecord[] = [];
  /** Settled bills, oldest first, so the oldest can be retired into the pile. */
  private readonly settled: BillRecord[] = [];
  private pile!: PileMesh;
  private readonly queue: { id: number; gold: boolean; owner: Owner | null; photoKey: string | null }[] = [];
  private printing: BillRecord | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private art!: HTMLCanvasElement | HTMLImageElement;
  /** Bills in the visitor's hand, with their offset from the pointer. */
  private readonly held: { rec: BillRecord; off: THREE.Vector3 }[] = [];
  private readonly grabPlane = new THREE.Plane();
  private readonly hand = new THREE.Vector3();
  private readonly sweepAt = new THREE.Vector3();
  private sweepTime = 0;

  constructor(private readonly stage: Stage, private readonly events: WorldEvents = {}) {}

  async init(): Promise<void> {
    this.art = await loadBillArt();
    this.plain = new BillBatch(canvasTexture(composeBill(this.art)), CONFIG.pile.visualCap + 64);
    this.stage.scene.add(this.plain.mesh);
    this.pile = new PileMesh(this.field, makePileTexture(this.art));
    this.stage.scene.add(this.pile.mesh);
    this.seedPile(CONFIG.pile.initialBills);
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
  print(id: number, gold: boolean, owner: Owner | null, photoKey: string | null): void {
    this.queue.push({ id, gold, owner, photoKey });
  }

  update(dt: number): void {
    if (!this.printing && this.queue.length) {
      const job = this.queue.shift()!;
      const batch = (job.photoKey && this.photoBatches.get(job.photoKey)) || this.plain;
      if (batch.full) this.retire(batch);
      const rec = batch.add({ id: job.id, gold: job.gold, owner: job.owner, body: new BillBody() });
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
        this.pileAdd(rec, CONFIG.pile.thickness);
        this.settled.push(rec);
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
    this.plain.flush();
    for (const b of this.photoBatches.values()) b.flush();
    this.pile.update();
  }

  /** Oldest settled bill of this batch becomes part of the pile surface. */
  private retire(batch: BillBatch): void {
    const i = this.settled.findIndex((r) => r.batch === batch);
    if (i < 0) return;
    const [r] = this.settled.splice(i, 1);
    batch.remove(r);
  }

  /** Bill under the pointer, if any. */
  pick(ndc: THREE.Vector2): BillRecord | null {
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const meshes = [this.plain.mesh, ...[...this.photoBatches.values()].map((b) => b.mesh)];
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      if (h.instanceId == null) continue;
      const batch = h.object === this.plain.mesh ? this.plain : [...this.photoBatches.values()].find((b) => b.mesh === h.object);
      const rec = batch?.records[h.instanceId];
      if (rec) return rec;
    }
    return null;
  }

  /** A bill joins (or leaves) the pile height. Bills under the table are not part of it. */
  private pileAdd(rec: BillRecord, thickness: number): void {
    const b = rec.body;
    if (this.field.height(b.p.x, b.p.z, b.p.y) < this.field.height(b.p.x, b.p.z)) return;
    this.field.deposit(b.p.x, b.p.z, b.yaw, b.hw * 2, b.hh * 2, thickness);
  }

  /** Put a settled bill back into the simulation. False when too many are awake. */
  private wake(rec: BillRecord): boolean {
    const i = this.settled.indexOf(rec);
    if (i < 0) return rec.body.mode === 'flying';
    if (this.live.length >= CONFIG.touch.maxAwake) return false;
    this.settled.splice(i, 1);
    const b = rec.body;
    this.pileAdd(rec, -CONFIG.pile.thickness);
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

  /**
   * Build the pile that everybody's earlier bills already made, without
   * simulating them: drop footprints where bills tend to land, then lay the
   * most recent ones on top as real, crumpled bills.
   */
  private seedPile(count: number): void {
    const t = CONFIG.table;
    const landX = CONFIG.printer.slot.x;
    const landZ = t.z + t.d / 2 + 0.35;
    const visible = Math.min(count, Math.floor(CONFIG.pile.visualCap * 0.6));
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const tmp = new BillBody();
    for (let k = 0; k < count; k++) {
      const x = landX + gauss() * 0.65;
      const z = landZ + 0.1 + gauss() * 0.4;
      const yaw = Math.random() * Math.PI * 2;
      const showAsBill = k >= count - visible;
      if (showAsBill) {
        const b = new BillBody();
        b.mode = 'asleep';
        const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.25, -yaw, (Math.random() - 0.5) * 0.25));
        b.q.copy(tilt);
        b.p.set(x, this.field.height(x, z) + 0.002, z);
        b.crumple = b.crumpleTarget = 0.3 + Math.random() * 0.6;
        const rec = this.plain.add({ id: k + 1, gold: Math.random() < 0.15, owner: null, body: b });
        this.settled.push(rec);
      }
      this.field.deposit(x, z, yaw, tmp.hw * 2, tmp.hh * 2);
    }
    this.field.relaxAll(60);
    // Relaxing moved the surface: put the visible bills back on top of it.
    for (const r of this.settled) {
      const b = r.body;
      b.p.y = Math.max(b.p.y, this.field.height(b.p.x, b.p.z) - CONFIG.pile.thickness * 2);
    }
    this.plain.flush();
    this.pile.update();
  }
}
