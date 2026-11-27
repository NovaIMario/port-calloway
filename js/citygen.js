// Fills the layout from city.js with buildings, open lots, trees, street lights, traffic lights,
// stunt ramps and the named places the story uses. Deterministic for a given seed.
import {
  N, HALF_ROAD, LANE, SIDEWALK, CURB, LAND, CANAL, CANAL_COL, BRIDGES, PIERS, POND, line,
  buildLayout, baseHeight, isWater, onRoad,
} from './city.js';
import { mulberry32, rand, randInt, pick, clamp, forwardOf, rightOf } from './util.js';

const DIST = {
  hillside: { lot: [16, 26], fill: 0.9, setback: [4, 6], h: [5, 7], styles: ['house'] },
  oldtown: { lot: [11, 20], fill: 0.93, setback: [0, 0.5], h: [8, 17], styles: ['brick', 'plaster', 'brick'] },
  westgate: { lot: [22, 40], fill: 0.8, setback: [2, 5], h: [7, 13], styles: ['warehouse'] },
  midtown: { lot: [18, 30], fill: 0.9, setback: [0, 2], h: [18, 52], styles: ['office', 'plaster', 'brick'] },
  downtown: { lot: [20, 36], fill: 0.92, setback: [0, 1.5], h: [40, 170], styles: ['glass', 'office', 'glass'] },
  market: { lot: [12, 22], fill: 0.93, setback: [0, 0.5], h: [8, 22], styles: ['brick', 'plaster'] },
  eastbank: { lot: [16, 28], fill: 0.88, setback: [1, 3], h: [14, 38], styles: ['plaster', 'office', 'brick'] },
  strand: { lot: [18, 30], fill: 0.85, setback: [2, 5], h: [12, 58], styles: ['hotel', 'plaster', 'hotel'] },
};
const COLORS = {
  glass: [0x5f7f9c, 0x6d8aa3, 0x4f6b84, 0x7895ad, 0x587a8a],
  office: [0xb9b2a6, 0xa9a59c, 0xc8c0b0, 0x9aa1a8, 0xbfb6a0],
  brick: [0x9c5a43, 0x8a4b3a, 0xa86a4f, 0x7d4a3c, 0xb07a5a],
  plaster: [0xd8cdb4, 0xe2d6bf, 0xcdbfa6, 0xd9c3a0, 0xc9d0c4],
  house: [0xe8dcc4, 0xd6c7ae, 0xc9d3d6, 0xe3c9b2, 0xbfcfb8, 0xd8b9a4],
  warehouse: [0x8f969a, 0x7f8a8f, 0x9d9687, 0x6f7b80],
  hotel: [0xf0e4cf, 0xe8d4c0, 0xf2ece0, 0xdcebe6],
};
const ROOFS = [0x7a4b3a, 0x5d4a44, 0x6b5a4a, 0x4f5a63, 0x8a5a44];

const inset = (r, d) => ({ x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d });

function bsp(rect, minS, maxS, r, out, depth = 0) {
  const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
  if ((w <= maxS && d <= maxS) || depth > 9) { out.push(rect); return; }
  const alongX = w > d || (w === d && r() < 0.5);
  const len = alongX ? w : d;
  if (len < 2 * minS) { out.push(rect); return; }
  const cut = clamp(len * rand(r, 0.32, 0.68), minS, len - minS);
  if (alongX) {
    bsp({ ...rect, x1: rect.x0 + cut }, minS, maxS, r, out, depth + 1);
    bsp({ ...rect, x0: rect.x0 + cut }, minS, maxS, r, out, depth + 1);
  } else {
    bsp({ ...rect, z1: rect.z0 + cut }, minS, maxS, r, out, depth + 1);
    bsp({ ...rect, z0: rect.z0 + cut }, minS, maxS, r, out, depth + 1);
  }
}

