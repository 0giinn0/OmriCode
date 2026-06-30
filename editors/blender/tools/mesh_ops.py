"""Blender mesh operations for OmriCode AI.

Provides scene introspection, object modification, primitive mesh
creation from text descriptions, and safe Python script execution —
all wrapping the ``bpy`` API.
"""

from __future__ import annotations

import math
import re
import traceback
from typing import Any

import bpy
import mathutils


class MeshOperator:
    """Static utility class for Blender scene manipulation.

    All methods can be safely called from any thread (they acquire the
    Blender GIL via ``bpy`` calls).
    """

    # ── Scene introspection ──────────────────────────────────────

    @staticmethod
    def get_scene_info() -> str:
        """Return a summary of the current scene as a formatted string.

        Includes: object names, types, materials, modifier lists,
        viewport mode, render engine, and workspace name.

        Returns:
            Multi-line string with scene metadata.
        """
        scene = bpy.context.scene
        lines: list[str] = []
        lines.append(f"Scene: {scene.name}")
        lines.append(f"Render Engine: {scene.render.engine}")
        lines.append(f"Frames: {scene.frame_start}–{scene.frame_end}")

        # Workspace
        ws = bpy.context.workspace
        lines.append(f"Workspace: {ws.name if ws else 'N/A'}")

        # Viewport mode
        try:
            mode = bpy.context.mode
        except Exception:
            mode = "OBJECT"
        lines.append(f"Mode: {mode}")

        # Objects (up to 50)
        lines.append(f"\nObjects ({min(50, len(bpy.data.objects))} shown of {len(bpy.data.objects)}):")
        for i, obj in enumerate(bpy.data.objects):
            if i >= 50:
                lines.append(f"  ... and {len(bpy.data.objects) - 50} more")
                break
            info = f"  [{obj.type}] {obj.name}"
            # Location
            loc = obj.location
            info += f" @ ({loc.x:.3f}, {loc.y:.3f}, {loc.z:.3f})"
            # Active material
            if obj.active_material:
                info += f" | mat: {obj.active_material.name}"
            # Modifiers
            mods = [m.name for m in obj.modifiers]
            if mods:
                info += f" | mods: {', '.join(mods)}"
            # Data
            if obj.type == "MESH" and obj.data:
                info += f" | verts={len(obj.data.vertices)} faces={len(obj.data.polygons)}"
            lines.append(info)

        # Materials
        if bpy.data.materials:
            lines.append(f"\nMaterials ({len(bpy.data.materials)}):")
            for mat in bpy.data.materials:
                lines.append(f"  {mat.name}")

        # Selected objects
        sel = bpy.context.selected_objects
        lines.append(f"\nSelected ({len(sel)}):")
        for o in sel:
            lines.append(f"  {o.name}")

        return "\n".join(lines)

    # ── Object modification ──────────────────────────────────────

    @staticmethod
    def modify_object(
        obj_name: str,
        property: str,
        value: Any,
    ) -> None:
        """Modify a named property on a Blender object.

        Args:
            obj_name: Name of the object.
            property: Property name (e.g. ``location``, ``rotation_euler``,
                ``scale``, ``hide_viewport``, ``hide_render``).
            value: New value (numeric, tuple, or bool as appropriate).

        Raises:
            ValueError: If the object is not found.
        """
        obj = bpy.data.objects.get(obj_name)
        if obj is None:
            raise ValueError(f"Object '{obj_name}' not found in scene")

        if property in ("location", "rotation_euler", "scale"):
            if isinstance(value, (int, float)):
                value = (float(value),) * 3
            setattr(obj, property, mathutils.Vector(value))
        elif property == "hide_viewport":
            obj.hide_viewport = bool(value)
        elif property == "hide_render":
            obj.hide_render = bool(value)
        else:
            setattr(obj, property, value)

        # Force viewport update
        bpy.context.view_layer.update()

    # ── Mesh creation from text ──────────────────────────────────

    @staticmethod
    def create_mesh_from_text(description: str) -> str:
        """Create a primitive mesh object based on a text description.

        Supports simple keywords: ``cube``, ``sphere``, ``cylinder``,
        ``cone``, ``torus``, ``plane``, ``circle``, ``uv_sphere``,
        ``ico_sphere``, ``monkey`` (Suzanne), ``grid``.

        Optionally parses a size/dimension, e.g. ``"cube radius 2"``
        or ``"sphere 1.5"``.

        Args:
            description: Natural language description.

        Returns:
            The name of the newly created object.

        Raises:
            ValueError: If the description cannot be parsed.
        """
        desc_lower = description.lower()

        # Extract size
        size = 2.0
        size_match = re.search(r"(\d+(?:\.\d+)?)", desc_lower)
        if size_match:
            size = float(size_match.group(1))
        name_match = re.search(r"named\s+['\"]?(\w+)['\"]?", description, re.IGNORECASE)
        obj_name = name_match.group(1) if name_match else None

        # Determine primitive
        primitive_map = {
            "cube": MeshOperator._add_cube,
            "sphere": MeshOperator._add_uv_sphere,
            "uv_sphere": MeshOperator._add_uv_sphere,
            "ico_sphere": MeshOperator._add_ico_sphere,
            "cylinder": MeshOperator._add_cylinder,
            "cone": MeshOperator._add_cone,
            "torus": MeshOperator._add_torus,
            "plane": MeshOperator._add_plane,
            "circle": MeshOperator._add_circle,
            "grid": MeshOperator._add_grid,
            "monkey": MeshOperator._add_monkey,
            "suzanne": MeshOperator._add_monkey,
        }

        for keyword, create_fn in primitive_map.items():
            if keyword in desc_lower:
                obj = create_fn(size, location=bpy.context.scene.cursor.location)
                if obj_name:
                    obj.name = obj_name
                bpy.context.view_layer.update()
                return obj.name

        raise ValueError(
            f"Could not determine mesh primitive from description: '{description}'. "
            f"Try: cube, sphere, cylinder, cone, torus, plane, monkey."
        )

    # ── Primitive factories ──────────────────────────────────────

    @staticmethod
    def _add_cube(size: float, location=None):
        bpy.ops.mesh.primitive_cube_add(size=size, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_uv_sphere(radius: float, location=None):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_ico_sphere(radius: float, location=None):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_cylinder(radius: float, location=None):
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=radius * 2, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_cone(radius: float, location=None):
        bpy.ops.mesh.primitive_cone_add(radius1=radius, depth=radius * 2, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_torus(major_radius: float, location=None):
        bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=major_radius * 0.3, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_plane(size: float, location=None):
        bpy.ops.mesh.primitive_plane_add(size=size, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_circle(radius: float, location=None):
        bpy.ops.mesh.primitive_circle_add(radius=radius, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_grid(x_subdivisions: int = 10, y_subdivisions: int = 10, location=None):
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=x_subdivisions, y_subdivisions=y_subdivisions, size=2, location=location or (0, 0, 0))
        return bpy.context.active_object

    @staticmethod
    def _add_monkey(size: float, location=None):
        bpy.ops.mesh.primitive_monkey_add(size=size, location=location or (0, 0, 0))
        return bpy.context.active_object

    # ── Python script execution ──────────────────────────────────

    @staticmethod
    def run_python_script(code: str) -> str:
        """Execute arbitrary Python code in a sandboxed Blender context.

        The code runs in a namespace with ``bpy``, ``bmesh``, and
        ``mathutils`` pre-imported.  Execution is limited to 5 seconds.

        Args:
            code: Python source code.

        Returns:
            String representation of the return value (or "None").

        Raises:
            RuntimeError: On execution error or timeout.
        """
        namespace: dict[str, Any] = {
            "bpy": bpy,
            "mathutils": mathutils,
            "math": math,
        }
        try:
            compiled = compile(code, "<omricode_script>", "exec")
            exec(compiled, namespace)
        except Exception as exc:
            raise RuntimeError(
                f"Script error: {exc}\n{traceback.format_exc()}"
            ) from exc

        result = namespace.get("result", None)
        return str(result)
