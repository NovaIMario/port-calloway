// Blocky people. Pedestrians are drawn with one instanced mesh per body part, so a crowd costs
// a handful of draw calls. The player uses the same parts as ordinary meshes.
import * as THREE from 'three';
import { SKIN, SHIRTS, TROUSERS, HAIR } from '../looks.js';
import { WEAPONS } from '../combat.js';
import { gunGeometry, gunMaterial } from './guns.js';
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
const HAND = [0, -0.6, 0]; // where a gun sits, from the shoulder of a straight arm
const PUNCH = 0.28;

// Arm angles. 'armL' is the person's right arm (it holds the gun); 'armR' the left.
// Pose fields: swing, armsUp, armed, twoHand, aiming (or aim, for the police), aimPitch, punchT.
function armAngles(name, p) {
  const swing = p.swing || 0, gunArm = name === 'armL';
  const raised = p.armed && (p.aiming || p.aim || p.shotT > 0);
  const pitch = p.aimPitch || 0;
  if (gunArm && p.punchT > 0) return [-1.55 * Math.sin(Math.PI * (1 - p.punchT / PUNCH)), 0.12];
  if (raised) {
    if (gunArm) return [-1.5 + pitch, p.twoHand ? 0 : 0.08];
    if (p.twoHand) return [-1.3 + pitch, -0.75];
  } else if (p.armed && p.twoHand && !p.armsUp) {
    // carried across the body
    return gunArm ? [-0.55 - swing * 0.2, 0.1] : [-0.85 + swing * 0.2, -0.65];
  }
  const sw = (gunArm ? -swing : swing) * 0.8;
  if (p.armsUp) return [sw - 2.6, gunArm ? 0.25 : -0.25];
  return [sw, 0];
}

function partMatrix(name, p, out, tmp, extra = null) {
  const P = PARTS[name];
  let rx = 0, rz = 0;
  if (name === 'legL') rx = p.swing || 0;
  else if (name === 'legR') rx = -(p.swing || 0);
  else if (name === 'armL' || name === 'armR') [rx, rz] = armAngles(name, p);
  tmp.local.makeRotationFromEuler(tmp.euler.set(rx, 0, rz));
  tmp.local.setPosition(P.pivot[0], P.pivot[1], P.pivot[2]);
  const off = extra || P.off;
  tmp.off.makeTranslation(off[0], off[1], off[2]);
  out.copy(tmp.body).multiply(tmp.local).multiply(tmp.off);
  return out;
}

function bodyMatrix(p, m, tmp) {
  // Lying down: rotate the whole body to the ground around its feet. A hit rocks it back.
  const lean = (p.lean || 0) - (p.hitT > 0 ? p.hitT * 0.9 : 0);
  tmp.euler.set(p.down ? -Math.PI / 2 * p.down : lean, p.h, p.spin || 0, 'YXZ');
  m.makeRotationFromEuler(tmp.euler);
  m.setPosition(p.x, p.y + (p.down ? 0.15 * p.down : 0), p.z);
  return m;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

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
    // the police carry pistols
    this.guns = new THREE.InstancedMesh(gunGeometry('pistol'), gunMaterial, max);
    this.guns.count = 0;
    this.guns.frustumCulled = false;
    scene.add(this.guns);
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
      this.guns.setMatrixAt(i, p.armed && !p.dead ? partMatrix('armL', p, this.m, this.tmp, HAND) : ZERO);
    }
    for (const mesh of [...Object.values(this.meshes), this.guns]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

// The player: same blocky person, as a group of ordinary meshes, with whatever they are holding.
export class PlayerView {
  constructor(scene, look) {
    this.group = new THREE.Group();
    this.parts = {};
    this.look = { ...look };
    for (const n of NAMES) {
      const mesh = new THREE.Mesh(PARTS[n].geo(), new THREE.MeshLambertMaterial({ color: this.colorOf(n) }));
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.parts[n] = mesh;
    }
    // a jacket collar so the player stands out from the crowd
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), new THREE.MeshLambertMaterial({ color: look.accent }));
    collar.matrixAutoUpdate = false;
    this.collar = collar;
    this.collarAt = new THREE.Matrix4().makeTranslation(0, 1.58, 0);
    this.group.add(collar);
    this.guns = {};
    for (const id of ['pistol', 'smg', 'shotgun', 'rifle']) {
      const g = new THREE.Mesh(gunGeometry(id), gunMaterial);
      g.castShadow = true;
      g.matrixAutoUpdate = false;
      g.visible = false;
      this.group.add(g);
      this.guns[id] = g;
    }
    this.tmp = { local: new THREE.Matrix4(), off: new THREE.Matrix4(), body: new THREE.Matrix4(), euler: new THREE.Euler() };
    scene.add(this.group);
  }

  colorOf(n) {
    const L = this.look;
    return n === 'head' ? L.skin : n === 'hair' ? L.hair : n.startsWith('leg') ? L.trousers : L.shirt;
  }

  // New clothes: shirt, trousers and the collar's accent colour.
  setLook(look) {
    Object.assign(this.look, look);
    for (const n of NAMES) this.parts[n].material.color.setHex(this.colorOf(n));
    this.collar.material.color.setHex(this.look.accent);
  }

  update(p) {
    this.group.visible = !p.hidden;
    if (p.hidden) return;
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = p.h;
    const W = WEAPONS[p.weapon] || WEAPONS.fist;
    const pose = { ...p, x: 0, y: 0, z: 0, h: 0, armed: !W.melee, twoHand: !!W.twoHand };
    if (!p.aiming) pose.aimPitch = 0;
    bodyMatrix(pose, this.tmp.body, this.tmp);
    for (const n of NAMES) partMatrix(n, pose, this.parts[n].matrix, this.tmp);
    this.collar.matrix.copy(this.tmp.body).multiply(this.collarAt);
    for (const [id, g] of Object.entries(this.guns)) {
      g.visible = id === p.weapon && p.down === 0;
      if (g.visible) partMatrix('armL', pose, g.matrix, this.tmp, HAND);
    }
  }
}
