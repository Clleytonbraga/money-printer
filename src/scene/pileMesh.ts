import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Heightfield } from '../physics/heightfield';

/**
 * The surface of the pile, where bills that are no longer simulated live on.
 * It is a displaced grid following the heightfield, textured with a collage
 * of bills, and cut away (ragged, like paper edges) where the pile is thin.
 */
export class PileMesh {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.PlaneGeometry;
  private readonly amount: THREE.BufferAttribute;
  private seenVersion = -1;
  private readonly step = 2;
  private readonly cols: number;
  private readonly rows: number;

  constructor(private readonly field: Heightfield, texture: THREE.Texture) {
    this.cols = Math.floor((field.nx - 1) / this.step);
    this.rows = Math.floor((field.nz - 1) / this.step);
    const w = this.cols * this.step * field.cell;
    const d = this.rows * this.step * field.cell;
    this.geo = new THREE.PlaneGeometry(w, d, this.cols, this.rows);
    this.geo.rotateX(-Math.PI / 2);
    this.geo.translate(field.minX + w / 2, 0, field.minZ + d / 2);
    this.amount = new THREE.BufferAttribute(new Float32Array(this.geo.attributes.position.count), 1);
    this.geo.setAttribute('aPile', this.amount);

    // World-space UVs so the collage keeps its scale as the pile grows.
    const uv = this.geo.attributes.uv as THREE.BufferAttribute;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const tile = 0.75;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);

    texture.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aPile;\nvarying float vPile;\nvarying vec2 vWorldXZ;\nvarying vec3 vPilePos;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPile = aPile;\nvWorldXZ = position.xz;\nvPilePos = position;',
      );
      shader.fragmentShader = 'varying float vPile;\nvarying vec2 vWorldXZ;\nvarying vec3 vPilePos;\n' + shader.fragmentShader.replace(
        'void main() {',
        /* glsl */ `
        float mpH(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          // Ragged edge: blocky noise at roughly bill size.
          float edge = ${(CONFIG.pile.thickness * 2.5).toFixed(5)} + mpH(vWorldXZ * 9.0) * ${(CONFIG.pile.thickness * 3).toFixed(5)};
          if (vPile < edge) discard;
          // Steeper than any pile can be = the side of the table/printer: not paper.
          vec3 fn = normalize(cross(dFdx(vPilePos), dFdy(vPilePos)));
          if (abs(fn.y) < 0.45) discard;
        `,
      );
    };
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.receiveShadow = true;
    // No shadow casting: its depth pass would ignore the ragged-edge discard
    // and stamp a table-shaped shadow on the floor.
    this.mesh.castShadow = false;
    this.update();
  }

  update(): void {
    if (this.field.version === this.seenVersion) return;
    this.seenVersion = this.field.version;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const f = this.field;
    // The top layer of live bills sits on the pile, so draw the pile a hair lower.
    const sink = CONFIG.pile.thickness * 1.6;
    let k = 0;
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c <= this.cols; c++) {
        const i = c * this.step;
        const j = r * this.step;
        const idx = j * f.nx + i;
        const pile = f.pile[idx];
        pos.setY(k, f.base[idx] + Math.max(0, pile - sink));
        this.amount.setX(k, pile);
        k++;
      }
    }
    pos.needsUpdate = true;
    this.amount.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
