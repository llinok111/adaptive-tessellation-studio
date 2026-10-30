# Adaptive Tessellation Studio

**One-line promise:** on a parametric surface with localized curvature, a curvature-adaptive quadtree mesh reaches the same visual error budget as a uniform grid while using **70.4% fewer triangles** (1,790 vs 6,050), verified against an in-repo uniform baseline that is binary-searched to the smallest resolution meeting the same bound (`node bench/verify.mjs`).

Upstream: none

---

## What this is

A three.js viewer plus a dependency-free geometry kernel (`src/core.mjs`) that tessellates a
parametric surface `f(u,v) → R³` with a **curvature-adaptive quadtree**: each patch is accepted
only when the true surface stays within `tolerance` of the two triangles that would represent it,
otherwise it splits into four children. The control arm is the obvious alternative — a uniform
`n × n` grid — and its resolution is not guessed: `findUniformResolution()` binary-searches the
smallest `n` whose **one-sided Hausdorff error** also satisfies the budget. Both meshes are then
re-measured by an independent dense sampler, so the comparison is equal-error, not equal-effort.

The demo shows both meshes side by side, coloured by adaptive patch depth, with orbit controls,
wireframe toggle and preset switching.

## Run it

```bash
node tools/gen-sample.mjs          # writes data/*.json (deterministic, byte-identical)
python3 -m http.server 4173        # then open http://localhost:4173
node bench/verify.mjs              # 14 behavioural assertions, exit 0
node bench/bench.mjs               # timing -> bench/result.json
```

No build step, no `npm install`. three.js r169 is pinned in the import map.

## Evidence

From `bench/result.json` (Node v24.19.0, 11 samples, 1 warmup, batched timing):

| metric | adaptive | uniform baseline | budget |
| --- | --- | --- | --- |
| triangles (bumpy-sphere) | **1,790** | 6,050 (n=55) | — |
| triangle reduction | **70.4%** | — | ≥ 60% (asserted) |
| Hausdorff / bbox diagonal | 0.213% | 0.203% | ≤ 0.5% (asserted) |
| build time, median | 2.96 ms | 0.61 ms | — |
| build time, cold start | 11.86 ms | — | — |

The 70.4% is the headline; the other two presets are reported as they measured, including a
regression case:

| preset | adaptive | uniform | reduction | adaptive error |
| --- | --- | --- | --- | --- |
| bumpy-sphere (localized bump) | 1,790 | 6,050 | **70.4%** | 0.213% |
| terrain-ridge (localized ridge) | 1,796 | 2,592 | 30.7% | 0.346% |
| ridged-torus (high-frequency curvature everywhere) | 11,168 | 11,552 | 3.3% | 0.230% |

## How the numbers are produced

- `src/core.mjs` — pure ES module: no three.js, no DOM, no I/O, no top-level side effects.
- `hausdorff()` — dense `(u,v)` sampling (97 × 97 = 9,409 points) against a spatial-hash over the
  mesh triangles; reports max and mean surface→mesh distance.
- `findUniformResolution()` — binary search for the smallest uniform `n` inside the same budget,
  so the baseline cannot be sandbagged by picking a coarse grid.
- `bench/verify.mjs` — asserts the reduction, both error bounds, bit-identical rebuilds, the stored
  sample data against a fresh computation, and point-triangle distance unit cases.
- `tools/gen-sample.mjs` — fixed rounding, no clock, no RNG; running it twice yields byte-identical
  files (`sha256sum` stable).

## Known limitations

- **Error is one-sided and sampled.** `hausdorff()` measures surface→mesh only, on a 97 × 97 grid;
  a triangle edge could deviate between samples. The budget is therefore a sampled estimate, not a
  proof. Mesh→surface is not measured.
- **Adaptive tessellation is not a free win.** The ridged-torus preset has high-frequency curvature
  everywhere, so the quadtree overhead is real and the gain collapses to 3.3%. The method pays off
  only when curvature is spatially concentrated; this is reported rather than hidden.
- **Relative stddev is above 10%** for the timing metrics (20.9% adaptive, 14.5% uniform). This is a
  shared 4-core VM: one of the 11 samples hit a GC pause (p95 5.11 ms vs median 2.96 ms). Medians
  and minima are stable across runs; treat the p95 as a jitter ceiling, not a typical build time.
- The quadtree splits isotropically, so anisotropic features (long ridges) are over-refined in the
  narrow direction. An anisotropic metric is the obvious next step.
- The page needs network access to `unpkg.com` for three.js; the kernel and all evidence scripts do not.
