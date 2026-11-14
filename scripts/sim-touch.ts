export {};
/**
 * Headless check of "pick a bill up and let go":
 *   npx tsx scripts/sim-touch.ts
 * A resting bill is lifted out of the pile, held 1 m up, dropped, and must
 * come to rest again with the pile height back where it was.
 */
import assert from 'node:assert/strict';
(globalThis as any).location = { search: '' };
(globalThis as any).matchMedia = () => ({ matches: false });

const { CONFIG } = await import('../src/config');
const { BillBody } = await import('../src/physics/billBody');
const { Heightfield } = await import('../src/physics/heightfield');

const field = new Heightfield();
const sum = (): number => field.pile.reduce((a, b) => a + b, 0);
const b = new BillBody();
const size = [b.hw * 2, b.hh * 2] as const;

// A bill resting on the floor, in front of the table.
b.mode = 'asleep';
b.p.set(0.3, 0.003, 1);
field.deposit(b.p.x, b.p.z, b.yaw, ...size);
const before = sum();
assert(before > 0);

// Lift it out and hold it 1 m up.
field.deposit(b.p.x, b.p.z, b.yaw, ...size, -CONFIG.pile.thickness);
assert(sum() < before * 0.05, 'the bill left the pile');
b.mode = 'held';
b.target.set(0.3, 1, 1);
for (let i = 0; i < 60; i++) b.step(1 / 60, field);
assert(Math.abs(b.p.y - 1) < 0.01, `held bill follows the hand (y = ${b.p.y.toFixed(3)})`);

// Let go: it must fall, land and sleep.
b.wake();
let t = 0;
while (b.mode !== 'asleep' && t < 20) { b.step(1 / 60, field); t += 1 / 60; }
assert.equal(b.mode, 'asleep');
assert(b.p.y < 0.02, `landed on the floor (y = ${b.p.y.toFixed(3)})`);
field.deposit(b.p.x, b.p.z, b.yaw, ...size);
// The footprint is sampled on a 2 cm grid, so a new angle changes the sum a little.
assert(Math.abs(sum() - before) < before * 0.3, 'pile height is back');

// Dragging moves pile material forward and loses none.
const s0 = sum();
field.shove(b.p.x, b.p.z, 1, 0, CONFIG.touch.sweepRadius);
assert(Math.abs(sum() - s0) < s0 * 1e-4, 'shove conserves the pile');
// A bill swept under the table stays on the floor there (no jump to the table top).
const u = new BillBody();
u.wake(); u.p.set(0.2, 0.05, 0.7); u.q.identity(); u.v.set(0, 1, -2.2);
for (let i = 0; i < 1200 && u.mode !== 'asleep'; i++) u.step(1 / 60, field);
assert(u.p.y < 0.05, `under the table, on the floor (y = ${u.p.y.toFixed(3)})`);
console.log(`ok: held, dropped, rested after ${t.toFixed(2)}s at (${b.p.x.toFixed(2)}, ${b.p.z.toFixed(2)})`);
