// Small shared helpers: a seeded random number generator and some maths.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (r, a, b) => a + (b - a) * r();
export const randInt = (r, a, b) => Math.floor(a + (b - a + 1) * r());
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const chance = (r, p) => r() < p;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Wrap an angle to (-PI, PI].
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

// Heading convention used everywhere: forward = (sin h, cos h) in (x, z), which matches
// Three.js rotation.y = h for a model built facing +z. Right = (-cos h, sin h).
export const forwardOf = (h) => ({ x: Math.sin(h), z: Math.cos(h) });
export const rightOf = (h) => ({ x: -Math.cos(h), z: Math.sin(h) });
export const headingOf = (dx, dz) => Math.atan2(dx, dz);

export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

// Deterministic hash of two integers to [0, 1).
export function hash2(x, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A uniform grid for fast "what is near this point" queries.
export class SpatialGrid {
  constructor(cell = 25) {
    this.cell = cell;
    this.map = new Map();
  }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  clear() { this.map.clear(); }
  // Insert an item covering the box [x0, x1] x [z0, z1].
  insert(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this.key(i, j);
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(item);
      }
    }
  }
  // Items whose cells overlap the box. May contain duplicates when an item spans cells.
  query(x0, z0, x1, z1, out = []) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const list = this.map.get(this.key(i, j));
        if (list) for (const it of list) out.push(it);
      }
    }
    return out;
  }
}
