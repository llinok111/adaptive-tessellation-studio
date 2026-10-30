/**
 * core.mjs — pure geometry kernel for curvature-adaptive parametric tessellation.
 *
 * No three.js, no DOM, no I/O, no top-level side effects. Every export is a pure
 * function over plain arrays so `node -e "import('./src/core.mjs')"` works and
 * bench/verify.mjs can assert on real numbers.
 */

/* ------------------------------------------------------------------ */
/* Surface presets: (u,v) in [0,1]^2 -> R^3                            */
/* ------------------------------------------------------------------ */

export const PRESETS = [
  {
    id: "bumpy-sphere",
    label: "Bumpy sphere",
    kind: "sphere",
    radius: 1,
    bumpAmp: 0.3,
    bumpCenter: [0.32, 0.62],
    bumpWidth: 0.008,
    waveAmp: 0,
  },
  {
    id: "ridged-torus",
    label: "Ridged torus",
    kind: "torus",
    major: 1,
    minor: 0.34,
    ridgeAmp: 0.11,
    ridgeFreq: 5,
  },
  {
    id: "terrain-ridge",
    label: "Terrain ridge",
    kind: "heightfield",
    extent: 2,
    ridgeAmp: 0.42,
    ridgeWidth: 0.055,
    ridgeFreq: 4,
  },
];

export function getPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error("unknown preset: " + id);
  return p;
}

/** Evaluate a preset at parameter (u,v). Returns [x,y,z]. */
export function evalSurface(preset, u, v) {
  if (preset.kind === "sphere") {
    const theta = v * Math.PI;
    const phi = u * Math.PI * 2;
    const du = u - preset.bumpCenter[0];
    const dv = v - preset.bumpCenter[1];
    const bump = preset.bumpAmp * Math.exp(-(du * du + dv * dv) / preset.bumpWidth);
    const wave = preset.waveAmp * Math.sin(3 * phi) * Math.sin(2 * theta);
    const r = preset.radius + bump + wave;
    return [
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.cos(theta),
      r * Math.sin(theta) * Math.sin(phi),
    ];
  }
  if (preset.kind === "torus") {
    const phi = u * Math.PI * 2;
    const theta = v * Math.PI * 2;
    const rr =
      preset.minor +
      preset.ridgeAmp * Math.pow(Math.abs(Math.cos(preset.ridgeFreq * phi)), 3);
    const R = preset.major + rr * Math.cos(theta);
    return [R * Math.cos(phi), rr * Math.sin(theta), R * Math.sin(phi)];
  }
  if (preset.kind === "heightfield") {
    const e = preset.extent;
    const x = (u - 0.5) * e;
    const z = (v - 0.5) * e;
    const du = u - 0.5;
    const ridge = preset.ridgeAmp * Math.exp(-(du * du) / preset.ridgeWidth);
    const y =
      ridge * (0.6 + 0.4 * Math.cos(preset.ridgeFreq * Math.PI * v)) +
      0.04 * Math.sin(9 * Math.PI * u) * Math.cos(7 * Math.PI * v);
    return [x, y, z];
  }
  throw new Error("unknown kind: " + preset.kind);
}

/* ------------------------------------------------------------------ */
/* Mesh construction                                                   */
/* ------------------------------------------------------------------ */

function emptyMesh() {
  return { positions: [], indices: [], patches: [] };
}

/**
 * Uniform (baseline) tessellation: an n x n grid of quads, 2 triangles each.
 * This is the control arm of the benchmark — it spends triangles everywhere
 * regardless of local curvature.
 */
export function buildUniform(preset, n) {
  const mesh = emptyMesh();
  const stride = n + 1;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const p = evalSurface(preset, i / n, j / n);
      mesh.positions.push(p[0], p[1], p[2]);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      mesh.indices.push(a, b, d, a, d, c);
      mesh.patches.push({ u0: i / n, v0: j / n, u1: (i + 1) / n, v1: (j + 1) / n, depth: 0 });
      mesh.patches.push({ u0: i / n, v0: j / n, u1: (i + 1) / n, v1: (j + 1) / n, depth: 0 });
    }
  }
  return mesh;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function pointTriDist2(p, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const qx = a[0] + t * abx - p[0];
    const qy = a[1] + t * aby - p[1];
    const qz = a[2] + t * abz - p[2];
    return qx * qx + qy * qy + qz * qz;
  }

  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const qx = a[0] + t * acx - p[0];
    const qy = a[1] + t * acy - p[1];
    const qz = a[2] + t * acz - p[2];
    return qx * qx + qy * qy + qz * qz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = b[0] + t * (c[0] - b[0]) - p[0];
    const qy = b[1] + t * (c[1] - b[1]) - p[1];
    const qz = b[2] + t * (c[2] - b[2]) - p[2];
    return qx * qx + qy * qy + qz * qz;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const qx = a[0] + abx * v + acx * w - p[0];
  const qy = a[1] + aby * v + acy * w - p[1];
  const qz = a[2] + abz * v + acz * w - p[2];
  return qx * qx + qy * qy + qz * qz;
}

