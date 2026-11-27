// Low-poly vehicle meshes built from boxes and a sloped cabin. Every model faces +z with its
// origin on the ground between the axles, matching the physics heading convention.
import * as THREE from 'three';
import { Geo } from './geo.js';
import { MODELS } from '../physics.js';

const SHAPES = {
  hatch: { ride: 0.32, body: 0.58, cab: 0.62, cabF: 0.55, cabB: -1.75, slopeF: 0.75, slopeB: 0.25, wheel: 0.33 },
  sedan: { ride: 0.32, body: 0.56, cab: 0.6, cabF: 0.75, cabB: -1.45, slopeF: 0.8, slopeB: 0.55, wheel: 0.34 },
  taxi: { ride: 0.32, body: 0.56, cab: 0.6, cabF: 0.75, cabB: -1.45, slopeF: 0.8, slopeB: 0.55, wheel: 0.34 },
  police: { ride: 0.33, body: 0.58, cab: 0.6, cabF: 0.8, cabB: -1.5, slopeF: 0.8, slopeB: 0.55, wheel: 0.35 },
  suv: { ride: 0.45, body: 0.7, cab: 0.72, cabF: 0.85, cabB: -2.1, slopeF: 0.55, slopeB: 0.1, wheel: 0.4 },
  pickup: { ride: 0.45, body: 0.68, cab: 0.72, cabF: 1.2, cabB: -0.3, slopeF: 0.5, slopeB: 0.05, wheel: 0.4, bed: true },
  van: { ride: 0.4, body: 1.95, cab: 0, cabF: 1.6, cabB: -2.6, slopeF: 0, slopeB: 0, wheel: 0.4, van: true },
  sports: { ride: 0.24, body: 0.48, cab: 0.48, cabF: 0.3, cabB: -1.45, slopeF: 0.95, slopeB: 0.8, wheel: 0.34, spoiler: true },
  armored: { ride: 0.45, body: 2.0, cab: 0, cabF: 1.8, cabB: -2.8, slopeF: 0, slopeB: 0, wheel: 0.45, van: true },
  // supercars: low, wide, with the cabin pushed forward and wider tyres
  gt: { ride: 0.25, body: 0.5, cab: 0.5, cabF: -0.05, cabB: -1.25, slopeF: 1.0, slopeB: 1.0, wheel: 0.36, tyre: 0.3, inset: 0.3, stripes: 0xf4f1ea },
  super: { ride: 0.2, body: 0.44, cab: 0.46, cabF: 0.55, cabB: -0.75, slopeF: 1.05, slopeB: 1.25, wheel: 0.36, tyre: 0.32, inset: 0.36, wing: 0.16, intakes: true, splitter: true },
  hyper: { ride: 0.18, body: 0.42, cab: 0.44, cabF: 0.7, cabB: -0.5, slopeF: 1.0, slopeB: 1.5, wheel: 0.37, tyre: 0.34, inset: 0.38, wing: 0.46, intakes: true, splitter: true },
};
const CARBON = 0x141518;

function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const q = (g, a, b, c, d, color) => g.quad(a, b, c, d, faceNormal(a, b, c), UV, color);

