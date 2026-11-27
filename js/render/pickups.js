// Things to pick up: spinning guns, bundles of cash, body armour and first aid, each in a
// faint column of light so they can be spotted from down the street.
import * as THREE from 'three';
import { gunGeometry, gunMaterial } from './guns.js';

const GLOW = { cash: 0x4fd18b, weapon: 0xffa040, ammo: 0xffa040, armour: 0x4f8cff, health: 0xff5a4f };

export class PickupView {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.columnGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.8, 16, 1, true).translate(0, 0.9, 0);
    this.cashGeo = new THREE.BoxGeometry(0.34, 0.1, 0.18);
    this.armourGeo = new THREE.BoxGeometry(0.42, 0.5, 0.16);
    this.healthGeo = new THREE.BoxGeometry(0.4, 0.3, 0.2);
    this.mats = {
      cash: new THREE.MeshLambertMaterial({ color: 0x5fa86c, emissive: 0x15301b }),
      armour: new THREE.MeshLambertMaterial({ color: 0x2f4f8c, emissive: 0x0c1830 }),
      health: new THREE.MeshLambertMaterial({ color: 0xf4f4f4, emissive: 0x402020 }),
    };
  }

  item(i) {
    if (!this.pool[i]) {
      const g = new THREE.Group();
      const column = new THREE.Mesh(this.columnGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      const thing = new THREE.Mesh(this.cashGeo, this.mats.cash);
      thing.castShadow = true;
      g.add(column, thing);
      g.userData = { column, thing };
      this.scene.add(g);
      this.pool[i] = g;
    }
    return this.pool[i];
  }

  update(pickups, t, player) {
    let n = 0;
    for (const k of pickups) {
      if (k.wait > 0 || Math.abs(k.x - player.x) > 150 || Math.abs(k.z - player.z) > 150) continue;
      const g = this.item(n++), { column, thing } = g.userData;
      g.visible = true;
      g.position.set(k.x, k.y, k.z);
      column.material.color.setHex(GLOW[k.kind] ?? 0xffffff);
      const gun = (k.kind === 'weapon' || k.kind === 'ammo') && gunGeometry(k.weapon);
      thing.geometry = gun || (k.kind === 'armour' ? this.armourGeo : k.kind === 'health' ? this.healthGeo : this.cashGeo);
      thing.material = gun ? gunMaterial : this.mats[k.kind] || this.mats.cash;
      // guns stand upright and turn about their own top; the rest bob and spin
      if (gun) { thing.rotation.set(-Math.PI / 2, 0, t * 1.8); thing.scale.setScalar(1.7); }
      else { thing.rotation.set(0, t * 1.8, 0); thing.scale.setScalar(1); }
      thing.position.y = 0.6 + Math.sin(t * 3 + k.x) * 0.08;
      // a pickup about to vanish flickers
      g.visible = k.life === undefined || k.life > 5 || Math.floor(t * 6) % 2 === 0;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
