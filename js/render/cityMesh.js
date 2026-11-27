// Turns the city data into a few large merged meshes: ground slabs, surfaces, roads, buildings.
import * as THREE from 'three';
import { Geo } from './geo.js';
import { facadeTextures, roadTexture, pavingTexture, noiseTexture, waterTexture, signTexture } from './textures.js';
import { HALF_ROAD, SIDEWALK, CURB, LAND, CANAL, BRIDGES, PIERS, WATER_Y, line, N } from '../city.js';
import { mulberry32, randInt } from '../util.js';

export const SURFACE_COLORS = {
  grass: 0x7fae5c, sand: 0xf0dcaa, paving: 0xd8d3c6, asphalt: 0x65686c, concrete: 0xbab7ae,
  path: 0xe4d4b0, boards: 0xc4a27a, pool: 0x5fd0ee,
};

export function buildCityMeshes(city, scene) {
  const out = { night: [], water: null };
  const paving = pavingTexture(), noise = noiseTexture();

  // Ground slabs: blocks, canal promenades, bridge pavements, coast and piers.
  const slabs = new Geo();
  const slab = (x0, z0, x1, z1, yb = -0.6) => slabs.box(x0, yb, z0, x1, CURB, z1, 0xffffff, { uvFn: (f, w, h) => [0, 0, w / 8, h / 8] });
  for (const g of city.regions) slab(g.x0, g.z0, g.x1, g.z1);
  const deep = WATER_Y - 1.5;
  const bridgeGaps = BRIDGES.map((j) => [line(j) - HALF_ROAD, line(j) + HALF_ROAD]);
  const splitZ = (z0, z1, gaps) => {
    const parts = []; let s = z0;
    for (const [a, b] of gaps) if (b > z0 && a < z1) { if (a > s) parts.push([s, a]); s = b; }
    if (s < z1) parts.push([s, z1]);
    return parts;
  };
  for (const [z0, z1] of splitZ(LAND.z0, LAND.z1, bridgeGaps)) {
    slab(line(7) + HALF_ROAD, z0, CANAL.x0, z1, deep);
    slab(CANAL.x1, z0, line(8) - HALF_ROAD, z1, deep);
  }
  for (const j of BRIDGES) {
    const z = line(j);
    slab(CANAL.x0, z + HALF_ROAD, CANAL.x1, z + HALF_ROAD + SIDEWALK, -0.9);
    slab(CANAL.x0, z - HALF_ROAD - SIDEWALK, CANAL.x1, z - HALF_ROAD, -0.9);
    slabs.box(CANAL.x0, -0.9, z - HALF_ROAD, CANAL.x1, -0.02, z + HALF_ROAD, 0x9a9a9a, { top: false });
  }
  const W = line(0) - HALF_ROAD, E = line(N) + HALF_ROAD;
  slab(LAND.x0, LAND.z0, W, LAND.z1, deep);
  slab(E, LAND.z0, LAND.x1, LAND.z1, deep);
  for (const [x0, x1] of [[W, CANAL.x0], [CANAL.x1, E]]) {
    slab(x0, LAND.z0, x1, W, deep);
    slab(x0, E, x1, LAND.z1, deep);
  }
  for (const p of PIERS) slab(p.x0, LAND.z1, p.x1, p.z1, deep);
  const slabMesh = new THREE.Mesh(slabs.build(), new THREE.MeshLambertMaterial({ map: paving, vertexColors: true }));
  slabMesh.receiveShadow = true;
  scene.add(slabMesh);

  // Surfaces laid on top of the slabs.
  const surf = new Geo();
  const order = { path: 0.03, pool: 0.035, boards: 0.012 };
  for (const s of city.surfaces) surf.flat(s.x0, s.z0, s.x1, s.z1, CURB + (order[s.kind] ?? 0.015), SURFACE_COLORS[s.kind], 6);
  const surfMesh = new THREE.Mesh(surf.build(), new THREE.MeshLambertMaterial({ map: noise, vertexColors: true }));
  surfMesh.receiveShadow = true;
  scene.add(surfMesh);

  // Roads: lane-marked segments, plain junctions, zebra crossings at signalled junctions.
  const roads = new Geo(), junctions = new Geo(), zebra = new Geo();
  for (const s of city.segments) {
    const a = city.nodes[s.a], b = city.nodes[s.b];
    if (s.axis === 'x') {
      const x0 = a.x + HALF_ROAD, x1 = b.x - HALF_ROAD, z0 = a.z - HALF_ROAD, z1 = a.z + HALF_ROAD;
      const v0 = x0 / 24, v1 = x1 / 24;
      roads.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[1, v0], [1, v1], [0, v1], [0, v0]]);
    } else {
      const z0 = a.z + HALF_ROAD, z1 = b.z - HALF_ROAD, x0 = a.x - HALF_ROAD, x1 = a.x + HALF_ROAD;
      const v0 = z0 / 24, v1 = z1 / 24;
      roads.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[0, v1], [1, v1], [1, v0], [0, v0]]);
    }
  }
  for (const n of city.nodes) {
    if (!n.alive) continue;
    junctions.flat(n.x - HALF_ROAD, n.z - HALF_ROAD, n.x + HALF_ROAD, n.z + HALF_ROAD, 0, 0xffffff, 12);
    if (!n.signal) continue;
    for (const l of n.links) {
      const o = city.nodes[l.to];
      const dx = Math.sign(o.x - n.x), dz = Math.sign(o.z - n.z);
      for (let k = -5.5; k <= 5.5; k += 1.1) {
        const c0 = HALF_ROAD + 0.8, c1 = HALF_ROAD + 3.6;
        if (dx !== 0) {
          const xa = n.x + dx * c0, xb = n.x + dx * c1;
          zebra.flat(Math.min(xa, xb), n.z + k - 0.28, Math.max(xa, xb), n.z + k + 0.28, 0.012);
        } else {
          const za = n.z + dz * c0, zb = n.z + dz * c1;
          zebra.flat(n.x + k - 0.28, Math.min(za, zb), n.x + k + 0.28, Math.max(za, zb), 0.012);
        }
      }
    }
  }
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture(true) });
  const junctionMat = new THREE.MeshLambertMaterial({ map: roadTexture(false) });
  for (const [geo, mat] of [[roads, roadMat], [junctions, junctionMat], [zebra, new THREE.MeshLambertMaterial({ color: 0xe9e6dc })]]) {
    const m = new THREE.Mesh(geo.build(), mat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Water: one big plane with a slowly drifting texture.
  const wt = waterTexture();
  wt.repeat.set(400, 400);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshPhongMaterial({
    color: 0x3f7f9c, map: wt, shininess: 80, specular: 0x557788,
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);
  out.water = water;

  out.buildings = buildBuildings(city, scene, out);
  for (const s of city.signs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w / 8), new THREE.MeshBasicMaterial({ map: signTexture(s.text, s.bg, s.fg), toneMapped: false }));
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.h;
    scene.add(m);
  }
  if (city.awnings?.length) scene.add(buildAwnings(city.awnings));
  return out;
}

