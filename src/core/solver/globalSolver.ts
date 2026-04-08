/**
 * Global Solver
 * ═══════════════════════════════════════════════════════════════
 * Solves the system KU = F using:
 * 1. Dense Cholesky factorisation (fallback, always available)
 * 2. Conjugate Gradient with Jacobi preconditioner (for large systems)
 *
 * The solver automatically selects the method based on system size.
 * Threshold: CG for n > 2000 DOF, Cholesky otherwise.
 */

export type SolverMethod = 'cholesky' | 'cg' | 'auto';

export interface SolverConfig {
  method: SolverMethod;
  /** CG convergence tolerance (default 1e-10). */
  cgTolerance: number;
  /** CG max iterations (default 10 × n). */
  cgMaxIter?: number;
}

const DEFAULT_CONFIG: SolverConfig = {
  method: 'auto',
  cgTolerance: 1e-10,
};

export interface SolverResult {
  /** Solution vector U. */
  U: Float64Array;
  /** Method actually used. */
  method: 'cholesky' | 'cg';
  /** Number of iterations (CG only). */
  iterations?: number;
  /** Residual norm (CG only). */
  residualNorm?: number;
}

/**
 * Solve KU = F.
 * K: n×n symmetric positive-definite matrix (flat row-major).
 * F: n-vector.
 */
export function solve(
  K: Float64Array,
  F: Float64Array,
  n: number,
  config: Partial<SolverConfig> = {},
): SolverResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const method = cfg.method === 'auto'
    ? (n > 2000 ? 'cg' : 'cholesky')
    : cfg.method;

  if (method === 'cg') {
    return solveCG(K, F, n, cfg.cgTolerance, cfg.cgMaxIter ?? n * 10);
  } else {
    return solveCholesky(K, F, n);
  }
}

/**
 * Dense Cholesky factorisation: K = L·L^T, then forward/back substitution.
 * Modifies K in-place (stores L in lower triangle).
 */
function solveCholesky(K: Float64Array, F: Float64Array, n: number): SolverResult {
  // Copy K to avoid destroying original
  const L = new Float64Array(K);

  // Cholesky decomposition: L·L^T = K
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let k = 0; k < j; k++) {
      sum += L[j * n + k] ** 2;
    }
    const diag = L[j * n + j] - sum;
    if (diag <= 0) {
      // Fall back to Gaussian elimination for non-PD matrices
      return solveGauss(new Float64Array(K), F, n);
    }
    L[j * n + j] = Math.sqrt(diag);

    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = 0; k < j; k++) {
        s += L[i * n + k] * L[j * n + k];
      }
      L[i * n + j] = (L[i * n + j] - s) / L[j * n + j];
    }
  }

  // Forward substitution: L·y = F
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < i; k++) sum += L[i * n + k] * y[k];
    y[i] = (F[i] - sum) / L[i * n + i];
  }

  // Back substitution: L^T·U = y
  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let k = i + 1; k < n; k++) sum += L[k * n + i] * U[k];
    U[i] = (y[i] - sum) / L[i * n + i];
  }

  return { U, method: 'cholesky' };
}

/**
 * Gaussian elimination with partial pivoting (fallback).
 */
function solveGauss(K: Float64Array, F: Float64Array, n: number): SolverResult {
  const A = new Float64Array(K);
  const b = new Float64Array(F);

  // Forward elimination
  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxVal = Math.abs(A[col * n + col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row * n + col]);
      if (val > maxVal) { maxVal = val; maxRow = row; }
    }

    if (maxRow !== col) {
      // Swap rows
      for (let j = 0; j < n; j++) {
        const temp = A[col * n + j];
        A[col * n + j] = A[maxRow * n + j];
        A[maxRow * n + j] = temp;
      }
      const tb = b[col]; b[col] = b[maxRow]; b[maxRow] = tb;
    }

    const pivot = A[col * n + col];
    if (Math.abs(pivot) < 1e-30) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = A[row * n + col] / pivot;
      for (let j = col; j < n; j++) {
        A[row * n + j] -= factor * A[col * n + j];
      }
      b[row] -= factor * b[col];
    }
  }

  // Back substitution
  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) sum += A[i * n + j] * U[j];
    const diag = A[i * n + i];
    U[i] = Math.abs(diag) > 1e-30 ? (b[i] - sum) / diag : 0;
  }

  return { U, method: 'cholesky' };
}

/**
 * Preconditioned Conjugate Gradient with Jacobi preconditioner.
 * For symmetric positive-definite K.
 */
function solveCG(
  K: Float64Array, F: Float64Array, n: number,
  tol: number, maxIter: number,
): SolverResult {
  // Jacobi preconditioner: M^{-1} = diag(1/K_ii)
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = K[i * n + i];
    Minv[i] = d > 1e-30 ? 1 / d : 1;
  }

  const U = new Float64Array(n);
  const r = new Float64Array(F); // r = F - K·U (U=0 initially, so r=F)
  const z = new Float64Array(n);
  const p = new Float64Array(n);

  // z = M^{-1} · r
  for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
  p.set(z);

  let rz = dot(r, z, n);
  let iter = 0;

  const normF = Math.sqrt(dot(F, F, n));
  const threshold = tol * (normF > 0 ? normF : 1);

  while (iter < maxIter) {
    // Ap = K · p
    const Ap = matvec(K, p, n);

    const pAp = dot(p, Ap, n);
    if (Math.abs(pAp) < 1e-30) break;
    const alpha = rz / pAp;

    for (let i = 0; i < n; i++) {
      U[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }

    const residualNorm = Math.sqrt(dot(r, r, n));
    iter++;

    if (residualNorm < threshold) {
      return { U, method: 'cg', iterations: iter, residualNorm };
    }

    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
    const rzNew = dot(r, z, n);
    const beta = rzNew / rz;

    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }

  return { U, method: 'cg', iterations: iter, residualNorm: Math.sqrt(dot(r, r, n)) };
}

function dot(a: Float64Array, b: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function matvec(A: Float64Array, x: Float64Array, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i * n + j] * x[j];
    y[i] = s;
  }
  return y;
}
