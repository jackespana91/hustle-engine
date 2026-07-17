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
  addAmbientStreetProps(root, segment, segmentIndex, district, lod);
  return root;
}

function addRoadSurfaceDetails(
  root: THREE.Group,
  segment: ComposedSpatialRouteSegment,
  segmentIndex: number,
  district: NightDropDistrictProfile,
  lod: NightDropRunnerLod,
): void {
  const markingMaterial = standard("road-marking", 0xd7d5c7, 0x3c3a31, .035, .7, .08);
  const pavementMaterial = standard(`pavement-slab-${district.id}`, 0x39454b, 0x0a1115, .012, .86, .07);
  const kerbMaterial = standard(`street-kerb-${district.id}`, 0x5c6669, 0x0b1114, .018, .76, .12);
  const moduleLength = Math.min(9.5, Math.max(5.4, (segment.endDistance - segment.startDistance) * .46));
  for (const side of [-1, 1]) {
    const pavement = box("pedestrian-pavement", 1.52, .14, moduleLength, pavementMaterial);
    pavement.position.set(side * (segment.width + .86), .07, 0);
    root.add(pavement);
    const kerb = box("granite-kerb", .18, .22, moduleLength, kerbMaterial);
    kerb.position.set(side * (segment.width + .09), .11, 0);
    root.add(kerb);
    const seamCount = lod === "low" ? 2 : 4;
    for (let seamIndex = 0; seamIndex < seamCount; seamIndex += 1) {
      const seam = box("pavement-joint", 1.38, .012, .035, standard("pavement-joint", 0x242b2f, 0x000000, 0, .9, .02));
      seam.position.set(side * (segment.width + .86), .146, -moduleLength / 2 + (seamIndex + 1) * moduleLength / (seamCount + 1));
      root.add(seam);
    }
  }
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
      standard(`puddle-${district.id}`, 0x07131c, district.primaryAccent, .04, .1, .88, true),
    );
    puddle.name = "rain-puddle";
    puddle.scale.set(1.15 + seeded(segmentIndex) * 1.25, .55 + seeded(segmentIndex + 11) * .5, 1);
    puddle.rotation.x = -Math.PI / 2;
    puddle.rotation.z = seeded(segmentIndex + 5) * Math.PI;
    puddle.position.set(segmentIndex % 2 === 0 ? -2.7 : 2.7, .061, .8);
    root.add(puddle);
  }

  if (segmentIndex % 2 === 1) {
    const patch = box(
      "asphalt-repair",
      1.65 + seeded(segmentIndex + 2) * .8,
      .018,
      2.2 + seeded(segmentIndex + 4) * 1.2,
      standard(`asphalt-repair-${segmentIndex % 3}`, 0x111c23, 0x060b0e, .015, .9, .04),
    );
    patch.position.set(segmentIndex % 3 === 0 ? -1.8 : 1.7, .052, -.4);
    patch.rotation.y = (seeded(segmentIndex + 7) - .5) * .24;
    root.add(patch);
  }

  if (lod !== "low") {
    const crackMaterial = new THREE.LineBasicMaterial({ color: 0x05090c, transparent: true, opacity: .58 });
    const crack = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.6, .083, -2.25),
        new THREE.Vector3(-.72, .084, -1.1),
        new THREE.Vector3(-1.08, .083, .2),
        new THREE.Vector3(.15, .084, 1.55),
      ]),
      crackMaterial,
    );
    crack.name = "asphalt-crack";
    crack.rotation.y = (seeded(segmentIndex + 31) - .5) * .55;
    root.add(crack);
  }
}

function addAmbientStreetProps(
  root: THREE.Group,
  segment: ComposedSpatialRouteSegment,
  segmentIndex: number,
  district: NightDropDistrictProfile,
  lod: NightDropRunnerLod,
): void {
  if ((segment.kind === "street" || segment.kind === "bend") && segmentIndex % 2 === 0) {
    const side = segmentIndex % 4 === 0 ? -1 : 1;
    const vehicle = createParkedVehicle(segmentIndex, district, lod);
    vehicle.position.set(side * (segment.width + 1.35), .04, segmentIndex % 3 === 0 ? -1.1 : .9);
    vehicle.rotation.y = side < 0 ? 0 : Math.PI;
    root.add(vehicle);
  }

  if (segmentIndex % 3 === 1) {
    const cabinet = box(
      "utility-cabinet",
      .62,
      1.15,
      .42,
      standard(`utility-cabinet-${district.id}`, 0x29363b, district.primaryAccent, .045, .7, .38),
    );
    cabinet.position.set(segmentIndex % 2 === 0 ? -6.25 : 6.25, .58, 1.3);
    root.add(cabinet);
  }
}

