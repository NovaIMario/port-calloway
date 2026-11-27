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

// Shop pictograms: a white glyph on a coloured disc.
export const SHOP_COLORS = { guns: '#ff8a3a', food: '#7fe0a4', clothes: '#e889b0', cars: '#b9a2ff', garage: '#4ab0b5' };
export function shopGlyph(g, kind, s = 1) {
  g.save();
  g.scale(s, s);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  if (kind === 'guns') {
    g.rect(28, 44, 70, 18); g.moveTo(40, 58); g.lineTo(58, 58); g.lineTo(52, 90); g.lineTo(36, 90); g.closePath(); g.fill();
  } else if (kind === 'food') {
    g.rect(38, 52, 38, 42); g.fill();
    g.beginPath(); g.arc(80, 70, 10, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.beginPath(); for (const x of [46, 58, 70]) { g.moveTo(x, 44); g.quadraticCurveTo(x - 6, 36, x, 28); } g.stroke();
  } else if (kind === 'clothes') {
    g.moveTo(44, 30); g.lineTo(26, 42); g.lineTo(34, 58); g.lineTo(42, 54); g.lineTo(42, 96); g.lineTo(86, 96);
    g.lineTo(86, 54); g.lineTo(94, 58); g.lineTo(102, 42); g.lineTo(84, 30); g.quadraticCurveTo(64, 44, 44, 30); g.fill();
  } else if (kind === 'cars') {
    g.moveTo(22, 82); g.lineTo(22, 66); g.lineTo(44, 62); g.lineTo(56, 48); g.lineTo(84, 48); g.lineTo(98, 62); g.lineTo(106, 66); g.lineTo(106, 82); g.closePath(); g.fill();
    g.fillStyle = '#1b1208'; for (const x of [42, 86]) { g.beginPath(); g.arc(x, 82, 9, 0, Math.PI * 2); g.fill(); }
  } else {
    g.moveTo(24, 58); g.lineTo(64, 30); g.lineTo(104, 58); g.lineTo(104, 98); g.lineTo(24, 98); g.closePath(); g.fill();
    g.fillStyle = '#1b1208'; for (const y of [66, 76, 86]) g.fillRect(40, y, 48, 5);
  }
  g.restore();
}

function shopTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = SHOP_COLORS[kind] || '#fff'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#1b1208'; g.stroke();
  shopGlyph(g, kind);
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
    this.shops = null;
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

  // Shop doors: a ring on the pavement and the shop's sign floating over it. Shut shops are dimmed.
  setShops(shops, t, groundAt, player, closed = () => false) {
    if (!this.shops) {
      const textures = {};
      this.shops = shops.map((s) => {
        const color = new THREE.Color(SHOP_COLORS[s.kind] || '#fff');
        const g = new THREE.Group();
        const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
        ring.scale.set(1.1, 1, 1.1);
        ring.position.y = 0.04;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: (textures[s.kind] ||= shopTexture(s.kind)), fog: false }));
        sprite.scale.set(0.9, 0.9, 1);
        g.add(ring, sprite);
        g.position.set(s.x, groundAt(s.x, s.z) ?? 0, s.z);
        g.userData = { ring, sprite };
        this.scene.add(g);
        return g;
      });
    }
    shops.forEach((s, i) => {
      const g = this.shops[i];
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      g.visible = d < 140;
      if (!g.visible) return;
      const shut = closed(s);
      g.userData.sprite.position.y = 2.2 + Math.sin(t * 2 + i) * 0.12;
      g.userData.sprite.material.opacity = shut ? 0.35 : 1;
      g.userData.ring.material.opacity = shut ? 0.2 : 0.6 + Math.sin(t * 3) * 0.25;
    });
  }
}
