import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

globalThis.ProgressEvent ??= class ProgressEvent {};

const directory = path.dirname(fileURLToPath(import.meta.url));
const assetRoot = path.resolve(directory, "../../public/assets/night-drop/runner");
const roles = [
  "street_straight", "corner_left", "corner_right", "t_junction", "crossroads", "alley",
  "bridge", "tunnel", "ramp_up", "ramp_down", "rooftop", "destination",
];
const lods = ["lod0", "lod1", "lod2"];
const requiredClips = [
  "Dash_Idle", "Dash_Start", "Dash_Run", "Dash_Stop", "Dash_Jump", "Dash_Slide",
  "Dash_Dodge_L", "Dash_Dodge_R", "Dash_Turn_L", "Dash_Turn_R", "Dash_Collect",
  "Dash_Stumble", "Dash_Celebrate",
];
const materials = ["wet-asphalt", "city-concrete", "neon-glass", "rooftop-metal"];
const maps = ["albedo", "normal", "roughness", "emissive"];

const loader = new GLTFLoader();

function requiredFile(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error(`Missing Night Drop production asset: ${filePath}`);
  }
  return filePath;
}

function loadGlb(filePath) {
  const bytes = fs.readFileSync(requiredFile(filePath));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(data, "", resolve, reject));
}

function inspectScene(scene) {
  let meshes = 0;
  let bones = 0;
  let triangles = 0;
  scene.traverse((object) => {
    if (object.isBone) bones += 1;
    if (!object.isMesh) return;
    meshes += 1;
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : object.geometry.getAttribute("position").count / 3;
  });
  return { meshes, bones, triangles: Math.round(triangles) };
}

const environment = [];
for (const role of roles) {
  for (const lod of lods) {
    const filePath = path.join(assetRoot, "environment", `${role}_${lod}.glb`);
    const gltf = await loadGlb(filePath);
    const inspection = inspectScene(gltf.scene);
    if (inspection.meshes === 0 || inspection.triangles === 0) {
      throw new Error(`${role} ${lod} contains no renderable geometry`);
    }
    environment.push({ role, lod, bytes: fs.statSync(filePath).size, ...inspection });
  }
}

const dashPath = path.join(assetRoot, "characters", "dash", "dash.glb");
const dash = await loadGlb(dashPath);
const dashInspection = inspectScene(dash.scene);
const clipNames = dash.animations.map(({ name }) => name).sort();
const missingClips = requiredClips.filter((name) => !clipNames.includes(name));
if (missingClips.length > 0) throw new Error(`Dash is missing animation clips: ${missingClips.join(", ")}`);
if (dashInspection.triangles > 18_000 || dashInspection.bones > 55) {
  throw new Error(`Dash exceeds the mobile budget: ${JSON.stringify(dashInspection)}`);
}

for (const material of materials) {
  for (const map of maps) requiredFile(path.join(assetRoot, "materials", `${material}_${map}.webp`));
}

const report = JSON.parse(fs.readFileSync(requiredFile(path.join(assetRoot, "production-report.json")), "utf8"));
if (report.environment.length !== roles.length * lods.length) throw new Error("Production report inventory is incomplete");

console.log(JSON.stringify({
  valid: true,
  environmentFiles: environment.length,
  environmentTriangles: environment.reduce((total, item) => total + item.triangles, 0),
  dash: { bytes: fs.statSync(dashPath).size, clips: clipNames.length, ...dashInspection },
  materialMaps: materials.length * maps.length,
}, null, 2));