function createParkedVehicle(index: number, district: NightDropDistrictProfile, lod: NightDropRunnerLod): THREE.Group {
  const group = new THREE.Group();
  group.name = "parked-night-vehicle";
  const bodyColours = [0x273e4a, 0x552d35, 0x343941, 0x3d3150] as const;
  const bodyColour = bodyColours[index % bodyColours.length]!;
  const body = box(
    "vehicle-body",
    1.78,
    .58,
    3.75,
    standard(`vehicle-body-${index % bodyColours.length}`, bodyColour, 0x0a1419, .025, .4, .62),
  );
  body.position.y = .58;
  const cabin = box(
    "vehicle-cabin",
    1.52,
    .62,
    1.82,
    standard("vehicle-glass", 0x102b38, 0x153a45, .07, .18, .58),
  );
  cabin.position.set(0, 1.05, -.12);
  cabin.scale.x = .94;
  group.add(body, cabin);

  if (lod !== "low") {
    const tyreMaterial = standard("vehicle-tyre", 0x111316, 0x000000, 0, .94, .02);
    for (const x of [-.9, .9]) {
      for (const z of [-1.16, 1.16]) {
        const wheel = cylinder("vehicle-wheel", .27, .18, tyreMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, .34, z);
        group.add(wheel);
      }
    }
  }

  const warmLight = standard(`vehicle-headlight-${district.id}`, 0xffe0a5, 0xffd487, 1.4, .18, .18);
  const redLight = standard("vehicle-tail-light", 0x6a1520, 0xff2448, 1.2, .22, .2);
  for (const x of [-.56, .56]) {
    const headlight = box("parked-headlight", .24, .16, .055, warmLight);
    headlight.position.set(x, .65, -1.9);
    const tailLight = box("parked-tail-light", .26, .16, .055, redLight);
    tailLight.position.set(x, .65, 1.9);
    group.add(headlight, tailLight);
  }
  return group;
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
  if (lod !== "low" && index % 4 === 1) {
    const directory = new THREE.Group();
    directory.name = "glasshouse-street-directory";
    const shell = box("directory-shell", .48, 2.65, .42, standard("directory-shell", 0x142a35, 0x0b2631, .1, .28, .7));
    shell.position.y = 1.325;
    const screen = box("directory-screen", .39, 1.8, .045, standard("directory-screen", 0x183846, district.primaryAccent, 1.05, .16, .4));
    screen.position.set(0, 1.48, -.235);
    const cap = box("directory-cap", .64, .12, .58, standard("directory-cap", 0x273c48, district.secondaryAccent, .14, .34, .72));
    cap.position.y = 2.68;
    directory.position.set(index % 2 === 0 ? -6.3 : 6.3, 0, -.7);
    directory.add(shell, screen, cap);
    root.add(directory);
  }
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
  if (lod !== "low" && index % 2 === 0) {
    const kiosk = createNightKiosk(district);
    kiosk.position.set(7.0, 0, .25);
    kiosk.rotation.y = -Math.PI / 2;
    root.add(kiosk);
  }
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
  const shutter = box("service-shutter", 2.8, 2.6, .16, standard("service-shutter", 0x25353a, district.primaryAccent, .08, .66, .62));
  shutter.position.set(index % 2 === 0 ? -7.05 : 7.05, 1.3, 1.75);
  shutter.rotation.y = Math.PI / 2;
  root.add(shutter);
  for (let rail = -3; rail <= 3; rail += 1) {
    const rib = box("service-shutter-rib", .035, 2.5, .035, standard("service-shutter-rib", 0x496069, 0x12262c, .03, .5, .7));
    rib.position.set(shutter.position.x + (index % 2 === 0 ? -.09 : .09), 1.3, 1.75 + rail * .34);
    root.add(rib);
  }
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
  if (index % 2 === 1) {
    const shelter = createNightTramShelter(district);
    shelter.position.set(6.65, 0, .5);
    shelter.rotation.y = -Math.PI / 2;
    root.add(shelter);
  }
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

function createNightKiosk(district: NightDropDistrictProfile): THREE.Group {
  const kiosk = new THREE.Group();
  kiosk.name = "afterhours-kiosk";
  const shellMaterial = standard("kiosk-shell", 0x15212b, 0x100917, .025, .58, .45);
  const windowMaterial = standard("kiosk-window", 0x61451d, district.secondaryAccent, .82, .16, .34);
  const signMaterial = standard("kiosk-sign", 0xffd85a, district.primaryAccent, 1.3, .2, .36);
  const shell = box("kiosk-shell", 3.35, 2.45, 1.95, shellMaterial);
  shell.position.y = 1.225;
  const window = box("kiosk-serving-window", 2.35, 1.18, .08, windowMaterial);
  window.position.set(0, 1.52, -1.01);
  const counter = box("kiosk-counter", 2.65, .16, .48, standard("kiosk-counter", 0x37464c, 0x211609, .03, .42, .7));
  counter.position.set(0, .92, -1.2);
  const roof = box("kiosk-roof", 3.8, .18, 2.35, standard("kiosk-roof", 0x3f1f3b, district.primaryAccent, .2, .48, .42));
  roof.position.y = 2.56;
  const sign = box("kiosk-24-7-sign", 1.55, .38, .12, signMaterial);
  sign.position.set(0, 2.3, -1.08);
  kiosk.add(shell, window, counter, roof, sign);
  return kiosk;
}

function createNightTramShelter(district: NightDropDistrictProfile): THREE.Group {
  const shelter = new THREE.Group();
  shelter.name = "night-tram-shelter";
  const frameMaterial = standard("tram-frame", 0x334b57, district.primaryAccent, .09, .26, .78);
  const glassMaterial = standard("tram-glass", 0x193b4d, district.secondaryAccent, .18, .12, .45, true);
  const roof = box("tram-roof", 3.8, .15, 1.55, frameMaterial);
  roof.position.y = 2.65;
  const back = box("tram-glass-back", 3.45, 2.35, .08, glassMaterial);
  back.position.set(0, 1.3, .7);
  const side = box("tram-glass-side", .08, 2.35, 1.35, glassMaterial);
  side.position.set(-1.72, 1.3, 0);
  const bench = box("tram-bench", 2.25, .16, .48, standard("tram-bench", 0x495b64, 0x17262c, .025, .5, .68));
  bench.position.set(.25, .72, .42);
  const routeBar = box("tram-route-bar", 2.65, .12, .08, standard("tram-route-bar", 0xd7fdff, district.primaryAccent, 1.1, .18, .42));
  routeBar.position.set(.25, 2.25, .64);
  shelter.add(roof, back, side, bench, routeBar);
  return shelter;
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
