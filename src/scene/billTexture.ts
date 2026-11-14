import * as THREE from 'three';
import { CONFIG } from '../config';

/** Where the empty portrait circle sits on the bill art (fractions of w/h). */
export const PORTRAIT = { cx: 0.5, cy: 0.5, rx: 0.182, ry: 0.3525 };
const INK = '#3f6f4c';
/** Turns the green art into the gold (paid ink) bill on a 2D canvas. Same values in style.css. */
export const GOLD_FILTER = 'sepia(1) saturate(2.4) hue-rotate(-12deg) brightness(1.05)';

let baseArt: HTMLCanvasElement | HTMLImageElement | null = null;

/** Load the bill art once. Falls back to a drawn bill if the file is missing. */
export async function loadBillArt(): Promise<HTMLCanvasElement | HTMLImageElement> {
  if (baseArt) return baseArt;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = CONFIG.bill.textureSrc;
    await img.decode();
    baseArt = img;
  } catch {
    baseArt = drawFallbackBill();
  }
  return baseArt;
}

/** A plausible fictional note so the project runs before the real art is added. */
function drawFallbackBill(): HTMLCanvasElement {
  const W = 1024, H = 434;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const paper = g.createLinearGradient(0, 0, W, H);
  paper.addColorStop(0, '#e3ead9'); paper.addColorStop(1, '#d5e0cc');
  g.fillStyle = paper; g.fillRect(0, 0, W, H);
  // Fine guilloche lines.
  g.strokeStyle = 'rgba(63,111,76,0.25)'; g.lineWidth = 1;
  for (let k = 0; k < 60; k++) {
    g.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = H / 2 + Math.sin(x * 0.02 + k * 0.35) * (H * 0.42) * Math.cos(k * 0.11);
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  g.strokeStyle = INK; g.lineWidth = 10; g.strokeRect(18, 18, W - 36, H - 36);
  g.lineWidth = 2; g.strokeRect(36, 36, W - 72, H - 72);
  // Portrait circle (left empty for the photo).
  g.fillStyle = '#eef3e8';
  g.beginPath();
  g.ellipse(W * PORTRAIT.cx, H * PORTRAIT.cy, W * PORTRAIT.rx, H * PORTRAIT.ry, 0, 0, Math.PI * 2);
  g.fill(); g.lineWidth = 4; g.stroke();
  g.fillStyle = INK; g.textAlign = 'center';
  g.font = '600 40px Georgia, serif';
  g.fillText('THE MONEY PRINTER', W / 2, 92);
  g.font = '700 90px Georgia, serif';
  g.fillText('1', 110, 140); g.fillText('1', W - 110, H - 70);
  g.font = '500 22px Georgia, serif';
  g.fillText('TOY MONEY · NOT LEGAL TENDER', W / 2, H - 58);
  return c;
}

export interface PhotoOptions {
  image: CanvasImageSource & { width: number; height: number };
  /** 1 = fit the circle, 3 = 3x closer. */
  zoom: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Photo -> banknote engraving, w x h, ink on white.
 * Any photo works: levels are stretched first, so a dark or flat picture
 * still gets full contrast. Tone is then drawn the way a note's portrait is:
 * wavy ink lines that get thicker where the photo is darker, a second set of
 * crossing lines in the shadows, and a soft fade to bare paper at the edge.
 */
function engrave(photo: PhotoOptions, w: number, h: number): HTMLCanvasElement {
  const E = CONFIG.portrait;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = c.getContext('2d', { willReadFrequently: true })!;
  t.fillStyle = '#fff'; t.fillRect(0, 0, w, h);
  const s = Math.max(w / photo.image.width, h / photo.image.height) * photo.zoom;
  const pw = photo.image.width * s, ph = photo.image.height * s;
  t.drawImage(photo.image, (w - pw) / 2, (h - ph) / 2, pw, ph);

  const img = t.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    hist[lum[i] | 0]++;
  }
  // Auto levels: ignore the darkest and brightest 2 %.
  const cut = lum.length * 0.02;
  let lo = 0, hi = 255;
  for (let n = 0; lo < 255 && (n += hist[lo]) < cut; lo++);
  for (let n = 0; hi > lo + 1 && (n += hist[hi]) < cut; hi--);

  const ink = [parseInt(INK.slice(1, 3), 16), parseInt(INK.slice(3, 5), 16), parseInt(INK.slice(5, 7), 16)];
  const k = (Math.PI * 2) / E.linePitch;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const edge = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
      const dark = Math.pow(1 - Math.min(1, Math.max(0, (lum[i] - lo) / (hi - lo))), E.gamma) * smooth(1, E.fade, edge);
      // Main lines run across the face and wave a little, like a guilloche.
      const l1 = 0.5 + 0.5 * Math.sin((y + Math.sin(x * 0.035) * E.wave) * k);
      // Cross lines only where it is really dark.
      const l2 = 0.5 + 0.5 * Math.sin((x * 0.8 + y * 0.6) * k);
      const a = Math.max(
        smooth(l1 - E.soft, l1 + E.soft, dark * 1.15),
        smooth(l2 - E.soft, l2 + E.soft, (dark - E.crossFrom) / (1 - E.crossFrom)),
      );
      // Lines carry most of the tone; a wash under them keeps the face readable when small.
      const amount = Math.min(1, a * E.lines + dark * E.wash);
      for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = 255 + (ink[ch] - 255) * amount;
      d[i * 4 + 3] = 255;
    }
  }
  t.putImageData(img, 0, 0);
  return c;
}