export function generateCity(seed = 1912) {
  const r = mulberry32(seed);
  const L = buildLayout();
  const city = {
    ...L, seed, buildings: [], surfaces: [], trees: [], lamps: [], signals: [], containers: [],
    parking: [], ramps: [], railings: [], cranes: [], signs: [], pois: {}, colliders: [], round: [],
    shops: [], awnings: [], pickupSpots: [],
  };

  const addBuilding = (rect, h, style, opts = {}) => {
    const b = {
      x0: rect.x0, z0: rect.z0, x1: rect.x1, z1: rect.z1, h, style,
      color: opts.color ?? pick(r, COLORS[style] || COLORS.office),
      roof: opts.roof || (style === 'house' ? 'pitched' : 'flat'), roofColor: pick(r, ROOFS),
      tiers: [{ x0: rect.x0, z0: rect.z0, x1: rect.x1, z1: rect.z1, y0: 0, y1: h }],
    };
    if (opts.tiers !== false && h > 70 && Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) > 20) {
      const h1 = h * rand(r, 0.45, 0.6), h2 = h * rand(r, 0.78, 0.88);
      const a = rand(r, 2, 4), c = a + rand(r, 2, 4);
      b.tiers = [
        { ...b.tiers[0], y1: h1 },
        { ...inset(rect, a), y0: h1, y1: h2 },
        { ...inset(rect, c), y0: h2, y1: h },
      ];
      b.antenna = r() < 0.5;
    }
    city.buildings.push(b);
    city.colliders.push({ type: 'box', x0: rect.x0, z0: rect.z0, x1: rect.x1, z1: rect.z1, h, kind: 'building' });
    return b;
  };
  const addTree = (x, z, kind = 'round', s = rand(r, 0.85, 1.25)) => {
    city.trees.push({ x, z, kind, s });
    city.colliders.push({ type: 'circle', x, z, r: kind === 'palm' ? 0.35 : 0.45, h: 6, kind: 'tree' });
  };
  const addParking = (lot) => {
    city.surfaces.push({ ...lot, kind: 'asphalt' });
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (d < 12 || w < 6) return;
    for (let x = lot.x0 + 1.6; x + 1.4 < lot.x1; x += 3) {
      city.parking.push({ x, z: lot.z0 + 3, h: Math.PI });
      city.parking.push({ x, z: lot.z1 - 3, h: 0 });
    }
  };
  const openLot = (lot, district) => {
    const k = r();
    if (district === 'westgate' || k < 0.45) addParking(lot);
    else if (k < 0.75 || district === 'downtown') {
      city.surfaces.push({ ...lot, kind: 'paving' });
      if (lot.x1 - lot.x0 > 8 && lot.z1 - lot.z0 > 8) addTree((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2);
    } else {
      city.surfaces.push({ ...lot, kind: 'grass' });
      const n = randInt(r, 1, 4);
      for (let i = 0; i < n; i++) addTree(rand(r, lot.x0 + 2, lot.x1 - 2), rand(r, lot.z0 + 2, lot.z1 - 2));
    }
  };

  const fillRegion = (reg) => {
    const S = DIST[reg.district];
    const lots = [];
    bsp(inset(reg, SIDEWALK), S.lot[0], S.lot[1], r, lots);
    const cx = 0, cz = 0;
    for (const lot of lots) {
      if (r() > S.fill) { openLot(lot, reg.district); continue; }
      const style = pick(r, S.styles);
      let h = rand(r, S.h[0], S.h[1]);
      if (reg.district === 'downtown') {
        const centrality = clamp(1 - Math.hypot((lot.x0 + lot.x1) / 2 - cx, (lot.z0 + lot.z1) / 2 - cz) / 320, 0.2, 1);
        h = S.h[0] + (S.h[1] - S.h[0]) * Math.pow(r(), 1.4) * centrality;
      }
      if (style === 'house') {
        city.surfaces.push({ ...lot, kind: 'grass' });
        const w = Math.min(lot.x1 - lot.x0 - 8, rand(r, 9, 13)), d = Math.min(lot.z1 - lot.z0 - 8, rand(r, 9, 12));
        const mx = (lot.x0 + lot.x1) / 2 + rand(r, -1.5, 1.5), mz = (lot.z0 + lot.z1) / 2 + rand(r, -1.5, 1.5);
        if (w > 5 && d > 5) addBuilding({ x0: mx - w / 2, z0: mz - d / 2, x1: mx + w / 2, z1: mz + d / 2 }, h, 'house');
        if (r() < 0.7) addTree(lot.x0 + 2.5, lot.z0 + 2.5 + r() * (lot.z1 - lot.z0 - 5), r() < 0.4 ? 'pine' : 'round');
        continue;
      }
      const sb = rand(r, S.setback[0], S.setback[1]) + 0.6;
      const b = inset(lot, sb);
      if (b.x1 - b.x0 < 6 || b.z1 - b.z0 < 6) { openLot(lot, reg.district); continue; }
      if (sb > 1.5) city.surfaces.push({ ...lot, kind: reg.district === 'strand' ? 'sand' : 'paving' });
      addBuilding(b, h, style);
    }
  };

  // Places the story needs. Each takes a whole block.
  const regionAt = (c, rr) => city.regions.find((g) => c >= g.c0 && c <= g.c1 && rr >= g.r0 && rr <= g.r1);
  const special = new Map();
  const site = (id, c, rr, fn) => { const g = regionAt(c, rr); special.set(g.id, () => fn(g)); return g; };

  site('garage', 1, 6, (g) => {
    city.surfaces.push({ ...inset(g, SIDEWALK), kind: 'asphalt' });
    addBuilding({ x0: g.x0 + 18, z0: g.z0 + 16, x1: g.x0 + 62, z1: g.z0 + 44 }, 9, 'brick', { color: 0x6f8a7a });
    city.signs.push({ x: g.x0 + 40, z: g.z0 + 15.9, y: 7, h: Math.PI, w: 20, text: "BEA'S BODY & PAINT", bg: '#1f3b33', fg: '#f6d27a' });
    addBuilding({ x0: g.x0 + 8, z0: g.z1 - 26, x1: g.x0 + 30, z1: g.z1 - 6 }, 6, 'warehouse');
    for (let i = 0; i < 6; i++) city.parking.push({ x: g.x1 - 30 + i * 3.2, z: g.z1 - 12, h: 0, wreck: true });
    city.pois.garage = { x: g.x0 + 40, z: g.z0 + 8, h: 0, name: "Bea's Body & Paint", road: { x: g.x0 + 40, z: g.z0 - LANE } };
    // the lock-up where cars you buy are kept
    city.shops.push({ id: 'lockup', kind: 'garage', name: "Bea's lock-up", x: g.x0 + 9, z: g.z0 + 10, h: Math.PI, road: { x: g.x0 + 9, z: g.z0 - LANE }, deliver: { x: g.x0 + 9, z: g.z0 + 26, h: Math.PI } });
  });
  site('dealer', 8, 8, (g) => {
    const L = inset(g, SIDEWALK), mx = (g.x0 + g.x1) / 2;
    city.surfaces.push({ ...L, kind: 'paving' });
    addBuilding({ x0: L.x0 + 6, z0: L.z0 + 40, x1: L.x1 - 6, z1: L.z1 - 4 }, 8.5, 'glass', { color: 0x7895ad, tiers: false });
    city.signs.push({ x: mx, z: L.z0 + 39.9, y: 6.4, h: Math.PI, w: 24, text: 'STRAND MOTORS', bg: '#141a2a', fg: '#f2c230' });
    // the range on show, angled towards the street
    const show = [['volantis', 0x9c1f24], ['vantor', 0xf2c230], ['halcyon', 0x23395b], ['vireo', 0xe0703a]];
    show.forEach(([model, color], i) => city.parking.push({ x: L.x0 + 13 + i * 18.5, z: L.z0 + 24, h: Math.PI + 0.55, display: model, color }));
    for (const x of [L.x0 + 2, L.x1 - 2]) addTree(x, L.z0 + 18, 'palm');
    const door = { x: mx, z: L.z0 + 38.2 };
    city.pois.dealer = { ...door, h: Math.PI, name: 'Strand Motors', road: { x: mx, z: g.z0 - LANE } };
    city.shops.push({ id: 'dealer', kind: 'cars', name: 'Strand Motors', ...door, h: Math.PI, road: { x: mx, z: g.z0 - LANE }, deliver: { x: L.x1 - 7, z: L.z0 + 7, h: Math.PI } });
  });
  site('police', 4, 4, (g) => {
    addBuilding({ x0: g.x0 + 4, z0: g.z0 + 4, x1: g.x0 + 46, z1: g.z0 + 52 }, 64, 'office', { color: 0x9ca7b3, tiers: false });
    city.signs.push({ x: g.x0 + 25, z: g.z0 + 52.1, y: 10, h: 0, w: 22, text: 'CALLOWAY POLICE', bg: '#1d3a5c', fg: '#ffffff' });
    addParking({ x0: g.x0 + 50, z0: g.z0 + 4, x1: g.x1 - 4, z1: g.z1 - 4 });
    for (const p of city.parking.slice(-12)) p.police = true;
    city.pois.police = { x: g.x0 + 25, z: g.z1 + 1.5, h: 0, name: 'Police HQ', road: { x: g.x0 + 25, z: g.z1 + LANE } };
  });
  site('hospital', 3, 1, (g) => {
    addBuilding({ x0: g.x0 + 6, z0: g.z0 + 6, x1: g.x1 - 6, z1: g.z0 + 44 }, 30, 'plaster', { color: 0xeef0ee });
    city.signs.push({ x: (g.x0 + g.x1) / 2, z: g.z0 + 44.1, y: 24, h: 0, w: 18, text: 'ST. AGNES HOSPITAL', bg: '#b3262e', fg: '#ffffff' });
    addParking({ x0: g.x0 + 4, z0: g.z0 + 50, x1: g.x1 - 4, z1: g.z1 - 4 });
    city.pois.hospital = { x: (g.x0 + g.x1) / 2, z: g.z1 + 1.5, h: 0, name: 'St. Agnes Hospital', road: { x: (g.x0 + g.x1) / 2, z: g.z1 + LANE } };
  });
  site('hotel', 9, 7, (g) => {
    city.surfaces.push({ ...inset(g, SIDEWALK), kind: 'paving' });
    addBuilding({ x0: g.x0 + 14, z0: g.z0 + 14, x1: g.x1 - 22, z1: g.z1 - 14 }, 96, 'hotel', { color: 0xf3e9d8 });
    city.signs.push({ x: g.x1 - 21.9, z: (g.z0 + g.z1) / 2, y: 80, h: Math.PI / 2, w: 22, text: 'HOTEL MARISOL', bg: '#0f5c63', fg: '#ffe9b8' });
    for (let i = 0; i < 4; i++) addTree(g.x1 - 9, g.z0 + 14 + i * 18, 'palm');
    city.pois.hotel = { x: g.x1 - 1.5, z: (g.z0 + g.z1) / 2, h: -Math.PI / 2, name: 'Hotel Marisol', road: { x: g.x1 + LANE, z: (g.z0 + g.z1) / 2 } };
  });
  site('mansion', 1, 0, (g) => {
    city.surfaces.push({ ...inset(g, SIDEWALK), kind: 'grass' });
    addBuilding({ x0: g.x0 + 22, z0: g.z0 + 14, x1: g.x1 - 22, z1: g.z0 + 40 }, 9, 'house', { color: 0xf1eadb });
    city.surfaces.push({ x0: g.x0 + 30, z0: g.z0 + 46, x1: g.x0 + 46, z1: g.z0 + 54, kind: 'pool' });
    city.surfaces.push({ x0: g.x0 + 36, z0: g.z0 + 58, x1: g.x0 + 52, z1: g.z1 - SIDEWALK, kind: 'paving' });
    for (let i = 0; i < 8; i++) addTree(g.x0 + 8 + i * 10, g.z0 + 8, 'pine');
    city.pois.mansion = { x: g.x0 + 44, z: g.z1 - 10, h: 0, name: 'Lindqvist House', road: { x: g.x0 + 44, z: g.z1 + LANE } };
  });

  for (const g of city.regions) {
    if (special.has(g.id)) { special.get(g.id)(); continue; }
    if (g.kind === 'park') buildPark(city, g, r, addTree, addBuilding);
    else if (g.kind === 'docks') buildDocks(city, g, r, addBuilding);
    else if (g.kind === 'arena') buildArena(city, g, r, addParking);
    else if (g.kind === 'works') buildWorks(city, g, r, addBuilding, addParking);
    else fillRegion(g);
  }
  buildCoast(city, r, addTree, addBuilding);
  buildStreetFurniture(city, r, addTree);
  buildRamps(city);
  for (const s of SHOP_SITES) shopFront(city, regionAt(s.c, s.r), s);
  city.pickupSpots.push(...PICKUP_SPOTS.map((p) => ({ ...p, y: heightAt(city, p.x, p.z) ?? CURB })));
  city.pois.ferry = { x: -20, z: 560, h: Math.PI, name: 'Ferry Terminal', road: { x: -20, z: 512 } };
  city.pois.arena = { x: 303, z: 0, h: 0, name: 'Calloway Arena', road: { x: 303, z: 0 } };
  city.pois.lighthouse = { x: 548, z: -520, h: 0, name: 'Gull Point Lighthouse', road: { x: 497, z: -480 } };
  return city;
}

