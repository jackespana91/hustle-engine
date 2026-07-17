import * as THREE from "three";
import type { NightDropDistrictId } from "./night-drop-districts.js";

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
  root.userData.productionKit = "night-drop-city-v1";

  const palette = paletteFor(descriptor.archetype);
  const shell = box(
    "shell",
    spec.width,
    spec.height,
    spec.depth,
    material(`shell-${descriptor.archetype}-${spec.accent}`, palette.shell, spec.accent, .07, .54, .34),
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
    material(`plinth-${descriptor.archetype}`, palette.plinth, spec.accent, .035, .62, .24),
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
    material(`entrance-${descriptor.archetype}-${spec.accent}`, palette.entrance, spec.accent, .28, .38, .48),
  );
  entrance.position.set(descriptor.archetype === "night-market" ? spec.width * .2 : 0, plinthHeight * .36, frontZ);
  root.add(entrance);

  if (descriptor.archetype === "night-market") {
    const shopWindow = box(
      "shop-window",
      spec.width * .42,
      plinthHeight * .48,
      .12,
      material(`shop-${spec.accent}`, 0x213847, spec.accent, .55, .26, .48),
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
  readonly plinth: number;
  readonly entrance: number;
  readonly trim: number;
} {
  if (archetype === "glasshouse") return { shell: 0x102638, plinth: 0x142f3c, entrance: 0x194456, trim: 0x28495b };
  if (archetype === "night-market") return { shell: 0x1b1b2d, plinth: 0x252239, entrance: 0x3b2740, trim: 0x48304e };
  if (archetype === "service-block") return { shell: 0x17232c, plinth: 0x26323a, entrance: 0x303d43, trim: 0x3b4b53 };
  return { shell: 0x141d30, plinth: 0x202a3b, entrance: 0x273a49, trim: 0x35445a };
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
  const created = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness, metalness });
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
  const colour = `#${accent.toString(16).padStart(6, "0")}`;
  const columns = archetype === "glasshouse" ? 5 : archetype === "service-block" ? 3 : 4;
  const rows = archetype === "night-market" ? 7 : 9;
  const cellWidth = canvas.width / columns;
  const cellHeight = canvas.height / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if ((row * 5 + column * 3 + pattern) % 8 === 0) continue;
      context.globalAlpha = .18 + ((row + column + pattern) % 4) * .1;
      context.fillStyle = colour;
      context.fillRect(column * cellWidth + 5, row * cellHeight + 5, cellWidth - 9, Math.max(3, cellHeight * .35));
    }
  }
  context.globalAlpha = .16;
  context.strokeStyle = colour;
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
  const created = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .9, depthWrite: false });
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