const cache = new Map();
function modelGeometry(model) {
  if (cache.has(model)) return cache.get(model);
  const m = MODELS[model], s = SHAPES[m.kind];
  const paint = new Geo(), trim = new Geo(), glass = new Geo(), head = new Geo(), tail = new Geo();
  const hw = m.wid / 2, hl = m.len / 2, y0 = s.ride, y1 = s.ride + s.body;
  paint.box(-hw, y0, -hl, hw, y1, hl);
  trim.box(-hw - 0.02, y0 - 0.05, hl - 0.12, hw + 0.02, y0 + 0.22, hl + 0.06, 0x2a2c30);
  trim.box(-hw - 0.02, y0 - 0.05, -hl - 0.06, hw + 0.02, y0 + 0.22, -hl + 0.12, 0x2a2c30);
  if (s.van) {
    glass.box(-hw + 0.05, y1 - 0.85, hl - 0.02, hw - 0.05, y1 - 0.2, hl + 0.01, 0xffffff, { top: false });
    glass.box(-hw - 0.01, y1 - 0.8, hl - 1.3, hw + 0.01, y1 - 0.25, hl - 0.25, 0xffffff, { top: false });
  } else {
    // Cabin: a prism whose front and back faces slope like a windscreen and rear window.
    const cy0 = y1, cy1 = y1 + s.cab, w0 = hw - 0.08, w1 = hw - (s.inset ?? 0.22);
    const zf0 = s.cabF + s.slopeF, zf1 = s.cabF, zb0 = s.cabB - s.slopeB, zb1 = s.cabB;
    q(glass, [-w0, cy0, zf0], [w0, cy0, zf0], [w1, cy1, zf1], [-w1, cy1, zf1]);
    q(glass, [w0, cy0, zb0], [-w0, cy0, zb0], [-w1, cy1, zb1], [w1, cy1, zb1]);
    q(glass, [w0, cy0, zf0], [w0, cy0, zb0], [w1, cy1, zb1], [w1, cy1, zf1]);
    q(glass, [-w0, cy0, zb0], [-w0, cy0, zf0], [-w1, cy1, zf1], [-w1, cy1, zb1]);
    paint.box(-w1 - 0.02, cy1, zb1 - 0.02, w1 + 0.02, cy1 + 0.07, zf1 + 0.02);
    // door pillars so the cabin does not read as one glass block
    trim.box(-w0 - 0.01, cy0, -0.1, -w1 + 0.03, cy1, 0.0, 0x222428);
    trim.box(w1 - 0.03, cy0, -0.1, w0 + 0.01, cy1, 0.0, 0x222428);
  }
  if (s.bed) {
    trim.box(-hw + 0.08, y1 - 0.05, -hl + 0.1, hw - 0.08, y1 + 0.02, -0.5, 0x3a3c40);
  }
  if (s.spoiler) paint.box(-hw + 0.1, y1 + 0.25, -hl + 0.05, hw - 0.1, y1 + 0.32, -hl + 0.4);
  if (m.kind === 'taxi') paint.box(-0.35, y1 + s.cab + 0.07, -0.6, 0.35, y1 + s.cab + 0.35, -0.2, 0xffffff);
  if (s.wing) {
    // rear wing on two struts
    const wy = y1 + s.wing;
    trim.box(-hw + 0.06, wy, -hl + 0.02, hw - 0.06, wy + 0.06, -hl + 0.42, CARBON, { bottom: true });
    for (const x of [-hw * 0.55, hw * 0.55]) trim.box(x - 0.03, y1, -hl + 0.15, x + 0.03, wy, -hl + 0.3, CARBON);
    for (const x of [-hw + 0.06, hw - 0.08]) trim.box(x, wy - 0.08, -hl + 0.02, x + 0.02, wy + 0.1, -hl + 0.42, CARBON);
  }
  if (s.intakes) {
    // side air intakes behind the doors, and a diffuser under the tail
    for (const sx of [-1, 1]) trim.box(sx < 0 ? -hw - 0.025 : hw - 0.02, y0 + 0.1, -1.05, sx < 0 ? -hw + 0.02 : hw + 0.025, y1 - 0.06, -0.3, CARBON);
    trim.box(-hw + 0.25, y0 - 0.04, -hl - 0.1, hw - 0.25, y0 + 0.08, -hl + 0.2, CARBON);
  }
  if (s.splitter) trim.box(-hw + 0.04, y0 - 0.07, hl - 0.15, hw - 0.04, y0 - 0.02, hl + 0.14, CARBON, { bottom: true });
  if (s.stripes) {
    // twin stripes over the bonnet, roof and boot
    const top = y1 + s.cab + 0.071;
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -0.36 : 0.13, x1 = sx < 0 ? -0.13 : 0.36;
      trim.box(x0, y1, s.cabF + s.slopeF, x1, y1 + 0.006, hl + 0.005, s.stripes);
      trim.box(x0, top - 0.004, s.cabB, x1, top + 0.002, s.cabF, s.stripes);
      trim.box(x0, y1, -hl - 0.005, x1, y1 + 0.006, s.cabB - s.slopeB, s.stripes);
    }
  }
  head.box(-hw + 0.12, y0 + 0.28, hl - 0.02, -hw + 0.5, y0 + 0.44, hl + 0.03, 0xffffff, { top: false });
  head.box(hw - 0.5, y0 + 0.28, hl - 0.02, hw - 0.12, y0 + 0.44, hl + 0.03, 0xffffff, { top: false });
  tail.box(-hw + 0.1, y0 + 0.3, -hl - 0.03, -hw + 0.48, y0 + 0.46, -hl + 0.02, 0xffffff, { top: false });
  tail.box(hw - 0.48, y0 + 0.3, -hl - 0.03, hw - 0.1, y0 + 0.46, -hl + 0.02, 0xffffff, { top: false });
  const out = {
    paint: paint.build(), trim: trim.build(), glass: glass.build(), head: head.build(), tail: tail.build(),
    shape: s, wheel: new THREE.CylinderGeometry(s.wheel, s.wheel, s.tyre ?? 0.28, 12).rotateZ(Math.PI / 2),
  };
  cache.set(model, out);
  return out;
}

