/**
 * Everything that must be tuned to match the room photo lives here.
 * Open the app with `?debug` to get a live panel; "Copy config" puts the
 * current values on the clipboard so you can paste them back in here.
 *
 * World units are metres. Floor is y = 0. +z points toward the camera.
 */
export const CONFIG = {
  photo: {
    /** Drop your room photo here (the one from the design canvas). */
    src: 'assets/room.jpg',
    /** Width / height of the photo. The 3D stage is locked to this aspect. */
    aspect: 1536 / 1024,
    /** Which point of the photo stays visible when the screen crops it (0..1). */
    focusX: 0.5,
    focusY: 0.75,
    /** Same, on a phone held sideways (viewport shorter than `shortHeight` px). */
    focusYShort: 0.82,
    shortHeight: 500,
    /** Phone upright: the photo sits at the bottom and takes this share of the height. */
    portraitHeight: 700 / 844,
  },
  camera: {
    fov: 27.5,
    pos: { x: 0, y: 1.33, z: 6.625 },
    target: { x: 0, y: 1.1, z: 0 },
  },
  table: { x: 0, z: 0, w: 1.5, d: 0.75, top: 0.74 },
  printer: {
    x: 0, z: 0.04, w: 0.9, d: 0.45, h: 0.35,
    /** Where the paper comes out, and the direction it travels. */
    slot: { x: 0, y: 0.87, z: 0.265 },
    slotDir: { x: 0, y: -0.25, z: 1 },
    /** Output tray in front of the slot: the paper slides down it, then drops. */
    tray: { length: 0.14, drop: 0.1 },
    /** Seconds the bill takes to slide out of the slot. */
    emergeTime: 1.25,
    /** Push the bill gets when the printer lets go (m/s). */
    releaseSpeed: 0.9,
  },
  bill: {
    /** Real banknote is 15.6 x 6.6 cm. `scale` exaggerates so it reads on screen. */
    w: 0.156,
    h: 0.066,
    scale: 1.5,
    segX: 22,
    segY: 9,
    /** Green bill art. Missing file -> a procedural bill is drawn instead. */
    textureSrc: 'assets/bill-green.webp',
    /** Face value printed on both sides of the portrait. "Ray" is the toy currency. */
    value: '200',
    unit: 'RAY',
  },
  /** How the buyer's photo is engraved into the bill (billTexture.ts `engrave`). */
  portrait: {
    /** Distance between ink lines, in texture pixels (the circle is ~370 px wide). */
    linePitch: 5,
    /** How much the lines wave (px). */
    wave: 3.2,
    /** Line edge softness: lower = crisper ink. */
    soft: 0.14,
    /** Below 1 lifts the mid tones so faces do not go muddy. */
    gamma: 0.85,
    /** Darkness (0..1) where the crossing lines start. */
    crossFrom: 0.45,
    /** Strength of the lines and of the flat tone under them. */
    lines: 0.9,
    wash: 0.35,
    /** Where the fade to bare paper starts (1 = the edge of the circle). */
    fade: 0.78,
    /** How much of the bill's own paper is laid back over the portrait. */
    paper: 0.2,
  },
  /** The last bills printed stay easy to reach: in view, on top, flat, first to be picked. */
  fresh: {
    count: 8,
    /** How far above the pile surface a fresh bill rests (m). */
    lift: 0.01,
    /** Fresh bills stay almost flat; they crumple like the rest when they stop being fresh. */
    crumple: 0.12,
    /** Tap radius around a fresh bill's centre (CSS px). */
    pickPx: 30,
    /** A bill that landed out of sight slides toward the camera in steps of this (m)... */
    slideStep: 0.04,
    /** ...and takes about this long to get there (s). */
    slideTime: 0.35,
  },
  /** Playing with the bills: tap opens, drag spreads, press-and-hold grabs. */
  touch: {
    /** A press shorter than this (ms) that moved less than tapPx is a tap. */
    tapMs: 250,
    tapPx: 6,
    /** Holding still on a bill this long (ms) picks it up. */
    holdMs: 350,
    /** While still holding still, one more nearby bill joins every N ms. */
    handfulEveryMs: 150,
    handfulMax: 12,
    handfulRadius: 0.14,
    /** How tightly held bills follow the pointer (1/s) and how high they can go (m). */
    follow: 14,
    maxLift: 2.1,
    /** Fastest a bill leaves the hand (m/s). */
    throwMax: 3,
    /** Drag: bills this close (m) to the pointer get pushed along. */
    sweepRadius: 0.1,
    sweepPush: 0.7,
    sweepLift: 0.9,
    sweepMaxSpeed: 2.5,
    /** Share of the pile under the pointer that a drag moves forward. */
    shove: 0.35,
    /** Bills simulated at once, so a wild drag cannot stall the frame. */
    maxAwake: 80,
  },
  physics: {
    gravity: 9.81,
    /** Air resistance against the flat face. Sets terminal speed (~1/sqrt(kN)). */
    kNormal: 7.5,
    /** Air resistance along the face (paper slices through edge-on). */
    kTangent: 0.9,
    /** Extra lift from circulation: more = longer glides and swoops. */
    kLift: 0.4,
    /** How far the centre of pressure moves to the leading edge (flutter driver). */
    copShift: 0.32,
    /** Aero torque gain. */
    kTorque: 1.6,
    /** Rotational air damping (linear, quadratic). */
    rotDamp: 1.2,
    rotDamp2: 0.12,
    /** Gentle room draft (m/s) and how fast it changes. */
    windStrength: 0.12,
    windScale: 0.9,
    /** Paper on paper / wood friction. */
    friction: 0.6,
    /** Paper is floppy: once it touches, it lies down flat instead of rolling. */
    flatten: 90,
    /** Top speed (m/s) at which a bill is pushed out of a surface it sank into. */
    maxPushOut: 0.3,
    substeps: 8,
    sleepSpeed: 0.035,
    sleepSpin: 0.6,
    sleepTime: 0.35,
  },
  pile: {
    /** Floor area that can hold bills: [minX, maxX, minZ, maxZ]. */
    bounds: [-2.6, 2.6, -1.4, 2.2] as [number, number, number, number],
    cell: 0.02,
    /** Height step (m) across one cell that counts as an edge to fall off, not a slope. */
    cliff: 0.1,
    /** A point this far (m) under a surface is beneath it (under the table), not sunk into it. */
    overhang: 0.05,
    /** How much height one crumpled bill adds to the pile (air included). */
    thickness: 0.0012,
    /** Max slope before the pile slides (angle of repose, radians). */
    repose: 0.55,
    /** Bills already printed by everyone (replace with the server count). */
    initialBills: 4312,
    /** Bills kept as real 3D objects. Older ones melt into the pile surface. */
    visualCap: 1100,
  },
  /** Free prints every new visitor gets. */
  freeInk: 3,
};