// Shops on ordinary streets: a ground-floor frontage in the block gets a sign, an awning and a door.
const SHOP_SITES = [
  { id: 'guns-market', kind: 'guns', name: 'Gunwale Arms', c: 3, r: 8, sign: ['#2b1d14', '#f2c230'], awning: 0x8a3b22 },
  { id: 'guns-east', kind: 'guns', name: 'Gunwale Arms', c: 8, r: 1, sign: ['#2b1d14', '#f2c230'], awning: 0x8a3b22 },
  { id: 'clothes', kind: 'clothes', name: 'Threadline', c: 5, r: 5, sign: ['#f7eef2', '#8c2f55'], awning: 0xb8456a },
  { id: 'owl-oldtown', kind: 'food', name: 'Night Owl', c: 0, r: 4, sign: ['#13261d', '#9ff0b8'], awning: 0x2f7a55 },
  { id: 'owl-midtown', kind: 'food', name: 'Night Owl', c: 6, r: 2, sign: ['#13261d', '#9ff0b8'], awning: 0x2f7a55 },
  { id: 'owl-strand', kind: 'food', name: 'Night Owl', c: 9, r: 8, sign: ['#13261d', '#9ff0b8'], awning: 0x2f7a55 },
];

// Things lying about the city that come back a while after you take them.
const PICKUP_SPOTS = [
  { kind: 'weapon', weapon: 'pistol', amount: 36, x: -28, z: 548 },    // on the ferry pier
  { kind: 'weapon', weapon: 'smg', amount: 60, x: -139, z: 449 },      // behind Halloran & Sons
  { kind: 'weapon', weapon: 'shotgun', amount: 12, x: -415, z: 378 },  // in the Westgate Works yard
  { kind: 'weapon', weapon: 'rifle', amount: 60, x: 548, z: -508 },    // at the foot of the lighthouse
  { kind: 'armour', amount: 100, x: 0, z: -300 },                      // the middle of Ferris Park
  { kind: 'cash', amount: 500, x: 100, z: 615, respawn: 600 },          // the end of the east pier
];

