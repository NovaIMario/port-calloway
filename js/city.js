// The shape of Port Calloway: a grid of roads with some blocks merged into superblocks, a canal
// (the Cut) down the east side crossed by four bridges, and water all round. This module is pure
// data and geometry queries; buildings, props and points of interest are added by citygen.js.

export const N = 10;                 // blocks per side
export const PITCH = 100;            // metres between road centre lines
export const HALF = (N * PITCH) / 2; // the outer ring road sits at +-500
export const HALF_ROAD = 6;          // carriageway half-width: one 6 m lane each way
export const LANE = 3;               // lane centre, measured from the road centre line
export const SIDEWALK = 3;
export const CURB = 0.15;            // pavements and lots are this much higher than the road
export const WATER_Y = -2.4;

export const LAND = { x0: -540, x1: 570, z0: -540, z1: 530 };
export const CANAL_COL = 7;
export const BRIDGES = [0, 3, 6, 10];
export const line = (i) => i * PITCH - HALF;
export const CANAL = { x0: line(7) + HALF_ROAD + SIDEWALK + 6, x1: line(8) - HALF_ROAD - SIDEWALK - 6 };
export const PIERS = [
  { x0: -175, x1: -145, z0: 520, z1: 625 },
  { x0: -35, x1: -5, z0: 520, z1: 600 },
  { x0: 95, x1: 125, z0: 520, z1: 640 },
];
export const POND = { x: 45, z: -255, r: 22 };

// Superblocks: blocks merged by removing the roads between them. Inclusive block ranges.
export const MERGES = [
  { c0: 4, r0: 1, c1: 5, r1: 2, kind: 'park', name: 'Ferris Park' },
  { c0: 3, r0: 9, c1: 6, r1: 9, kind: 'docks', name: 'Halloran Docks' },
  { c0: 8, r0: 4, c1: 9, r1: 5, kind: 'arena', name: 'Calloway Arena' },
  { c0: 0, r0: 8, c1: 1, r1: 9, kind: 'works', name: 'Westgate Works' },
  { c0: 0, r0: 1, c1: 0, r1: 2 },
  { c0: 2, r0: 0, c1: 2, r1: 1 },
  { c0: 0, r0: 5, c1: 1, r1: 5 },
  { c0: 2, r0: 6, c1: 2, r1: 7 },
  { c0: 5, r0: 7, c1: 6, r1: 7 },
];

export const DISTRICT_NAMES = {
  hillside: 'Hillside', oldtown: 'Old Town', westgate: 'Westgate', midtown: 'Midtown',
  downtown: 'Downtown', market: 'Market Row', docks: 'Halloran Docks', eastbank: 'Eastbank',
  strand: 'The Strand', park: 'Ferris Park', arena: 'Calloway Arena', works: 'Westgate Works',
  canal: 'The Cut', coast: 'Calloway Sound',
};

export function districtOf(c, r) {
  if (c === CANAL_COL) return 'canal';
  if (c >= 8) return r <= 3 ? 'eastbank' : 'strand';
  if (c <= 2) return r <= 3 ? 'hillside' : r <= 7 ? 'oldtown' : 'westgate';
  if (r <= 2) return 'midtown';
  if (r <= 6) return 'downtown';
  return r <= 8 ? 'market' : 'docks';
}

