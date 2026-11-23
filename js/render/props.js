// Instanced street furniture and landmarks: trees, street lights, traffic lights, containers,
// ramps, railings, the arena, chimneys, the lighthouse and dock cranes.
import * as THREE from 'three';
import { Geo } from './geo.js';
import { stripeTexture } from './textures.js';
import { signalState } from '../citygen.js';
import { CURB } from '../city.js';
import { mulberry32 } from '../util.js';

const dummy = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);

function instanced(geom, mat, count, shadow = true) {
  const m = new THREE.InstancedMesh(geom, mat, Math.max(1, count));
  m.count = count;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function setAt(mesh, i, x, y, z, ry = 0, s = 1, fall = null) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, ry, 0);
  dummy.scale.setScalar(s);
  dummy.updateMatrix();
  if (fall) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(fall.z, 0, -fall.x).normalize(), 1.35);
    const base = new THREE.Matrix4().makeTranslation(x, y, z);
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);
    dummy.matrix.copy(base).multiply(rot).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeScale(s, s, s));
  }
  mesh.setMatrixAt(i, dummy.matrix);
}

export function buildProps(city, scene) {
  const r = mulberry32(5);
  const api = { lampMats: [], pools: null };
  const col = new THREE.Color();

  // Trees
  const kinds = { round: [], pine: [], palm: [] };
  city.trees.forEach((t) => kinds[t.kind].push(t));
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4f3a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const parts = {
    round: [new THREE.CylinderGeometry(0.2, 0.3, 3.2, 6).translate(0, 1.6, 0), new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.4, 0)],
    pine: [new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6).translate(0, 1.1, 0), new THREE.ConeGeometry(2.1, 6.5, 7).translate(0, 5, 0)],
    palm: [new THREE.CylinderGeometry(0.16, 0.26, 7.5, 6).translate(0, 3.75, 0), palmFronds()],
  };
  const leafColors = { round: [0x4f8a3c, 0x5c9944, 0x467f37, 0x6aa04c], pine: [0x2f6b45, 0x3a7a4f, 0x2c5f3e], palm: [0x5c9a3a, 0x6aab45] };
  for (const k of Object.keys(kinds)) {
    const list = kinds[k];
    const trunk = instanced(parts[k][0], trunkMat, list.length);
    const leaf = instanced(parts[k][1], leafMat, list.length);
    list.forEach((t, i) => {
      const y = CURB, ry = r() * 6.28;
      setAt(trunk, i, t.x, y, t.z, ry, t.s);
      setAt(leaf, i, t.x, y, t.z, ry, t.s);
      leaf.setColorAt(i, col.setHex(leafColors[k][i % leafColors[k].length]).offsetHSL(0, 0, (r() - 0.5) * 0.08));
    });
    scene.add(trunk, leaf);
  }

  // Street lights: pole, arm, lamp head, and a pool of light on the road at night.
  const metal = new THREE.MeshLambertMaterial({ color: 0x4a4f55 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xdedede, emissive: 0xffd9a0, emissiveIntensity: 0 });
  api.lampMats.push(headMat);
  const L = city.lamps.length;
  const pole = instanced(new THREE.BoxGeometry(0.18, 7.2, 0.18).translate(0, 3.6, 0), metal, L);
  const arm = instanced(new THREE.BoxGeometry(0.12, 0.12, 2.1).translate(0, 7.1, 1.0), metal, L, false);
  const head = instanced(new THREE.BoxGeometry(0.45, 0.18, 0.9).translate(0, 7.0, 2.0), headMat, L, false);
  const poolTex = radialTexture();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = instanced(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(0, 0.03, 2.0), poolMat, L, false);
  pools.receiveShadow = false;
  city.lamps.forEach((l, i) => {
    for (const m of [pole, arm, head, pools]) setAt(m, i, l.x, CURB, l.z, l.h);
  });
  scene.add(pole, arm, head, pools);
  api.pools = poolMat;

  // Traffic lights.
  const S = city.signals.length;
  const sPole = instanced(new THREE.BoxGeometry(0.16, 4.8, 0.16).translate(0, 2.4, 0), metal, S);
  const sBox = instanced(new THREE.BoxGeometry(0.42, 1.3, 0.32).translate(0, 4.25, 0), new THREE.MeshLambertMaterial({ color: 0x23262a }), S);
  const lampGeo = new THREE.CircleGeometry(0.13, 10);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lights = [0, 1, 2].map((k) => instanced(lampGeo.clone().translate(0, 4.65 - k * 0.4, 0.17), lampMat, S, false));
  city.signals.forEach((s, i) => {
    for (const m of [sPole, sBox, ...lights]) setAt(m, i, s.x, CURB, s.z, s.h);
  });
  scene.add(sPole, sBox, ...lights);
  const ON = [new THREE.Color(0xff3b30), new THREE.Color(0xffb020), new THREE.Color(0x36e07a)];
  const OFF = [new THREE.Color(0x3a1513), new THREE.Color(0x3a2a10), new THREE.Color(0x10301c)];
  let lastSignalUpdate = -1;
  api.updateSignals = (t) => {
    const step = Math.floor(t * 4);
    if (step === lastSignalUpdate) return;
    lastSignalUpdate = step;
    city.signals.forEach((s, i) => {
      if (s.broken) return;
      const st = signalState(city, s.node, s.axis, t);
      const on = st === 'r' ? 0 : st === 'y' ? 1 : 2;
      for (let k = 0; k < 3; k++) lights[k].setColorAt(i, k === on ? ON[k] : OFF[k]);
    });
    for (const m of lights) m.instanceColor.needsUpdate = true;
  };

  // Knocked-over lamps and signals.
  api.knock = (c, dirX, dirZ) => {
    const fall = { x: dirX, z: dirZ };
    if (c.kind === 'lamp') {
      const l = city.lamps[c.prop];
      for (const m of [pole, arm, head]) { setAt(m, c.prop, l.x, CURB, l.z, l.h, 1, fall); m.instanceMatrix.needsUpdate = true; }
      setAt(pools, c.prop, l.x, -50, l.z, 0, 0.001); pools.instanceMatrix.needsUpdate = true;
    } else if (c.kind === 'signal') {
      const s = city.signals[c.prop];
      s.broken = true;
      for (const m of [sPole, sBox, ...lights]) { setAt(m, c.prop, s.x, CURB, s.z, s.h, 1, fall); m.instanceMatrix.needsUpdate = true; }
    }
  };

  buildContainers(city, scene);
  buildRamps(city, scene);
  buildLandmarks(city, scene, api);
  return api;
}