/**
 * Bill art, optionally with a portrait printed into the circle, engraved in
 * the bill's own ink (see `engrave`).
 */
export function composeBill(art: CanvasImageSource & { width: number; height: number }, photo?: PhotoOptions): HTMLCanvasElement {
  const W = 1024;
  const H = Math.round((W * art.height) / art.width);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.drawImage(art, 0, 0, W, H);
  if (!photo) return c;

  const cx = W * PORTRAIT.cx, cy = H * PORTRAIT.cy, rx = W * PORTRAIT.rx, ry = H * PORTRAIT.ry;

  const tmp = engrave(photo, Math.ceil(rx * 2), Math.ceil(ry * 2));

  // Multiply into the circle: white stays paper, ink darkens it.
  g.save();
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.clip();
  g.globalCompositeOperation = 'multiply';
  g.drawImage(tmp, cx - rx, cy - ry);
  // A little of the note's own paper back on top, so the two sit together.
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = CONFIG.portrait.paper;
  g.drawImage(art, 0, 0, W, H);
  g.restore();
  return c;
}

export function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A tileable collage of bills for the surface of the big pile. */
export function makePileTexture(art: CanvasImageSource & { width: number; height: number }): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b9c7ad'; g.fillRect(0, 0, S, S);
  const bw = 230, bh = Math.round((bw * art.height) / art.width);
  // Tint each variant ONCE. A canvas filter or shadowBlur on every one of the
  // ~1,260 stamps below stalls the GPU process on real hardware until the
  // browser kills it, and the page then loses its WebGL context.
  const stamp = (filter: string): HTMLCanvasElement => {
    const t = document.createElement('canvas');
    t.width = bw; t.height = bh;
    const tg = t.getContext('2d')!;
    tg.filter = filter;
    tg.drawImage(art, 0, 0, bw, bh);
    return t;
  };
  const green = stamp('none');
  const golden = stamp(GOLD_FILTER);
  const reach = Math.hypot(bw, bh) / 2 + 8;
  for (let k = 0; k < 140; k++) {
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI * 2;
    const art2 = Math.random() < 0.18 ? golden : green;
    const shade = art2 === golden ? 0 : Math.random() * 0.2;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const px = x + ox, py = y + oy;
      if (px < -reach || px > S + reach || py < -reach || py > S + reach) continue;   // wrapped copy is off-canvas
      g.save();
      g.translate(px, py); g.rotate(a);
      g.fillStyle = 'rgba(0,0,0,0.22)';                       // cheap drop shadow
      g.fillRect(-bw / 2 - 2, -bh / 2, bw + 6, bh + 6);
      g.drawImage(art2, -bw / 2, -bh / 2);
      if (shade > 0) { g.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`; g.fillRect(-bw / 2, -bh / 2, bw, bh); }
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