// Build the road network: which grid segments exist, the intersections that are left, and the
// regions (blocks or superblocks) between the roads.
export function buildLayout() {
  const vSeg = Array.from({ length: N + 1 }, () => new Array(N).fill(true)); // x-line i, z-line j..j+1
  const hSeg = Array.from({ length: N + 1 }, () => new Array(N).fill(true)); // z-line j, x-line i..i+1
  for (let j = 0; j <= N; j++) if (!BRIDGES.includes(j)) hSeg[j][CANAL_COL] = false;
  for (const m of MERGES) {
    for (let i = m.c0 + 1; i <= m.c1; i++) for (let j = m.r0; j <= m.r1; j++) vSeg[i][j] = false;
    for (let j = m.r0 + 1; j <= m.r1; j++) for (let i = m.c0; i <= m.c1; i++) hSeg[j][i] = false;
  }

  const nodes = [];
  const nodeAt = (i, j) => nodes[j * (N + 1) + i];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) nodes.push({ id: j * (N + 1) + i, i, j, x: line(i), z: line(j), links: [] });
  }
  const segments = [];
  const link = (a, b, axis) => {
    const s = { id: segments.length, a: a.id, b: b.id, axis };
    segments.push(s);
    a.links.push({ to: b.id, seg: s.id });
    b.links.push({ to: a.id, seg: s.id });
  };
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) if (vSeg[i][j]) link(nodeAt(i, j), nodeAt(i, j + 1), 'z');
  for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) if (hSeg[j][i]) link(nodeAt(i, j), nodeAt(i + 1, j), 'x');
  for (const n of nodes) n.alive = n.links.length > 0;

  // Regions between roads, inset to the kerb line (pavements are inside the region).
  const regions = [];
  const owner = new Map();
  for (const m of MERGES) for (let c = m.c0; c <= m.c1; c++) for (let r = m.r0; r <= m.r1; r++) owner.set(c * 100 + r, m);
  const seen = new Set();
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (c === CANAL_COL) continue;
      const m = owner.get(c * 100 + r) || { c0: c, r0: r, c1: c, r1: r };
      const key = `${m.c0},${m.r0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      regions.push({
        id: regions.length, c0: m.c0, r0: m.r0, c1: m.c1, r1: m.r1,
        x0: line(m.c0) + HALF_ROAD, x1: line(m.c1 + 1) - HALF_ROAD,
        z0: line(m.r0) + HALF_ROAD, z1: line(m.r1 + 1) - HALF_ROAD,
        district: m.kind || districtOf(m.c0, m.r0), kind: m.kind || 'block', name: m.name || null,
      });
    }
  }
  return { vSeg, hSeg, nodes, segments, regions, nodeAt };
}

// Is (x, z) on a carriageway?
export function onRoad(L, x, z) {
  const fi = (x + HALF) / PITCH, fj = (z + HALF) / PITCH;
  const i = Math.round(fi), j = Math.round(fj);
  const nearX = i >= 0 && i <= N && Math.abs(x - line(i)) <= HALF_ROAD;
  const nearZ = j >= 0 && j <= N && Math.abs(z - line(j)) <= HALF_ROAD;
  if (nearX && nearZ) return L.nodeAt(i, j).alive;
  if (nearX) { const s = Math.floor(fj); return s >= 0 && s < N && L.vSeg[i][s]; }
  if (nearZ) { const s = Math.floor(fi); return s >= 0 && s < N && L.hSeg[j][s]; }
  return false;
}

export function onBridge(x, z) {
  if (x < line(CANAL_COL) || x > line(CANAL_COL + 1)) return false;
  return BRIDGES.some((j) => Math.abs(z - line(j)) <= HALF_ROAD + SIDEWALK);
}

export function isWater(x, z) {
  const inLand = x >= LAND.x0 && x <= LAND.x1 && z >= LAND.z0 && z <= LAND.z1;
  if (!inLand) return !PIERS.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);
  if (x > CANAL.x0 && x < CANAL.x1 && !onBridge(x, z)) return true;
  const dx = x - POND.x, dz = z - POND.z;
  return dx * dx + dz * dz < POND.r * POND.r;
}

// Height of the ground (ignoring ramps), or null over water.
export function baseHeight(L, x, z) {
  if (isWater(x, z)) return null;
  return onRoad(L, x, z) ? 0 : CURB;
}

// Which named area a point is in, for the HUD.
export function areaName(L, x, z) {
  if (isWater(x, z)) return x > CANAL.x0 && x < CANAL.x1 && z > LAND.z0 && z < LAND.z1 ? DISTRICT_NAMES.canal : DISTRICT_NAMES.coast;
  if (PIERS.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) && z > LAND.z1) return 'Ferry Piers';
  const c = Math.floor((x + HALF) / PITCH), r = Math.floor((z + HALF) / PITCH);
  if (c < 0 || c >= N || r < 0 || r >= N) {
    if (x > HALF) return 'Calloway Beach';
    if (z > HALF) return DISTRICT_NAMES.docks;
    return z < -HALF ? 'North Shore' : 'West Cliffs';
  }
  const reg = L.regions.find((g) => c >= g.c0 && c <= g.c1 && r >= g.r0 && r <= g.r1);
  return DISTRICT_NAMES[reg ? reg.district : districtOf(c, r)];
}
