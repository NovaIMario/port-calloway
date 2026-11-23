// Blocky people. Pedestrians are drawn with one instanced mesh per body part, so a crowd costs
// six draw calls. The player uses the same parts as ordinary meshes.
import * as THREE from 'three';
import { SKIN, SHIRTS, TROUSERS, HAIR } from '../looks.js';
export { SKIN, SHIRTS, TROUSERS, HAIR };

const PARTS = {
  torso: { geo: () => new THREE.BoxGeometry(0.48, 0.62, 0.28), pivot: [0, 1.0, 0], off: [0, 0.31, 0] },
  head: { geo: () => new THREE.BoxGeometry(0.26, 0.28, 0.26), pivot: [0, 1.64, 0], off: [0, 0.14, 0] },
  hair: { geo: () => new THREE.BoxGeometry(0.28, 0.1, 0.28), pivot: [0, 1.64, 0], off: [0, 0.29, -0.01] },
  armL: { geo: () => new THREE.BoxGeometry(0.13, 0.58, 0.14), pivot: [-0.31, 1.58, 0], off: [0, -0.27, 0] },
  armR: { geo: () => new THREE.BoxGeometry(0.13, 0.58, 0.14), pivot: [0.31, 1.58, 0], off: [0, -0.27, 0] },
  legL: { geo: () => new THREE.BoxGeometry(0.19, 0.96, 0.2), pivot: [-0.12, 1.0, 0], off: [0, -0.48, 0] },
  legR: { geo: () => new THREE.BoxGeometry(0.19, 0.96, 0.2), pivot: [0.12, 1.0, 0], off: [0, -0.48, 0] },
};
const NAMES = Object.keys(PARTS);

// Pose: swing (radians) for arms and legs, lean, and an optional "down" state for knocked-over people.
function partMatrix(name, p, out, tmp) {
  const P = PARTS[name];
  const swing = p.swing || 0;
  let rx = 0, rz = 0;
  if (name === 'legL') rx = swing;
  else if (name === 'legR') rx = -swing;
  else if (name === 'armL') rx = -swing * 0.8 + (p.armsUp ? -2.6 : 0);
  else if (name === 'armR') rx = swing * 0.8 + (p.armsUp ? -2.6 : 0);
  if (p.armsUp && (name === 'armL' || name === 'armR')) rz = name === 'armL' ? 0.25 : -0.25;
  tmp.local.makeRotationFromEuler(tmp.euler.set(rx, 0, rz));
  tmp.local.setPosition(P.pivot[0], P.pivot[1], P.pivot[2]);
  tmp.off.makeTranslation(P.off[0], P.off[1], P.off[2]);
  out.copy(tmp.body).multiply(tmp.local).multiply(tmp.off);
  return out;
}

function bodyMatrix(p, m, tmp) {
  // Lying down: rotate the whole body to the ground around its feet.
  tmp.euler.set(p.down ? -Math.PI / 2 * p.down : p.lean || 0, p.h, p.spin || 0, 'YXZ');
  m.makeRotationFromEuler(tmp.euler);
  m.setPosition(p.x, p.y + (p.down ? 0.15 * p.down : 0), p.z);
  return m;
}


export class CrowdRenderer {
  constructor(scene, max = 80) {
    this.max = max;
    this.meshes = {};
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const n of NAMES) {
      const m = new THREE.InstancedMesh(PARTS[n].geo(), mat, max);
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color());
      scene.add(m);
      this.meshes[n] = m;
    }
    this.tmp = { local: new THREE.Matrix4(), off: new THREE.Matrix4(), body: new THREE.Matrix4(), euler: new THREE.Euler() };
    this.m = new THREE.Matrix4();
    this.c = new THREE.Color();
  }

  update(people) {
    const n = Math.min(people.length, this.max);
    for (let i = 0; i < n; i++) {
      const p = people[i];
      bodyMatrix(p, this.tmp.body, this.tmp);
      for (const name of NAMES) {
        const mesh = this.meshes[name];
        mesh.setMatrixAt(i, partMatrix(name, p, this.m, this.tmp));
        const hex = name === 'head' ? p.skin : name === 'hair' ? p.hair : name.startsWith('leg') ? p.trousers : name.startsWith('arm') ? (p.sleeves ? p.shirt : p.skin) : p.shirt;
        mesh.setColorAt(i, this.c.setHex(hex));
      }
    }
    for (const name of NAMES) {
      const mesh = this.meshes[name];
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

// The player: same blocky person, as a group of ordinary meshes.
export class PlayerView {
  constructor(scene, look) {
    this.group = new THREE.Group();
    this.parts = {};
    for (const n of NAMES) {
      const hex = n === 'head' ? look.skin : n === 'hair' ? look.hair : n.startsWith('leg') ? look.trousers : n.startsWith('arm') ? look.shirt : look.shirt;
      const mesh = new THREE.Mesh(PARTS[n].geo(), new THREE.MeshLambertMaterial({ color: hex }));
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.parts[n] = mesh;
    }
    // a jacket collar so the player stands out from the crowd
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), new THREE.MeshLambertMaterial({ color: look.accent }));
    collar.position.set(0, 1.58, 0);
    this.collar = collar;
    this.group.add(collar);
    this.tmp = { local: new THREE.Matrix4(), off: new THREE.Matrix4(), body: new THREE.Matrix4(), euler: new THREE.Euler() };
    this.identity = { x: 0, y: 0, z: 0, h: 0 };
    scene.add(this.group);
  }

  update(p) {
    this.group.visible = !p.hidden;
    if (p.hidden) return;
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = p.h;
    const pose = { ...p, x: 0, y: 0, z: 0, h: 0 };
    bodyMatrix(pose, this.tmp.body, this.tmp);
    for (const n of NAMES) partMatrix(n, pose, this.parts[n].matrix, this.tmp);
  }
}
