import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Heightfield } from './heightfield';
import { noise3 } from './noise';

export type BillMode = 'emerging' | 'flying' | 'held' | 'asleep';

const _n = new THREE.Vector3();
const _vrel = new THREE.Vector3();
const _vn = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _f = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _tq = new THREE.Vector3();
const _r = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _az = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _wind = new THREE.Vector3();
const _ww = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Local sample points used for contact (3 x 3 over the sheet). */
const SAMPLES: [number, number][] = [];
for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) SAMPLES.push([u, v]);

/**
 * A banknote as a thin rigid plate falling through air.
 *
 * Aerodynamics follow the quasi-steady "falling paper" model (Andersen,
 * Pesavento & Wang, J. Fluid Mech. 2005), extended to 3D:
 *  - drag that is strong against the face and weak along it, so the sheet
 *    glides sideways instead of dropping straight;
 *  - circulation lift that bends the path into swoops;
 *  - the centre of pressure shifts toward the leading edge, which pitches the
 *    nose up, stalls the glide and reverses it: the classic flutter, and with
 *    more spin, tumbling.
 * Contact is sequential impulses at 9 points against the heightfield, which
 * makes the sheet land on one edge, slap flat and slide a little.
 *
 * Deformation (bend, cup, flutter wave, crumple) is visual only and is fed
 * to the vertex shader as per-bill parameters.
 */
export class BillBody {
  readonly p = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  /** Angular velocity in body space (x = long axis, y = normal, z = short axis). */
  readonly w = new THREE.Vector3();
  mode: BillMode = 'emerging';

  /** Half sizes after the on-screen scale. */
  readonly hw: number;
  readonly hh: number;
  /** Inertia per unit mass about body x/y/z. */
  private readonly I: THREE.Vector3;

  // Emerging from the printer.
  emerge = 0;
  private readonly slot = new THREE.Vector3();
  private readonly slotDir = new THREE.Vector3();
  private readonly slotQ = new THREE.Quaternion();

  // Visual deformation, smoothed so it reads as material, not noise.
  bend = 0;
  cup = 0;
  twist = 0;
  flutter = 0;
  phase = 0;
  crumple = 0;
  crumpleTarget = 0;
  readonly seed = Math.random() * 100;

  /** Where the hand wants this bill while `mode` is 'held'. */
  readonly target = new THREE.Vector3();

  contacting = false;
  /** Touched down somewhere other than the printer tray. */
  landed = false;
  /** Strongest landing impact (m/s), for the rustle sound. */
  impact = 0;
  private restTimer = 0;
  private t = Math.random() * 100;

  constructor() {
    const s = CONFIG.bill.scale;
    this.hw = (CONFIG.bill.w * s) / 2;
    this.hh = (CONFIG.bill.h * s) / 2;
    const L = this.hw * 2;
    const W = this.hh * 2;
    // Thin plate; inflated a little so the motion reads at screen scale.
    this.I = new THREE.Vector3(W * W / 12, (L * L + W * W) / 12, L * L / 12).multiplyScalar(2.2);

    const pr = CONFIG.printer;
    this.slot.set(pr.slot.x, pr.slot.y, pr.slot.z);
    this.slotDir.set(pr.slotDir.x, pr.slotDir.y, pr.slotDir.z).normalize();
    // Long side across the slot (like a real bill leaving a printer), face up,
    // travelling along slotDir.
    const fwd = this.slotDir.clone();
    const side = new THREE.Vector3(0, 1, 0).cross(fwd).normalize(); // long axis
    const up = fwd.clone().cross(side).normalize();
    const m = new THREE.Matrix4().makeBasis(side, up, fwd);
    this.slotQ.setFromRotationMatrix(m);
    this.q.copy(this.slotQ);
    this.p.copy(this.slot).addScaledVector(this.slotDir, -this.hh);
  }

