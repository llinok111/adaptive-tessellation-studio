#!/usr/bin/env node
/**
 * verify.mjs — behavioural assertions. Exits 0 only if every number below holds.
 * No network, no DOM, no three.js.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESETS,
  getPreset,
  evalSurface,
  buildUniform,
  buildAdaptive,
  meshStats,
  hausdorff,
  pointTriDistance,
  summarize,
} from "../src/core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!ok) failures++;
};

/* ---- 1. point-triangle distance unit cases ------------------------- */
const A = [0, 0, 0], B = [1, 0, 0], C = [0, 1, 0];
check("distance: point above interior", Math.abs(pointTriDistance([0.25, 0.25, 2], A, B, C) - 2) < 1e-12,
  `d=${pointTriDistance([0.25, 0.25, 2], A, B, C).toFixed(12)} expect 2`);
check("distance: point beyond vertex", Math.abs(pointTriDistance([-1, 0, 0], A, B, C) - 1) < 1e-12,
  `d=${pointTriDistance([-1, 0, 0], A, B, C).toFixed(12)} expect 1`);
check("distance: point on face is 0", pointTriDistance([0.2, 0.2, 0], A, B, C) < 1e-12,
  `d=${pointTriDistance([0.2, 0.2, 0], A, B, C).toExponential(2)}`);

/* ---- 2. surface sanity -------------------------------------------- */
const sph = getPreset("bumpy-sphere");
const radiusOk = [0, 0.1, 0.5, 0.77, 1].every((u) => {
  const p = evalSurface(sph, u, 0.5);
  const r = Math.hypot(p[0], p[1], p[2]);
  return r > 0.99 && r < 1.4;
});
check("surface: bumpy-sphere radius in [0.99,1.4]", radiusOk, "5 samples along u at v=0.5");

/* ---- 3. adaptive vs uniform on the headline preset ---------------- */
const TOL = 0.008;
const head = summarize(sph, { tolerance: TOL });
const headErr = head.adaptive.hausdorff / head.diagonal;
const uniErr = head.uniform.hausdorff / head.diagonal;
check("headline: triangle reduction >= 60%", head.triangleReduction >= 0.6,
  `reduction=${(head.triangleReduction * 100).toFixed(1)}% (adaptive ${head.adaptive.triangles} vs uniform ${head.uniform.triangles})`);
check("headline: adaptive Hausdorff <= 0.5% of bbox diagonal", headErr <= 0.005,
  `${(headErr * 100).toFixed(3)}% of ${head.diagonal.toFixed(3)}`);
check("headline: uniform baseline also <= 0.5%", uniErr <= 0.005, `${(uniErr * 100).toFixed(3)}%`);

/* ---- 4. determinism ------------------------------------------------ */
const m1 = buildAdaptive(sph, { tolerance: TOL });
const m2 = buildAdaptive(sph, { tolerance: TOL });
const same = m1.positions.length === m2.positions.length && m1.positions.every((v, i) => v === m2.positions[i]);
check("determinism: adaptive rebuild is bit-identical", same, `${m1.positions.length} floats compared`);

/* ---- 5. other presets stay inside the error budget ----------------- */
for (const preset of PRESETS.filter((p) => p.id !== sph.id)) {
  const s = summarize(preset, { tolerance: TOL });
  const rel = s.adaptive.hausdorff / s.diagonal;
  check(`preset ${preset.id}: adaptive error <= 0.5%`, rel <= 0.005, `${(rel * 100).toFixed(3)}%`);
}

/* ---- 6. generated data matches a fresh computation ----------------- */
const report = JSON.parse(readFileSync(join(ROOT, "data", "report.json"), "utf8"));
const gen = report.presets.find((p) => p.id === "bumpy-sphere");
check("data: report.json matches fresh summarize()",
  gen.adaptive.triangles === head.adaptive.triangles && gen.uniform.resolution === head.uniform.resolution,
  `json=${gen.adaptive.triangles}/${gen.uniform.resolution} fresh=${head.adaptive.triangles}/${head.uniform.resolution}`);

const meshJson = JSON.parse(readFileSync(join(ROOT, "data", "mesh-bumpy-sphere.json"), "utf8"));
const loaded = { positions: meshJson.positions, indices: meshJson.indices, patches: meshJson.depths.map((d) => ({ depth: d })) };
const stats = meshStats(loaded);
check("data: stored mesh triangle count matches report", stats.triangles === head.adaptive.triangles,
  `stored=${stats.triangles} report=${head.adaptive.triangles}`);
const reloadErr = hausdorff(loaded, sph, { samples: 96 }).max / stats.diagonal;
check("data: stored (5-decimal) mesh still within error budget", reloadErr <= 0.005, `${(reloadErr * 100).toFixed(3)}%`);

/* ---- 7. baseline search is monotone (a finer grid cannot be worse) -- */
const n = head.uniform.resolution;
const coarse = hausdorff(buildUniform(sph, Math.max(2, n - 4)), sph, { samples: 80 }).max;
const fine = hausdorff(buildUniform(sph, n), sph, { samples: 80 }).max;
check("baseline: finer uniform grid has smaller error", fine <= coarse + 1e-9,
  `n=${n}: ${fine.toFixed(5)} <= n=${n - 4}: ${coarse.toFixed(5)}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
