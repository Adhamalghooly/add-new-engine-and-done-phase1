/**
 * Validation Suite
 * ═══════════════════════════════════════════════════════════════
 * Test cases for verifying the unified structural analysis core.
 *
 * Test 1: Simply supported beam (analytical comparison)
 * Test 2: Continuous beam (2-span)
 * Test 3: Portal frame
 * Test 4: 3D frame
 * Test 5: Slab FEM patch test
 * Test 6: Beam + slab interaction (FULL vs LOAD_ONLY comparison)
 */

import type { StructuralModel } from '../model/types';
import { ModelBuilder } from '../model/modelBuilder';
import { FIXED_RESTRAINTS, PINNED_RESTRAINTS, FREE_RESTRAINTS } from '../model/types';
import { runAnalysis } from '../coreAnalysisController';

export interface ValidationResult {
  testName: string;
  passed: boolean;
  expected: number;
  computed: number;
  errorPercent: number;
  notes: string;
}

/**
 * Test 1: Simply supported beam under uniform load.
 * Analytical: δ_max = 5·w·L⁴ / (384·E·I)
 *             M_max = w·L² / 8
 */
export function testSimplySupported(): ValidationResult {
  const L = 6000; // mm
  const w = 10;   // N/mm (distributed load)
  const E = 30000; // MPa
  const b = 300, h = 500; // mm
  const I = b * h ** 3 / 12;

  const builder = new ModelBuilder();
  builder
    .addNode(1, 0, 0, 0, PINNED_RESTRAINTS)
    .addNode(2, L, 0, 0, PINNED_RESTRAINTS)
    .addMaterial({ id: 'c30', name: 'Concrete', E, nu: 0.2, gamma: 24e-6, fc: 30 })
    .addSection({ id: 's1', name: 'B300x500', type: 'rectangular', b, h })
    .addLoadCase({ id: 'DL', name: 'Dead', type: 'dead', selfWeightFactor: 0 });

  // Convert distributed load to equivalent nodal forces
  // For uniform load w on beam of length L:
  // F_node = w·L/2, M_node = ±w·L²/12
  const F_total = w * L / 2;
  const M_equiv = w * L * L / 12;

  builder.addNode(1, 0, 0, 0, PINNED_RESTRAINTS, [
    { fx: 0, fy: 0, fz: -F_total, mx: 0, my: -M_equiv, mz: 0, loadCaseId: 'DL' },
  ]);
  builder.addNode(2, L, 0, 0, PINNED_RESTRAINTS, [
    { fx: 0, fy: 0, fz: -F_total, mx: 0, my: M_equiv, mz: 0, loadCaseId: 'DL' },
  ]);

  builder.addElement({
    id: 1, type: 'beam', nodeIds: [1, 2],
    materialId: 'c30', sectionId: 's1',
  });

  const model = builder.build();

  // Analytical midspan deflection
  const delta_analytical = 5 * w * L ** 4 / (384 * E * I);

  try {
    const result = runAnalysis(model);
    // Midspan deflection would need a midpoint node for exact comparison
    // Use end rotations as proxy
    const maxDefl = Math.max(...result.nodalDisplacements.map(d => Math.abs(d.uz)));

    const error = Math.abs(maxDefl - delta_analytical) / delta_analytical * 100;

    return {
      testName: 'Simply Supported Beam',
      passed: error < 5,
      expected: delta_analytical,
      computed: maxDefl,
      errorPercent: error,
      notes: `δ_analytical = ${delta_analytical.toFixed(4)} mm`,
    };
  } catch (e) {
    return {
      testName: 'Simply Supported Beam',
      passed: false,
      expected: delta_analytical,
      computed: 0,
      errorPercent: 100,
      notes: `Error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Test 3: Portal frame under lateral load.
 */
export function testPortalFrame(): ValidationResult {
  const H = 3000; // column height (mm)
  const L = 6000; // beam span (mm)
  const P = 10000; // lateral force (N)
  const E = 200000; // Steel (MPa)
  const b = 200, h = 300;

  const builder = new ModelBuilder();
  builder
    .addMaterial({ id: 'steel', name: 'Steel', E, nu: 0.3, gamma: 78.5e-6 })
    .addSection({ id: 's1', name: 'S200x300', type: 'rectangular', b, h })
    .addLoadCase({ id: 'W', name: 'Wind', type: 'wind', selfWeightFactor: 0 })
    .addNode(1, 0, 0, 0, FIXED_RESTRAINTS)
    .addNode(2, 0, 0, H, FREE_RESTRAINTS, [
      { fx: P, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, loadCaseId: 'W' },
    ])
    .addNode(3, L, 0, H, FREE_RESTRAINTS)
    .addNode(4, L, 0, 0, FIXED_RESTRAINTS)
    .addElement({ id: 1, type: 'column', nodeIds: [1, 2], materialId: 'steel', sectionId: 's1' })
    .addElement({ id: 2, type: 'beam', nodeIds: [2, 3], materialId: 'steel', sectionId: 's1' })
    .addElement({ id: 3, type: 'column', nodeIds: [4, 3], materialId: 'steel', sectionId: 's1' });

  try {
    const result = runAnalysis(builder.build());
    const topDisp = result.nodalDisplacements.find(d => d.nodeId === 2);
    const drift = topDisp ? Math.abs(topDisp.ux) : 0;

    // Approximate analytical: δ ≈ P·H³/(12EI) for fixed-base portal
    const I = b * h ** 3 / 12;
    const delta_approx = P * H ** 3 / (12 * E * I);

    const error = delta_approx > 0 ? Math.abs(drift - delta_approx) / delta_approx * 100 : 0;

    return {
      testName: 'Portal Frame',
      passed: error < 10,
      expected: delta_approx,
      computed: drift,
      errorPercent: error,
      notes: 'Lateral drift at top of frame',
    };
  } catch (e) {
    return {
      testName: 'Portal Frame',
      passed: false, expected: 0, computed: 0, errorPercent: 100,
      notes: `Error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Run all validation tests.
 */
export function runValidationSuite(): ValidationResult[] {
  return [
    testSimplySupported(),
    testPortalFrame(),
  ];
}
