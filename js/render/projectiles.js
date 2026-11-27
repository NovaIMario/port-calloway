// Rockets and grenades in flight: a few instanced meshes, plus a flickering flame behind each
// rocket (its smoke trail is particles, from the game's effects).
import * as THREE from 'three';

const MAX = 24;

export class ProjectileView {
  constructor(scene) {
    this.grenades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), new THREE.MeshLambertMaterial({ color: 0x3d4436 }), MAX);
    this.rockets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6e7a5a }), MAX);
    this.flames = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc46a }), MAX);
    for (const m of [this.grenades, this.rockets, this.flames]) {
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.grenades.castShadow = this.rockets.castShadow = true;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3(1, 1, 1);
    this.p = new THREE.Vector3();
  }

  update(list, t) {
    let g = 0, r = 0;
    for (const k of list) {
      if (k.kind === 'grenade' && g < MAX) {
        this.q.setFromEuler(this.e.set(k.spin, k.spin * 0.6, 0));
        this.grenades.setMatrixAt(g++, this.m.compose(this.p.set(k.x, k.y, k.z), this.q, this.s.set(1, 1, 1)));
      } else if (k.kind === 'rocket' && r < MAX) {
        this.q.setFromEuler(this.e.set(-Math.asin(Math.max(-1, Math.min(1, k.dy))), Math.atan2(k.dx, k.dz), 0, 'YXZ'));
        this.rockets.setMatrixAt(r, this.m.compose(this.p.set(k.x, k.y, k.z), this.q, this.s.set(1, 1, 1)));
        const fl = 0.8 + Math.sin(t * 70 + r * 2) * 0.3;
        this.p.set(k.x - k.dx * 0.5, k.y - k.dy * 0.5, k.z - k.dz * 0.5);
        this.flames.setMatrixAt(r++, this.m.compose(this.p, this.q, this.s.set(fl, fl, fl * 1.8)));
      }
    }
    this.grenades.count = g;
    this.rockets.count = this.flames.count = r;
    for (const m of [this.grenades, this.rockets, this.flames]) m.instanceMatrix.needsUpdate = true;
  }
}