// Striped shop awnings: sloping down from the wall, with a short flap along the front edge.
function buildAwnings(list) {
  const g = new Geo(), uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const a of list) {
    const lo = a.along ? a.x0 : a.z0, hi = a.along ? a.x1 : a.z1;
    const wall = a.out < 0 ? (a.along ? a.z1 : a.x1) : (a.along ? a.z0 : a.x0);
    const edge = a.out < 0 ? (a.along ? a.z0 : a.x0) : (a.along ? a.z1 : a.x1);
    const yHi = a.y + 0.55, yLo = a.y, flap = 0.28;
    // point at distance t along the frontage, d out from the wall, height y
    const P = (t, d, y) => (a.along ? [t, y, d] : [d, y, t]);
    const n = Math.max(2, Math.round((hi - lo) / 0.5));
    for (let i = 0; i < n; i++) {
      const t0 = lo + ((hi - lo) * i) / n, t1 = lo + ((hi - lo) * (i + 1)) / n;
      const color = i % 2 ? 0xf4f1ea : a.color;
      g.quad(P(t0, wall, yHi), P(t1, wall, yHi), P(t1, edge, yLo), P(t0, edge, yLo), [0, 1, 0], uv, color);
      g.quad(P(t0, edge, yLo), P(t1, edge, yLo), P(t1, edge, yLo - flap), P(t0, edge, yLo - flap), [0, 0, 1], uv, color);
    }
  }
  const m = new THREE.Mesh(g.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

function buildBuildings(city, scene, out) {
  const r = mulberry32(99);
  const walls = {}, tex = {};
  const roofs = new Geo();
  const color = new THREE.Color();
  for (const b of city.buildings) {
    if (!walls[b.style]) { walls[b.style] = new Geo(); tex[b.style] = facadeTextures(b.style, 17 + Object.keys(tex).length); }
    const T = tex[b.style];
    const uOff = r(), vOff = randInt(r, 0, 7) / 8;
    color.setHex(b.color);
    for (const t of b.tiers) {
      walls[b.style].box(t.x0, t.y0, t.z0, t.x1, t.y1, t.z1, color, {
        top: false,
        uvFn: (face, w, h, y0, y1) => [uOff + face * 0.37, vOff + y0 * T.vScale, uOff + face * 0.37 + w * T.uScale, vOff + y1 * T.vScale],
      });
      if (b.roof === 'flat') roofs.flat(t.x0, t.z0, t.x1, t.z1, t.y1, 0x77777a);
    }
    const top = b.tiers[b.tiers.length - 1];
    if (b.roof === 'pitched') pitchedRoof(roofs, top, b.roofColor, b.color);
    else if (b.h > 14) {
      const n = randInt(r, 1, 3);
      for (let i = 0; i < n; i++) {
        const w = 2 + r() * 3, d = 2 + r() * 3;
        const x = top.x0 + 1 + r() * Math.max(0.1, top.x1 - top.x0 - w - 2), z = top.z0 + 1 + r() * Math.max(0.1, top.z1 - top.z0 - d - 2);
        roofs.box(x, top.y1, z, x + w, top.y1 + 1.2 + r() * 1.5, z + d, 0x9a9a98);
      }
      if (b.antenna) {
        const cx = (top.x0 + top.x1) / 2, cz = (top.z0 + top.z1) / 2;
        roofs.box(cx - 0.25, top.y1, cz - 0.25, cx + 0.25, top.y1 + 10 + r() * 10, cz + 0.25, 0x55585c);
      }
    }
  }
  const meshes = [];
  for (const style of Object.keys(walls)) {
    const mat = new THREE.MeshLambertMaterial({
      map: tex[style].map, vertexColors: true, emissive: 0xffffff, emissiveMap: tex[style].emissive, emissiveIntensity: 0,
    });
    const m = new THREE.Mesh(walls[style].build(), mat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    out.night.push(mat);
    meshes.push(m);
  }
  const rm = new THREE.Mesh(roofs.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  rm.castShadow = rm.receiveShadow = true;
  scene.add(rm);
  return meshes;
}

function pitchedRoof(g, t, roofColor, wallColor) {
  const o = 0.5, y = t.y1;
  const w = t.x1 - t.x0, d = t.z1 - t.z0;
  const rh = Math.min(w, d) * 0.38;
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (w >= d) {
    const zm = (t.z0 + t.z1) / 2, x0 = t.x0 - o, x1 = t.x1 + o, z0 = t.z0 - o, z1 = t.z1 + o;
    const ns = norm(0, z1 - zm, rh), nn = norm(0, zm - z0, -rh);
    g.quad([x0, y, z1], [x1, y, z1], [x1, y + rh, zm], [x0, y + rh, zm], ns, uv, roofColor);
    g.quad([x1, y, z0], [x0, y, z0], [x0, y + rh, zm], [x1, y + rh, zm], nn, uv, roofColor);
    g.tri([t.x1, y, t.z1], [t.x1, y, t.z0], [t.x1, y + rh, zm], [1, 0, 0], uv, wallColor);
    g.tri([t.x0, y, t.z0], [t.x0, y, t.z1], [t.x0, y + rh, zm], [-1, 0, 0], uv, wallColor);
  } else {
    const xm = (t.x0 + t.x1) / 2, x0 = t.x0 - o, x1 = t.x1 + o, z0 = t.z0 - o, z1 = t.z1 + o;
    g.quad([x1, y, z1], [x1, y, z0], [xm, y + rh, z0], [xm, y + rh, z1], norm(rh, x1 - xm, 0), uv, roofColor);
    g.quad([x0, y, z0], [x0, y, z1], [xm, y + rh, z1], [xm, y + rh, z0], norm(-rh, xm - x0, 0), uv, roofColor);
    g.tri([t.x0, y, t.z1], [t.x1, y, t.z1], [xm, y + rh, t.z1], [0, 0, 1], uv, wallColor);
    g.tri([t.x1, y, t.z0], [t.x0, y, t.z0], [xm, y + rh, t.z0], [0, 0, -1], uv, wallColor);
  }
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