export function pointTriDistance(p, a, b, c) {
  return Math.sqrt(pointTriDist2(p, a, b, c));
}

/**
 * Curvature-adaptive quadtree tessellation over the (u,v) domain.
 *
 * A patch is accepted when the true surface deviates from the two triangles
 * that would represent it by at most `tolerance` (measured on a 3x3 interior
 * probe grid). Otherwise it splits into four children until maxDepth.
 */
export function buildAdaptive(preset, { tolerance = 0.008, maxDepth = 8 } = {}) {
  const mesh = emptyMesh();
  const tol2 = tolerance * tolerance;

  const evalPatch = (u0, v0, u1, v1, depth) => {
    const p00 = evalSurface(preset, u0, v0);
    const p10 = evalSurface(preset, u1, v0);
    const p01 = evalSurface(preset, u0, v1);
    const p11 = evalSurface(preset, u1, v1);
    const tris = [
      [p00, p10, p11],
      [p00, p11, p01],
    ];
    let worst = 0;
    for (let sj = 1; sj <= 3; sj++) {
      for (let si = 1; si <= 3; si++) {
        const s = si / 4;
        const t = sj / 4;
        const q = evalSurface(preset, u0 + (u1 - u0) * s, v0 + (v1 - v0) * t);
        let best = Infinity;
        for (const tri of tris) {
          const d = pointTriDist2(q, tri[0], tri[1], tri[2]);
          if (d < best) best = d;
        }
        if (best > worst) worst = best;
      }
    }
    if (worst > tol2 && depth < maxDepth) {
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      evalPatch(u0, v0, um, vm, depth + 1);
      evalPatch(um, v0, u1, vm, depth + 1);
      evalPatch(u0, vm, um, v1, depth + 1);
      evalPatch(um, vm, u1, v1, depth + 1);
      return;
    }
    const base = mesh.positions.length / 3;
    mesh.positions.push(...p00, ...p10, ...p11, ...p01);
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const patch = { u0, v0, u1, v1, depth };
    mesh.patches.push(patch, patch);
  };

  evalPatch(0, 0, 1, 1, 0);
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export function meshStats(mesh) {
  const pos = mesh.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k];
      if (pos[i + k] > max[k]) max[k] = pos[i + k];
    }
  }
  const dx = max[0] - min[0], dy = max[1] - min[1], dz = max[2] - min[2];
  const triangles = mesh.indices.length / 3;
  const depths = mesh.patches.map((p) => p.depth);
  return {
    triangles,
    vertices: pos.length / 3,
    bbox: { min, max },
    diagonal: Math.sqrt(dx * dx + dy * dy + dz * dz),
    maxDepth: depths.length ? Math.max(...depths) : 0,
    avgDepth: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
  };
}

/** Spatial hash over triangles, cell size derived from the mesh bbox. */
function buildTriangleGrid(mesh, divisions) {
  const stats = meshStats(mesh);
  const cell = stats.diagonal / divisions || 1;
  const min = stats.bbox.min;
  const map = new Map();
  const triCount = mesh.indices.length / 3;
  const tri = new Float64Array(triCount * 9);
  const key = (x, y, z) => x + "," + y + "," + z;
  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3] * 3;
    const ib = mesh.indices[t * 3 + 1] * 3;
    const ic = mesh.indices[t * 3 + 2] * 3;
    const xs = [mesh.positions[ia], mesh.positions[ib], mesh.positions[ic]];
    const ys = [mesh.positions[ia + 1], mesh.positions[ib + 1], mesh.positions[ic + 1]];
    const zs = [mesh.positions[ia + 2], mesh.positions[ib + 2], mesh.positions[ic + 2]];
    for (let k = 0; k < 9; k++) tri[t * 9 + k] = [xs, ys, zs][k % 3][(k / 3) | 0];
    const lo = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
    const hi = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
    const c0 = [0, 1, 2].map((k) => Math.floor((lo[k] - min[k]) / cell));
    const c1 = [0, 1, 2].map((k) => Math.floor((hi[k] - min[k]) / cell));
    for (let x = c0[0]; x <= c1[0]; x++)
      for (let y = c0[1]; y <= c1[1]; y++)
        for (let z = c0[2]; z <= c1[2]; z++) {
          const k = key(x, y, z);
          let arr = map.get(k);
          if (!arr) map.set(k, (arr = []));
          arr.push(t);
        }
  }
  return { cell, min, map, tri, triCount, key };
}

