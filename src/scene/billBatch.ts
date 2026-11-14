import * as THREE from 'three';
import { CONFIG } from '../config';
import type { BillBody } from '../physics/billBody';

export interface Owner {
  name: string;
  text: string;
  link: string;
  photo: boolean;
}

export interface BillRecord {
  id: number;
  gold: boolean;
  owner: Owner | null;
  body: BillBody;
  batch: BillBatch;
  slot: number;
  /** Landing sound already played. */
  heard?: boolean;
}

/**
 * Shared GLSL: the sheet is a flat grid in local XZ (x = long side). Its
 * height is displaced per instance by bend, cup, twist, a travelling
 * flutter wave, the sag while it leaves the printer, and crumple (two
 * creases + paper-scale noise). Normals come from finite differences of the
 * same function so lighting follows every fold.
 */
const DISPLACE = /* glsl */ `
attribute vec4 aDeform;   // bend, cup, twist, flutter
attribute vec4 aDeform2;  // phase, crumple, seed, sag
attribute float aGold;
uniform vec2 uHalf;
varying float vGold;

float mpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mpNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mpHash(i), mpHash(i + vec2(1, 0)), u.x), mix(mpHash(i + vec2(0, 1)), mpHash(i + vec2(1, 1)), u.x), u.y);
}
float mpDisp(vec2 q) {
  float u = q.x / uHalf.x;
  float v = q.y / uHalf.y;
  float y = 0.0;
  y += aDeform.x * u * u * uHalf.x * 0.35;
  y += aDeform.y * v * v * uHalf.y * 0.5;
  y += aDeform.z * u * v * uHalf.y * 0.6;
  y += aDeform.w * sin(u * 3.4 - aDeform2.x) * uHalf.x * 0.07 * (0.35 + 0.65 * abs(u));
  float s = max(0.0, (v + 1.0) * 0.5);
  y -= aDeform2.w * s * s * uHalf.y * 0.55;
  float c = aDeform2.y;
  if (c > 0.0) {
    float sd = aDeform2.z;
    float crease1 = 1.0 - abs(u + sin(sd) * 0.35);
    float crease2 = 1.0 - abs(v * 0.7 + u * 0.35 * cos(sd * 1.3));
    y += c * max(0.0, crease1) * uHalf.y * 0.32;
    y += c * max(0.0, crease2) * uHalf.y * 0.12;
    y += c * (mpNoise(q * 34.0 / uHalf.y * 0.05 + sd) - 0.5) * uHalf.y * 0.14;
    y += c * (mpNoise(q * 120.0 / uHalf.y * 0.05 + sd * 2.0) - 0.5) * uHalf.y * 0.05;
  }
  return y;
}
`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, half: THREE.Vector2, withNormal: boolean): void {
  shader.uniforms.uHalf = { value: half };
  shader.vertexShader = DISPLACE + shader.vertexShader;
  if (withNormal) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
      float mpE = uHalf.y * 0.04;
      float mpH0 = mpDisp(position.xz);
      float mpHx = mpDisp(position.xz + vec2(mpE, 0.0));
      float mpHz = mpDisp(position.xz + vec2(0.0, mpE));
      vec3 objectNormal = normalize(vec3(-(mpHx - mpH0) / mpE, 1.0, -(mpHz - mpH0) / mpE));
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
      #endif
      `,
    );
  }
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    /* glsl */ `
    vec3 transformed = vec3(position);
    transformed.y += mpDisp(position.xz);
    vGold = aGold;
    `,
  );
}

export class BillBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly records: BillRecord[] = [];
  private readonly deform: THREE.InstancedBufferAttribute;
  private readonly deform2: THREE.InstancedBufferAttribute;
  private readonly gold: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(texture: THREE.Texture, readonly capacity: number) {
    const s = CONFIG.bill.scale;
    const half = new THREE.Vector2((CONFIG.bill.w * s) / 2, (CONFIG.bill.h * s) / 2);
    const geo = new THREE.PlaneGeometry(half.x * 2, half.y * 2, CONFIG.bill.segX, CONFIG.bill.segY);
    geo.rotateX(-Math.PI / 2);

    this.deform = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.deform2 = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.gold = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.deform, this.deform2, this.gold]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDeform', this.deform);
    geo.setAttribute('aDeform2', this.deform2);
    geo.setAttribute('aGold', this.gold);

    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      patchVertex(shader, half, true);
      shader.fragmentShader = 'varying float vGold;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          #include <map_fragment>
          if (vGold > 0.5) {
            // Same engraving, printed in gold ink on cream paper.
            float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(vec3(0.20, 0.12, 0.02), vec3(0.95, 0.78, 0.38), smoothstep(0.04, 0.6, l));
          }
          if (!gl_FrontFacing) diffuseColor.rgb *= 0.86;
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, vGold);',
        )
        .replace(
          '#include <metalnessmap_fragment>',
          '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.3, vGold);',
        );
    };

    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = (shader) => patchVertex(shader, half, false);

    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  get full(): boolean {
    return this.records.length >= this.capacity;
  }

  add(rec: Omit<BillRecord, 'batch' | 'slot'>): BillRecord {
    const r = rec as BillRecord;
    r.batch = this;
    r.slot = this.records.length;
    this.records.push(r);
    this.mesh.count = this.records.length;
    this.write(r);
    return r;
  }

  /** Swap-remove: the last instance moves into the freed slot. */
  remove(r: BillRecord): void {
    const last = this.records.pop()!;
    if (last !== r) {
      last.slot = r.slot;
      this.records[r.slot] = last;
      this.write(last);
    }
    this.mesh.count = this.records.length;
  }

  write(r: BillRecord): void {
    const b = r.body;
    this.m.compose(b.p, b.q, this.one);
    this.mesh.setMatrixAt(r.slot, this.m);
    this.deform.setXYZW(r.slot, b.bend, b.cup, b.twist, b.flutter);
    this.deform2.setXYZW(r.slot, b.phase, b.crumple, b.seed, b.sag);
    this.gold.setX(r.slot, r.gold ? 1 : 0);
    this.dirty = true;
  }

  private dirty = false;

  flush(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.deform.needsUpdate = true;
    this.deform2.needsUpdate = true;
    this.gold.needsUpdate = true;
    this.dirty = false;
  }
}
