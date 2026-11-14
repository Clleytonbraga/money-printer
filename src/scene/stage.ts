import * as THREE from 'three';
import { CONFIG, LITE } from '../config';

/**
 * The room photo is the backdrop. A transparent WebGL canvas sits exactly on
 * top of it, locked to the photo's aspect ratio, so a camera calibrated once
 * stays matched on every screen size. The pair is scaled like CSS
 * `object-fit: cover` around CONFIG.photo.focus.
 */
export class Stage {
  readonly el: HTMLDivElement;
  readonly photo: HTMLImageElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly floorShadow: THREE.Mesh;
  readonly tableShadow: THREE.Mesh;
  /**
   * Depth-only stand-ins for the table top and printer in the photo, so
   * bills behind or under them are hidden like they would be in the room.
   */
  readonly occluders = new THREE.Group();
  /** Visible only in ?debug: table/printer boxes, slot marker, grid. */
  readonly debugGroup = new THREE.Group();

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'stage';
    root.appendChild(this.el);

    this.photo = new Image();
    this.photo.className = 'stage-photo';
    this.photo.alt = 'White minimalist room with a white table and a printer on it';
    this.photo.src = CONFIG.photo.src;
    this.photo.onerror = () => this.el.classList.add('no-photo');
    this.el.appendChild(this.photo);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(LITE ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.className = 'stage-canvas';
    this.el.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, CONFIG.photo.aspect, 0.05, 50);

    // Light that agrees with a bright, soft, white room: big sky fill plus a
    // window light from upper left that throws soft contact shadows.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdcd8d2, 2.2));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-2.5, 4.5, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(LITE ? 1024 : 2048);
    this.sun.shadow.radius = 6;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.01;
    const sc = this.sun.shadow.camera;
    sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 12;
    this.scene.add(this.sun);

    // Invisible surfaces that only receive shadows, drawn over the photo.
    const catcher = new THREE.ShadowMaterial({ opacity: 0.22 });
    this.floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), catcher);
    this.floorShadow.rotation.x = -Math.PI / 2;
    this.floorShadow.receiveShadow = true;
    this.scene.add(this.floorShadow);

    this.tableShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), catcher);
    this.tableShadow.rotation.x = -Math.PI / 2;
    this.tableShadow.receiveShadow = true;
    this.scene.add(this.tableShadow);

    this.scene.add(this.occluders);
    this.scene.add(this.debugGroup);
    this.debugGroup.visible = false;

    this.applyCalibration();
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  /** Re-read CONFIG (camera, table, printer). Called by the debug panel. */
  applyCalibration(): void {
    const { camera: c, table: t, printer: p, photo } = CONFIG;
    this.camera.fov = c.fov;
    this.camera.aspect = photo.aspect;
    this.camera.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.camera.lookAt(c.target.x, c.target.y, c.target.z);
    this.camera.updateProjectionMatrix();

    this.tableShadow.position.set(t.x, t.top + 0.0005, t.z);
    this.tableShadow.scale.set(t.w, t.d, 1);

    this.occluders.clear();
    const hide = new THREE.MeshBasicMaterial({ colorWrite: false });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.035, t.d), hide);
    slab.position.set(t.x, t.top - 0.0175 - 0.001, t.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), hide);
    body.position.set(p.x, t.top + p.h / 2, p.z);
    for (const m of [slab, body]) { m.renderOrder = -1; this.occluders.add(m); }

    this.debugGroup.clear();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
      const m = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
        new THREE.LineBasicMaterial({ color }),
      );
      m.position.set(x, y, z);
      this.debugGroup.add(m);
    };
    box(t.w, t.top, t.d, t.x, t.top / 2, t.z, 0xff3366);
    box(p.w, p.h, p.d, p.x, t.top + p.h / 2, p.z, 0x3366ff);
    const slot = new THREE.Mesh(new THREE.SphereGeometry(0.015), new THREE.MeshBasicMaterial({ color: 0x00cc66 }));
    slot.position.set(p.slot.x, p.slot.y, p.slot.z);
    this.debugGroup.add(slot);
    const dir = new THREE.Vector3(p.slotDir.x, p.slotDir.y, p.slotDir.z).normalize();
    this.debugGroup.add(new THREE.ArrowHelper(dir, slot.position, 0.25, 0x00cc66));
    const grid = new THREE.GridHelper(6, 30, 0x888888, 0xbbbbbb);
    this.debugGroup.add(grid);
    this.layout();
  }

  /** Size the photo+canvas pair like object-fit: cover. */
  layout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const p = CONFIG.photo;
    const a = p.aspect;
    // Phone upright: photo anchored at the bottom, fading out at the top (CSS mask).
    const portrait = vh > vw;
    this.el.classList.toggle('portrait', portrait);
    let w = vw;
    let h = vw / a;
    const minH = portrait ? vh * p.portraitHeight : vh;
    if (h < minH) { h = minH; w = minH * a; }
    const left = (vw - w) * p.focusX;
    const top = portrait ? vh - h : (vh - h) * (vh < p.shortHeight ? p.focusYShort : p.focusY);
    Object.assign(this.el.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
    this.renderer.setSize(w, h, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Normalised device coords for a pointer event, for raycasting. */
  ndc(ev: PointerEvent | MouseEvent, out = new THREE.Vector2()): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    out.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    return out;
  }
}
