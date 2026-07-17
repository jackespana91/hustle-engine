import * as THREE from "three";
import type { ComposedSpatialRoute, ComposedSpatialRouteSegment } from "@hustle/routerun";
import { resolveNightDropDistrict, type NightDropDistrictProfile } from "./night-drop-districts.js";
import type { NightDropRunnerLod } from "./night-drop-runner-assets.js";

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYLINDER = new THREE.CylinderGeometry(.5, .5, 1, 10);
const UNIT_CIRCLE = new THREE.CircleGeometry(1, 20);
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function createNightDropStreetModule(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  segment: ComposedSpatialRouteSegment,
  segmentIndex: number,
  lod: NightDropRunnerLod,
): THREE.Group {
  const root = new THREE.Group();
  const progress = ((segment.startDistance + segment.endDistance) / 2) / route.totalLength;
  const point = path.getPointAt(progress);
  const tangent = path.getTangentAt(progress).normalize();
  const district = resolveNightDropDistrict(progress, segment.kind);
  root.name = `street-module-${segment.id}`;
  root.position.copy(point);
  root.lookAt(point.clone().add(tangent));
  root.userData.segmentId = segment.id;
  root.userData.district = district.id;
  root.userData.lod = lod;

  addRoadSurfaceDetails(root, segment, segmentIndex, district, lod);
  addDistrictProps(root, segment, segmentIndex, district, lod);
  return root;
}

function addRoadSurfaceDetails(
  root: THREE.Group,
  segment: ComposedSpatialRouteSegment,
  segmentIndex: number,
  district: NightDropDistrictProfile,
  lod: NightDropRunnerLod,
): void {
  const markingMaterial = standard("road-marking", 0xb8d4d9, 0x28464d, .08, .64, .16);
  const markingCount = lod === "low" ? 2 : 4;
  for (let index = 0; index < markingCount; index += 1) {
    const dash = box("lane-marking", .09, .018, 1.35, markingMaterial);
    dash.position.set(0, .07, (index - (markingCount - 1) / 2) * 2.2);
    root.add(dash);
  }

  if (segment.kind === "junction") {
    const stripeCount = lod === "low" ? 4 : 7;
    for (let index = 0; index < stripeCount; index += 1) {
      const crossing = box("crossing-stripe", .52, .024, 4.8, markingMaterial);
      crossing.position.set((index - (stripeCount - 1) / 2) * .82, .075, 0);
      root.add(crossing);
    }
  }

  const drainMaterial = standard("drain", 0x273740, 0x0e1b20, .02, .48, .78);
  for (const side of [-1, 1]) {
    const drain = box("street-drain", .28, .06, 1.1, drainMaterial);
    drain.position.set(side * 5.15, .08, segmentIndex % 2 === 0 ? -1.7 : 1.7);
    root.add(drain);
  }

  if (lod !== "low" || segmentIndex % 2 === 0) {
    const puddle = new THREE.Mesh(
      UNIT_CIRCLE,
      standard(`puddle-${district.id}`, 0x123347, district.primaryAccent, .2, .12, .82, true),
    );
    puddle.name = "rain-puddle";
    puddle.scale.set(1.15 + seeded(segmentIndex) * 1.25, .55 + seeded(segmentIndex + 11) * .5, 1);
    puddle.rotation.x = -Math.PI / 2;
    puddle.rotation.z = seeded(segmentIndex + 5) * Math.PI;
    puddle.position.set(segmentIndex % 2 === 0 ? -2.7 : 2.7, .061, .8);
    root.add(puddle);
  }
}

function addDistrictProps(
  root: THREE.Group,
  segment: ComposedSpatialRouteSegment,
  segmentIndex: number,
  district: NightDropDistrictProfile,
  lod: NightDropRunnerLod,
): void {
  if (district.id === "night-market") addMarketProps(root, segmentIndex, district, lod);
  if (district.id === "service-quarter") addServiceProps(root, segmentIndex, district, lod);
  if (district.id === "canal-works") addCanalProps(root, segmentIndex, district, lod);
  if (district.id === "upper-heights") addUpperHeightsProps(root, segmentIndex, district, lod);
  if (district.id === "glasshouse") addGlasshouseProps(root, segmentIndex, district, lod);

  if (segment.kind === "alley") {
    for (const side of [-1, 1]) {
      const servicePipe = cylinder(
        "alley-service-pipe",
        .09,
        3.1,
        standard("alley-pipe", 0x314650, district.primaryAccent, .08, .48, .66),
      );
      servicePipe.position.set(side * 5.75, 1.55, 0);
      root.add(servicePipe);
    }
  }

  if (segment.kind === "rooftop") {
    const vent = box("rooftop-vent", 1.5, .85, 1.2, standard("roof-vent", 0x334853, 0x17272e, .04, .62, .58));
    vent.position.set(5.7, .45, -1.2);
    root.add(vent);
  }
}

