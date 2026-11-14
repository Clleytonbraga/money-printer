export {};
/**
 * Headless check of the paper physics: drops bills from the printer and
 * prints their path, so you can tune CONFIG.physics without a browser.
 *   npx tsx scripts/sim-bill.ts [count]
 */
(globalThis as any).location = { search: '' };
(globalThis as any).matchMedia = () => ({ matches: false });

const { BillBody } = await import('../src/physics/billBody');
const { Heightfield } = await import('../src/physics/heightfield');

const field = new Heightfield();
const n = Number(process.argv[2] ?? 5);
for (let k = 0; k < n; k++) {
  const b = new BillBody();
  let t = 0;
  let firstTouch = -1;
  const xs: number[] = [];
  let flips = 0;
  let lastNy = 1;
  while (b.mode !== 'asleep' && t < 20) {
    b.step(1 / 60, field);
    t += 1 / 60;
    if (b.mode === 'flying') {
      xs.push(b.p.x);
      const ny = 1 - 2 * (b.q.x * b.q.x + b.q.z * b.q.z); // normal.y
      if (Math.sign(ny) !== Math.sign(lastNy)) flips++;
      lastNy = ny;
    }
    if (firstTouch < 0 && b.contacting) firstTouch = t;
  }
  // count direction reversals of x = sideways swoops
  let swoops = 0;
  for (let i = 2; i < xs.length; i++) if ((xs[i] - xs[i - 1]) * (xs[i - 1] - xs[i - 2]) < 0) swoops++;
  console.log(`bill ${k}: touch ${firstTouch.toFixed(2)}s, rest ${t.toFixed(2)}s at (${b.p.x.toFixed(2)}, ${b.p.y.toFixed(3)}, ${b.p.z.toFixed(2)}), swoops ${swoops}, flips ${flips}, crumple ${b.crumpleTarget.toFixed(2)}`);
}
