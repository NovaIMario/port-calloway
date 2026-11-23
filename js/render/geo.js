// A small geometry builder: collect quads into flat arrays, then make one BufferGeometry.
// Merging the whole city into a handful of meshes keeps the draw-call count low.
import * as THREE from 'three';

const tmp = new THREE.Color();

export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; }
  get count() { return this.p.length / 3; }

  // Corners in counter-clockwise order seen from the front. uvs: [[u,v] x 4]. color: hex or Color.
  quad(a, b, c, d, nrm, uvs, color = 0xffffff) {
    const col = typeof color === 'number' ? tmp.setHex(color) : color;
    const base = this.count;
    for (const [k, p] of [a, b, c, d].entries()) {
      this.p.push(p[0], p[1], p[2]);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.c.push(col.r, col.g, col.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(a, b, c, nrm, uvs, color = 0xffffff) {
    const col = typeof color === 'number' ? tmp.setHex(color) : color;
    const base = this.count;
    for (const [k, p] of [a, b, c].entries()) {
      this.p.push(p[0], p[1], p[2]);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.c.push(col.r, col.g, col.b);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  // Horizontal rectangle facing up, UVs in world metres divided by `tile`.
  flat(x0, z0, x1, z1, y, color = 0xffffff, tile = 8) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
      [[x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], [x0 / tile, z0 / tile]], color);
  }

  // Axis-aligned box. uvFn(face, w, h) may return [u0, v0, u1, v1] for the side faces.
  box(x0, y0, z0, x1, y1, z1, color = 0xffffff, { top = true, bottom = false, sides = true, uvFn = null, topColor = null } = {}) {
    const dx = x1 - x0, dz = z1 - z0, dy = y1 - y0;
    const uvq = (face, w) => {
      const [u0, v0, u1, v1] = uvFn ? uvFn(face, w, dy, y0, y1) : [0, 0, w / 4, dy / 4];
      return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    };
    if (sides) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uvq(0, dx), color);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uvq(1, dx), color);
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uvq(2, dz), color);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uvq(3, dz), color);
    }
    if (top) this.flat(x0, z0, x1, z1, y1, topColor ?? color, 4);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Bake a transform into a copy of a geometry (used to build car bodies from primitives).
export function placed(geom, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geom.clone();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  g.applyMatrix4(m);
  return g;
}