function shopFront(city, g, spec) {
  const mid = { x: (g.x0 + g.x1) / 2, z: (g.z0 + g.z1) / 2 };
  const sides = [['n', mid.x, g.z0 - 3], ['s', mid.x, g.z1 + 3], ['w', g.x0 - 3, mid.z], ['e', g.x1 + 3, mid.z]]
    .filter(([, x, z]) => onRoad(city, x, z)).map(([k]) => k);
  let best = null;
  for (const b of city.buildings) {
    if (b.x0 < g.x0 || b.x1 > g.x1 || b.z0 < g.z0 || b.z1 > g.z1 || b.style === 'house' || b.shop) continue;
    for (const k of sides) {
      const gap = k === 'n' ? b.z0 - g.z0 : k === 's' ? g.z1 - b.z1 : k === 'w' ? b.x0 - g.x0 : g.x1 - b.x1;
      const width = k === 'n' || k === 's' ? b.x1 - b.x0 : b.z1 - b.z0;
      if (width < 9 || gap > SIDEWALK + 4) continue;
      const score = gap + Math.abs(width - 16) * 0.15;
      if (!best || score < best.score) best = { b, k, score };
    }
  }
  if (!best) return null;
  const { b, k } = best;
  b.shop = spec.kind;
  const along = k === 'n' || k === 's'; // the frontage runs along x
  const out = k === 'n' || k === 'w' ? -1 : 1;
  const face = { n: b.z0, s: b.z1, w: b.x0, e: b.x1 }[k];
  const lo = along ? b.x0 : b.z0, hi = along ? b.x1 : b.z1, centre = (lo + hi) / 2;
  const at = (t, off) => (along ? { x: t, z: face + out * off } : { x: face + out * off, z: t });
  // the door: on the pavement in front of the shop, nudged clear of trees and lamp posts
  let t = centre;
  for (const shift of [0, 2, -2, 4, -4]) {
    const p = at(centre + shift, 1.6);
    if (!city.colliders.some((c) => c.type === 'circle' && Math.hypot(c.x - p.x, c.z - p.z) < c.r + 1.1)) { t = centre + shift; break; }
  }
  const door = at(t, 1.6);
  const h = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 }[k];
  const sign = at(centre, 0.08);
  city.signs.push({ ...sign, y: 4.4, h, w: Math.min(10, hi - lo - 2), text: spec.name.toUpperCase(), bg: spec.sign[0], fg: spec.sign[1] });
  // a striped awning over the door, kept within the frontage
  const a0 = Math.max(lo + 0.3, t - 3), a1 = Math.min(hi - 0.3, t + 3), f1 = face + out * 1.5;
  const [x0, x1, z0, z1] = along ? [a0, a1, Math.min(face, f1), Math.max(face, f1)] : [Math.min(face, f1), Math.max(face, f1), a0, a1];
  city.awnings.push({ x0, x1, z0, z1, y: 3.1, color: spec.awning, along, out });
  const road = { n: { x: door.x, z: line(g.r0) }, s: { x: door.x, z: line(g.r1 + 1) }, w: { x: line(g.c0), z: door.z }, e: { x: line(g.c1 + 1), z: door.z } }[k];
  const shop = { id: spec.id, kind: spec.kind, name: spec.name, ...door, h, road };
  city.shops.push(shop);
  return shop;
}

