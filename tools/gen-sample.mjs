#!/usr/bin/env node
/**
 * gen-sample.mjs — deterministic sample generator.
 * Writes data/surfaces.json, data/report.json and one mesh per preset.
 * Same command twice => byte-identical output (fixed rounding, no clocks, no RNG).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESETS, summarize } from "../src/core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const round = (x) => Math.round(x * 1e5) / 1e5;

mkdirSync(DATA, { recursive: true });

const surfaces = PRESETS.map((p) => {
  const { kind, ...rest } = p;
  return { ...rest, kind };
});

const report = [];
for (const preset of PRESETS) {
  const s = summarize(preset);
  const mesh = s.adaptiveMesh;
  const payload = {
    id: s.id,
    triangles: s.adaptive.triangles,
    positions: mesh.positions.map(round),
    indices: mesh.indices,
    depths: mesh.patches.map((p) => p.depth),
  };
  writeFileSync(join(DATA, `mesh-${s.id}.json`), JSON.stringify(payload));
  const { adaptiveMesh, ...rest } = s;
  report.push({
    ...rest,
    diagonal: round(rest.diagonal),
    relativeTolerance: round(rest.relativeTolerance),
    adaptive: { ...rest.adaptive, hausdorff: round(rest.adaptive.hausdorff), hausdorffMean: round(rest.adaptive.hausdorffMean) },
    uniform: { ...rest.uniform, hausdorff: round(rest.uniform.hausdorff), hausdorffMean: round(rest.uniform.hausdorffMean) },
    triangleReduction: round(rest.triangleReduction),
  });
  console.log(
    `${s.id.padEnd(14)} adaptive=${String(s.adaptive.triangles).padStart(6)} tris  ` +
      `uniform(n=${s.uniform.resolution})=${String(s.uniform.triangles).padStart(6)} tris  ` +
      `reduction=${(s.triangleReduction * 100).toFixed(1)}%  ` +
      `err=${(s.adaptive.hausdorff / s.diagonal * 100).toFixed(3)}%`
  );
}

writeFileSync(join(DATA, "surfaces.json"), JSON.stringify({ presets: surfaces, tolerance: 0.008, maxDepth: 8 }, null, 2));
writeFileSync(join(DATA, "report.json"), JSON.stringify({ generatedBy: "tools/gen-sample.mjs", tolerance: 0.008, presets: report }, null, 2));
console.log(`wrote ${DATA}`);
