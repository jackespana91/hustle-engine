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
const feedbackCues = [
  "round-start", "footstep", "jump", "slide", "dodge", "junction-open",
  "branch-selected", "package", "premium-package", "obstacle-clear",
  "obstacle-hit", "continuation", "shortcut", "clamp", "arrival", "win",
  "recovery",
];
const cityAssets = [
  ["glasshouse", "a", 5_500], ["glasshouse", "b", 5_000],
  ["night-market", "a", 5_500], ["night-market", "b", 6_000],
  ["service-block", "a", 3_200], ["service-block", "b", 3_000],
  ["stacked-flats", "a", 7_750], ["stacked-flats", "b", 8_000],
];

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
  let skinnedMeshes = 0;
  let weightedVertices = 0;
  let maximumInfluences = 0;
  scene.traverse((object) => {
    if (object.isBone) bones += 1;
    if (!object.isMesh) return;
    meshes += 1;
    if (object.isSkinnedMesh) {
      skinnedMeshes += 1;
      const weights = object.geometry.getAttribute("skinWeight");
      if (weights) {
        for (let index = 0; index < weights.count; index += 1) {
          let influences = 0;
          for (let component = 0; component < weights.itemSize; component += 1) {
            if (weights.array[index * weights.itemSize + component] > 0.0001) influences += 1;
          }
          if (influences > 0) weightedVertices += 1;
          maximumInfluences = Math.max(maximumInfluences, influences);
        }
      }
    }
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : object.geometry.getAttribute("position").count / 3;
  });
  return { meshes, bones, triangles: Math.round(triangles), skinnedMeshes, weightedVertices, maximumInfluences };
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
if (dashInspection.skinnedMeshes !== dashInspection.meshes || dashInspection.weightedVertices === 0) {
  throw new Error(`Dash must export every renderable body part through armature skin weights: ${JSON.stringify(dashInspection)}`);
}
if (dashInspection.maximumInfluences > 4 || dashInspection.bones < 17) {
  throw new Error(`Dash violates the production rig contract: ${JSON.stringify(dashInspection)}`);
}

for (const material of materials) {
  for (const map of maps) requiredFile(path.join(assetRoot, "materials", `${material}_${map}.webp`));
}

const audioRoot = path.join(assetRoot, "audio");
const audioPack = JSON.parse(fs.readFileSync(requiredFile(path.join(audioRoot, "production-audio.json")), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(audioPack.version) || !audioPack.files || typeof audioPack.files !== "object") {
  throw new Error("Night Drop production audio manifest is invalid");
}
for (const [cueId, fileName] of Object.entries(audioPack.files)) {
  if (!feedbackCues.includes(cueId) || typeof fileName !== "string" || fileName.includes("..") || !/\.(?:ogg|mp3|wav)$/i.test(fileName)) {
    throw new Error(`Night Drop production audio entry is invalid: ${cueId}`);
  }
  requiredFile(path.join(audioRoot, fileName));
}

const cityKit = [];
for (const [archetype, variant, maximumTriangles] of cityAssets) {
  const filePath = path.join(assetRoot, "city-kit", `${archetype}_${variant}.glb`);
  const gltf = await loadGlb(filePath);
  const inspection = inspectScene(gltf.scene);
  if (inspection.meshes === 0 || inspection.triangles === 0 || inspection.triangles > maximumTriangles) {
    throw new Error(`${archetype}.${variant} violates its city-kit budget: ${JSON.stringify(inspection)}`);
  }
  cityKit.push({ archetype, variant, bytes: fs.statSync(filePath).size, ...inspection });
}
const cityKitReport = JSON.parse(fs.readFileSync(requiredFile(path.join(assetRoot, "city-kit", "city-kit-report.json")), "utf8"));
if (cityKitReport.assets.length !== cityAssets.length) throw new Error("City-kit report inventory is incomplete");
const cityKitBundlePath = path.join(assetRoot, "city-kit", "night-drop-city-kit.glb");
const cityKitBundle = await loadGlb(cityKitBundlePath);
const bundleRoots = [];
cityKitBundle.scene.traverse((object) => {
  if (object.userData.nightDropCityKit === "2.0.0") bundleRoots.push(object.name);
});
if (bundleRoots.length !== cityAssets.length) throw new Error(`City-kit bundle contains ${bundleRoots.length} templates instead of ${cityAssets.length}`);

const report = JSON.parse(fs.readFileSync(requiredFile(path.join(assetRoot, "production-report.json")), "utf8"));
if (report.environment.length !== roles.length * lods.length) throw new Error("Production report inventory is incomplete");
if (
  report.character.rigType !== "armature-skin"
  || report.character.meshObjects !== 1
  || report.character.skinnedMeshObjects !== 1
  || report.character.materialPrimitives !== dashInspection.skinnedMeshes
  || report.character.sourceMeshParts <= report.character.materialPrimitives
  || report.character.batchedForRuntime !== true
) {
  throw new Error("Production report does not describe the exported Dash skin");
}

console.log(JSON.stringify({
  valid: true,
  environmentFiles: environment.length,
  environmentTriangles: environment.reduce((total, item) => total + item.triangles, 0),
  dash: { bytes: fs.statSync(dashPath).size, clips: clipNames.length, ...dashInspection },
  cityKit: { files: cityKit.length, bundleBytes: fs.statSync(cityKitBundlePath).size, triangles: cityKit.reduce((total, item) => total + item.triangles, 0) },
  materialMaps: materials.length * maps.length,
  productionAudioCues: Object.keys(audioPack.files).length,
}, null, 2));