function buildPark(city, g, r, addTree) {
  city.surfaces.push({ ...inset(g, SIDEWALK), kind: 'grass' });
  const mx = (g.x0 + g.x1) / 2, mz = (g.z0 + g.z1) / 2;
  city.surfaces.push({ x0: g.x0 + 3, z0: mz - 2, x1: g.x1 - 3, z1: mz + 2, kind: 'path' });
  city.surfaces.push({ x0: mx - 2, z0: g.z0 + 3, x1: mx + 2, z1: g.z1 - 3, kind: 'path' });
  for (let i = 0; i < 90; i++) {
    const x = rand(r, g.x0 + 6, g.x1 - 6), z = rand(r, g.z0 + 6, g.z1 - 6);
    if (Math.abs(x - mx) < 5 || Math.abs(z - mz) < 5) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 6) continue;
    if (Math.abs(x - POND.x) < 8 && z < POND.z && z > POND.z - 150) continue; // run-up to the pond jump
    addTree(x, z, r() < 0.3 ? 'pine' : 'round');
  }
}

function buildDocks(city, g, r, addBuilding) {
  city.surfaces.push({ ...inset(g, SIDEWALK), kind: 'concrete' });
  const xs = [g.x0 + 8, g.x0 + 60, g.x0 + 112, g.x0 + 164, g.x0 + 216, g.x0 + 268, g.x0 + 320];
  xs.forEach((x, i) => {
    const b = addBuilding({ x0: x, z0: g.z0 + 8, x1: x + 42, z1: g.z0 + 38 }, rand(r, 10, 13), 'warehouse');
    if (i === 0) {
      b.color = 0x8a6d4f;
      city.signs.push({ x: x + 21, z: g.z0 + 7.9, y: 8.5, h: Math.PI, w: 20, text: 'HALLORAN & SONS', bg: '#2b2b2b', fg: '#e8c25a' });
      city.pois.warehouse = { x: x + 21, z: g.z0 - 1.5, h: Math.PI, name: 'Halloran & Sons', road: { x: x + 21, z: g.z0 - LANE } };
    }
  });
  const palette = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0x839192, 0x1abc9c];
  for (let row = 0; row < 3; row++) {
    for (let x = g.x0 + 10; x < g.x1 - 16; x += 15) {
      if (r() < 0.18) continue;
      const z = g.z0 + 50 + row * 11;
      const stack = randInt(r, 1, 3);
      city.containers.push({ x: x + 6, z, w: 12, d: 2.5, stack, color: pick(r, palette) });
      city.colliders.push({ type: 'box', x0: x, z0: z - 1.25, x1: x + 12, z1: z + 1.25, h: stack * 2.6, kind: 'container' });
    }
  }
  for (let i = 0; i < 4; i++) {
    const c = { x: [-120, -70, 40, 160][i], z: 518 }; // clear of the pier entrances
    city.cranes.push(c);
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) city.colliders.push({ type: 'box', x0: c.x + dx - 0.5, z0: c.z + dz - 0.5, x1: c.x + dx + 0.5, z1: c.z + dz + 0.5, h: 22, kind: 'crane' });
  }
}

