// Glowing columns for destinations and checkpoints, arrows over target vehicles, and beacons
// with a letter where a job can be started.
import * as THREE from 'three';

function letterTexture(letter, bg) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#1b1208'; g.stroke();
  g.fillStyle = '#1b1208'; g.font = '800 72px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Markers {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.arrows = [];
    this.beacons = new Map();
    this.colGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    this.arrowGeo = new THREE.ConeGeometry(0.7, 1.4, 4).rotateX(Math.PI);
  }

  column(i) {
    if (!this.pool[i]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      const g = new THREE.Group();
      const col = new THREE.Mesh(this.colGeo, mat), ring = new THREE.Mesh(this.ringGeo, ringMat);
      ring.position.y = 0.25;
      g.add(col, ring);
      g.userData = { col, ring, mat, ringMat };
      this.scene.add(g);
      this.pool[i] = g;
    }
    return this.pool[i];
  }

  arrow(i) {
    if (!this.arrows[i]) {
      const m = new THREE.Mesh(this.arrowGeo, new THREE.MeshBasicMaterial({ color: 0xff5a4f, fog: false }));
      this.scene.add(m);
      this.arrows[i] = m;
    }
    return this.arrows[i];
  }

  // list: [{x, z, y?, r, kind, checkpoint, faint, vehicle}]
  set(list, t, groundAt) {
    let ci = 0, ai = 0;
    for (const m of list) {
      if (m.vehicle) {
        const a = this.arrow(ai++);
        a.visible = true;
        a.position.set(m.x, (m.y ?? 0) + 4 + Math.sin(t * 4) * 0.35, m.z);
        a.rotation.y = t * 2;
        continue;
      }
      const g = this.column(ci++);
      const y = groundAt(m.x, m.z) ?? 0;
      const r = m.r ?? 4;
      g.visible = true;
      g.position.set(m.x, y, m.z);
      const color = m.checkpoint ? 0xff8a3a : 0xf2c230;
      g.userData.mat.color.setHex(color); g.userData.ringMat.color.setHex(color);
      g.userData.col.scale.set(r, m.checkpoint ? 14 : 26, r);
      g.userData.ring.scale.set(r, 1, r);
      g.userData.mat.opacity = (m.faint ? 0.1 : 0.26) + Math.sin(t * 3) * 0.04;
      g.userData.ringMat.opacity = m.faint ? 0.3 : 0.9;
    }
    for (let i = ci; i < this.pool.length; i++) this.pool[i].visible = false;
    for (let i = ai; i < this.arrows.length; i++) this.arrows[i].visible = false;
  }

  // Job start points: a column plus a floating letter for whoever gives the job.
  setBeacons(list, t, groundAt) {
    const seen = new Set();
    for (const b of list) {
      const key = `${b.x},${b.z}`;
      seen.add(key);
      let o = this.beacons.get(key);
      if (!o) {
        const g = new THREE.Group();
        const col = new THREE.Mesh(this.colGeo, new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
        col.scale.set(1.6, 7, 1.6);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(b.letter, '#f2c230'), depthTest: true, fog: false }));
        sprite.scale.set(1.8, 1.8, 1);
        sprite.position.y = 3.2;
        g.add(col, sprite);
        g.userData.sprite = sprite;
        this.scene.add(g);
        o = g;
        this.beacons.set(key, o);
      }
      o.visible = true;
      o.position.set(b.x, groundAt(b.x, b.z) ?? 0, b.z);
      o.userData.sprite.position.y = 3.2 + Math.sin(t * 2.5) * 0.25;
    }
    for (const [k, o] of this.beacons) if (!seen.has(k)) o.visible = false;
  }
}