function buildContainers(city, scene) {
  const list = [];
  for (const c of city.containers) for (let k = 0; k < c.stack; k++) list.push({ ...c, y: CURB + 1.3 + k * 2.6 });
  const g = new THREE.BoxGeometry(12, 2.6, 2.5);
  const m = instanced(g, new THREE.MeshLambertMaterial({ map: ribTexture() }), list.length);
  const col = new THREE.Color();
  list.forEach((c, i) => { setAt(m, i, c.x, c.y, c.z); m.setColorAt(i, col.setHex(c.color)); });
  scene.add(m);
}

function buildRamps(city, scene) {
  const mat = new THREE.MeshLambertMaterial({ map: stripeTexture() });
  const side = new THREE.MeshLambertMaterial({ color: 0x707274 });
  for (const rp of city.ramps) {
    const top = new Geo(), sides = new Geo();
    const w = rp.width / 2, b = rp.base, h = rp.height, len = rp.len;
    top.quad([-w, b, 0], [-w, b + h, len], [w, b + h, len], [w, b, 0], [0, len, -h].map((v) => v / Math.hypot(len, h)),
      [[0, 0], [0, len / 3], [w / 1.5, len / 3], [w / 1.5, 0]]);
    sides.quad([-w, 0, len], [w, 0, len], [w, b + h, len], [-w, b + h, len], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], 0xffffff);
    sides.tri([w, b, len], [w, b, 0], [w, b + h, len], [1, 0, 0], [[0, 0], [1, 0], [1, 1]], 0xffffff);
    sides.tri([-w, b, 0], [-w, b, len], [-w, b + h, len], [-1, 0, 0], [[0, 0], [1, 0], [1, 1]], 0xffffff);
    const grp = new THREE.Group();
    const a = new THREE.Mesh(top.build(), mat), s = new THREE.Mesh(sides.build(), side);
    a.castShadow = s.castShadow = true;
    a.receiveShadow = true;
    grp.add(a, s);
    grp.position.set(rp.x, 0, rp.z);
    grp.rotation.y = rp.h;
    scene.add(grp);
  }
}

