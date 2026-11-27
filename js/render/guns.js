// Blocky gun models. In "hand space": the origin is in the hand, the barrel points along -y and
// +z is the top of the gun, which matches an arm held out straight in people.js.
import * as THREE from 'three';
import { Geo } from './geo.js';

const STEEL = 0x2b2d31, BLACK = 0x18191b, WOOD = 0x6b4a2e, OLIVE = 0x3d4436;

// [x half-width, y0, y1, z0, z1, colour]
const PARTS = {
  pistol: [[0.025, -0.19, 0.03, 0.03, 0.1, STEEL], [0.022, -0.02, 0.04, -0.07, 0.04, BLACK]],
  smg: [
    [0.03, -0.26, 0.06, 0.02, 0.11, STEEL], [0.012, -0.36, -0.26, 0.05, 0.08, BLACK],
    [0.02, -0.13, -0.06, -0.15, 0.02, BLACK], [0.022, 0.0, 0.05, -0.08, 0.02, BLACK],
  ],
  shotgun: [
    [0.022, -0.74, 0.0, 0.06, 0.1, STEEL], [0.03, -0.52, -0.32, 0.0, 0.06, WOOD],
    [0.03, -0.06, 0.08, 0.0, 0.1, STEEL], [0.028, 0.08, 0.36, -0.04, 0.08, WOOD],
  ],
  rifle: [
    [0.03, -0.3, 0.08, 0.02, 0.11, OLIVE], [0.012, -0.64, -0.3, 0.055, 0.085, BLACK],
    [0.032, -0.48, -0.3, 0.02, 0.1, STEEL], [0.02, -0.2, -0.12, -0.16, 0.02, BLACK],
    [0.028, 0.08, 0.34, -0.02, 0.1, STEEL], [0.01, -0.12, 0.0, 0.11, 0.14, BLACK],
  ],
};

const cache = new Map();
export function gunGeometry(id) {
  if (!PARTS[id]) return null;
  if (!cache.has(id)) {
    const g = new Geo();
    for (const [hw, y0, y1, z0, z1, color] of PARTS[id]) g.box(-hw, y0, z0, hw, y1, z1, color, { bottom: true });
    cache.set(id, g.build());
  }
  return cache.get(id);
}

export const gunMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