/**
 * One-sided Hausdorff distance (surface -> mesh): the largest distance from a
 * dense grid of analytic surface samples to the nearest triangle of the mesh.
 * This is the error a viewer actually sees, independent of how the mesh was built.
 */
export function hausdorff(mesh, preset, { samples = 96, divisions = 40 } = {}) {
  const grid = buildTriangleGrid(mesh, divisions);
  const { cell, min, map, tri, key } = grid;
  const triCount = mesh.indices.length / 3;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  let max = 0;
  let sum = 0;
  let n = 0;
  const cellOf = (p) => [0, 1, 2].map((k) => Math.floor((p[k] - min[k]) / cell));

  for (let j = 0; j <= samples; j++) {
    for (let i = 0; i <= samples; i++) {
      const p = evalSurface(preset, i / samples, j / samples);
      const c0 = cellOf(p);
      let best = Infinity;
      let r = 1;
      while (best === Infinity && r <= 6) {
        for (let dx = -r; dx <= r; dx++)
          for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
              const arr = map.get(key(c0[0] + dx, c0[1] + dy, c0[2] + dz));
              if (!arr) continue;
              for (let q = 0; q < arr.length; q++) {
                const t = arr[q] * 9;
                a[0] = tri[t]; a[1] = tri[t + 1]; a[2] = tri[t + 2];
                b[0] = tri[t + 3]; b[1] = tri[t + 4]; b[2] = tri[t + 5];
                c[0] = tri[t + 6]; c[1] = tri[t + 7]; c[2] = tri[t + 8];
                const d = pointTriDist2(p, a, b, c);
                if (d < best) best = d;
              }
            }
        r++;
      }
      if (best === Infinity) throw new Error("hausdorff: no triangle found for sample");
      const d = Math.sqrt(best);
      if (d > max) max = d;
      sum += d;
      n++;
    }
  }
  return { max, mean: sum / n, samples: n, triangles: triCount };
}

/**
 * Baseline search: the smallest uniform grid resolution whose one-sided
 * Hausdorff error also satisfies `tolerance`. This is the honest control —
 * we do not compare against an arbitrarily coarse uniform mesh.
 */
export function findUniformResolution(preset, tolerance, { samples = 96, maxN = 512 } = {}) {
  let lo = 2;
  let hi = 16;
  while (hi < maxN) {
    const m = buildUniform(preset, hi);
    if (hausdorff(m, preset, { samples }).max <= tolerance) break;
    hi *= 2;
  }
  if (hi >= maxN && hausdorff(buildUniform(preset, hi), preset, { samples }).max > tolerance) {
    return null;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const m = buildUniform(preset, mid);
    if (hausdorff(m, preset, { samples }).max <= tolerance) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Compact serialisable snapshot used by tools/gen-sample.mjs and main.js. */
export function summarize(preset, { tolerance = 0.008, maxDepth = 8, samples = 80 } = {}) {
  const adaptive = buildAdaptive(preset, { tolerance, maxDepth });
  const aStats = meshStats(adaptive);
  const n = findUniformResolution(preset, tolerance, { samples });
  if (n === null) throw new Error("uniform baseline exceeded maxN for " + preset.id);
  const uniform = buildUniform(preset, n);
  const uStats = meshStats(uniform);
  const aErr = hausdorff(adaptive, preset, { samples: Math.max(samples, 96) });
  const uErr = hausdorff(uniform, preset, { samples: Math.max(samples, 96) });
  return {
    id: preset.id,
    label: preset.label,
    tolerance,
    diagonal: aStats.diagonal,
    relativeTolerance: tolerance / aStats.diagonal,
    adaptive: {
      triangles: aStats.triangles,
      vertices: aStats.vertices,
      maxDepth: aStats.maxDepth,
      hausdorff: aErr.max,
      hausdorffMean: aErr.mean,
    },
    uniform: {
      resolution: n,
      triangles: uStats.triangles,
      vertices: uStats.vertices,
      hausdorff: uErr.max,
      hausdorffMean: uErr.mean,
    },
    triangleReduction: 1 - aStats.triangles / uStats.triangles,
    adaptiveMesh: adaptive,
  };
}
