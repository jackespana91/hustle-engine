import * as THREE from "three";
import type { NightDropDistrictId } from "./night-drop-districts.js";
import { createNightDropPbrMaterial } from "./night-drop-pbr-materials.js";

export type NightDropBuildingArchetype = "glasshouse" | "night-market" | "service-block" | "stacked-flats";
export type NightDropRoofTreatment = "crown" | "hvac" | "water-tank" | "antenna";

export interface NightDropBuildingDescriptor {
  readonly archetype: NightDropBuildingArchetype;
  readonly roofTreatment: NightDropRoofTreatment;
  readonly hasAwning: boolean;
  readonly hasSideLight: boolean;
  readonly windowPattern: number;
}

export interface NightDropBuildingSpec {
  readonly index: number;
  readonly sideIndex: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly accent: number;
  readonly district?: NightDropDistrictId;
  readonly label?: string;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UNIT_CYLINDER = new THREE.CylinderGeometry(.5, .5, 1, 10);
const UNIT_CIRCLE = new THREE.CircleGeometry(1, 24);
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const facadeCache = new Map<string, THREE.MeshBasicMaterial>();
const signCache = new Map<string, THREE.MeshBasicMaterial>();

export function describeNightDropBuilding(index: number, sideIndex: number, district?: NightDropDistrictId): NightDropBuildingDescriptor {
  const archetypes: readonly NightDropBuildingArchetype[] = ["glasshouse", "night-market", "service-block", "stacked-flats"];
  const roofs: readonly NightDropRoofTreatment[] = ["crown", "hvac", "water-tank", "antenna"];
  const variation = Math.abs(index * 7 + sideIndex * 2);
  const districtArchetypes: Readonly<Record<NightDropDistrictId, readonly NightDropBuildingArchetype[]>> = {
    glasshouse: ["glasshouse", "stacked-flats", "glasshouse"],
    "night-market": ["night-market", "stacked-flats", "night-market"],
    "service-quarter": ["service-block", "night-market", "service-block"],
    "canal-works": ["service-block", "glasshouse", "service-block"],
    "upper-heights": ["glasshouse", "stacked-flats", "glasshouse"],
  };
  const availableArchetypes = district ? districtArchetypes[district] : archetypes;
  return {
    archetype: availableArchetypes[variation % availableArchetypes.length]!,
    roofTreatment: roofs[(variation + Math.floor(index / 2)) % roofs.length]!,
    hasAwning: variation % 3 === 0,
    hasSideLight: variation % 4 !== 1,
    windowPattern: variation % 5,
  };
}

export function createNightDropBuilding(spec: NightDropBuildingSpec): THREE.Group {
  const descriptor = describeNightDropBuilding(spec.index, spec.sideIndex, spec.district);
  const root = new THREE.Group();
  root.name = `night-drop-building-${spec.index}-${spec.sideIndex}`;
  root.userData.archetype = descriptor.archetype;
  root.userData.district = spec.district ?? "unassigned";
  root.userData.productionKit = "night-drop-city-v2";
  root.userData.cameraOccluder = true;
  root.userData.cameraClearanceRadius = Math.hypot(spec.width, spec.depth) * .5;
  root.userData.desiredWidth = spec.width;
  root.userData.desiredDepth = spec.depth;
  root.userData.desiredHeight = spec.height;
  root.userData.cityVariant = spec.index % 2 === 0 ? "a" : "b";

  const palette = paletteFor(descriptor.archetype);
  const shell = box(
    "shell",
    spec.width,
    spec.height,
    spec.depth,
    material(`shell-${descriptor.archetype}`, palette.shell, palette.shellEmissive, .025, .62, .28),
  );
  shell.position.y = spec.height / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  root.add(shell);

  const plinthHeight = Math.min(2.8, Math.max(1.8, spec.height * .19));
  const plinth = box(
    "street-level",
    spec.width * .94,
    plinthHeight,
    spec.depth + .24,
    material(`plinth-${descriptor.archetype}`, palette.plinth, palette.shellEmissive, .018, .7, .22),
  );
  plinth.position.set(0, plinthHeight / 2, .12);
  plinth.castShadow = true;
  root.add(plinth);

  const facade = new THREE.Mesh(
    UNIT_PLANE,
    facadeMaterial(spec.accent, descriptor.archetype, descriptor.windowPattern),
  );
  facade.name = "lit-facade";
  facade.scale.set(spec.width * .73, Math.max(2.8, spec.height - plinthHeight - 1.15), 1);
  facade.position.set(0, plinthHeight + facade.scale.y / 2, spec.depth / 2 + .016);
  root.add(facade);

  addSideFacades(root, spec, descriptor, plinthHeight);
  addFacadeFrame(root, spec, descriptor, plinthHeight, palette);
  addNightFrontage(root, spec, descriptor, palette);

  addStreetFront(root, spec, descriptor, plinthHeight, palette);
  addRoofline(root, spec, descriptor, palette);

  if (spec.label) {
    const sign = new THREE.Mesh(UNIT_PLANE, signMaterial(spec.label, spec.accent));
    sign.name = "street-sign";
    sign.scale.set(Math.min(spec.width * .7, 4.6), 1.05, 1);
    sign.position.set(0, Math.min(spec.height - .9, plinthHeight + .8), spec.depth / 2 + .25);
    root.add(sign);
  }

  if (descriptor.hasSideLight) {
    const strip = box(
      "corner-light",
      .12,
      Math.max(2.2, spec.height * .52),
      .08,
      material(`strip-${spec.accent}`, spec.accent, spec.accent, 1.45, .28, .5),
    );
    strip.position.set(-spec.width * .42, spec.height * .55, spec.depth / 2 + .08);
    root.add(strip);
  }

  return root;
}

function addStreetFront(
  root: THREE.Group,
  spec: NightDropBuildingSpec,
  descriptor: NightDropBuildingDescriptor,
  plinthHeight: number,
  palette: ReturnType<typeof paletteFor>,
): void {
  const frontZ = spec.depth / 2 + .2;
  const entranceWidth = descriptor.archetype === "service-block" ? spec.width * .54 : spec.width * .25;
  const entrance = box(
    "entrance",
    entranceWidth,
    plinthHeight * .7,
    .16,
    material(`entrance-${descriptor.archetype}-${spec.accent}`, palette.entrance, spec.accent, .2, .42, .44),
  );
  entrance.position.set(descriptor.archetype === "night-market" ? spec.width * .2 : 0, plinthHeight * .36, frontZ);
  root.add(entrance);

  if (descriptor.archetype === "night-market") {
    const shopWindow = box(
      "shop-window",
      spec.width * .42,
      plinthHeight * .48,
      .12,
      material(`shop-${spec.accent}`, 0x152a32, descriptor.archetype === "night-market" ? 0xffb84d : spec.accent, .72, .22, .42),
    );
    shopWindow.position.set(-spec.width * .22, plinthHeight * .43, frontZ + .02);
    root.add(shopWindow);
  }

  if (descriptor.hasAwning) {
    const awning = box(
      "awning",
      spec.width * .62,
      .16,
      .9,
      material(`awning-${spec.accent}`, palette.trim, spec.accent, .14, .48, .42),
    );
    awning.position.set(0, plinthHeight * .82, spec.depth / 2 + .55);
    awning.rotation.x = -.08;
    root.add(awning);
  }

  if (descriptor.archetype === "stacked-flats") {
    for (const level of [.45, .68]) {
      const balcony = box(
        "balcony",
        spec.width * .56,
        .11,
        .62,
        material("balcony", 0x253a47, 0x162b35, .04, .5, .62),
      );
      balcony.position.set(0, spec.height * level, spec.depth / 2 + .3);
      root.add(balcony);
    }
  }

  if (descriptor.archetype === "service-block") {
    const pipeMaterial = material("service-pipe", 0x334d59, 0x16313b, .04, .38, .7);
    for (const side of [-1, 1]) {
      const pipe = cylinder("service-pipe", .13, Math.max(3, spec.height * .58), pipeMaterial);
      pipe.position.set(side * spec.width * .39, spec.height * .48, spec.depth / 2 + .16);
      root.add(pipe);
    }
  }
}

function addSideFacades(
  root: THREE.Group,
  spec: NightDropBuildingSpec,
  descriptor: NightDropBuildingDescriptor,
  plinthHeight: number,
): void {
  const facadeHeight = Math.max(2.8, spec.height - plinthHeight - 1.15);
  for (const side of [-1, 1] as const) {
    const facade = new THREE.Mesh(
      UNIT_PLANE,
      facadeMaterial(spec.accent, descriptor.archetype, descriptor.windowPattern + (side > 0 ? 2 : 1)),
    );
    facade.name = "lit-side-facade";
    facade.scale.set(Math.max(2.3, spec.depth * .72), facadeHeight, 1);
    facade.position.set(side * (spec.width / 2 + .018), plinthHeight + facadeHeight / 2, 0);
    facade.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(facade);
  }
}

function addFacadeFrame(
  root: THREE.Group,
  spec: NightDropBuildingSpec,
  descriptor: NightDropBuildingDescriptor,
  plinthHeight: number,
  palette: ReturnType<typeof paletteFor>,
): void {
  const frameMaterial = material(`facade-frame-${descriptor.archetype}`, palette.trim, palette.shellEmissive, .025, .56, .52);
  const frameHeight = Math.max(2.5, spec.height - plinthHeight - .7);
  for (const side of [-1, 1] as const) {
    const column = box("facade-column", .13, frameHeight, .16, frameMaterial);
    column.position.set(side * spec.width * .42, plinthHeight + frameHeight / 2, spec.depth / 2 + .09);
    root.add(column);
  }
  const cornice = box("facade-cornice", spec.width * .9, .14, .18, frameMaterial);
  cornice.position.set(0, spec.height - .55, spec.depth / 2 + .09);
  root.add(cornice);
}

function addNightFrontage(
  root: THREE.Group,
  spec: NightDropBuildingSpec,
  descriptor: NightDropBuildingDescriptor,
  palette: ReturnType<typeof paletteFor>,
): void {
  const pavement = box(
    "pavement-frontage",
    spec.width + .6,
    .14,
    2.1,
    material(`pavement-${descriptor.archetype}`, palette.pavement, 0x07131b, .015, .82, .12),
  );
  pavement.position.set(0, .07, spec.depth / 2 + 1.05);
  pavement.receiveShadow = true;
  root.add(pavement);

  const kerb = box(
    "street-kerb",
    spec.width + .72,
    .22,
    .16,
    material(`kerb-${descriptor.archetype}`, palette.kerb, palette.shellEmissive, .035, .68, .24),
  );
  kerb.position.set(0, .11, spec.depth / 2 + 2.06);
  root.add(kerb);

  const poolMaterial = new THREE.MeshBasicMaterial({
    color: descriptor.archetype === "night-market" ? 0xffb348 : spec.accent,
    transparent: true,
    opacity: descriptor.archetype === "night-market" ? .16 : .1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pool = new THREE.Mesh(UNIT_CIRCLE, poolMaterial);
  pool.name = "door-light-pool";
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(1.45, .82, 1);
  pool.position.set(0, .155, spec.depth / 2 + 1.15);
  root.add(pool);
}

function addRoofline(
  root: THREE.Group,
  spec: NightDropBuildingSpec,
  descriptor: NightDropBuildingDescriptor,
  palette: ReturnType<typeof paletteFor>,
): void {
  const parapet = box(
    "roof-parapet",
    spec.width + .42,
    .36,
    spec.depth + .42,
    material(`roof-${descriptor.archetype}`, palette.trim, 0x132c38, .035, .42, .66),
  );
  parapet.position.y = spec.height + .16;
  root.add(parapet);

  if (descriptor.roofTreatment === "crown") {
    const crown = box(
      "light-crown",
      spec.width * .58,
      .18,
      spec.depth * .44,
      material(`crown-${spec.accent}`, palette.trim, spec.accent, .72, .3, .6),
    );
    crown.position.y = spec.height + .58;
    root.add(crown);
    return;
  }

  if (descriptor.roofTreatment === "water-tank") {
    const tank = cylinder(
      "water-tank",
      Math.min(1.3, spec.width * .13),
      1.25,
      material("water-tank", 0x263b45, 0x12242c, .04, .58, .58),
    );
    tank.position.set(spec.width * .18, spec.height + .98, 0);
    root.add(tank);
    return;
  }

  if (descriptor.roofTreatment === "antenna") {
    const mast = cylinder(
      "antenna",
      .06,
      2.2,
      material(`antenna-${spec.accent}`, 0x3b5360, spec.accent, .22, .34, .72),
    );
    mast.position.set(-spec.width * .18, spec.height + 1.3, 0);
    root.add(mast);
    return;
  }

  const hvac = box(
    "roof-hvac",
    Math.min(2.2, spec.width * .3),
    .75,
    Math.min(1.55, spec.depth * .34),
    material("roof-hvac", 0x314651, 0x172a33, .03, .66, .56),
  );
  hvac.position.set(spec.width * .14, spec.height + .58, 0);
  root.add(hvac);
}

function paletteFor(archetype: NightDropBuildingArchetype): {
  readonly shell: number;
  readonly shellEmissive: number;
  readonly plinth: number;
  readonly entrance: number;
  readonly trim: number;
  readonly pavement: number;
  readonly kerb: number;
} {
  if (archetype === "glasshouse") return { shell: 0x081722, shellEmissive: 0x071b27, plinth: 0x10222c, entrance: 0x153846, trim: 0x223c4a, pavement: 0x192832, kerb: 0x38505a };
  if (archetype === "night-market") return { shell: 0x12101d, shellEmissive: 0x1d0a1a, plinth: 0x1d1928, entrance: 0x2d2132, trim: 0x3a283d, pavement: 0x24212b, kerb: 0x55424f };
  if (archetype === "service-block") return { shell: 0x101820, shellEmissive: 0x0b171c, plinth: 0x202a2f, entrance: 0x293338, trim: 0x344148, pavement: 0x252d31, kerb: 0x4a5558 };
  return { shell: 0x0c1422, shellEmissive: 0x0a1323, plinth: 0x182231, entrance: 0x20313d, trim: 0x2b394b, pavement: 0x1c2632, kerb: 0x3d4c59 };
}

function box(name: string, width: number, height: number, depth: number, materialValue: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT_BOX, materialValue);
  mesh.name = name;
  mesh.scale.set(width, height, depth);
  return mesh;
}

function cylinder(name: string, radius: number, height: number, materialValue: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT_CYLINDER, materialValue);
  mesh.name = name;
  mesh.scale.set(radius * 2, height, radius * 2);
  return mesh;
}

function material(
  key: string,
  color: number,
  emissive: number,
  emissiveIntensity: number,
  roughness: number,
  metalness: number,
): THREE.MeshStandardMaterial {
  const cached = materialCache.get(key);
  if (cached) return cached;
  const surface = key.startsWith("roof-") || key.includes("hvac") || key.includes("pipe") || key.includes("balcony")
    ? "nd.material.rooftop-metal"
    : key.includes("entrance") || key.includes("shop-") || key.includes("awning") || key.includes("strip-")
      ? "nd.material.neon-glass"
      : "nd.material.city-concrete";
  const created = createNightDropPbrMaterial(surface, {
    repeat: surface === "nd.material.city-concrete" ? [2, 3] : [1, 1],
    color: new THREE.Color(color)
      .lerp(new THREE.Color(0xffffff), surface === "nd.material.city-concrete" ? .64 : .46)
      .getHex(),
    emissive: surface === "nd.material.city-concrete"
      ? new THREE.Color(emissive).lerp(new THREE.Color(0x223441), .7).getHex()
      : emissive,
    emissiveIntensity: surface === "nd.material.city-concrete" ? Math.max(.2, emissiveIntensity) : emissiveIntensity,
    emissiveTexture: surface === "nd.material.neon-glass",
    roughness,
    metalness,
  });
  materialCache.set(key, created);
  return created;
}

function facadeMaterial(accent: number, archetype: NightDropBuildingArchetype, pattern: number): THREE.MeshBasicMaterial {
  const key = `${accent}-${archetype}-${pattern}`;
  const cached = facadeCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Night Drop building facade canvas unavailable");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(3, 9, 16, .96)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const accentColour = `#${accent.toString(16).padStart(6, "0")}`;
  const warmWindows = ["#ffd48a", "#ffb85a", "#ffe9ba"] as const;
  const coolWindows = ["#75dff2", "#a5efff", "#8cbcff"] as const;
  const columns = archetype === "glasshouse" ? 5 : archetype === "service-block" ? 3 : 4;
  const rows = archetype === "night-market" ? 7 : 9;
  const cellWidth = canvas.width / columns;
  const cellHeight = canvas.height / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const variation = (row * 5 + column * 3 + pattern) % 9;
      if (variation === 0 || variation === 6) continue;
      const windowPalette = archetype === "night-market" || variation === 2 ? warmWindows : coolWindows;
      context.globalAlpha = .38 + (variation % 4) * .13;
      context.fillStyle = windowPalette[variation % windowPalette.length]!;
      context.fillRect(column * cellWidth + 5, row * cellHeight + 4, cellWidth - 9, Math.max(4, cellHeight * .42));
      context.globalAlpha = .16;
      context.fillStyle = accentColour;
      context.fillRect(column * cellWidth + 5, row * cellHeight + cellHeight * .58, cellWidth - 9, 1);
    }
  }
  context.globalAlpha = .16;
  context.strokeStyle = accentColour;
  context.lineWidth = 1;
  for (let column = 1; column < columns; column += 1) {
    context.beginPath();
    context.moveTo(column * cellWidth, 0);
    context.lineTo(column * cellWidth, canvas.height);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const created = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .96, depthWrite: false, side: THREE.DoubleSide });
  facadeCache.set(key, created);
  return created;
}

function signMaterial(label: string, accent: number): THREE.MeshBasicMaterial {
  const key = `${label}-${accent}`;
  const cached = signCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Night Drop building sign canvas unavailable");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(4, 10, 18, .88)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
  context.lineWidth = 3;
  context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
  context.fillStyle = "#e9feff";
  context.font = "700 22px system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const created = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  signCache.set(key, created);
  return created;
}
