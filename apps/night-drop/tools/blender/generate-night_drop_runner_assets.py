"""Generate the first game-ready Night Drop runner production pack.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
    apps/night-drop/tools/blender/generate-night_drop_runner_assets.py

The script is deterministic and writes only under the Night Drop public asset
folder. It creates the complete semantic environment set at three LODs, the
initial rigged Dash GLB with all loader animation clips, shared PBR texture
maps, and a machine-readable production report.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
APP_ROOT = SCRIPT_DIR.parents[1]
ASSET_ROOT = APP_ROOT / "public" / "assets" / "night-drop" / "runner"
ENVIRONMENT_ROOT = ASSET_ROOT / "environment"
DASH_ROOT = ASSET_ROOT / "characters" / "dash"
MATERIAL_ROOT = ASSET_ROOT / "materials"
REPORT_PATH = ASSET_ROOT / "production-report.json"

ROLES = (
    "street-straight",
    "corner-left",
    "corner-right",
    "t-junction",
    "crossroads",
    "alley",
    "bridge",
    "tunnel",
    "ramp-up",
    "ramp-down",
    "rooftop",
    "destination",
)

LOD_DETAIL = {"lod0": 2, "lod1": 1, "lod2": 0}

PALETTE = {
    "asphalt": (0.018, 0.032, 0.055, 1.0),
    "asphalt_wet": (0.025, 0.060, 0.082, 1.0),
    "concrete": (0.055, 0.082, 0.105, 1.0),
    "concrete_light": (0.11, 0.16, 0.19, 1.0),
    "glass": (0.025, 0.19, 0.25, 1.0),
    "gunmetal": (0.035, 0.055, 0.075, 1.0),
    "cyan": (0.02, 0.82, 1.0, 1.0),
    "cyan_muted": (0.015, 0.24, 0.31, 1.0),
    "magenta": (1.0, 0.025, 0.48, 1.0),
    "gold": (1.0, 0.61, 0.035, 1.0),
    "warm_window": (1.0, 0.34, 0.07, 1.0),
    "acid": (0.37, 1.0, 0.15, 1.0),
    "skin": (0.48, 0.21, 0.12, 1.0),
    "skin_light": (0.72, 0.38, 0.23, 1.0),
    "hair": (0.012, 0.018, 0.04, 1.0),
    "jacket": (0.018, 0.045, 0.085, 1.0),
    "jacket_panel": (0.025, 0.11, 0.16, 1.0),
    "trouser": (0.018, 0.026, 0.052, 1.0),
    "shoe": (0.035, 0.025, 0.075, 1.0),
    "white": (0.82, 0.94, 0.98, 1.0),
}

REPORT: dict[str, object] = {
    "generator": "night-drop-blender-production-v1",
    "blenderVersion": bpy.app.version_string,
    "environment": [],
    "character": {},
    "materials": [],
}


def ensure_directories() -> None:
    ENVIRONMENT_ROOT.mkdir(parents=True, exist_ok=True)
    DASH_ROOT.mkdir(parents=True, exist_ok=True)
    MATERIAL_ROOT.mkdir(parents=True, exist_ok=True)


def reset_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 48
    scene.render.fps = 30
    scene.world.color = (0.004, 0.006, 0.012)


def set_principled_input(shader: bpy.types.Node, names: Iterable[str], value) -> None:
    for name in names:
        socket = shader.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.55,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    created = bpy.data.materials.new(name)
    created.use_nodes = True
    created.diffuse_color = color
    shader = created.node_tree.nodes.get("Principled BSDF")
    if shader:
        set_principled_input(shader, ("Base Color",), color)
        set_principled_input(shader, ("Metallic",), metallic)
        set_principled_input(shader, ("Roughness",), roughness)
        if emission and emission_strength > 0:
            set_principled_input(shader, ("Emission Color", "Emission"), emission)
            set_principled_input(shader, ("Emission Strength",), emission_strength)
    created["nightDropMaterial"] = name
    return created


def scene_materials() -> dict[str, bpy.types.Material]:
    return {
        "asphalt": material("ND_WetAsphalt", PALETTE["asphalt_wet"], metallic=0.12, roughness=0.26),
        "road_edge": material("ND_RoadEdge", PALETTE["concrete"], metallic=0.08, roughness=0.62),
        "concrete": material("ND_CityConcrete", PALETTE["concrete"], metallic=0.08, roughness=0.58),
        "concrete_light": material("ND_CityConcreteLight", PALETTE["concrete_light"], metallic=0.1, roughness=0.5),
        "glass": material("ND_NeonGlass", PALETTE["glass"], metallic=0.32, roughness=0.18, emission=PALETTE["cyan"], emission_strength=0.22),
        "glass_dark": material("ND_DarkGlass", (0.018, 0.058, 0.078, 1.0), metallic=0.34, roughness=0.2, emission=PALETTE["cyan"], emission_strength=0.045),
        "metal": material("ND_RooftopMetal", PALETTE["gunmetal"], metallic=0.78, roughness=0.34),
        "cyan": material("ND_RouteCyan", PALETTE["cyan"], metallic=0.16, roughness=0.24, emission=PALETTE["cyan"], emission_strength=2.8),
        "cyan_muted": material("ND_CityCyanMuted", PALETTE["cyan_muted"], metallic=0.28, roughness=0.34, emission=PALETTE["cyan"], emission_strength=0.45),
        "magenta": material("ND_DangerMagenta", PALETTE["magenta"], metallic=0.12, roughness=0.26, emission=PALETTE["magenta"], emission_strength=2.0),
        "gold": material("ND_PackageGold", PALETTE["gold"], metallic=0.42, roughness=0.24, emission=PALETTE["gold"], emission_strength=1.3),
        "window": material("ND_WarmWindow", (0.42, 0.09, 0.018, 1.0), metallic=0.12, roughness=0.3, emission=PALETTE["warm_window"], emission_strength=1.65),
        "acid": material("ND_FiveStarAcid", (0.07, 0.28, 0.035, 1.0), metallic=0.12, roughness=0.3, emission=PALETTE["acid"], emission_strength=1.6),
    }


def apply_bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("ProductionEdge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    try:
        modifier.limit_method = "ANGLE"
    except Exception:
        pass
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def add_box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    bevel: float = 0.0,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    obj.data.materials.append(mat)
    apply_bevel(obj, bevel)
    return obj


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 12,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    apply_bevel(obj, bevel, 1)
    return obj


def add_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    subdivisions: int = 2,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def add_plane_disc(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 32,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=0.035, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def add_building(
    index: int,
    x: float,
    y: float,
    width: float,
    length: float,
    height: float,
    side: int,
    detail: int,
    mats: dict[str, bpy.types.Material],
    *,
    premium: bool = False,
) -> None:
    shell_material = mats["concrete_light"] if premium else mats["concrete"]
    building = add_box(
        f"Glasshouse_Building_{index}",
        (x, y, height / 2),
        (width, length, height),
        shell_material,
        bevel=0.16 if detail > 0 else 0.05,
    )
    building["district"] = "glasshouse"
    building["productionModule"] = True
    front_x = x - side * (width / 2 + 0.025)
    band_count = 2 if detail == 0 else 3 if detail == 1 else 5
    for band in range(band_count):
        z = 1.25 + band * max(1.1, (height - 2.2) / max(1, band_count - 1))
        if z >= height - 0.45:
            continue
        glass = add_box(
            f"Glasshouse_WindowBand_{index}_{band}",
            (front_x, y, z),
            (0.055, max(0.65, length - 0.75), 0.34 if detail < 2 else 0.46),
            mats["glass"] if band % 3 else mats["window"],
            bevel=0.025,
        )
        glass["facadeBand"] = True
    end_band_count = 1 if detail == 0 else 2
    for end in (-1, 1):
        end_glass_wall = add_box(
            f"Glasshouse_EndGlass_{index}_{end}",
            (x, y + end * (length / 2 + 0.018), max(1.2, height * 0.52)),
            (max(0.75, width - 0.95), 0.04, max(1.4, height - 1.75)),
            mats["glass_dark"],
            bevel=0.025,
        )
        end_glass_wall["glassCurtainWall"] = True
        for band in range(end_band_count):
            end_z = 2.0 + band * max(1.8, (height - 3.0) / max(1, end_band_count))
            if end_z >= height - 0.45:
                continue
            end_glass = add_box(
                f"Glasshouse_EndBand_{index}_{end}_{band}",
                (x, y + end * (length / 2 + 0.025), end_z),
                (max(0.65, width - 0.7), 0.055, 0.38),
                mats["glass"] if (index + band) % 3 else mats["window"],
                bevel=0.025,
            )
            end_glass["facadeBand"] = True
        edge_light = add_box(
            f"Glasshouse_EndEdge_{index}_{end}",
            (x + side * (width / 2 - 0.18), y + end * (length / 2 + 0.05), height * 0.56),
            (0.075, 0.075, max(1.2, height - 1.4)),
            mats["cyan_muted"] if not premium else mats["gold"],
            bevel=0.02,
        )
        edge_light["facadeEdgeLight"] = True
    entrance = add_box(
        f"Glasshouse_Entrance_{index}",
        (front_x, y - length * 0.18, 0.95),
        (0.075, min(1.5, length * 0.32), 1.75),
        mats["glass"],
        bevel=0.035,
    )
    entrance["streetEntrance"] = True
    crown = add_box(
        f"Glasshouse_Crown_{index}",
        (x, y, height + 0.16),
        (max(0.9, width - 0.5), max(0.9, length - 0.5), 0.32),
        mats["cyan_muted"] if not premium else mats["gold"],
        bevel=0.09,
    )
    crown["roofTreatment"] = "crown"
    if detail > 0:
        antenna_height = 1.2 + (index % 3) * 0.35
        add_cylinder(
            f"Glasshouse_Antenna_{index}",
            (x + side * width * 0.18, y, height + antenna_height / 2 + 0.3),
            0.055,
            antenna_height,
            mats["metal"],
            vertices=8,
        )


def add_route_surface(detail: int, mats: dict[str, bpy.types.Material], width: float = 16.0, length: float = 20.0) -> None:
    add_box("WetStreet", (0, 0, -0.16), (width, length, 0.34), mats["asphalt"], bevel=0.05)
    for side in (-1, 1):
        add_box("RaisedPavement", (side * (width / 2 + 1.25), 0, 0.05), (2.5, length, 0.42), mats["road_edge"], bevel=0.08)
        add_box("CyanCurb", (side * (width / 2 + 0.04), 0, 0.28), (0.08, length, 0.08), mats["cyan_muted"], bevel=0.015)
    dash_count = 3 if detail == 0 else 5 if detail == 1 else 7
    for marker in range(dash_count):
        y = -length / 2 + (marker + 0.5) * length / dash_count
        add_box("LaneMarking", (0, y, 0.035), (0.13, length / dash_count * 0.48, 0.035), mats["concrete_light"], bevel=0.01)
    if detail > 0:
        for side in (-1, 1):
            add_box("Drain", (side * (width / 2 - 0.35), -3.2, 0.045), (0.42, 1.5, 0.055), mats["metal"], bevel=0.02)


def add_cross_street(detail: int, mats: dict[str, bpy.types.Material], width: float, y: float = 0.0, one_sided: bool = False) -> None:
    cross_x = width / 4 if one_sided else 0
    cross_width = width / 2 if one_sided else width
    add_box("CrossStreet", (cross_x, y, -0.145), (cross_width, 10.5, 0.35), mats["asphalt"], bevel=0.05)
    stripe_count = 4 if detail == 0 else 7
    for stripe in range(stripe_count):
        x = -4.2 + stripe * 1.4
        add_box("Crosswalk", (x, y - 3.7, 0.04), (0.62, 1.8, 0.04), mats["concrete_light"], bevel=0.01)


def add_standard_city(detail: int, mats: dict[str, bpy.types.Material], *, alley: bool = False) -> None:
    """Frame a street without allowing the architecture to crowd the run line.

    The previous production modules placed facade edges almost directly against
    the pavement. That worked in an orthographic asset review, but foreground
    buildings repeatedly masked the road from the chase camera. Keep a generous
    pedestrian/visibility zone outside the pavement and add gaps between shells
    so the route remains the dominant shape on a phone.
    """
    count = 2 if detail == 0 else 3 if detail == 1 else 4
    road_half = 5.6 if alley else 8.0
    pavement_width = 2.5
    sightline_setback = 1.8 if alley else 4.5
    facade_edge = road_half + pavement_width + sightline_setback
    for side_index, side in enumerate((-1, 1)):
        for index in range(count):
            slot_length = 20 / count
            length = slot_length - (0.9 if alley else 1.45)
            y = -10 + slot_length / 2 + index * slot_length
            width = 3.8 if alley else 4.45 + ((index + side_index) % 2) * 0.55
            height = 5.0 + ((index * 3 + side_index * 2) % 5) * 1.15
            x = side * (facade_edge + width / 2)
            add_building(index + side_index * 10, x, y, width, length, height, side, detail, mats, premium=index == count - 1 and side > 0)


def add_intersection_city(role: str, detail: int, mats: dict[str, bpy.types.Material]) -> None:
    """Place buildings beyond every driveable arm of an intersection.

    Junctions cannot reuse straight-street architecture: long shells on the
    module sides physically intersect the turn branches and hide the player's
    choice. Compact corner volumes keep the city present while leaving a clear
    visual cone through the crossroads, T-junction and bend exits.
    """
    if role == "crossroads":
        x_edge, y_centres = 22.0, (-8.4, 8.4)
    elif role == "t-junction":
        x_edge, y_centres = 19.0, (-6.0, 10.2)
    else:
        x_edge, y_centres = 14.8, (-7.2, 8.6)

    for side_index, side in enumerate((-1, 1)):
        for row, y in enumerate(y_centres):
            width = 4.0 + ((side_index + row) % 2) * 0.55
            length = 4.6 if role in ("crossroads", "t-junction") else 4.0
            height = 5.2 + ((side_index * 2 + row) % 3) * 1.15
            x = side * (x_edge + width / 2)
            add_building(
                40 + side_index * 10 + row,
                x,
                y,
                width,
                length,
                height,
                side,
                detail,
                mats,
                premium=side > 0 and row == 1,
            )

    if detail > 0:
        beacon_x = x_edge - 1.0
        for x in (-beacon_x, beacon_x):
            add_cylinder("JunctionBeacon", (x, -4.8, 1.3), 0.12, 2.6, mats["cyan_muted"], vertices=10)


def add_bridge(detail: int, mats: dict[str, bpy.types.Material]) -> None:
    add_box("BridgeDeck", (0, 0, 0.0), (16, 20, 0.7), mats["metal"], bevel=0.12)
    add_box("BridgeRoad", (0, 0, 0.38), (12.8, 20, 0.16), mats["asphalt"], bevel=0.04)
    for side in (-1, 1):
        add_box("BridgeRail", (side * 7.25, 0, 1.02), (0.18, 20, 1.2), mats["cyan_muted"], bevel=0.04)
        post_count = 3 if detail == 0 else 6
        for post in range(post_count):
            y = -8.5 + post * 17 / max(1, post_count - 1)
            add_box("BridgePost", (side * 7.25, y, 1.45), (0.34, 0.34, 2.1), mats["metal"], bevel=0.04)


def add_tunnel(detail: int, mats: dict[str, bpy.types.Material]) -> None:
    add_route_surface(detail, mats)
    frame_count = 3 if detail == 0 else 5 if detail == 1 else 7
    for index in range(frame_count):
        y = -9 + index * 18 / max(1, frame_count - 1)
        for side in (-1, 1):
            add_box("TunnelFrame", (side * 7.2, y, 3.2), (0.38, 0.48, 6.4), mats["metal"], bevel=0.07)
        add_box("TunnelFrameTop", (0, y, 6.15), (14.75, 0.48, 0.5), mats["metal"], bevel=0.07)
        if detail > 0:
            add_box("TunnelLight", (0, y + 0.28, 5.82), (3.2, 0.08, 0.1), mats["cyan"], bevel=0.02)


def add_rooftop(detail: int, mats: dict[str, bpy.types.Material], destination: bool = False) -> None:
    add_box("RooftopDeck", (0, 0, -0.2), (16, 20, 0.65), mats["metal"], bevel=0.12)
    for side in (-1, 1):
        add_box("RooftopParapet", (side * 7.7, 0, 0.45), (0.55, 20, 1.3), mats["concrete"], bevel=0.08)
    if destination:
        add_plane_disc("FinalAddressLanding", (0, 2.8, 0.2), 3.2, mats["gold"], vertices=36 if detail > 0 else 20)
        tower_height = 9.0 if detail == 0 else 12.0
        add_building(99, 0, 7.2, 9.5, 5.4, tower_height, 1, detail, mats, premium=True)
        add_cylinder("FinalAddressBeacon", (0, 7.2, tower_height + 2.2), 0.18, 4.4, mats["gold"], vertices=12)
        add_box("FinalAddressCanopy", (0, 3.5, 3.0), (7.5, 0.65, 0.4), mats["gold"], bevel=0.12)
    else:
        vent_count = 2 if detail == 0 else 4
        for index in range(vent_count):
            add_box("RoofVent", ((-1 if index % 2 else 1) * 5.4, -6 + index * 3.5, 0.55), (1.5, 1.1, 1.1), mats["concrete_light"], bevel=0.09)


def build_environment(role: str, lod: str) -> None:
    reset_scene()
    mats = scene_materials()
    detail = LOD_DETAIL[lod]
    root = bpy.data.objects.new(f"ND_{role.replace('-', '_')}_{lod}", None)
    bpy.context.collection.objects.link(root)
    root["assetId"] = f"nd.street.{role}"
    root["assetRole"] = role
    root["lod"] = lod
    root["district"] = "glasshouse"

    if role == "bridge":
        add_bridge(detail, mats)
    elif role == "tunnel":
        add_tunnel(detail, mats)
    elif role == "rooftop":
        add_rooftop(detail, mats)
    elif role == "destination":
        add_rooftop(detail, mats, destination=True)
    else:
        road_width = 11.2 if role == "alley" else 16.0
        add_route_surface(detail, mats, width=road_width)
        if role == "crossroads":
            add_cross_street(detail, mats, 38.0)
        elif role == "t-junction":
            add_cross_street(detail, mats, 32.0, y=4.1)
        elif role == "corner-left":
            add_cross_street(detail, mats, 22.0, y=2.0, one_sided=True)
        elif role == "corner-right":
            add_cross_street(detail, mats, 22.0, y=-2.0, one_sided=True)
            for obj in bpy.context.scene.objects:
                if obj.name.startswith("CrossStreet") or obj.name.startswith("Crosswalk"):
                    obj.location.x *= -1
        elif role == "ramp-up":
            add_box("RampApproach", (0, 2.0, 0.48), (13.6, 10.0, 0.28), mats["metal"], bevel=0.08, rotation=(math.radians(5.5), 0, 0))
        elif role == "ramp-down":
            add_box("RampApproach", (0, 2.0, 0.48), (13.6, 10.0, 0.28), mats["metal"], bevel=0.08, rotation=(math.radians(-5.5), 0, 0))
        if role in ("crossroads", "t-junction", "corner-left", "corner-right"):
            add_intersection_city(role, detail, mats)
        else:
            add_standard_city(detail, mats, alley=role == "alley")

    merge_environment_meshes(root)
    output = ENVIRONMENT_ROOT / f"{role.replace('-', '_')}_{lod}.glb"
    export_glb(output, animations=False)
    REPORT["environment"].append(asset_report(output, role=role, lod=lod))


def merge_environment_meshes(root: bpy.types.Object) -> None:
    """Batch static meshes by material to keep mobile draw calls bounded."""
    groups: dict[str, list[bpy.types.Object]] = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or obj == root:
            continue
        material_name = obj.data.materials[0].name if len(obj.data.materials) else "unassigned"
        groups.setdefault(material_name, []).append(obj)
    for material_name, objects in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        joined = bpy.context.object
        joined.name = f"ND_Batch_{material_name}"
        joined.data.name = joined.name
        joined["batchedMaterial"] = material_name
        joined.parent = root


def dash_materials() -> dict[str, bpy.types.Material]:
    return {
        "skin": material("Dash_Skin", PALETTE["skin_light"], roughness=0.54),
        "hair": material("Dash_Hair", PALETTE["hair"], metallic=0.16, roughness=0.32),
        "jacket": material("Dash_Jacket", PALETTE["jacket"], metallic=0.22, roughness=0.34),
        "panel": material("Dash_JacketPanel", PALETTE["jacket_panel"], metallic=0.34, roughness=0.28),
        "trouser": material("Dash_Trouser", PALETTE["trouser"], metallic=0.1, roughness=0.48),
        "shoe": material("Dash_Shoe", PALETTE["shoe"], metallic=0.28, roughness=0.28),
        "cyan": material("Dash_CyanTrim", (0.01, 0.22, 0.3, 1.0), metallic=0.25, roughness=0.24, emission=PALETTE["cyan"], emission_strength=1.5),
        "magenta": material("Dash_MagentaTrim", (0.25, 0.01, 0.12, 1.0), metallic=0.22, roughness=0.26, emission=PALETTE["magenta"], emission_strength=1.35),
        "white": material("Dash_Eye", PALETTE["white"], roughness=0.3, emission=PALETTE["cyan"], emission_strength=0.12),
    }


def create_dash_armature() -> bpy.types.Object:
    armature_data = bpy.data.armatures.new("Dash_Rig")
    armature = bpy.data.objects.new("Dash_Rig", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones: dict[str, bpy.types.EditBone] = {}

    def bone(name: str, head, tail, parent: str | None = None) -> None:
        created = armature_data.edit_bones.new(name)
        created.head = head
        created.tail = tail
        if parent:
            created.parent = bones[parent]
        bones[name] = created

    bone("root", (0, 0, 0), (0, 0, 0.35))
    bone("hips", (0, 0, 0.82), (0, 0, 1.17), "root")
    bone("spine", (0, 0, 1.10), (0, 0, 1.78), "hips")
    bone("head", (0, 0, 1.68), (0, 0, 2.34), "spine")
    for side, x in (("L", -0.24), ("R", 0.24)):
        bone(f"upper_leg.{side}", (x, 0, 1.02), (x, 0, 0.58), "hips")
        bone(f"lower_leg.{side}", (x, 0, 0.60), (x, 0, 0.20), f"upper_leg.{side}")
        bone(f"foot.{side}", (x, 0, 0.20), (x, -0.35, 0.13), f"lower_leg.{side}")
    for side, x in (("L", -0.52), ("R", 0.52)):
        bone(f"upper_arm.{side}", (x, 0, 1.63), (x * 1.2, 0, 1.22), "spine")
        bone(f"lower_arm.{side}", (x * 1.2, 0, 1.24), (x * 1.08, -0.04, 0.88), f"upper_arm.{side}")
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    armature["assetId"] = "character.dash"
    armature["forwardAxis"] = "+z"
    armature["rootMotion"] = False
    return armature


def parent_to_bone(obj: bpy.types.Object, armature: bpy.types.Object, bone_name: str) -> None:
    world_matrix = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world_matrix
    obj["dashBone"] = bone_name


def add_limb(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    vertices: int,
) -> bpy.types.Object:
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    midpoint = (start_vector + end_vector) * 0.5
    obj = add_cylinder(name, midpoint, radius, direction.length, mat, vertices=vertices, bevel=radius * 0.22)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
    return obj


def build_dash_mesh(armature: bpy.types.Object) -> None:
    mats = dash_materials()
    torso = add_box("Dash_Torso", (0, 0, 1.43), (0.82, 0.42, 0.72), mats["jacket"], bevel=0.15)
    hips = add_box("Dash_Hips", (0, 0, 1.02), (0.62, 0.38, 0.28), mats["trouser"], bevel=0.1)
    chest_panel = add_box("Dash_ChestTrim", (0, -0.225, 1.48), (0.38, 0.045, 0.32), mats["cyan"], bevel=0.03)
    collar = add_box("Dash_Collar", (0, 0, 1.74), (0.7, 0.42, 0.16), mats["panel"], bevel=0.07)
    backpack = add_box("Dash_Backpack", (0, 0.30, 1.42), (0.62, 0.25, 0.72), mats["panel"], bevel=0.13)
    backpack_mark = add_box("Dash_BackpackMark", (0, 0.435, 1.43), (0.32, 0.035, 0.22), mats["magenta"], bevel=0.03)
    for obj, bone in ((torso, "spine"), (chest_panel, "spine"), (collar, "spine"), (backpack, "spine"), (backpack_mark, "spine"), (hips, "hips")):
        parent_to_bone(obj, armature, bone)

    head = add_sphere("Dash_Head", (0, -0.035, 2.02), (0.36, 0.31, 0.42), mats["skin"], subdivisions=3)
    hair_cap = add_sphere("Dash_HairCap", (0, 0.015, 2.20), (0.39, 0.32, 0.25), mats["hair"], subdivisions=2)
    parent_to_bone(head, armature, "head")
    parent_to_bone(hair_cap, armature, "head")
    for index, x in enumerate((-0.25, -0.1, 0.08, 0.24)):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.11, radius2=0.025, depth=0.34, location=(x, -0.035 + abs(x) * 0.12, 2.43 - abs(x) * 0.2), rotation=(math.radians(-13), math.radians(x * 70), math.radians(x * 20)))
        tuft = bpy.context.object
        tuft.name = f"Dash_HairTuft_{index}"
        tuft.data.materials.append(mats["hair"])
        parent_to_bone(tuft, armature, "head")
    for side, x in (("L", -0.145), ("R", 0.145)):
        eye = add_sphere(f"Dash_Eye_{side}", (x, -0.305, 2.075), (0.075, 0.032, 0.048), mats["white"], subdivisions=2)
        brow = add_box(f"Dash_Brow_{side}", (x, -0.338, 2.16), (0.19, 0.035, 0.045), mats["hair"], bevel=0.015, rotation=(0, math.radians(side == "L" and -8 or 8), math.radians(side == "L" and -8 or 8)))
        parent_to_bone(eye, armature, "head")
        parent_to_bone(brow, armature, "head")

    for side, x, sign in (("L", -0.24, -1), ("R", 0.24, 1)):
        upper_leg = add_limb(f"Dash_UpperLeg_{side}", (x, 0, 1.0), (x, 0.02, 0.62), 0.16, mats["trouser"], 10)
        lower_leg = add_limb(f"Dash_LowerLeg_{side}", (x, 0.02, 0.61), (x, -0.02, 0.23), 0.13, mats["trouser"], 10)
        shoe = add_box(f"Dash_Shoe_{side}", (x, -0.17, 0.16), (0.34, 0.52, 0.22), mats["shoe"], bevel=0.08)
        sole = add_box(f"Dash_Sole_{side}", (x, -0.2, 0.055), (0.36, 0.56, 0.07), mats["magenta"], bevel=0.025)
        parent_to_bone(upper_leg, armature, f"upper_leg.{side}")
        parent_to_bone(lower_leg, armature, f"lower_leg.{side}")
        parent_to_bone(shoe, armature, f"foot.{side}")
        parent_to_bone(sole, armature, f"foot.{side}")
        upper_arm = add_limb(f"Dash_UpperArm_{side}", (sign * 0.52, 0, 1.6), (sign * 0.62, 0, 1.25), 0.12, mats["jacket"], 10)
        lower_arm = add_limb(f"Dash_LowerArm_{side}", (sign * 0.62, 0, 1.24), (sign * 0.56, -0.04, 0.91), 0.105, mats["panel"], 10)
        hand = add_sphere(f"Dash_Hand_{side}", (sign * 0.56, -0.045, 0.84), (0.125, 0.105, 0.14), mats["skin"], subdivisions=2)
        parent_to_bone(upper_arm, armature, f"upper_arm.{side}")
        parent_to_bone(lower_arm, armature, f"lower_arm.{side}")
        parent_to_bone(hand, armature, f"lower_arm.{side}")


def reset_dash_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0, 0, 0)
        pose_bone.location = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def key_dash_pose(
    armature: bpy.types.Object,
    frame: int,
    rotations: dict[str, tuple[float, float, float]],
    locations: dict[str, tuple[float, float, float]] | None = None,
) -> None:
    reset_dash_pose(armature)
    for name, degrees in rotations.items():
        armature.pose.bones[name].rotation_euler = tuple(math.radians(value) for value in degrees)
    for name, location in (locations or {}).items():
        armature.pose.bones[name].location = location
    for pose_bone in armature.pose.bones:
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
        pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)


def create_action(
    armature: bpy.types.Object,
    name: str,
    frames: list[tuple[int, dict[str, tuple[float, float, float]], dict[str, tuple[float, float, float]]]],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame, rotations, locations in frames:
        key_dash_pose(armature, frame, rotations, locations)
    if hasattr(action, "fcurves"):
        for curve in action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
    action["nightDropClip"] = name
    return action


def build_dash_actions(armature: bpy.types.Object) -> list[str]:
    neutral: dict[str, tuple[float, float, float]] = {}
    actions: list[tuple[str, list[tuple[int, dict, dict]]]] = [
        ("Dash_Idle", [
            (1, {"spine": (2, 0, 0), "upper_arm.L": (-6, 0, -4), "upper_arm.R": (-6, 0, 4)}, {"hips": (0, 0, 0)}),
            (24, {"spine": (-1, 0, 1.5), "head": (1, 0, -3), "upper_arm.L": (-3, 0, -3), "upper_arm.R": (-8, 0, 3)}, {"hips": (0, 0, 0.035)}),
            (48, {"spine": (2, 0, 0), "upper_arm.L": (-6, 0, -4), "upper_arm.R": (-6, 0, 4)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Start", [
            (1, {"spine": (0, 0, 0)}, {"hips": (0, 0, 0)}),
            (8, {"spine": (12, 0, 0), "upper_leg.L": (-22, 0, 0), "upper_leg.R": (14, 0, 0), "upper_arm.L": (20, 0, 0), "upper_arm.R": (-20, 0, 0)}, {"hips": (0, 0, -0.05)}),
            (16, {"spine": (8, 0, 0), "upper_leg.L": (34, 0, 0), "upper_leg.R": (-34, 0, 0), "upper_arm.L": (-32, 0, 0), "upper_arm.R": (32, 0, 0)}, {"hips": (0, 0, 0.04)}),
            (24, {"spine": (7, 0, 0), "upper_leg.L": (-38, 0, 0), "upper_leg.R": (38, 0, 0), "upper_arm.L": (34, 0, 0), "upper_arm.R": (-34, 0, 0)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Run", [
            (1, {"spine": (7, 0, 0), "upper_leg.L": (-38, 0, 0), "lower_leg.L": (20, 0, 0), "upper_leg.R": (38, 0, 0), "lower_leg.R": (-18, 0, 0), "upper_arm.L": (34, 0, 0), "upper_arm.R": (-34, 0, 0)}, {"hips": (0, 0, 0)}),
            (6, {"spine": (8, 0, 0), "upper_leg.L": (0, 0, 0), "lower_leg.L": (30, 0, 0), "upper_leg.R": (0, 0, 0), "lower_leg.R": (28, 0, 0)}, {"hips": (0, 0, 0.07)}),
            (11, {"spine": (7, 0, 0), "upper_leg.L": (38, 0, 0), "lower_leg.L": (-18, 0, 0), "upper_leg.R": (-38, 0, 0), "lower_leg.R": (20, 0, 0), "upper_arm.L": (-34, 0, 0), "upper_arm.R": (34, 0, 0)}, {"hips": (0, 0, 0)}),
            (16, {"spine": (8, 0, 0), "upper_leg.L": (0, 0, 0), "lower_leg.L": (28, 0, 0), "upper_leg.R": (0, 0, 0), "lower_leg.R": (30, 0, 0)}, {"hips": (0, 0, 0.07)}),
            (21, {"spine": (7, 0, 0), "upper_leg.L": (-38, 0, 0), "lower_leg.L": (20, 0, 0), "upper_leg.R": (38, 0, 0), "lower_leg.R": (-18, 0, 0), "upper_arm.L": (34, 0, 0), "upper_arm.R": (-34, 0, 0)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Stop", [
            (1, {"spine": (7, 0, 0), "upper_leg.L": (-30, 0, 0), "upper_leg.R": (30, 0, 0)}, {"hips": (0, 0, 0)}),
            (10, {"spine": (-10, 0, 0), "upper_leg.L": (18, 0, 0), "upper_leg.R": (-12, 0, 0), "upper_arm.L": (-20, 0, 0), "upper_arm.R": (-20, 0, 0)}, {"hips": (0, 0, -0.06)}),
            (24, neutral, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Jump", [
            (1, {"spine": (8, 0, 0)}, {"hips": (0, 0, 0)}),
            (8, {"spine": (18, 0, 0), "upper_leg.L": (32, 0, 0), "upper_leg.R": (24, 0, 0), "lower_leg.L": (-45, 0, 0), "lower_leg.R": (-38, 0, 0), "upper_arm.L": (-32, 0, 0), "upper_arm.R": (-32, 0, 0)}, {"hips": (0, 0, 0.18)}),
            (16, {"spine": (-4, 0, 0), "upper_leg.L": (20, 0, 0), "upper_leg.R": (-8, 0, 0), "lower_leg.L": (-55, 0, 0), "lower_leg.R": (-48, 0, 0), "upper_arm.L": (52, 0, 0), "upper_arm.R": (52, 0, 0)}, {"hips": (0, 0, 0.48)}),
            (24, {"spine": (8, 0, 0), "upper_leg.L": (-18, 0, 0), "upper_leg.R": (18, 0, 0), "lower_leg.L": (18, 0, 0), "lower_leg.R": (18, 0, 0)}, {"hips": (0, 0, 0.19)}),
            (32, {"spine": (7, 0, 0)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Slide", [
            (1, {"spine": (8, 0, 0)}, {"hips": (0, 0, 0)}),
            (8, {"spine": (48, 0, 0), "upper_leg.L": (45, 0, 0), "upper_leg.R": (-12, 0, 0), "lower_leg.L": (-65, 0, 0), "lower_leg.R": (22, 0, 0), "upper_arm.L": (-30, 0, 0), "upper_arm.R": (-18, 0, 0)}, {"hips": (0, -0.02, -0.34)}),
            (20, {"spine": (44, 0, 0), "upper_leg.L": (32, 0, 0), "upper_leg.R": (-5, 0, 0), "lower_leg.L": (-58, 0, 0), "upper_arm.L": (-18, 0, 0), "upper_arm.R": (-24, 0, 0)}, {"hips": (0, 0, -0.36)}),
            (30, {"spine": (7, 0, 0)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Dodge_L", [
            (1, {"spine": (7, 0, 0)}, {"hips": (0, 0, 0)}),
            (10, {"spine": (7, -10, -14), "head": (0, 0, 8), "upper_arm.L": (24, 0, 0), "upper_arm.R": (-18, 0, 0)}, {"hips": (-0.28, 0, 0.03)}),
            (20, {"spine": (7, 0, 0)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Dodge_R", [
            (1, {"spine": (7, 0, 0)}, {"hips": (0, 0, 0)}),
            (10, {"spine": (7, 10, 14), "head": (0, 0, -8), "upper_arm.L": (-18, 0, 0), "upper_arm.R": (24, 0, 0)}, {"hips": (0.28, 0, 0.03)}),
            (20, {"spine": (7, 0, 0)}, {"hips": (0, 0, 0)}),
        ]),
        ("Dash_Turn_L", [
            (1, {"spine": (7, 0, 0)}, {}),
            (9, {"hips": (0, 0, 24), "spine": (7, 0, 34), "head": (0, 0, -14), "upper_arm.L": (28, 0, 0), "upper_arm.R": (-26, 0, 0)}, {}),
            (18, {"spine": (7, 0, 0)}, {}),
        ]),
        ("Dash_Turn_R", [
            (1, {"spine": (7, 0, 0)}, {}),
            (9, {"hips": (0, 0, -24), "spine": (7, 0, -34), "head": (0, 0, 14), "upper_arm.L": (-26, 0, 0), "upper_arm.R": (28, 0, 0)}, {}),
            (18, {"spine": (7, 0, 0)}, {}),
        ]),
        ("Dash_Collect", [
            (1, {"spine": (7, 0, 0)}, {}),
            (9, {"spine": (2, 0, -8), "upper_arm.R": (62, 0, -18), "lower_arm.R": (-72, 0, 0), "head": (0, 0, -8)}, {"hips": (0.03, 0, 0.04)}),
            (18, {"spine": (7, 0, 0)}, {}),
        ]),
        ("Dash_Stumble", [
            (1, {"spine": (7, 0, 0)}, {}),
            (7, {"spine": (28, 0, 18), "head": (-12, 0, -14), "upper_arm.L": (-58, 0, 20), "upper_arm.R": (-42, 0, -18), "upper_leg.L": (16, 0, 0)}, {"hips": (0.12, 0, -0.12)}),
            (15, {"spine": (19, 0, -12), "head": (8, 0, 12), "upper_arm.L": (-26, 0, 0), "upper_arm.R": (-52, 0, 0)}, {"hips": (-0.08, 0, -0.05)}),
            (28, {"spine": (7, 0, 0)}, {}),
        ]),
        ("Dash_Celebrate", [
            (1, {"spine": (0, 0, 0)}, {}),
            (12, {"spine": (-10, 0, 0), "upper_arm.L": (118, 0, -12), "lower_arm.L": (-32, 0, 0), "upper_arm.R": (118, 0, 12), "lower_arm.R": (-32, 0, 0)}, {"hips": (0, 0, 0.14)}),
            (24, {"spine": (-4, 0, 8), "head": (0, 0, -8), "upper_arm.L": (92, 0, -28), "upper_arm.R": (122, 0, 18)}, {"hips": (0, 0, 0.05)}),
            (36, {"spine": (-4, 0, -8), "head": (0, 0, 8), "upper_arm.L": (122, 0, -18), "upper_arm.R": (92, 0, 28)}, {"hips": (0, 0, 0.12)}),
            (48, {"spine": (0, 0, 0)}, {}),
        ]),
    ]
    names: list[str] = []
    for name, frames in actions:
        create_action(armature, name, frames)
        names.append(name)
    reset_dash_pose(armature)
    armature.animation_data.action = bpy.data.actions.get("Dash_Idle")
    return names


def build_dash() -> None:
    reset_scene()
    armature = create_dash_armature()
    build_dash_mesh(armature)
    animation_names = build_dash_actions(armature)
    output = DASH_ROOT / "dash.glb"
    export_glb(output, animations=True)
    character_report = asset_report(output, role="character.dash", lod="production")
    character_report["animations"] = animation_names
    character_report["bones"] = len(armature.data.bones)
    REPORT["character"] = character_report


def export_glb(path: Path, *, animations: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    kwargs = {
        "filepath": str(path),
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": True,
        "export_animations": animations,
        "export_extras": True,
        "export_cameras": False,
        "export_lights": False,
    }
    if animations:
        kwargs.update({
            "export_animation_mode": "ACTIONS",
            "export_frame_range": True,
            "export_force_sampling": True,
        })
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_animation_mode", None)
        kwargs.pop("export_force_sampling", None)
        bpy.ops.export_scene.gltf(**kwargs)
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"Blender did not create {path}")


def asset_report(path: Path, *, role: str, lod: str) -> dict[str, object]:
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    return {
        "role": role,
        "lod": lod,
        "path": str(path.relative_to(APP_ROOT / "public")),
        "bytes": path.stat().st_size,
        "meshObjects": len(objects),
        "triangles": triangles,
    }


def create_texture_maps() -> None:
    definitions = {
        "wet-asphalt": ((0.018, 0.038, 0.055), 0.34, (0.0, 0.035, 0.05)),
        "city-concrete": ((0.075, 0.095, 0.11), 0.66, (0.0, 0.0, 0.0)),
        "neon-glass": ((0.02, 0.16, 0.21), 0.22, (0.0, 0.52, 0.72)),
        "rooftop-metal": ((0.035, 0.06, 0.08), 0.4, (0.0, 0.08, 0.1)),
    }
    size = 128
    for slug, (base, roughness, emissive) in definitions.items():
        outputs: dict[str, str] = {}
        for map_name in ("albedo", "normal", "roughness", "emissive"):
            image = bpy.data.images.new(f"{slug}_{map_name}", width=size, height=size, alpha=True, float_buffer=False)
            pixels: list[float] = []
            for y in range(size):
                for x in range(size):
                    noise = (math.sin(x * 1.71 + y * 2.37) + math.sin(x * 0.31 - y * 0.47)) * 0.018
                    if map_name == "albedo":
                        values = tuple(max(0.0, min(1.0, value + noise)) for value in base)
                    elif map_name == "normal":
                        values = (0.5 + noise * 0.3, 0.5 - noise * 0.2, 1.0)
                    elif map_name == "roughness":
                        value = max(0.0, min(1.0, roughness + noise * 1.8))
                        values = (value, value, value)
                    else:
                        band = 1.0 if slug == "neon-glass" and (x // 16 + y // 16) % 7 == 0 else 0.18
                        values = tuple(value * band for value in emissive)
                    pixels.extend((*values, 1.0))
            image.pixels.foreach_set(pixels)
            output = MATERIAL_ROOT / f"{slug}_{map_name}.webp"
            image.filepath_raw = str(output)
            image.file_format = "WEBP"
            image.save()
            outputs[map_name] = str(output.relative_to(APP_ROOT / "public"))
            bpy.data.images.remove(image)
        REPORT["materials"].append({"id": slug, "resolution": size, "maps": outputs})


def main() -> None:
    ensure_directories()
    create_texture_maps()
    for role in ROLES:
        for lod in LOD_DETAIL:
            build_environment(role, lod)
            print(f"Generated {role} {lod}")
    build_dash()
    REPORT_PATH.write_text(json.dumps(REPORT, indent=2) + "\n", encoding="utf-8")
    print(f"Generated Night Drop production pack at {ASSET_ROOT}")
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
