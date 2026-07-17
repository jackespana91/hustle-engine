"""Generate curve-safe, individually placeable Night Drop city buildings.

The runner owns street geometry. These assets contain architecture only and
face Blender -Y, which becomes Three.js +Z after glTF Y-up conversion.
"""

from __future__ import annotations

import json
import math
import importlib.util
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
PRODUCTION_SCRIPT = SCRIPT_DIR / "generate-night_drop_runner_assets.py"
PRODUCTION_SPEC = importlib.util.spec_from_file_location("night_drop_runner_production", PRODUCTION_SCRIPT)
if PRODUCTION_SPEC is None or PRODUCTION_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {PRODUCTION_SCRIPT}")
production = importlib.util.module_from_spec(PRODUCTION_SPEC)
PRODUCTION_SPEC.loader.exec_module(production)


APP_ROOT = SCRIPT_DIR.parents[1]
OUTPUT_ROOT = APP_ROOT / "public" / "assets" / "night-drop" / "runner" / "city-kit"
REPORT_PATH = OUTPUT_ROOT / "city-kit-report.json"

SPECS = (
    ("glasshouse", "a", 8.0, 6.4, 15.0),
    ("glasshouse", "b", 7.2, 6.0, 12.5),
    ("night-market", "a", 9.0, 6.8, 10.5),
    ("night-market", "b", 7.8, 6.2, 12.0),
    ("service-block", "a", 8.4, 6.8, 9.0),
    ("service-block", "b", 7.4, 6.0, 11.0),
    ("stacked-flats", "a", 8.2, 6.6, 15.5),
    ("stacked-flats", "b", 7.4, 6.2, 13.5),
)


def materials() -> dict[str, bpy.types.Material]:
    return {
        "concrete": production.material("NDK_AgedConcrete", (0.12, 0.145, 0.16, 1), metallic=0.04, roughness=0.78),
        "concrete_dark": production.material("NDK_DarkConcrete", (0.045, 0.06, 0.07, 1), metallic=0.08, roughness=0.72),
        "brick": production.material("NDK_WetBrick", (0.13, 0.055, 0.05, 1), metallic=0.02, roughness=0.82),
        "plaster": production.material("NDK_NightPlaster", (0.16, 0.18, 0.19, 1), metallic=0.02, roughness=0.76),
        "metal": production.material("NDK_Gunmetal", (0.055, 0.075, 0.085, 1), metallic=0.76, roughness=0.34),
        "roof": production.material("NDK_RoofTar", (0.025, 0.032, 0.038, 1), metallic=0.03, roughness=0.9),
        "glass": production.material("NDK_OccupiedGlass", (0.018, 0.07, 0.095, 1), metallic=0.44, roughness=0.16),
        "glass_dark": production.material("NDK_DarkGlass", (0.008, 0.025, 0.04, 1), metallic=0.5, roughness=0.12),
        "warm": production.material("NDK_WarmInterior", (0.32, 0.11, 0.025, 1), metallic=0.02, roughness=0.38, emission=(1.0, 0.48, 0.16, 1), emission_strength=2.0),
        "cool": production.material("NDK_CoolInterior", (0.035, 0.19, 0.24, 1), metallic=0.04, roughness=0.32, emission=(0.18, 0.72, 1.0, 1), emission_strength=1.05),
        "cyan": production.material("NDK_CyanPractical", (0.01, 0.16, 0.2, 1), metallic=0.16, roughness=0.28, emission=(0.0, 0.7, 0.9, 1), emission_strength=1.2),
        "magenta": production.material("NDK_MagentaPractical", (0.18, 0.012, 0.08, 1), metallic=0.14, roughness=0.3, emission=(0.92, 0.03, 0.44, 1), emission_strength=1.05),
        "roller": production.material("NDK_RollerShutter", (0.12, 0.14, 0.145, 1), metallic=0.68, roughness=0.46),
    }


