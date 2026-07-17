"""Regenerate only the Night Drop PBR texture maps in Blender."""

from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE = SCRIPT_DIR / "generate-night_drop_runner_assets.py"
SPEC = importlib.util.spec_from_file_location("night_drop_runner_production", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {SOURCE}")
production = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(production)

production.ensure_directories()
production.create_texture_maps()
print(f"Regenerated Night Drop PBR maps at {production.MATERIAL_ROOT}")
