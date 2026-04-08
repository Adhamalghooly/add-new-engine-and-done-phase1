/**
 * Mindlin-Reissner 4-Node Shell Element
 * ═══════════════════════════════════════════════════════════════
 * Flat shell element combining plate bending + membrane behaviour.
 *
 * For slab analysis in the global structural core:
 * - 6 DOF per node: [ux, uy, uz, rx, ry, rz]
 * - Total: 4 nodes × 6 DOF = 24 DOF element stiffness
 *
 * Bending DOF (plate): uz, rx, ry — Mindlin plate theory
 *   κx  = −∂RY/∂x,  κy = ∂RX/∂y,  κxy = ∂RX/∂x − ∂RY/∂y
 *   γxz = ∂UZ/∂x + RY,  γyz = ∂UZ/∂y − RX
 *
 * Membrane DOF: ux, uy — plane stress
 *   εx = ∂ux/∂x,  εy = ∂uy/∂y,  γxy = ∂ux/∂y + ∂uy/∂x
 *
 * Drilling DOF (rz): stabilised with small penalty stiffness.
 *
 * ── SLAB STIFFNESS MODES ─────────────────────────────────────
 *   FULL          → full bending + membrane + shear
 *   LOAD_ONLY     → returns zero stiffness matrix
 *   MEMBRANE_ONLY → membrane terms only, zero bending/shear
 *   REDUCED       → K = factor × K_full
 *
 * Integration: 2×2 Gauss for bending, 1×1 reduced for shear (locking-free).
 */

import type { StructuralNode, Material, SlabProperties } from '../model/types';

// Gauss points
const GP2 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const GW2 = [1.0, 1.0];

/**
 * Build 24×24 shell element stiffness matrix.
 * Returns flat row-major array of length 576.
 */
