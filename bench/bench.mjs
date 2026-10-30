#!/usr/bin/env node
/**
 * bench.mjs — timing harness. Cold start (first call) is recorded separately,
 * then 1 warmup + 7 measured repetitions; we report median, p95, stddev.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPreset, buildAdaptive, buildUniform, summarize, hausdorff } from "../src/core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPEATS = 11;
const preset = getPreset("bumpy-sphere");
const opts = { tolerance: 0.008, maxDepth: 8 };

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length;
  return {
    min: s[0],
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)],
    stddev: Math.sqrt(variance),
    samples: s.length,
  };
};

// cold start: very first call, includes JIT warm-up and first-touch allocation
const tCold0 = performance.now();
const coldMesh = buildAdaptive(preset, opts);
const coldMs = performance.now() - tCold0;

// warmup
buildAdaptive(preset, opts);

// each sample times BATCH builds and divides, so sub-5 ms timings are not
// dominated by timer granularity / GC jitter
const BATCH = 10;
const adaptive = [];
for (let i = 0; i < REPEATS; i++) {
  const t = performance.now();
  for (let k = 0; k < BATCH; k++) buildAdaptive(preset, opts);
  adaptive.push((performance.now() - t) / BATCH);
}

const UBATCH = 20;
const uniformMs = [];
buildUniform(preset, 55);
for (let i = 0; i < REPEATS; i++) {
  const t = performance.now();
  for (let k = 0; k < UBATCH; k++) buildUniform(preset, 55);
  uniformMs.push((performance.now() - t) / UBATCH);
}

// end-to-end: baseline search + both meshes + independent Hausdorff checks
const tPipe0 = performance.now();
const summary = summarize(preset, opts);
const pipelineMs = performance.now() - tPipe0;

const errPct = (hausdorff(coldMesh, preset, { samples: 96 }).max / summary.diagonal) * 100;

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  preset: preset.id,
  tolerance: opts.tolerance,
  repeats: REPEATS,
  batchAdaptive: BATCH,
  batchUniform: UBATCH,
  coldStartMs: Number(coldMs.toFixed(3)),
  adaptiveBuildMs: stats(adaptive),
  uniformBuildMs: stats(uniformMs),
  baselineSearchPlusEvalMs: Number(pipelineMs.toFixed(3)),
  triangles: { adaptive: summary.adaptive.triangles, uniform: summary.uniform.triangles },
  reduction: Number(summary.triangleReduction.toFixed(4)),
  hausdorffPctOfDiagonal: Number(errPct.toFixed(4)),
};

writeFileSync(join(ROOT, "bench", "result.json"), JSON.stringify(result, null, 2) + "\n");

const f = (x) => x.toFixed(2).padStart(7);
console.log(`preset            ${result.preset}`);
console.log(`cold start        ${f(coldMs)} ms`);
console.log(`adaptive build    median ${f(result.adaptiveBuildMs.median)} ms  min ${f(result.adaptiveBuildMs.min)}  p95 ${f(result.adaptiveBuildMs.p95)}  stddev ${f(result.adaptiveBuildMs.stddev)}`);
console.log(`uniform build     median ${f(result.uniformBuildMs.median)} ms  (n=55, ${summary.uniform.triangles} tris)`);
console.log(`triangles         adaptive ${summary.adaptive.triangles} vs uniform ${summary.uniform.triangles}  => -${(summary.triangleReduction * 100).toFixed(1)}%`);
console.log(`hausdorff         ${errPct.toFixed(3)}% of bbox diagonal (budget 0.5%)`);
console.log(`wrote bench/result.json`);