def part(
    root: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    bevel: float = 0.04,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    obj = production.add_box(name, location, dimensions, mat, bevel=bevel, rotation=rotation)
    obj.parent = root
    return obj


def cylinder(
    root: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    obj = production.add_cylinder(name, location, radius, depth, mat, vertices=12, rotation=rotation, bevel=0.025)
    obj.parent = root
    return obj


def front_windows(
    root: bpy.types.Object,
    width: float,
    depth: float,
    height: float,
    mats: dict[str, bpy.types.Material],
    *,
    columns: int,
    rows: int,
    seed: int,
    bottom: float = 3.1,
) -> None:
    available_width = width - 1.25
    available_height = height - bottom - 1.0
    cell_width = available_width / columns
    cell_height = available_height / max(1, rows)
    for row in range(rows):
        for column in range(columns):
            state = (row * 7 + column * 5 + seed) % 9
            if state in (0, 6):
                continue
            x = -available_width / 2 + cell_width * (column + 0.5)
            z = bottom + cell_height * (row + 0.5)
            window_width = min(1.05, cell_width * 0.65)
            window_height = min(0.84, cell_height * 0.55)
            part(root, f"WindowReveal_{row}_{column}", (x, -depth / 2 - 0.018, z), (window_width + 0.16, 0.13, window_height + 0.16), mats["metal"], bevel=0.025)
            glazing = mats["warm"] if state in (2, 4, 7) else mats["cool"] if state == 5 else mats["glass"]
            part(root, f"WindowGlass_{row}_{column}", (x, -depth / 2 - 0.09, z), (window_width, 0.055, window_height), glazing, bevel=0.015)


def side_windows(
    root: bpy.types.Object,
    width: float,
    depth: float,
    height: float,
    mats: dict[str, bpy.types.Material],
    *,
    rows: int,
    seed: int,
) -> None:
    for side in (-1, 1):
        for row in range(rows):
            for column in range(2):
                state = (row * 5 + column * 3 + seed + side) % 8
                if state in (0, 5):
                    continue
                y = -depth * 0.22 + column * depth * 0.44
                z = 3.25 + row * max(1.45, (height - 4.3) / max(1, rows - 0.25))
                if z > height - 0.65:
                    continue
                glazing = mats["warm"] if state in (2, 6) else mats["glass"]
                part(root, f"SideWindow_{side}_{row}_{column}", (side * (width / 2 + 0.04), y, z), (0.07, 0.82, 0.62), glazing, bevel=0.015)


def ground_floor(
    root: bpy.types.Object,
    width: float,
    depth: float,
    mats: dict[str, bpy.types.Material],
    *,
    storefront: bool,
    accent: str,
) -> None:
    part(root, "GroundFloorPlinth", (0, 0, 1.2), (width + 0.16, depth + 0.16, 2.4), mats["concrete_dark"], bevel=0.09)
    part(root, "RecessedEntry", (width * 0.22, -depth / 2 - 0.11, 1.05), (1.2, 0.22, 2.05), mats["glass_dark"], bevel=0.03)
    part(root, "EntryLight", (width * 0.22, -depth / 2 - 0.24, 2.18), (1.0, 0.08, 0.12), mats[accent], bevel=0.025)
    if storefront:
        part(root, "StorefrontReveal", (-width * 0.17, -depth / 2 - 0.09, 1.12), (width * 0.48, 0.2, 1.72), mats["metal"], bevel=0.04)
        part(root, "StorefrontGlass", (-width * 0.17, -depth / 2 - 0.2, 1.12), (width * 0.44, 0.06, 1.56), mats["warm"], bevel=0.025)
        part(root, "StorefrontAwning", (-width * 0.17, -depth / 2 - 0.64, 2.18), (width * 0.56, 1.05, 0.14), mats[accent], bevel=0.035, rotation=(math.radians(-8), 0, 0))


def rooftop(
    root: bpy.types.Object,
    width: float,
    depth: float,
    height: float,
    mats: dict[str, bpy.types.Material],
    *,
    variant: str,
) -> None:
    part(root, "RoofSlab", (0, 0, height + 0.12), (width + 0.28, depth + 0.28, 0.24), mats["roof"], bevel=0.06)
    for side in (-1, 1):
        part(root, f"RoofParapetSide_{side}", (side * width / 2, 0, height + 0.42), (0.18, depth + 0.18, 0.68), mats["concrete"], bevel=0.04)
    part(root, "RoofParapetRear", (0, depth / 2, height + 0.42), (width, 0.18, 0.68), mats["concrete"], bevel=0.04)
    if variant == "a":
        part(root, "HVACUnit", (-width * 0.18, 0.22, height + 0.72), (1.55, 1.15, 0.9), mats["metal"], bevel=0.08)
        for index in range(4):
            part(root, f"HVACVent_{index}", (-width * 0.52 + index * 0.26, -0.37, height + 0.74), (0.16, 0.05, 0.38), mats["concrete_dark"], bevel=0.01)
    else:
        cylinder(root, "WaterTank", (width * 0.18, 0.12, height + 1.05), 0.72, 1.45, mats["metal"])
        for side in (-1, 1):
            cylinder(root, f"TankLeg_{side}", (width * 0.18 + side * 0.36, 0.12, height + 0.35), 0.055, 0.65, mats["metal"])


def glasshouse(root, width, depth, height, mats, variant):
    part(root, "GlasshouseCore", (0, 0, height / 2), (width, depth, height), mats["concrete_dark"], bevel=0.14)
    part(root, "CurtainWall", (0, -depth / 2 - 0.08, height * 0.56), (width * 0.84, 0.12, height * 0.76), mats["glass_dark"], bevel=0.035)
    columns = 5 if variant == "a" else 4
    for column in range(1, columns):
        x = -width * 0.42 + width * 0.84 * column / columns
        part(root, f"CurtainMullion_{column}", (x, -depth / 2 - 0.18, height * 0.56), (0.08, 0.08, height * 0.75), mats["metal"], bevel=0.012)
    for row in range(1, 7):
        z = 2.65 + (height - 3.4) * row / 7
        part(root, f"CurtainTransom_{row}", (0, -depth / 2 - 0.18, z), (width * 0.84, 0.08, 0.07), mats["metal"], bevel=0.01)
    for row in range(5):
        for column in range(columns):
            if (row * 3 + column + (0 if variant == "a" else 2)) % 5 not in (0, 3):
                continue
            x = -width * 0.42 + width * 0.84 * (column + .5) / columns
            z = 3.1 + (height - 4.0) * (row + .5) / 5
            part(root, f"OccupiedPane_{row}_{column}", (x, -depth / 2 - 0.225, z), (width * .68 / columns, .04, .68), mats["warm"], bevel=.01)
    ground_floor(root, width, depth, mats, storefront=False, accent="cyan")
    side_windows(root, width, depth, height, mats, rows=5, seed=1 if variant == "a" else 5)
    rooftop(root, width, depth, height, mats, variant=variant)


def night_market(root, width, depth, height, mats, variant):
    shell = mats["brick"] if variant == "a" else mats["plaster"]
    part(root, "MarketShell", (0, 0, height / 2), (width, depth, height), shell, bevel=0.11)
    for level in range(2, int(height // 2.6)):
        part(root, f"MasonryCourse_{level}", (0, -depth / 2 - .045, level * 2.4), (width * .92, .08, .12), mats["concrete_dark"], bevel=.015)
    ground_floor(root, width, depth, mats, storefront=True, accent="magenta")
    front_windows(root, width, depth, height, mats, columns=4, rows=max(2, int((height - 3) / 2)), seed=3 if variant == "a" else 7)
    side_windows(root, width, depth, height, mats, rows=4, seed=2)
    part(root, "MarketSignBlade", (-width / 2 - .35, -depth / 2 + .25, 3.25), (.62, .18, 1.55), mats["magenta"], bevel=.05)
    rooftop(root, width, depth, height, mats, variant=variant)


def service_block(root, width, depth, height, mats, variant):
    part(root, "ServiceShell", (0, 0, height / 2), (width, depth, height), mats["concrete"], bevel=0.08)
    part(root, "RollerReveal", (-width * .12, -depth / 2 - .08, 1.45), (width * .58, .16, 2.5), mats["concrete_dark"], bevel=.035)
    part(root, "RollerShutter", (-width * .12, -depth / 2 - .18, 1.42), (width * .53, .06, 2.32), mats["roller"], bevel=.02)
    for line in range(7):
        part(root, f"ShutterLine_{line}", (-width * .12, -depth / 2 - .22, .48 + line * .29), (width * .5, .025, .025), mats["metal"], bevel=.006)
    part(root, "ServiceDoor", (width * .32, -depth / 2 - .12, 1.02), (1.1, .18, 2.0), mats["metal"], bevel=.035)
    for side in (-1, 1):
        cylinder(root, f"Downpipe_{side}", (side * width * .41, -depth / 2 - .18, height * .48), .075, height * .82, mats["metal"])
    for row in range(2):
        for column in range(3):
            part(root, f"ServiceWindow_{row}_{column}", (-width * .27 + column * width * .27, -depth / 2 - .1, 4.2 + row * 2.1), (1.05, .08, .6), mats["cool"] if (column + row) % 2 else mats["glass"], bevel=.02)
    rooftop(root, width, depth, height, mats, variant=variant)


def stacked_flats(root, width, depth, height, mats, variant):
    part(root, "FlatsShell", (0, 0, height / 2), (width, depth, height), mats["plaster"] if variant == "a" else mats["brick"], bevel=.1)
    ground_floor(root, width, depth, mats, storefront=variant == "b", accent="cyan")
    front_windows(root, width, depth, height, mats, columns=3, rows=5, seed=6 if variant == "a" else 2)
    side_windows(root, width, depth, height, mats, rows=5, seed=8)
    for level in (0.42, 0.61, 0.8):
        z = height * level
        part(root, f"BalconySlab_{level}", (0, -depth / 2 - .48, z), (width * .62, .95, .12), mats["concrete_dark"], bevel=.035)
        part(root, f"BalconyRail_{level}", (0, -depth / 2 - .92, z + .52), (width * .6, .06, .9), mats["metal"], bevel=.018)
        for post in (-.27, 0, .27):
            part(root, f"BalconyPost_{level}_{post}", (width * post, -depth / 2 - .92, z + .46), (.055, .055, .82), mats["metal"], bevel=.01)
    rooftop(root, width, depth, height, mats, variant=variant)


BUILDERS = {
    "glasshouse": glasshouse,
    "night-market": night_market,
    "service-block": service_block,
    "stacked-flats": stacked_flats,
}


def material_family(material_name: str) -> str:
    if "WarmInterior" in material_name:
        return "warm"
    if any(token in material_name for token in ("CoolInterior", "CyanPractical", "MagentaPractical")):
        return "practical"
    if any(token in material_name for token in ("DarkGlass", "OccupiedGlass")):
        return "glass"
    if any(token in material_name for token in ("Gunmetal", "RollerShutter")):
        return "metal"
    return "structure"


def merge_root_meshes(root: bpy.types.Object) -> None:
    groups: dict[str, list[bpy.types.Object]] = {}
    for obj in list(root.children):
        if obj.type != "MESH":
            continue
        material_name = obj.data.materials[0].name if len(obj.data.materials) else "unassigned"
        groups.setdefault(material_family(material_name), []).append(obj)
    canonical_names = {
        "structure": "NDK_AgedConcrete",
        "metal": "NDK_Gunmetal",
        "glass": "NDK_DarkGlass",
        "warm": "NDK_WarmInterior",
        "practical": "NDK_CyanPractical",
    }
    for family, objects in groups.items():
        if family == "practical" and any("MagentaPractical" in obj.data.materials[0].name for obj in objects):
            canonical_names[family] = "NDK_MagentaPractical"
        canonical = bpy.data.materials.get(canonical_names[family])
        if canonical is None:
            raise RuntimeError(f"Missing Night Drop city material {canonical_names[family]}")
        for obj in objects:
            obj.data.materials.clear()
            obj.data.materials.append(canonical)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        joined = bpy.context.object
        joined.name = f"ND_Batch_{family}"
        joined.data.name = joined.name
        joined["batchedMaterial"] = family
        joined.parent = root


def create_template(archetype: str, variant: str, width: float, depth: float, height: float) -> bpy.types.Object:
    mats = materials()
    root = bpy.data.objects.new(f"ND_City_{archetype.replace('-', '_')}_{variant.upper()}", None)
    root["nightDropCityKit"] = "2.0.0"
    root["archetype"] = archetype
    root["variant"] = variant
    root["baseWidth"] = width
    root["baseDepth"] = depth
    root["baseHeight"] = height
    bpy.context.scene.collection.objects.link(root)
    BUILDERS[archetype](root, width, depth, height, mats, variant)
    merge_root_meshes(root)
    return root


def build_asset(archetype: str, variant: str, width: float, depth: float, height: float) -> dict[str, object]:
    production.reset_scene()
    create_template(archetype, variant, width, depth, height)
    output = OUTPUT_ROOT / f"{archetype}_{variant}.glb"
    production.export_glb(output, animations=False)
    report = production.asset_report(output, role=f"city.{archetype}.{variant}", lod="shared")
    report.update({"archetype": archetype, "variant": variant, "baseWidth": width, "baseDepth": depth, "baseHeight": height})
    return report


def build_bundle() -> Path:
    production.reset_scene()
    for spec in SPECS:
        create_template(*spec)
    output = OUTPUT_ROOT / "night-drop-city-kit.glb"
    production.export_glb(output, animations=False)
    return output


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    assets = [build_asset(*spec) for spec in SPECS]
    bundle = build_bundle()
    REPORT_PATH.write_text(json.dumps({
        "generator": "night-drop-curve-safe-city-kit-v2",
        "blenderVersion": bpy.app.version_string,
        "assets": assets,
        "bundle": {"path": str(bundle.relative_to(APP_ROOT / "public")), "bytes": bundle.stat().st_size},
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(assets)} Night Drop city-kit assets at {OUTPUT_ROOT}")


if __name__ == "__main__":
    main()