function buildArena(city, g, r, addParking) {
  addParking(inset(g, SIDEWALK));
  const x = (g.x0 + g.x1) / 2, z = (g.z0 + g.z1) / 2;
  city.round.push({ x, z, r: 52, h: 24, kind: 'arena' });
  city.colliders.push({ type: 'circle', x, z, r: 52, h: 24, kind: 'building' });
  city.parking = city.parking.filter((p) => Math.hypot(p.x - x, p.z - z) > 58);
  city.signs.push({ x, z: z - 52.4, y: 18, h: Math.PI, w: 26, text: 'CALLOWAY ARENA', bg: '#3b1f5c', fg: '#ffffff' });
}

function buildWorks(city, g, r, addBuilding, addParking) {
  city.surfaces.push({ ...inset(g, SIDEWALK), kind: 'concrete' });
  addBuilding({ x0: g.x0 + 10, z0: g.z0 + 10, x1: g.x0 + 90, z1: g.z0 + 60 }, 16, 'warehouse');
  addBuilding({ x0: g.x0 + 110, z0: g.z0 + 10, x1: g.x1 - 10, z1: g.z0 + 50 }, 12, 'warehouse');
  addBuilding({ x0: g.x0 + 10, z0: g.z0 + 80, x1: g.x0 + 60, z1: g.z1 - 10 }, 10, 'warehouse');
  for (let i = 0; i < 3; i++) {
    const x = g.x0 + 100 + i * 14, z = g.z0 + 95;
    city.round.push({ x, z, r: 2.6, h: 48, kind: 'chimney' });
    city.colliders.push({ type: 'circle', x, z, r: 2.6, h: 48, kind: 'building' });
  }
  addParking({ x0: g.x0 + 80, z0: g.z1 - 40, x1: g.x1 - 10, z1: g.z1 - 8 });
}