export function buildShellStiffness(
  nodeCoords: { x: number; y: number; z: number }[],
  mat: Material,
  slabProps: SlabProperties,
): number[] {
  const n = 24;
  const K = new Array(n * n).fill(0);

  // LOAD_ONLY mode: zero stiffness (loads transferred separately)
  if (slabProps.stiffnessMode === 'LOAD_ONLY') {
    return K;
  }

  const t = slabProps.thickness;
  const E = mat.fc ? 4700 * Math.sqrt(mat.fc) : mat.E;
  const nu = mat.nu;
  const G = E / (2 * (1 + nu));

  const includeBending = slabProps.stiffnessMode !== 'MEMBRANE_ONLY';
  const factor = slabProps.stiffnessMode === 'REDUCED'
    ? (slabProps.stiffnessFactor ?? 1.0)
    : 1.0;

  // ── Membrane stiffness (plane stress) ──
  // Dm = Et/(1-ν²) × [[1,ν,0],[ν,1,0],[0,0,(1-ν)/2]]
  const Dm_coeff = E * t / (1 - nu * nu);
  const Dm = [
    Dm_coeff, Dm_coeff * nu, 0,
    Dm_coeff * nu, Dm_coeff, 0,
    0, 0, Dm_coeff * (1 - nu) / 2,
  ];

  // ── Bending stiffness ──
  // Db = Et³/(12(1-ν²)) × [[1,ν,0],[ν,1,0],[0,0,(1-ν)/2]]
  const Db_coeff = E * t * t * t / (12 * (1 - nu * nu));
  const Db = [
    Db_coeff, Db_coeff * nu, 0,
    Db_coeff * nu, Db_coeff, 0,
    0, 0, Db_coeff * (1 - nu) / 2,
  ];

  // ── Shear stiffness ──
  const ks = 5 / 6;
  const Ds_coeff = ks * G * t;

  // Node coordinates in element (4 nodes)
  const x = nodeCoords.map(n => n.x);
  const y = nodeCoords.map(n => n.y);

  // Shape function derivatives in natural coordinates
  function shapeFuncDerivs(xi: number, eta: number) {
    // dN/dξ, dN/dη for 4-node quad
    const dNdxi = [
      -(1 - eta) / 4, (1 - eta) / 4, (1 + eta) / 4, -(1 + eta) / 4,
    ];
    const dNdeta = [
      -(1 - xi) / 4, -(1 + xi) / 4, (1 + xi) / 4, (1 - xi) / 4,
    ];
    return { dNdxi, dNdeta };
  }

  function shapeFunc(xi: number, eta: number) {
    return [
      (1 - xi) * (1 - eta) / 4,
      (1 + xi) * (1 - eta) / 4,
      (1 + xi) * (1 + eta) / 4,
      (1 - xi) * (1 + eta) / 4,
    ];
  }

  function jacobian(dNdxi: number[], dNdeta: number[]) {
    let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
    for (let i = 0; i < 4; i++) {
      J11 += dNdxi[i] * x[i];
      J12 += dNdxi[i] * y[i];
      J21 += dNdeta[i] * x[i];
      J22 += dNdeta[i] * y[i];
    }
    const detJ = J11 * J22 - J12 * J21;
    return {
      detJ,
      invJ: [J22 / detJ, -J12 / detJ, -J21 / detJ, J11 / detJ],
    };
  }

  // Helper to add to K
  const addK = (i: number, j: number, v: number) => {
    K[i * n + j] += v;
    if (i !== j) K[j * n + i] += v;
  };

  // ── 2×2 Gauss integration (membrane + bending) ──
  for (let gi = 0; gi < 2; gi++) {
    for (let gj = 0; gj < 2; gj++) {
      const xi = GP2[gi];
      const eta = GP2[gj];
      const w = GW2[gi] * GW2[gj];

      const { dNdxi, dNdeta } = shapeFuncDerivs(xi, eta);
      const { detJ, invJ } = jacobian(dNdxi, dNdeta);

      // dN/dx, dN/dy in physical coords
      const dNdx: number[] = [];
      const dNdy: number[] = [];
      for (let i = 0; i < 4; i++) {
        dNdx[i] = invJ[0] * dNdxi[i] + invJ[1] * dNdeta[i];
        dNdy[i] = invJ[2] * dNdxi[i] + invJ[3] * dNdeta[i];
      }

      const wdetJ = w * Math.abs(detJ);

      // DOF mapping per node: [ux, uy, uz, rx, ry, rz] → indices 0-5
      // Global DOF for node i: base = i * 6

      // ── Membrane: Bm^T · Dm · Bm ──
      // Bm for node i: [[dNdx, 0], [0, dNdy], [dNdy, dNdx]] on DOF [ux, uy]
      for (let a = 0; a < 4; a++) {
        for (let b = a; b < 4; b++) {
          const ai = a * 6;
          const bi = b * 6;

          // Km contributions (3×3 membrane Bm^T·Dm·Bm per node pair)
          // Row 0: dNa/dx · D11 · dNb/dx + dNa/dy · D33 · dNb/dy
          const k00 = (dNdx[a] * Dm[0] * dNdx[b] + dNdy[a] * Dm[8] * dNdy[b]) * wdetJ;
          const k01 = (dNdx[a] * Dm[1] * dNdy[b] + dNdy[a] * Dm[8] * dNdx[b]) * wdetJ;
          const k11 = (dNdy[a] * Dm[4] * dNdy[b] + dNdx[a] * Dm[8] * dNdx[b]) * wdetJ;

          addK(ai + 0, bi + 0, k00);
          addK(ai + 0, bi + 1, k01);
          addK(ai + 1, bi + 1, k11);

          if (a !== b) {
            addK(bi + 0, ai + 0, k00);
            addK(bi + 0, ai + 1, k01);
            addK(bi + 1, ai + 1, k11);
          }
        }
      }

      // ── Bending: Bb^T · Db · Bb (only if bending included) ──
      if (includeBending) {
        // Bb for node i on DOF [rx, ry]:
        //   κx  = -dNi/dx · θy  → row 0, col ry (DOF 4)
        //   κy  =  dNi/dy · θx  → row 1, col rx (DOF 3)
        //   κxy =  dNi/dx · θx - dNi/dy · θy → row 2
        for (let a = 0; a < 4; a++) {
          for (let b = a; b < 4; b++) {
            const ai = a * 6;
            const bi = b * 6;

            // θy-θy (DOF 4-4): (-dNa/dx)·Db11·(-dNb/dx) + (dNa/dy)·Db33·(dNb/dy) ... wait
            // Let's compute Bb^T·Db·Bb properly
            // Bb(a) = [0, -dNa/dx; dNa/dy, 0; dNa/dx, -dNa/dy]  for [rx, ry]
            //        col: rx(3), ry(4)

            // (rx_a, rx_b):  Bb[1,0]*Db[1,1]*Bb[1,0] + Bb[2,0]*Db[2,2]*Bb[2,0]
            const rxrx = (dNdy[a] * Db[4] * dNdy[b] + dNdx[a] * Db[8] * dNdx[b]) * wdetJ;
            // (rx_a, ry_b):  Bb[1,0]*Db[1,0]*Bb[0,1] + Bb[2,0]*Db[2,2]*Bb[2,1]
            const rxry = (dNdy[a] * Db[3] * (-dNdx[b]) + dNdx[a] * Db[8] * (-dNdy[b])) * wdetJ;
            // (ry_a, ry_b):  Bb[0,1]*Db[0,0]*Bb[0,1] + Bb[2,1]*Db[2,2]*Bb[2,1]
            const ryry = ((-dNdx[a]) * Db[0] * (-dNdx[b]) + (-dNdy[a]) * Db[8] * (-dNdy[b])) * wdetJ;

            addK(ai + 3, bi + 3, rxrx);
            addK(ai + 3, bi + 4, rxry);
            addK(ai + 4, bi + 4, ryry);

            if (a !== b) {
              addK(bi + 3, ai + 3, rxrx);
              addK(bi + 3, ai + 4, rxry);
              addK(bi + 4, ai + 4, ryry);
            }
          }
        }
      }
    }
  }

  // ── 1×1 Reduced integration for transverse shear (if bending included) ──
  if (includeBending) {
    const xi = 0, eta = 0;
    const { dNdxi, dNdeta } = shapeFuncDerivs(xi, eta);
    const { detJ, invJ } = jacobian(dNdxi, dNdeta);
    const N = shapeFunc(xi, eta);

    const dNdx: number[] = [];
    const dNdy: number[] = [];
    for (let i = 0; i < 4; i++) {
      dNdx[i] = invJ[0] * dNdxi[i] + invJ[1] * dNdeta[i];
      dNdy[i] = invJ[2] * dNdxi[i] + invJ[3] * dNdeta[i];
    }

    const wdetJ = 4.0 * Math.abs(detJ); // weight = 2×2 = 4 for single point

    // Bs for node i: γxz = dNi/dx · uz + Ni · ry → [dNdx, 0, Ni] on [uz(2), rx(3), ry(4)]
    //                γyz = dNi/dy · uz - Ni · rx → [dNdy, -Ni, 0]
    for (let a = 0; a < 4; a++) {
      for (let b = a; b < 4; b++) {
        const ai = a * 6;
        const bi = b * 6;

        // Ds * Bs^T · Bs
        // uz-uz: Ds*(dNa/dx·dNb/dx + dNa/dy·dNb/dy)
        const uzuz = Ds_coeff * (dNdx[a] * dNdx[b] + dNdy[a] * dNdy[b]) * wdetJ;
        // uz-rx: Ds*(-dNa/dy·Nb) ... from γyz
        const uzrx = Ds_coeff * (dNdy[a] * (-N[b])) * wdetJ;
        // uz-ry: Ds*(dNa/dx·Nb) ... from γxz
        const uzry = Ds_coeff * (dNdx[a] * N[b]) * wdetJ;
        // rx-rx: Ds*(Na·Nb) from γyz
        const rxrx = Ds_coeff * (N[a] * N[b]) * wdetJ;
        // ry-ry: Ds*(Na·Nb) from γxz
        const ryry = Ds_coeff * (N[a] * N[b]) * wdetJ;
        // rx-ry: 0

        addK(ai + 2, bi + 2, uzuz);
        addK(ai + 2, bi + 3, uzrx);
        addK(ai + 2, bi + 4, uzry);
        addK(ai + 3, bi + 3, rxrx);
        addK(ai + 4, bi + 4, ryry);

        if (a !== b) {
          addK(bi + 2, ai + 2, uzuz);
          addK(bi + 2, ai + 3, uzrx);
          addK(bi + 2, ai + 4, uzry);
          addK(bi + 3, ai + 3, rxrx);
          addK(bi + 4, ai + 4, ryry);
        }
      }
    }
  }

  // ── Drilling DOF (rz) stabilisation ──
  // Small penalty: α·Km_trace / 1000
  let trace = 0;
  for (let i = 0; i < n; i++) trace += Math.abs(K[i * n + i]);
  const alpha = trace / (n * 1000);
  for (let a = 0; a < 4; a++) {
    const rz = a * 6 + 5;
    K[rz * n + rz] += alpha;
  }

  // ── Apply stiffness reduction for REDUCED mode ──
  if (slabProps.stiffnessMode === 'REDUCED') {
    for (let i = 0; i < n * n; i++) K[i] *= factor;
  }

  return K;
}
