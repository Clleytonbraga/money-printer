import { CONFIG } from '../config';

/**
 * The ground the bills land on: floor + table + printer (the `base`), plus
 * the pile of bills on top (`pile`). Settled bills deposit height into the
 * pile, and a slope relaxation (angle of repose) turns the stack into a
 * natural mound that eventually swallows the table.
 */
export class Heightfield {
  readonly nx: number;
  readonly nz: number;
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly base: Float32Array;
  readonly pile: Float32Array;
  /** 1 where the surface is the smooth plastic output tray. */
  readonly slick: Uint8Array;
  /** Bumped whenever the pile changes, so the mesh knows to rebuild. */
  version = 0;

  constructor() {
    const [minX, maxX, minZ, maxZ] = CONFIG.pile.bounds;
    this.cell = CONFIG.pile.cell;
    this.minX = minX;
    this.minZ = minZ;
    this.nx = Math.ceil((maxX - minX) / this.cell) + 1;
    this.nz = Math.ceil((maxZ - minZ) / this.cell) + 1;
    this.base = new Float32Array(this.nx * this.nz);
    this.pile = new Float32Array(this.nx * this.nz);
    this.slick = new Uint8Array(this.nx * this.nz);
    this.rebuildBase();
  }

  /** Floor 0, table top, printer top. Call again after recalibrating. */
  rebuildBase(): void {
    const { table: t, printer: p } = CONFIG;
    const dl = Math.hypot(p.slotDir.x, p.slotDir.z) || 1;
    const tdx = p.slotDir.x / dl;
    const tdz = p.slotDir.z / dl;
    const trayHalf = (CONFIG.bill.w * CONFIG.bill.scale) / 2 + 0.02;
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.minX + i * this.cell;
        const z = this.minZ + j * this.cell;
        let h = 0;
        if (Math.abs(x - t.x) <= t.w / 2 && Math.abs(z - t.z) <= t.d / 2) h = t.top;
        // The printer body is not in the heightfield: the paper leaves through
        // its front face, and nothing should land on top of it anyway.
        let slick = 0;
        // Output tray: a ramp from just under the slot, along the feed direction.
        const dx = x - p.slot.x;
        const dz = z - p.slot.z;
        const along = dx * tdx + dz * tdz;
        const across = -dx * tdz + dz * tdx;
        if (along >= 0 && along <= p.tray.length && Math.abs(across) <= trayHalf) {
          h = Math.max(h, p.slot.y - 0.01 - p.tray.drop * (along / p.tray.length));
          slick = 1;
        }
        this.base[j * this.nx + i] = h;
        this.slick[j * this.nx + i] = slick;
      }
    }
    this.version++;
  }

  private idx(i: number, j: number): number {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
    return j * this.nx + i;
  }

  cellHeight(i: number, j: number): number {
    const k = this.idx(i, j);
    return this.base[k] + this.pile[k];
  }

  /**
   * Bilinear height at a world point (lower level at a cliff). Outside the
   * grid: the floor. Pass `y` for a point that may be under the table or the
   * tray: the grid is 2.5D, so what supports it there is the bare floor.
   */
  height(x: number, z: number, y = Infinity): number {
    const h = this.top(x, z);
    return h - y > CONFIG.pile.overhang ? 0 : h;
  }

  private top(x: number, z: number): number {
    const fx = (x - this.minX) / this.cell;
    const fz = (z - this.minZ) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return 0;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = this.cellHeight(i, j);
    const b = this.cellHeight(i + 1, j);
    const c = this.cellHeight(i, j + 1);
    const d = this.cellHeight(i + 1, j + 1);
    // A cell that spans a drop (table edge, tray tip) is not a ramp: bilinear
    // blending there made a fake wall in mid-air that bills rested on.
    const lo = Math.min(a, b, c, d);
    if (Math.max(a, b, c, d) - lo > CONFIG.pile.cliff) return lo;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Friction multiplier: the tray is slippery so the paper slides off it. */
  friction(x: number, z: number): number {
    const i = Math.round((x - this.minX) / this.cell);
    const j = Math.round((z - this.minZ) / this.cell);
    return this.slick[this.idx(i, j)] ? 0.15 : 1;
  }

  /**
   * Add one bill lying at (x, z) with yaw `angle`. Its footprint (an
   * oriented rectangle) gets `thickness` of height, then the neighbourhood
   * relaxes so no slope is steeper than the angle of repose.
   */
  deposit(x: number, z: number, angle: number, w: number, h: number, thickness = CONFIG.pile.thickness, relax = true): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = Math.hypot(w, h) / 2;
    const i0 = Math.floor((x - r - this.minX) / this.cell);
    const i1 = Math.ceil((x + r - this.minX) / this.cell);
    const j0 = Math.floor((z - r - this.minZ) / this.cell);
    const j1 = Math.ceil((z + r - this.minZ) / this.cell);
    for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const dx = this.minX + i * this.cell - x;
        const dz = this.minZ + j * this.cell - z;
        const u = dx * c + dz * s;
        const v = -dx * s + dz * c;
        if (Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2) {
          // Crumpled paper is thicker in the middle than at the edges.
          const fall = 1 - 0.5 * Math.max(Math.abs(u) / (w / 2), Math.abs(v) / (h / 2));
          const k = j * this.nx + i;
          // Negative thickness lifts a bill back out; the pile never goes below the floor.
          this.pile[k] = Math.max(0, this.pile[k] + thickness * (0.6 + 0.8 * fall));
        }
      }
    }
    // Seeding thousands of bills skips this and relaxes the whole grid once.
    if (relax) this.relax(i0 - 8, i1 + 8, j0 - 8, j1 + 8, 10);
    this.version++;
  }

  /** A hand dragging through the pile: move part of it forward along (dx, dz). */
  shove(x: number, z: number, dx: number, dz: number, r: number): void {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const n = Math.ceil(r / this.cell);
    const ci = Math.round((x - this.minX) / this.cell);
    const cj = Math.round((z - this.minZ) / this.cell);
    const oi = Math.round((dx / len) * (n + 1));
    const oj = Math.round((dz / len) * (n + 1));
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        if (i * i + j * j > n * n) continue;
        const si = ci + i, sj = cj + j, ti = si + oi, tj = sj + oj;
        if (si < 0 || sj < 0 || ti < 0 || tj < 0 || si >= this.nx || ti >= this.nx || sj >= this.nz || tj >= this.nz) continue;
        const k = sj * this.nx + si;
        const tk = tj * this.nx + ti;
        // Not up onto the table from the floor.
        if (this.base[tk] > this.base[k] + CONFIG.pile.cliff) continue;
        const amount = this.pile[k] * CONFIG.touch.shove;
        this.pile[k] -= amount;
        this.pile[tk] += amount;
      }
    }
    this.relax(ci - 2 * n - 8, ci + 2 * n + 8, cj - 2 * n - 8, cj + 2 * n + 8, 6);
    this.version++;
  }

  /** Relax the whole grid (after seeding many bills at once). */
  relaxAll(passes: number): void {
    this.relax(0, this.nx - 1, 0, this.nz - 1, passes);
    this.version++;
  }

  /** Move pile material downhill until slopes are under the angle of repose. */
  relax(i0: number, i1: number, j0: number, j1: number, passes: number): void {
    const maxDiff = Math.tan(CONFIG.pile.repose) * this.cell;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0);
    i1 = Math.min(this.nx - 1, i1); j1 = Math.min(this.nz - 1, j1);
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let pass = 0; pass < passes; pass++) {
      let moved = false;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * this.nx + i;
          if (this.pile[k] <= 0) continue;
          const h = this.base[k] + this.pile[k];
          for (const [di, dj] of nb) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nz) continue;
            const nk = nj * this.nx + ni;
            const diff = h - (this.base[nk] + this.pile[nk]) - maxDiff;
            if (diff > 0) {
              const amount = Math.min(this.pile[k], diff * 0.45);
              this.pile[k] -= amount;
              this.pile[nk] += amount;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
  }
}