  /** Advance one frame. Returns true the frame the bill falls asleep. */
  step(dt: number, field: Heightfield): boolean {
    if (this.mode === 'asleep') {
      this.crumple += (this.crumpleTarget - this.crumple) * Math.min(1, dt * 6);
      return false;
    }
    this.t += dt;
    if (this.mode === 'emerging') {
      this.stepEmerging(dt);
      return false;
    }
    if (this.mode === 'held') {
      // Follow the hand with a little lag; remember its speed for the throw.
      _tmp.copy(this.target).sub(this.p).multiplyScalar(Math.min(1, dt * CONFIG.touch.follow));
      this.p.add(_tmp);
      if (dt > 0) this.v.lerp(_tmp.divideScalar(dt), 0.35);
      this.contacting = false;
      this.updateDeformation(dt);
      return false;
    }
    const n = CONFIG.physics.substeps;
    const h = Math.min(dt, 1 / 30) / n;
    for (let i = 0; i < n; i++) this.integrate(h, field);
    this.updateDeformation(dt);
    return this.checkSleep(dt, field);
  }

  private stepEmerging(dt: number): void {
    const pr = CONFIG.printer;
    this.emerge = Math.min(1, this.emerge + dt / pr.emergeTime);
    // Stepper motor: slightly jerky feed.
    const e = this.emerge;
    const jitter = Math.sin(this.t * 70) * 0.0015 * (1 - e);
    const travel = (e * 2 * this.hh) - this.hh + jitter;
    this.p.copy(this.slot).addScaledVector(this.slotDir, travel);
    this.q.copy(this.slotQ);
    // The part that sticks out sags under its own weight (cantilever ~ e^2).
    this.bend = 0;
    this.cup = -0.15;
    this.twist = 0;
    this.flutter = 0;
    if (e >= 1) this.release();
  }

  /** A settled bill is disturbed (swept or picked up) and simulates again. */
  wake(): void {
    this.mode = 'flying';
    this.restTimer = 0;
  }

