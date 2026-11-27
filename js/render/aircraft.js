// Low-poly aircraft: the Skylark helicopter and the Gull high-wing plane. Like the cars, each faces
// +z with its origin on the ground (under the skids or wheels); rotors and the propeller spin.
import * as THREE from 'three';
import { Geo } from './geo.js';

const DARK = 0x26282c, STRIPE = 0x1f4e8c;

const mats = {
  trim: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glass: new THREE.MeshPhongMaterial({ color: 0x1d2a36, shininess: 100, specular: 0x8899aa }),
  blade: new THREE.MeshLambertMaterial({ color: 0x222326 }),
  disc: new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  tire: new THREE.MeshLambertMaterial({ color: 0x1c1d1f }),
  red: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
  green: new THREE.MeshBasicMaterial({ color: 0x30ff70 }),
  white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  off: new THREE.MeshBasicMaterial({ color: 0x3a3a3a }),
};
const paints = new Map();
function paintMat(hex) {
  if (!paints.has(hex)) paints.set(hex, new THREE.MeshPhongMaterial({ color: hex, shininess: 70, specular: 0x444444 }));
  return paints.get(hex);
}

const cache = new Map();
function heliGeometry() {
  const paint = new Geo(), trim = new Geo(), glass = new Geo();
  paint.box(-0.85, 0.62, -1.0, 0.85, 2.05, 1.55);            // cabin
  paint.box(-0.8, 0.62, 1.55, 0.8, 0.85, 2.55, 0xffffff, { bottom: true }); // chin
  glass.box(-0.8, 0.85, 1.55, 0.8, 1.95, 2.45);               // canopy
  glass.box(-0.87, 1.25, -0.2, 0.87, 1.9, 1.5, 0xffffff, { top: false }); // side windows
  trim.box(-0.86, 0.95, -1.0, 0.86, 1.12, 1.56, STRIPE, { top: false });  // stripe
  trim.box(-0.55, 2.05, -1.3, 0.55, 2.5, 0.85, 0x8a8f98);    // engine
  paint.box(-0.24, 1.45, -5.6, 0.24, 1.88, -1.0);             // tail boom
  paint.box(-0.06, 1.6, -5.85, 0.06, 3.0, -5.05);              // fin
  trim.box(-0.95, 1.52, -5.25, 0.95, 1.6, -4.7, DARK, { bottom: true }); // tailplane
  for (const x of [-0.95, 0.95]) {
    trim.box(x - 0.05, 0, -1.45, x + 0.05, 0.09, 1.95, DARK, { bottom: true }); // skid
    for (const z of [-0.7, 1.05]) trim.box(x * 0.92 - 0.04, 0.09, z - 0.04, x * 0.92 + 0.04, 0.65, z + 0.04, DARK);
  }
  trim.box(-0.07, 2.5, -0.07, 0.07, 2.72, 0.07, DARK);          // mast
  return { paint: paint.build(), trim: trim.build(), glass: glass.build() };
}

function planeGeometry() {
  const paint = new Geo(), trim = new Geo(), glass = new Geo();
  paint.box(-0.56, 0.9, -1.0, 0.56, 2.0, 2.6);                // cabin
  paint.box(-0.36, 1.2, -3.75, 0.36, 1.92, -1.0);             // rear fuselage
  paint.box(-0.5, 0.98, 2.6, 0.5, 1.78, 3.5);                  // cowling
  trim.box(-0.13, 1.26, 3.5, 0.13, 1.5, 3.74, DARK);           // spinner
  glass.box(-0.5, 1.62, 1.45, 0.5, 2.02, 2.35, 0xffffff, { top: false }); // windscreen
  glass.box(-0.57, 1.5, -0.1, 0.57, 1.96, 1.45, 0xffffff, { top: false }); // side windows
  trim.box(-0.57, 1.18, -1.0, 0.57, 1.32, 3.51, STRIPE, { top: false });   // stripe
  trim.box(-0.37, 1.45, -3.76, 0.37, 1.55, -1.0, STRIPE, { top: false });
  paint.box(-5.3, 2.0, 0.3, 5.3, 2.12, 1.85, 0xffffff, { bottom: true });   // high wing
  paint.box(-0.05, 1.9, -3.8, 0.05, 3.0, -2.95);               // fin
  paint.box(-1.7, 1.56, -3.8, 1.7, 1.63, -3.05, 0xffffff, { bottom: true }); // tailplane
  // landing gear: a leg under each side of the cabin with an arm out to the wheel, and a nose leg
  for (const s of [-1, 1]) {
    trim.box(Math.min(s * 0.45, s * 1.0), 0.26, 0.55, Math.max(s * 0.45, s * 1.0), 0.34, 0.65, DARK);
    trim.box(s * 0.45 - 0.05, 0.26, 0.55, s * 0.45 + 0.05, 0.95, 0.65, DARK);
  }
  trim.box(-0.04, 0.46, 2.86, 0.04, 1.0, 2.94, DARK);
  return { paint: paint.build(), trim: trim.build(), glass: glass.build() };
}

