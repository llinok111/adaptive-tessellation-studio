/**
 * main.js — rendering + interaction only. Every number shown on screen comes
 * from src/core.mjs (via data/report.json or a direct core call); nothing is
 * recomputed by hand here.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getPreset, buildUniform, meshStats } from "./src/core.mjs";

const $ = (id) => document.getElementById(id);
const app = $("app");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 6, 14);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 5.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.5;
controls.maxDistance = 14;

scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2233, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x5b8cff, 0.9);
rim.position.set(-4, -2, -3);
scene.add(rim);

// depth 0..8 -> blue .. red
const DEPTH_STOPS = [0x2b6cff, 0x39d0ff, 0xffd166, 0xff6b6b];
function depthColor(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (DEPTH_STOPS.length - 1);
  const i = Math.floor(x);
  const a = new THREE.Color(DEPTH_STOPS[i]);
  const b = new THREE.Color(DEPTH_STOPS[Math.min(i + 1, DEPTH_STOPS.length - 1)]);
  return a.lerp(b, x - i);
}

/** Non-indexed geometry with one flat colour per triangle (adaptive side). */
function adaptiveGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const col = [];
  const nTri = mesh.indices.length / 3;
  for (let t = 0; t < nTri; t++) {
    const d = mesh.depths ? mesh.depths[t] : 0;
    const c = depthColor(d / 8);
    for (let k = 0; k < 3; k++) {
      const i = mesh.indices[t * 3 + k] * 3;
      pos.push(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      col.push(c.r, c.g, c.b);
    }
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function uniformGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  g.setIndex(mesh.indices);
  g.computeVertexNormals();
  return g;
}

const groupL = new THREE.Group();
const groupR = new THREE.Group();
scene.add(groupL, groupR);

let wireframe = false;
const materials = [];
function makeMaterial(color) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.15, flatShading: false,
    vertexColors: color === null, wireframe, side: THREE.DoubleSide,
  });
  materials.push(m);
  return m;
}
const matL = makeMaterial(null);
const matR = makeMaterial(0x9aa6bd);

const report = await fetch("./data/report.json").then((r) => r.json());
const presets = report.presets;
let current = null;

async function show(presetId) {
  const entry = presets.find((p) => p.id === presetId);
  if (!entry) return;
  current = entry;
  const preset = getPreset(presetId);
  const data = await fetch(`./data/mesh-${presetId}.json`).then((r) => r.json());

  for (const g of [groupL, groupR]) {
    for (const child of [...g.children]) {
      g.remove(child);
      child.geometry.dispose();
    }
  }

  const adGeo = adaptiveGeometry({ positions: data.positions, indices: data.indices, depths: data.depths });
  groupL.add(new THREE.Mesh(adGeo, matL));

  const uni = buildUniform(preset, entry.uniform.resolution);
  groupR.add(new THREE.Mesh(uniformGeometry(uni), matR));

  const diag = entry.diagonal;
  const off = diag * 0.62;
  groupL.position.set(-off, 0, 0);
  groupR.position.set(off, 0, 0);

  const stats = meshStats(uni);
  $("s-preset").textContent = entry.label;
  $("s-ad").textContent = entry.adaptive.triangles.toLocaleString();
  $("s-n").textContent = entry.uniform.resolution;
  $("s-uni").textContent = stats.triangles.toLocaleString();
  $("s-red").textContent = `${(entry.triangleReduction * 100).toFixed(1)}%`;
  $("s-red").className = entry.triangleReduction >= 0.6 ? "good" : "warn";
  $("s-err").textContent = `${((entry.adaptive.hausdorff / diag) * 100).toFixed(3)}%`;
}

addEventListener("keydown", (e) => {
  if (e.key === "w" || e.key === "W") {
    wireframe = !wireframe;
    materials.forEach((m) => (m.wireframe = wireframe));
  }
  const idx = ["1", "2", "3"].indexOf(e.key);
  if (idx >= 0 && presets[idx]) show(presets[idx].id);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

try {
  await show(presets[0].id);
} catch (e) {
  const el = $("err");
  el.style.display = "grid";
  el.textContent = "Failed to load sample data: " + e.message;
  throw e;
}