const mats = {
  trim: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glass: new THREE.MeshPhongMaterial({ color: 0x1d2a36, shininess: 100, specular: 0x8899aa }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
  tail: new THREE.MeshBasicMaterial({ color: 0x9a1d1d }),
  tailBrake: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x1c1d1f }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  blue: new THREE.MeshBasicMaterial({ color: 0x2a6bff }),
  dim: new THREE.MeshBasicMaterial({ color: 0x333344 }),
};
const paints = new Map();
function paintMat(hex) {
  if (!paints.has(hex)) paints.set(hex, new THREE.MeshPhongMaterial({ color: hex, shininess: 70, specular: 0x444444 }));
  return paints.get(hex);
}

export function createVehicleMesh(v) {
  const G = modelGeometry(v.model);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.Mesh(G.paint, paintMat(v.color));
  const parts = [paint, new THREE.Mesh(G.trim, mats.trim), new THREE.Mesh(G.glass, mats.glass), new THREE.Mesh(G.head, mats.head)];
  const tail = new THREE.Mesh(G.tail, mats.tail);
  parts.push(tail);
  for (const p of parts) { p.castShadow = true; body.add(p); }
  const wheels = [];
  const hw = v.m.wid / 2 - 0.16, hb = v.m.wb / 2;
  for (const [x, z] of [[-hw, hb], [hw, hb], [-hw, -hb], [hw, -hb]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, G.shape.wheel, z);
    const w = new THREE.Mesh(G.wheel, mats.tire);
    w.castShadow = true;
    pivot.add(w);
    root.add(pivot);
    wheels.push({ pivot, w, front: z > 0 });
  }
  let bar = null;
  if (v.m.kind === 'police') {
    const y = G.shape.ride + G.shape.body + G.shape.cab + 0.07;
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.3), mats.dim);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.3), mats.dim);
    red.position.set(-0.34, y + 0.08, -0.4);
    blue.position.set(0.34, y + 0.08, -0.4);
    body.add(red, blue);
    bar = { red, blue };
  }
  return { root, body, paint, tail, wheels, bar, damageTint: 0 };
}

const dark = new THREE.Color(0x222222);
export function updateVehicleMesh(view, v, t) {
  view.root.position.set(v.x, v.y, v.z);
  view.root.rotation.y = v.h;
  view.body.rotation.x = -v.pitch;
  view.body.rotation.z = v.roll;
  for (const wh of view.wheels) {
    wh.w.rotation.x = v.wheelSpin;
    wh.pivot.rotation.y = wh.front ? -v.steer * v.m.steer * 0.8 : 0;
  }
  view.tail.material = v.input.brake > 0.1 || v.input.handbrake ? mats.tailBrake : mats.tail;
  if (view.bar) {
    const on = v.siren && Math.floor(t * 6) % 2 === 0;
    view.bar.red.material = v.siren ? (on ? mats.red : mats.dim) : mats.dim;
    view.bar.blue.material = v.siren ? (on ? mats.dim : mats.blue) : mats.dim;
  }
  // Damage darkens the paint; a wreck is scorched black.
  const dmg = Math.max(0, Math.min(1, 1 - v.health / 100));
  if (Math.abs(dmg - view.damageTint) > 0.05) {
    view.damageTint = dmg;
    if (dmg > 0.3) {
      if (view.paint.material === paintMat(v.color)) view.paint.material = view.paint.material.clone();
      view.paint.material.color.setHex(v.color).lerp(dark, Math.min(1, (dmg - 0.3) * 1.4));
    }
  }
}

export const CAR_COLORS = [0xc8ccd2, 0x2b2f36, 0xf2f2ef, 0x9c1f24, 0x1f4e8c, 0x5a6b4a, 0x8a8f98, 0xd7a43b, 0x3c6e71, 0x6d2e46, 0xe0dccf, 0x23395b];