function buildCoast(city, r, addTree, addBuilding) {
  const E = line(N) + HALF_ROAD + SIDEWALK, W = line(0) - HALF_ROAD - SIDEWALK;
  // Beach on the east, promenade elsewhere.
  city.surfaces.push({ x0: E, z0: LAND.z0, x1: LAND.x1, z1: LAND.z1, kind: 'sand' });
  for (let z = LAND.z0 + 20; z < LAND.z1 - 10; z += 26) if (Math.abs(z - 200) > 30) addTree(E + 8, z + rand(r, -4, 4), 'palm');
  city.surfaces.push({ x0: LAND.x0, z0: LAND.z0, x1: W, z1: LAND.z1, kind: 'grass' });
  city.surfaces.push({ x0: W, z0: LAND.z0, x1: E, z1: line(0) - HALF_ROAD - SIDEWALK, kind: 'grass' });
  city.surfaces.push({ x0: W, z0: line(N) + HALF_ROAD + SIDEWALK, x1: E, z1: LAND.z1, kind: 'concrete' });
  for (let i = 0; i < 40; i++) {
    const x = rand(r, LAND.x0 + 4, W - 3), z = rand(r, LAND.z0 + 4, LAND.z1 - 4);
    addTree(x, z, r() < 0.5 ? 'pine' : 'round');
    const nx = rand(r, W + 4, E - 4), nz = rand(r, LAND.z0 + 4, line(0) - 12);
    if (!isWater(nx, nz)) addTree(nx, nz, r() < 0.5 ? 'pine' : 'round');
  }
  for (const p of PIERS) city.surfaces.push({ ...p, z0: LAND.z1, kind: 'boards' });
  addBuilding({ x0: -32, z0: 585, x1: -8, z1: 598 }, 7, 'plaster', { color: 0xe7e2d6 });
  city.signs.push({ x: -20, z: 584.9, y: 5.5, h: Math.PI, w: 14, text: 'FERRY', bg: '#20507a', fg: '#ffffff' });
  city.round.push({ x: 548, z: -520, r: 4, h: 28, kind: 'lighthouse' });
  city.colliders.push({ type: 'circle', x: 548, z: -520, r: 4, h: 28, kind: 'building' });
}

const STREET_TREES = { midtown: 'round', eastbank: 'round', strand: 'palm', hillside: 'round', market: 'round' };

