import GUI from 'lil-gui';
import { CONFIG, saveCalibration } from './config';
import type { Stage } from './scene/stage';
import type { World } from './scene/world';
import { store } from './state';

/**
 * `?debug` panel: line the 3D table, printer and slot up with the photo,
 * then "Copy config" and paste into src/config.ts. Values also persist in
 * localStorage while you work.
 */
export function openDebug(stage: Stage, world: World, print: () => void): void {
  stage.debugGroup.visible = true;
  const gui = new GUI({ title: 'Money Printer · calibration' });
  const apply = () => {
    stage.applyCalibration();
    world.field.rebuildBase();
    stage.layout();
    saveCalibration();
  };

  const ph = gui.addFolder('Photo').onChange(apply);
  ph.add(CONFIG.photo, 'aspect', 0.4, 3, 0.001);
  ph.add(CONFIG.photo, 'focusX', 0, 1, 0.01);
  ph.add(CONFIG.photo, 'focusY', 0, 1, 0.01);

  const cam = gui.addFolder('Camera').onChange(apply);
  cam.add(CONFIG.camera, 'fov', 10, 80, 0.1);
  for (const k of ['x', 'y', 'z'] as const) cam.add(CONFIG.camera.pos, k, -8, 8, 0.005).name(`pos ${k}`);
  for (const k of ['x', 'y', 'z'] as const) cam.add(CONFIG.camera.target, k, -4, 4, 0.005).name(`target ${k}`);

  const t = gui.addFolder('Table').onChange(apply);
  t.add(CONFIG.table, 'x', -2, 2, 0.005);
  t.add(CONFIG.table, 'z', -2, 2, 0.005);
  t.add(CONFIG.table, 'w', 0.2, 3, 0.005);
  t.add(CONFIG.table, 'd', 0.2, 2, 0.005);
  t.add(CONFIG.table, 'top', 0.3, 1.2, 0.005);

  const p = gui.addFolder('Printer').onChange(apply);
  p.add(CONFIG.printer, 'x', -2, 2, 0.005);
  p.add(CONFIG.printer, 'z', -2, 2, 0.005);
  p.add(CONFIG.printer, 'w', 0.1, 1, 0.005);
  p.add(CONFIG.printer, 'd', 0.1, 1, 0.005);
  p.add(CONFIG.printer, 'h', 0.05, 0.6, 0.005);
  for (const k of ['x', 'y', 'z'] as const) p.add(CONFIG.printer.slot, k, -2, 2, 0.005).name(`slot ${k}`);
  for (const k of ['x', 'y', 'z'] as const) p.add(CONFIG.printer.slotDir, k, -1, 1, 0.01).name(`dir ${k}`);
  p.add(CONFIG.printer, 'emergeTime', 0.3, 4, 0.05);
  p.add(CONFIG.printer, 'releaseSpeed', 0, 2, 0.01);

  const phys = gui.addFolder('Paper physics');
  const P = CONFIG.physics;
  phys.add(P, 'kNormal', 0.5, 30, 0.1).name('face drag');
  phys.add(P, 'kTangent', 0, 3, 0.01).name('edge drag');
  phys.add(P, 'kLift', 0, 5, 0.01).name('lift');
  phys.add(P, 'copShift', 0, 1, 0.01).name('flutter (CoP shift)');
  phys.add(P, 'kTorque', 0, 5, 0.01).name('aero torque');
  phys.add(P, 'rotDamp', 0, 10, 0.05).name('spin damping');
  phys.add(P, 'windStrength', 0, 1, 0.01).name('room draft');
  phys.add(P, 'friction', 0, 1.5, 0.01).name('friction');
  phys.add(P, 'flatten', 0, 300, 1).name('lie-flat on contact');
  phys.add(CONFIG.bill, 'scale', 0.5, 4, 0.05).name('bill scale (reload)');
  phys.close();

  gui.add({ print: () => { store.set({ free: store.state.free + 1 }); print(); } }, 'print').name('Print one (free)');
  gui.add({ ten: () => { store.set({ free: store.state.free + 10 }); for (let i = 0; i < 10; i++) print(); } }, 'ten').name('Print ten (free)');
  gui.add({ reset: () => { localStorage.clear(); location.reload(); } }, 'reset').name('Reset wallet + calibration');
  gui.add({
    copy: () => {
      const { photo, camera, table, printer } = CONFIG;
      void navigator.clipboard.writeText(JSON.stringify({ photo, camera, table, printer }, null, 2));
    },
  }, 'copy').name('Copy config');
}