  /** The printer lets go: the sheet slides off with a small push and a tilt. */
  release(): void {
    this.mode = 'flying';
    this.v.copy(this.slotDir).multiplyScalar(CONFIG.printer.releaseSpeed);
    this.v.y -= 0.15;
    this.w.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3);
  }

  /** Emerging sag for the shader: 0..1 along the feed direction. */
  get sag(): number {
    return this.mode === 'emerging' ? this.emerge * this.emerge : 0;
  }

  private integrate(dt: number, field: Heightfield): void {
    const P = CONFIG.physics;
    _acc.set(0, -P.gravity, 0);
    _tq.set(0, 0, 0);

    _n.set(0, 1, 0).applyQuaternion(this.q);
    _ax.set(1, 0, 0).applyQuaternion(this.q);
    _az.set(0, 0, 1).applyQuaternion(this.q);

    // Air, relative to a slow, smooth room draft.
    const ws = P.windScale;
    _wind.set(
      noise3(this.p.x * ws, this.p.y * ws, this.t * 0.3) * P.windStrength,
      noise3(this.p.x * ws + 31, this.p.y * ws, this.t * 0.3) * P.windStrength * 0.4,
      noise3(this.p.z * ws + 77, this.p.y * ws, this.t * 0.3) * P.windStrength,
    );
    _vrel.copy(this.v).sub(_wind);
    const speed = _vrel.length();

    if (speed > 1e-4) {
      const vnS = _vrel.dot(_n);
      _vn.copy(_n).multiplyScalar(vnS);
      _vt.copy(_vrel).sub(_vn);
      const vtS = _vt.length();

      // Face force ~ |v| * v_n: quadratic drag when broadside, and lift-like
      // (linear in the angle of attack) when nearly edge-on, like a thin wing.
      _f.copy(_vn).multiplyScalar(-P.kNormal * speed);
      _acc.add(_f);
      _acc.addScaledVector(_vt, -P.kTangent * vtS);

      // Circulation lift ~ |v| sin(2a), perpendicular to the flow.
      const cosA = vnS / speed;
      const sinA = vtS / speed;
      _tmp.copy(_n).addScaledVector(_vrel, -vnS / (speed * speed));
      if (_tmp.lengthSq() > 1e-8) {
        _tmp.normalize();
        _acc.addScaledVector(_tmp, -Math.sign(vnS) * P.kLift * speed * speed * 2 * sinA * Math.abs(cosA) * 0.5);
      }

      // Centre of pressure moves toward the leading edge when edge-on.
      if (vtS > 1e-4) {
        _tmp.copy(_vt).divideScalar(vtS);
        const extent = Math.abs(_tmp.dot(_ax)) * this.hw + Math.abs(_tmp.dot(_az)) * this.hh;
        _r.copy(_tmp).multiplyScalar(P.copShift * extent * (1 - Math.abs(cosA)));
        _tq.add(_tmp.copy(_r).cross(_f).multiplyScalar(P.kTorque));
      }
    }

    // Integrate air + gravity (semi-implicit Euler).
    this.v.addScaledVector(_acc, dt);
    _qInv.copy(this.q).invert();
    _tq.applyQuaternion(_qInv);
    const w = this.w;
    w.x += (_tq.x / this.I.x) * dt;
    w.y += (_tq.y / this.I.y) * dt;
    w.z += (_tq.z / this.I.z) * dt;

    // Contacts: sequential impulses at 9 points (stable at any speed).
    this.contacting = false;
    this.solveContacts(dt, field);

    // Floppy paper: once it touches, it lies down instead of rolling on an edge.
    if (this.contacting) {
      _n.set(0, 1, 0).applyQuaternion(this.q);
      const up = _n.y >= 0 ? 1 : -1;
      _tmp.set(0, up, 0).cross(_n).multiplyScalar(-P.flatten * dt).applyQuaternion(_qInv);
      w.add(_tmp);
    }

    // Air resists spinning (implicit, so it can never blow up). Turning about
    // the long axis sweeps the whole face through the air: damp it most.
    const spin = w.length();
    const d = (P.rotDamp + P.rotDamp2 * spin) * dt + (this.contacting ? 20 * dt : 0);
    w.x /= 1 + d * 1.8;
    w.y /= 1 + d * 0.8;
    w.z /= 1 + d;

    this.p.addScaledVector(this.v, dt);
    const ang = w.length() * dt;
    if (ang > 1e-9) {
      _tmp.copy(w).normalize();
      _dq.setFromAxisAngle(_tmp, ang);
      this.q.multiply(_dq).normalize();
    }

    // Never tunnel through the ground.
    const floor = field.height(this.p.x, this.p.z, this.p.y);
    if (this.p.y < floor) {
      this.p.y = floor;
      if (this.v.y < 0) this.v.y = 0;
    }
  }

  /** World-space inverse inertia times a vector. */
  private invI(vWorld: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(vWorld).applyQuaternion(_qInv);
    out.set(out.x / this.I.x, out.y / this.I.y, out.z / this.I.z);
    return out.applyQuaternion(this.q);
  }

  private solveContacts(dt: number, field: Heightfield): void {
    const P = CONFIG.physics;
    const wW = _ww.copy(this.w).applyQuaternion(this.q);
    for (let iter = 0; iter < 2; iter++) {
      for (const [su, sv] of SAMPLES) {
        _r.set(su * this.hw, 0, sv * this.hh).applyQuaternion(this.q);
        const sx = this.p.x + _r.x;
        const sy = this.p.y + _r.y;
        const sz = this.p.z + _r.z;
        // Under the tray or the table, height() answers with the floor.
        const depth = field.height(sx, sz, sy) + 0.001 - sy;
        if (depth <= -0.002) continue;
        // Point velocity = v + w x r.
        _pv.copy(wW).cross(_r).add(this.v);
        const vn = _pv.y;
        if (depth <= 0 && vn >= 0) continue;
        this.contacting = true;
        if (iter === 0 && -vn > this.impact) this.impact = -vn;

        // Normal impulse along +y; push out of penetration gently (Baumgarte).
        _rn.copy(_r).cross(_up);
        const kN = 1 + this.invI(_rn, _tmp).cross(_r).dot(_up);
        // Capped: an uncapped bias turned a 5 cm step (table edge, pile slope)
        // into a 5 m/s kick that threw the bill back up into the air.
        const bias = Math.min(P.maxPushOut, Math.max(0, depth - 0.0005) * 0.2 / dt);
        const jn = Math.max(0, (-vn + bias) / kN) / (iter === 0 ? 1 : 2);
        if (jn <= 0) continue;
        this.v.y += jn;
        wW.add(this.invI(_rn.multiplyScalar(jn), _tmp));

        // Friction impulse, capped by Coulomb's cone.
        _pv.copy(wW).cross(_r).add(this.v);
        _f.set(_pv.x, 0, _pv.z);
        const vt = _f.length();
        if (vt > 1e-6) {
          _f.divideScalar(vt);
          _rn.copy(_r).cross(_f);
          const kT = 1 + this.invI(_rn, _tmp).cross(_r).dot(_f);
          const jt = Math.min(vt / kT, P.friction * field.friction(sx, sz) * jn);
          this.v.addScaledVector(_f, -jt);
          wW.add(this.invI(_rn.multiplyScalar(-jt), _tmp));
        }
      }
    }
    this.w.copy(wW).applyQuaternion(_qInv);
  }

  /** Paper bends away from the air hitting it and ripples along its length. */
  private updateDeformation(dt: number): void {
    _n.set(0, 1, 0).applyQuaternion(this.q);
    const vn = this.v.dot(_n);
    const speed = this.v.length();
    const k = Math.min(1, dt * 10);
    const air = this.contacting ? 0 : 1;
    const bendT = THREE.MathUtils.clamp(vn * 0.55, -0.7, 0.7) * air + THREE.MathUtils.clamp(this.w.z * 0.03, -0.3, 0.3) * air;
    const cupT = THREE.MathUtils.clamp(vn * 0.35, -0.5, 0.5) * air;
    const twistT = THREE.MathUtils.clamp(this.w.x * 0.05, -0.45, 0.45) * air;
    const flutT = Math.min(0.6, speed * 0.5) * air;
    this.bend += (bendT - this.bend) * k;
    this.cup += (cupT - this.cup) * k;
    this.twist += (twistT - this.twist) * k;
    this.flutter += (flutT - this.flutter) * k;
    this.phase += dt * (6 + speed * 14);
    const pr = CONFIG.printer;
    if (this.contacting && !this.landed && this.p.y < pr.slot.y - pr.tray.drop - 0.03) {
      // First real landing (not the tray): the sheet folds and creases a little.
      this.landed = true;
      this.crumpleTarget = 0.35 + Math.random() * 0.5;
    }
    this.crumple += (this.crumpleTarget - this.crumple) * Math.min(1, dt * 5);
  }

  private checkSleep(dt: number, field: Heightfield): boolean {
    const P = CONFIG.physics;
    const slow = this.v.length() < P.sleepSpeed && this.w.length() < P.sleepSpin;
    if (this.contacting && slow) this.restTimer += dt;
    else this.restTimer = 0;
    // Safety: anything that has been flying for very long or left the room.
    const lost = this.p.y < -1 || Math.abs(this.p.x) > 6 || Math.abs(this.p.z) > 6;
    if (this.restTimer > P.sleepTime || lost) {
      this.mode = 'asleep';
      this.v.set(0, 0, 0);
      this.w.set(0, 0, 0);
      this.bend = this.cup = this.twist = this.flutter = 0;
      if (lost) this.p.set(0, field.height(0, 0.8), 0.8);
      return true;
    }
    return false;
  }

  /** Yaw of the long axis on the ground plane, for depositing into the pile. */
  get yaw(): number {
    _ax.set(1, 0, 0).applyQuaternion(this.q);
    return Math.atan2(_ax.z, _ax.x);
  }
}
