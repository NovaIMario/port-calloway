// Procedural canvas textures, so the game ships with no image files.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Window layouts per building style: one texture holds an 8 x 8 grid of bays x floors.
export const FACADE = {
  glass: { bay: 3, floor: 3.6, win: [0.06, 0.08, 0.94, 0.9], frame: '#dfe6ec', glass: '#2c4257', lit: 0.45 },
  office: { bay: 3.5, floor: 3.6, win: [0.18, 0.2, 0.82, 0.78], frame: '#ffffff', glass: '#34475a', lit: 0.35 },
  brick: { bay: 3.2, floor: 3.4, win: [0.28, 0.2, 0.72, 0.8], frame: '#ffffff', glass: '#2a3440', lit: 0.4, arch: true },
  plaster: { bay: 3.4, floor: 3.3, win: [0.25, 0.22, 0.75, 0.78], frame: '#ffffff', glass: '#33414e', lit: 0.4 },
  house: { bay: 3.2, floor: 2.9, win: [0.3, 0.3, 0.7, 0.75], frame: '#ffffff', glass: '#36434f', lit: 0.5 },
  warehouse: { bay: 6, floor: 5, win: [0.1, 0.62, 0.9, 0.82], frame: '#ffffff', glass: '#465560', lit: 0.15, ribs: true },
  hotel: { bay: 3.6, floor: 3.2, win: [0.12, 0.18, 0.88, 0.84], frame: '#ffffff', glass: '#2f4a56', lit: 0.55, balcony: true },
};

export function facadeTextures(style, seed = 7) {
  const F = FACADE[style];
  const r = mulberry32(seed);
  const S = 64, n = 8;
  const [c, g] = canvas(S * n, S * n);
  const [e, ge] = canvas(S * n, S * n);
  g.fillStyle = F.frame; g.fillRect(0, 0, S * n, S * n);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S * n, S * n);
  if (F.ribs) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < S * n; x += 8) g.fillRect(x, 0, 3, S * n);
  }
  const warm = ['#ffd58a', '#ffe2a8', '#fff1c9', '#ffc97a', '#e8f0ff'];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [a, b, cc, d] = F.win;
      const x0 = i * S + a * S, y0 = j * S + (1 - d) * S, w = (cc - a) * S, h = (d - b) * S;
      g.fillStyle = F.glass;
      if (F.arch) {
        g.beginPath(); g.moveTo(x0, y0 + h); g.lineTo(x0, y0 + w / 2);
        g.arc(x0 + w / 2, y0 + w / 2, w / 2, Math.PI, 0); g.lineTo(x0 + w, y0 + h); g.fill();
      } else g.fillRect(x0, y0, w, h);
      // a lighter streak so the glass reads as glass in daylight
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x0, y0, w * 0.35, h);
      if (F.balcony) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(i * S + 4, j * S + S - 10, S - 8, 6); }
      if (r() < F.lit) {
        ge.fillStyle = warm[Math.floor(r() * warm.length)];
        ge.globalAlpha = 0.55 + r() * 0.45;
        ge.fillRect(x0, y0, w, h);
        ge.globalAlpha = 1;
      }
    }
  }
  return { map: tex(c), emissive: tex(e), uScale: 1 / (F.bay * n), vScale: 1 / (F.floor * n) };
}

// Asphalt with lane markings. u runs across the 12 m carriageway, v along 24 m of road.
export function roadTexture(lines = true) {
  const [c, g] = canvas(256, 512);
  const r = mulberry32(3);
  g.fillStyle = '#3b3e42'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.floor(r() * 30);
    g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
    g.fillRect(r() * 256, r() * 512, 2, 2);
  }
  if (lines) {
    g.fillStyle = '#e9e4d4';
    g.fillRect(8, 0, 5, 512); g.fillRect(256 - 13, 0, 5, 512);
    g.fillStyle = '#e8c547';
    for (let y = 0; y < 512; y += 128) g.fillRect(124, y + 16, 8, 70);
  }
  return tex(c);
}

// Paving slabs for pavements, tiled at 2 m.
export function pavingTexture() {
  const [c, g] = canvas(128, 128);
  const r = mulberry32(5);
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 170 + Math.floor(r() * 25);
    g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
    g.fillRect(i * 32 + 1, j * 32 + 1, 30, 30);
  }
  return tex(c);
}

// Neutral speckled noise, tinted per surface by vertex colour (grass, sand, concrete...).
export function noiseTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(11);
  g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const v = 196 + Math.floor(r() * 56);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 3, 2 + r() * 3);
  }
  return tex(c);
}

export function waterTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(13);
  g.fillStyle = '#7f9fb0'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const a = 0.08 + r() * 0.18;
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(10,40,70,${a})`;
    g.fillRect(r() * 256, r() * 256, 6 + r() * 22, 1.5 + r() * 2);
  }
  return tex(c);
}

// Diagonal warning stripes for ramps.
export function stripeTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#222';
  for (let k = -128; k < 256; k += 32) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 16, 0); g.lineTo(k + 16 - 128, 128); g.lineTo(k - 128, 128); g.fill();
  }
  return tex(c);
}

export function signTexture(text, bg, fg) {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = fg;
  g.font = '700 76px "Trebuchet MS", "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 68, 980);
  const t = tex(c, false);
  return t;
}