function buildStreetFurniture(city, r, addTree) {
  const { nodes } = city;
  for (const s of city.segments) {
    const a = nodes[s.a], b = nodes[s.b];
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    const px = -dz, pz = dx;
    for (const side of [-1, 1]) {
      for (const t of [18, 50, 82]) {
        const off = side * (HALF_ROAD + 0.7);
        const x = a.x + dx * t + px * off, z = a.z + dz * t + pz * off;
        if (isWater(x, z)) continue;
        city.lamps.push({ x, z, h: Math.atan2(-px * side, -pz * side) });
        city.colliders.push({ type: 'circle', x, z, r: 0.22, h: 7, kind: 'lamp', prop: city.lamps.length - 1 });
      }
    }
    if (s.axis === 'x' && a.i === CANAL_COL) {
      for (const side of [-1, 1]) {
        const z = a.z + side * (HALF_ROAD + SIDEWALK);
        city.railings.push({ x0: CANAL.x0 - 1, x1: CANAL.x1 + 1, z });
        city.colliders.push({ type: 'box', x0: CANAL.x0 - 1, x1: CANAL.x1 + 1, z0: z - 0.25, z1: z + 0.25, h: 1.1, kind: 'rail' });
      }
    }
  }
  for (const g of city.regions) {
    const kind = STREET_TREES[g.district];
    if (!kind || g.kind !== 'block') continue;
    for (let c = g.c0; c <= g.c1; c++) {
      for (const t of [34, 66]) { addTree(line(c) + t, g.z0 + 1.4, kind); addTree(line(c) + t, g.z1 - 1.4, kind); }
    }
    for (let rr = g.r0; rr <= g.r1; rr++) {
      for (const t of [34, 66]) { addTree(g.x0 + 1.4, line(rr) + t, kind); addTree(g.x1 - 1.4, line(rr) + t, kind); }
    }
  }
  // Traffic lights at every junction with three or more roads, one facing each approach.
  for (const n of nodes) {
    if (!n.alive || n.links.length < 3) continue;
    n.signal = true;
    for (const l of n.links) {
      const o = nodes[l.to];
      const dx = Math.sign(o.x - n.x), dz = Math.sign(o.z - n.z);
      const x = n.x + dx * (HALF_ROAD + 1.2) + dz * (HALF_ROAD + 1.0);
      const z = n.z + dz * (HALF_ROAD + 1.2) - dx * (HALF_ROAD + 1.0);
      city.signals.push({ node: n.id, x, z, h: Math.atan2(dx, dz), axis: dx !== 0 ? 'x' : 'z' });
      city.colliders.push({ type: 'circle', x, z, r: 0.22, h: 5, kind: 'signal', prop: city.signals.length - 1 });
    }
  }
}

function buildRamps(city) {
  const R = (name, x, z, h, len, width, height, extra = {}) =>
    city.ramps.push({ name, x, z, h, len, width, height, base: CURB, ...extra });
  R('Canal Leap', line(7) + HALF_ROAD + 0.3, line(1), Math.PI / 2, 8.5, 9, 3.0);
  R('Cut Return', line(8) - HALF_ROAD - 0.3, line(8), -Math.PI / 2, 8.5, 9, 3.0);
  R('Pond Skip', POND.x, POND.z - POND.r - 14, 0, 10, 8, 2.4);
  R('Arena Kicker', 330, -60, 0, 9, 8, 2.2);
  R('Pier Plunge', 110, 625, 0, 9, 8, 2.6, { splash: true });
  R('Beach Bump', 540, 120, Math.PI, 9, 8, 2.2);
  // Keep parked cars and trees off the ramps and their run-ups.
  const clear = (x, z) => city.ramps.some((rp) => {
    const f = forwardOf(rp.h), dx = x - rp.x, dz = z - rp.z;
    const u = dx * f.x + dz * f.z, v = Math.abs(-dx * f.z + dz * f.x);
    return u > -40 && u < rp.len + 6 && v < rp.width / 2 + 3;
  });
  city.parking = city.parking.filter((p) => !clear(p.x, p.z));
  const removed = new Set();
  city.trees = city.trees.filter((t, i) => (clear(t.x, t.z) ? (removed.add(i), false) : true));
  let k = 0;
  city.colliders = city.colliders.filter((c) => (c.kind === 'tree' ? !removed.has(k++) : true));
}

export function rampHeight(rp, x, z) {
  const f = forwardOf(rp.h), rt = rightOf(rp.h);
  const dx = x - rp.x, dz = z - rp.z;
  const u = dx * f.x + dz * f.z, v = dx * rt.x + dz * rt.z;
  if (u < 0 || u > rp.len || Math.abs(v) > rp.width / 2) return -Infinity;
  return rp.base + (rp.height * u) / rp.len;
}

// Ground height at a point including ramps; null over water.
export function heightAt(city, x, z) {
  let h = baseHeight(city, x, z);
  for (const rp of city.ramps) {
    const rh = rampHeight(rp, x, z);
    if (rh > -Infinity) h = Math.max(h ?? -Infinity, rh);
  }
  return h;
}

// Traffic light state for traffic travelling along `axis` into junction `nodeId` at time t.
export const SIGNAL_CYCLE = 24;
export function signalState(city, nodeId, axis, t) {
  const n = city.nodes[nodeId];
  if (!n.signal) return 'g';
  const p = (t + ((n.i * 7 + n.j * 3) % 8) * 3) % SIGNAL_CYCLE;
  const q = axis === 'x' ? p : (p + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
  return q < 10 ? 'g' : q < 12 ? 'y' : 'r';
}