function geometry(kind) {
  if (!cache.has(kind)) cache.set(kind, kind === 'heli' ? heliGeometry() : planeGeometry());
  return cache.get(kind);
}

function blades(n, len, width, axis) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(axis === 'y' ? new THREE.BoxGeometry(width, 0.05, len) : axis === 'x' ? new THREE.BoxGeometry(0.04, len, width) : new THREE.BoxGeometry(width, len, 0.05), mats.blade);
    b.position[axis === 'y' ? 'z' : 'y'] = len / 2;
    const arm = new THREE.Group();
    arm.add(b);
    arm.rotation[axis] = (i / n) * Math.PI * 2;
    b.castShadow = axis === 'y';
    g.add(arm);
  }
  return g;
}

function light(mat, x, y, z, s = 0.12) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
  m.position.set(x, y, z);
  return m;
}

export function createAircraftMesh(v) {
  const G = geometry(v.m.air);
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const paint = new THREE.Mesh(G.paint, paintMat(v.color));
  for (const m of [paint, new THREE.Mesh(G.trim, mats.trim), new THREE.Mesh(G.glass, mats.glass)]) { m.castShadow = true; body.add(m); }
  const view = { root, body, paint, damageTint: 0, air: v.m.air, beacon: null };
  if (v.m.air === 'heli') {
    const rotor = blades(3, 5.3, 0.28, 'y');
    rotor.position.set(0, 2.74, 0);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.3, 32).rotateX(-Math.PI / 2), mats.disc.clone());
    disc.position.set(0, 2.76, 0);
    const tail = blades(2, 0.85, 0.16, 'x');
    tail.position.set(0.12, 2.25, -5.45);
    body.add(rotor, disc, tail);
    // left side red, right side green, a white beacon on the fin
    body.add(light(mats.red, 0.9, 1.0, 0.4), light(mats.green, -0.9, 1.0, 0.4));
    view.beacon = light(mats.white, 0, 3.05, -5.45, 0.14);
    body.add(view.beacon);
    Object.assign(view, { rotor, disc, tail });
  } else {
    const prop = blades(2, 0.95, 0.13, 'z');
    prop.position.set(0, 1.38, 3.78);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), mats.disc.clone());
    disc.position.set(0, 1.38, 3.8);
    body.add(prop, disc);
    // wing struts, from the bottom of the cabin out to under the wing
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.08), mats.blade);
      strut.position.set(s * 1.6, 1.5, 1.1);
      strut.rotation.z = s * -1.08;
      body.add(strut);
    }
    const wheels = [];
    for (const [x, z, r] of [[-1.1, 0.6, 0.3], [1.1, 0.6, 0.3], [0, 2.9, 0.24]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.16, 12).rotateZ(Math.PI / 2), mats.tire);
      w.position.set(x, r, z);
      w.castShadow = true;
      body.add(w);
      wheels.push(w);
    }
    body.add(light(mats.red, 5.32, 2.06, 1.0), light(mats.green, -5.32, 2.06, 1.0));
    view.beacon = light(mats.white, 0, 3.05, -3.4, 0.14);
    body.add(view.beacon);
    Object.assign(view, { prop, disc, wheels });
  }
  return view;
}

const dark = new THREE.Color(0x222222);
export function updateAircraftMesh(view, v, t) {
  view.root.position.set(v.x, v.y, v.z);
  view.root.rotation.y = v.h;
  view.body.rotation.x = -v.pitch;
  view.body.rotation.z = v.roll;
  // a blur disc takes over from the blades as they come up to speed
  const blur = Math.max(0, Math.min(1, (v.rotor - 0.45) * 2.2));
  if (view.air === 'heli') {
    view.rotor.rotation.y = v.blade;
    view.tail.rotation.x = v.blade * 3;
    view.disc.material.opacity = blur * 0.16;
  } else {
    view.prop.rotation.z = v.blade;
    view.disc.material.opacity = blur * 0.22;
    for (const w of view.wheels) w.rotation.x = v.wheelSpin;
  }
  view.beacon.material = v.driver && Math.floor(t * 1.5) % 2 === 0 ? mats.white : mats.off;
  const dmg = Math.max(0, Math.min(1, 1 - v.health / 100));
  if (Math.abs(dmg - view.damageTint) > 0.05) {
    view.damageTint = dmg;
    if (dmg > 0.3) {
      if (view.paint.material === paintMat(v.color)) view.paint.material = view.paint.material.clone();
      view.paint.material.color.setHex(v.color).lerp(dark, Math.min(1, (dmg - 0.3) * 1.4));
    }
  }
}