/**
 * Lighter settings for phones, weak GPUs and `?lite`: fewer vertices per
 * bill, fewer live 3D bills (the pile surface still shows the rest),
 * smaller shadow map, 1x pixel ratio.
 */
export const LITE =
  new URLSearchParams(location.search).has('lite') ||
  matchMedia('(max-width: 700px)').matches ||
  (navigator.hardwareConcurrency ?? 8) <= 4;

if (LITE) {
  CONFIG.bill.segX = 12;
  CONFIG.bill.segY = 5;
  CONFIG.pile.visualCap = 500;
}

const KEY = 'money-printer:calibration';

/** Debug panel saves calibration to localStorage; load it over the defaults. */
export function loadSavedCalibration(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const k of ['photo', 'camera', 'table', 'printer'] as const) {
      if (saved[k]) deepAssign(CONFIG[k] as Record<string, unknown>, saved[k]);
    }
  } catch {
    /* storage can be unavailable; defaults are fine */
  }
}

export function saveCalibration(): void {
  try {
    const { photo, camera, table, printer } = CONFIG;
    localStorage.setItem(KEY, JSON.stringify({ photo, camera, table, printer }));
  } catch {
    /* ignore */
  }
}

function deepAssign(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') {
      deepAssign(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (k in target) {
      target[k] = v;
    }
  }
}