function addGlasshouseProps(root: THREE.Group, index: number, district: NightDropDistrictProfile, lod: NightDropRunnerLod): void {
  const bollardMaterial = standard("glasshouse-bollard", 0x193c49, district.primaryAccent, .42, .3, .64);
  const count = lod === "low" ? 2 : 4;
  for (let item = 0; item < count; item += 1) {
    const bollard = cylinder("glasshouse-bollard", .11, .72, bollardMaterial);
    bollard.position.set((item % 2 === 0 ? -1 : 1) * 5.95, .36, (Math.floor(item / 2) * 2 - 1) * 1.25);
    root.add(bollard);
  }
  if (index % 3 === 0) root.add(createDeliveryLocker(-6.55, district.primaryAccent));
}

function addMarketProps(root: THREE.Group, index: number, district: NightDropDistrictProfile, lod: NightDropRunnerLod): void {
  const crateMaterial = standard("market-crate", 0x4b2b33, district.secondaryAccent, .08, .72, .16);
  const count = lod === "low" ? 1 : 3;
  for (let item = 0; item < count; item += 1) {
    const crate = box("market-crate", .72, .55, .72, crateMaterial);
    crate.position.set((index % 2 === 0 ? -1 : 1) * (6.1 + item * .3), .28 + item * .04, -1.2 + item * .7);
    crate.rotation.y = seeded(index + item) * .4;
    root.add(crate);
  }
  const canopy = box("market-canopy", 2.8, .12, 1.4, standard("market-canopy", 0x4a2247, district.primaryAccent, .25, .5, .34));
  canopy.position.set(index % 2 === 0 ? 6.7 : -6.7, 2.45, .2);
  canopy.rotation.z = index % 2 === 0 ? -.08 : .08;
  root.add(canopy);
}

function addServiceProps(root: THREE.Group, index: number, district: NightDropDistrictProfile, lod: NightDropRunnerLod): void {
  const bin = box("service-bin", 1.05, 1.18, .9, standard("service-bin", 0x26383b, district.primaryAccent, .08, .68, .38));
  bin.position.set(index % 2 === 0 ? -6.35 : 6.35, .59, -1.25);
  root.add(bin);
  if (lod === "low") return;
  const duct = cylinder("service-duct", .22, 2.2, standard("service-duct", 0x3b4d54, 0x12242a, .05, .54, .72));
  duct.rotation.z = Math.PI / 2;
  duct.position.set(index % 2 === 0 ? -6.2 : 6.2, 1.55, .6);
  root.add(duct);
}

function addCanalProps(root: THREE.Group, index: number, district: NightDropDistrictProfile, lod: NightDropRunnerLod): void {
  const warning = box("canal-warning", .14, 1.8, .14, standard("canal-warning", 0x263d4a, district.secondaryAccent, .62, .34, .62));
  warning.position.set(index % 2 === 0 ? -6.1 : 6.1, .9, -.8);
  root.add(warning);
  if (lod === "low") return;
  const chain = box("canal-rail", 2.8, .07, .07, standard("canal-rail", 0x334d59, district.primaryAccent, .12, .48, .72));
  chain.position.set(index % 2 === 0 ? -6.1 : 6.1, 1.22, .4);
  chain.rotation.z = index % 2 === 0 ? .07 : -.07;
  root.add(chain);
}

function addUpperHeightsProps(root: THREE.Group, index: number, district: NightDropDistrictProfile, lod: NightDropRunnerLod): void {
  const planter = box("upper-planter", 1.6, .52, .72, standard("upper-planter", 0x293845, district.primaryAccent, .09, .54, .46));
  planter.position.set(index % 2 === 0 ? -6.25 : 6.25, .27, .2);
  root.add(planter);
  if (lod === "low") return;
  const light = cylinder("upper-beacon", .08, 1.45, standard("upper-beacon", 0x5d5125, district.primaryAccent, 1.1, .26, .68));
  light.position.set(index % 2 === 0 ? -6.25 : 6.25, 1.05, .2);
  root.add(light);
}

function createDeliveryLocker(x: number, accent: number): THREE.Group {
  const locker = new THREE.Group();
  const shell = box("delivery-locker", 1.15, 1.8, .7, standard("delivery-locker-shell", 0x17313d, accent, .12, .46, .52));
  shell.position.y = .9;
  const screen = box("delivery-locker-screen", .42, .28, .05, standard(`delivery-locker-screen-${accent}`, 0x9dfaff, accent, 1.35, .2, .36));
  screen.position.set(0, 1.15, .38);
  locker.position.x = x;
  locker.add(shell, screen);
  return locker;
}

function box(name: string, width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT_BOX, material);
  mesh.name = name;
  mesh.scale.set(width, height, depth);
  mesh.castShadow = height > .15;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(name: string, radius: number, height: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT_CYLINDER, material);
  mesh.name = name;
  mesh.scale.set(radius * 2, height, radius * 2);
  mesh.castShadow = true;
  return mesh;
}

function standard(
  key: string,
  color: number,
  emissive: number,
  emissiveIntensity: number,
  roughness: number,
  metalness: number,
  transparent = false,
): THREE.MeshStandardMaterial {
  const cacheKey = `${key}-${transparent}`;
  const cached = materialCache.get(cacheKey);
  if (cached) return cached;
  const created = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness,
    transparent,
    opacity: transparent ? .46 : 1,
    depthWrite: !transparent,
  });
  materialCache.set(cacheKey, created);
  return created;
}

function seeded(value: number): number {
  const result = Math.sin(value * 12.9898 + 78.233) * 43_758.5453;
  return result - Math.floor(result);
}
