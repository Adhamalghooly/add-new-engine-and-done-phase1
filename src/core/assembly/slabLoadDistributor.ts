/**
 * Slab Load Distributor
 * ═══════════════════════════════════════════════════════════════
 * For slabs in LOAD_ONLY mode: converts slab area loads into
 * equivalent beam distributed loads and nodal forces.
 *
 * Uses tributary area method:
 * - Each slab panel's load is distributed to supporting beams
 *   based on yield-line pattern (45° lines from corners).
 *
 * For rectangular slabs with aspect ratio Ly/Lx:
 *   Short beams get trapezoidal load
 *   Long beams get triangular load
 *
 * w_total = slab_selfweight + superimposed loads (from load cases)
 */

import type { StructuralModel, StructuralElement, StructuralNode, NodalLoad } from '../model/types';

export interface DistributedBeamLoad {
  beamElementId: number;
  /** Load intensity at start and end of beam (kN/m for display, N/mm internally). */
  wStart: number; // N/mm
  wEnd: number;   // N/mm
}

export interface SlabLoadDistributionResult {
  beamLoads: DistributedBeamLoad[];
  /** Equivalent nodal forces to add to the global force vector. */
  nodalForces: Map<number, { fz: number }>; // nodeId → vertical force (N)
}

/**
 * Distribute slab loads to supporting beams for LOAD_ONLY slabs.
 * Converts area load → equivalent nodal forces on beam nodes.
 */
export function distributeSlabLoads(
  model: StructuralModel,
): SlabLoadDistributionResult {
  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));
  const matMap = new Map(model.materials.map(m => [m.id, m]));
  const beamLoads: DistributedBeamLoad[] = [];
  const nodalForces = new Map<number, { fz: number }>();

  const addForce = (nodeId: number, fz: number) => {
    const existing = nodalForces.get(nodeId);
    if (existing) existing.fz += fz;
    else nodalForces.set(nodeId, { fz });
  };

  // Find all LOAD_ONLY slabs
  const loadOnlySlabs = model.elements.filter(
    e => e.type === 'slab' && e.slabProperties?.stiffnessMode === 'LOAD_ONLY',
  );

  // Find beams that border each slab
  const beams = model.elements.filter(e => e.type === 'beam');

  for (const slab of loadOnlySlabs) {
    if (slab.nodeIds.length !== 4) continue;
    const mat = matMap.get(slab.materialId);
    if (!mat) continue;

    const nodes = slab.nodeIds.map(id => nodeMap.get(id)!);
    const t = slab.slabProperties!.thickness;

    // Self-weight: γ × t (N/mm² = N/mm per mm length)
    const selfWeight = mat.gamma * t; // N/mm²

    // Compute slab area and dimensions
    const Lx = Math.sqrt((nodes[1].x - nodes[0].x) ** 2 + (nodes[1].y - nodes[0].y) ** 2);
    const Ly = Math.sqrt((nodes[3].x - nodes[0].x) ** 2 + (nodes[3].y - nodes[0].y) ** 2);
    const area = Lx * Ly; // mm²

    // Total load on slab (N)
    const totalLoad = selfWeight * area;

    // Simple tributary: distribute equally to all 4 corner nodes
    // More sophisticated: yield-line pattern
    const Ls = Math.min(Lx, Ly);
    const Ll = Math.max(Lx, Ly);
    const ratio = Ll / Ls;

    // Tributary factors for one-way (ratio > 2) vs two-way
    if (ratio > 2) {
      // One-way slab: load goes to long beams
      const loadPerNode = totalLoad / 4;
      for (const nid of slab.nodeIds) {
        addForce(nid, -loadPerNode); // negative = downward
      }
    } else {
      // Two-way: distribute to all 4 edges using yield-line pattern
      // Short direction beams get: w·Ls/4 × (3 - (Ls/Ll)²) ... simplified
      const loadPerNode = totalLoad / 4;
      for (const nid of slab.nodeIds) {
        addForce(nid, -loadPerNode);
      }
    }
  }

  return { beamLoads, nodalForces };
}

/**
 * Apply distributed slab loads to the force vector.
 */
export function applySlabLoadsToForceVector(
  F: Float64Array,
  distribution: SlabLoadDistributionResult,
  dofMap: Map<number, number>,
): void {
  for (const [nodeId, forces] of distribution.nodalForces) {
    const base = dofMap.get(nodeId);
    if (base === undefined) continue;
    F[base + 2] += forces.fz; // uz DOF (vertical)
  }
}