function buildLandmarks(city, scene, api) {
  const rails = new Geo();
  for (const rl of city.railings) {
    rails.box(rl.x0, 0.9, rl.z - 0.08, rl.x1, 1.1, rl.z + 0.08, 0xc8ccd0);
    for (let x = rl.x0; x <= rl.x1; x += 2.5) rails.box(x - 0.06, CURB, rl.z - 0.06, x + 0.06, 0.95, rl.z + 0.06, 0xc8ccd0);
  }
  scene.add(new THREE.Mesh(rails.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));

  for (const o of city.round) {
    if (o.kind === 'arena') {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.h, 48, 1, true), new THREE.MeshLambertMaterial({ color: 0x8c86a0, side: THREE.DoubleSide }));
      wall.position.y = o.h / 2;
      const stands = new THREE.Mesh(new THREE.CylinderGeometry(o.r - 1, o.r - 26, o.h - 3, 48, 1, true), new THREE.MeshLambertMaterial({ color: 0x5b5470, side: THREE.DoubleSide }));
      stands.position.y = (o.h - 3) / 2 + 1.5;
      const pitch = new THREE.Mesh(new THREE.CircleGeometry(o.r - 25, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4f9a46 }));
      pitch.position.y = 1.6;
      const lip = new THREE.Mesh(new THREE.RingGeometry(o.r - 3, o.r + 0.5, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe7e3ee, side: THREE.DoubleSide }));
      lip.position.y = o.h;
      wall.castShadow = true;
      g.add(wall, stands, pitch, lip);
      g.position.set(o.x, 0, o.z);
      scene.add(g);
    } else if (o.kind === 'chimney') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.7, o.r, o.h, 12), new THREE.MeshLambertMaterial({ color: 0x8a5a48 }));
      m.position.set(o.x, o.h / 2, o.z);
      m.castShadow = true;
      scene.add(m);
    } else if (o.kind === 'lighthouse') {
      const g = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.7, o.r, o.h, 16), new THREE.MeshLambertMaterial({ map: bandTexture() }));
      tower.position.y = o.h / 2;
      tower.castShadow = true;
      const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 0 });
      api.lampMats.push(lampMat);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 12), lampMat);
      lamp.position.y = o.h + 1.5;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(3, 3, 12), new THREE.MeshLambertMaterial({ color: 0xb33a3a }));
      cap.position.y = o.h + 4.5;
      g.add(tower, lamp, cap);
      g.position.set(o.x, 0, o.z);
      scene.add(g);
    }
  }

  const crane = new Geo();
  for (const c of city.cranes) {
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) crane.box(c.x + dx - 0.5, 0, c.z + dz - 0.5, c.x + dx + 0.5, 22, c.z + dz + 0.5, 0xe08a2c);
    crane.box(c.x - 1.5, 22, c.z - 30, c.x + 1.5, 25, c.z + 45, 0xe08a2c);
    crane.box(c.x - 3, 25, c.z - 4, c.x + 3, 29, c.z + 4, 0xd9d4c8);
  }
  const cm = new THREE.Mesh(crane.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  cm.castShadow = true;
  scene.add(cm);
}

function palmFronds() {
  const g = new Geo();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    const px = -dz * 0.45, pz = dx * 0.45;
    const y0 = 7.5, x1 = dx * 3.4, z1 = dz * 3.4, y1 = 6.2;
    const n = [0, 1, 0];
    g.quad([px, y0, pz], [-px, y0, -pz], [x1 - px * 0.3, y1, z1 - pz * 0.3], [x1 + px * 0.3, y1, z1 + pz * 0.3], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    g.quad([-px, y0, -pz], [px, y0, pz], [x1 + px * 0.3, y1, z1 + pz * 0.3], [x1 - px * 0.3, y1, z1 - pz * 0.3], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  return g.build();
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function ribTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < 128; x += 6) g.fillRect(x, 0, 2, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bandTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#c23b3b' : '#f4f1ea'; g.fillRect(0, i * 16, 8, 16); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
