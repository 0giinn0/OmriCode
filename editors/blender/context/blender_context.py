"""Blender scene context builder for OmriCode AI.

Gathers current scene state — objects, selection, materials, modifiers,
viewport mode, render engine, workspace — and assembles a system prompt
that informs the LLM about the 3D scene it is helping to manipulate.
"""

from __future__ import annotations

from typing import Any

import bpy


class BlenderContextBuilder:
    """Builds a system prompt describing the current Blender scene.

    Usage::

        builder = BlenderContextBuilder()
        prompt = builder.build_system_prompt()
    """

    def __init__(self) -> None:
        self._scene = bpy.context.scene
        self._data = bpy.data

    # ── Public API ───────────────────────────────────────────────

    def build_system_prompt(self) -> str:
        """Assemble a full system prompt from the current scene context.

        Returns:
            A multi-line string describing the scene for the LLM.
        """
        lines: list[str] = [
            "You are OmriCode AI, a helpful AI assistant integrated into Blender 3D.",
            "You can read and modify the current scene using the tools available to you.",
            "",
            "## Current Scene Context",
            self._scene_header(),
            "",
            self._objects_section(),
            "",
            self._materials_section(),
            "",
            self._selection_section(),
            "",
            self._modifiers_section(),
            "",
            "## Available Tools",
            self._tool_help(),
            "",
            "## Instructions",
            "- Use the tools to explore and modify the scene.",
            "- Always get_scene_info() first to understand what's in the scene.",
            "- When creating objects, place them at reasonable locations.",
            "- Use modify_object() to set location, rotation, scale.",
            "- Confirm destructive operations (write_file, run_script) with the user.",
            "- Format SEARCH/REPLACE edits using <<<<<<< SEARCH / ======= / >>>>>>> REPLACE.",
            "- Respond conversationally after each action.",
            "- If you need to ask the user something, use ask_user().",
            "",
            "Begin!",
        ]
        return "\n".join(lines)

    # ── Section builders ─────────────────────────────────────────

    def _scene_header(self) -> str:
        """Basic scene metadata."""
        ws = bpy.context.workspace
        try:
            mode = bpy.context.mode
        except Exception:
            mode = "OBJECT"
        return (
            f"Scene: {self._scene.name}\n"
            f"Render Engine: {self._scene.render.engine}\n"
            f"Frame: {self._scene.frame_current}/{self._scene.frame_end}\n"
            f"Workspace: {ws.name if ws else 'N/A'}\n"
            f"Viewport Mode: {mode}"
        )

    def _objects_section(self) -> str:
        """List objects in the scene (up to 50)."""
        objs = self._data.objects
        lines = [f"### Objects ({len(objs)} total, showing up to 50)"]
        count = 0
        for obj in objs:
            if count >= 50:
                lines.append(f"... and {len(objs) - 50} more")
                break
            count += 1
            loc = obj.location
            parts = [f"- [{obj.type}] {obj.name} @ ({loc.x:.3f}, {loc.y:.3f}, {loc.z:.3f})"]
            if obj.active_material:
                parts.append(f" mat={obj.active_material.name}")
            if obj.parent:
                parts.append(f" parent={obj.parent.name}")
            if obj.type == "MESH" and obj.data:
                mesh = obj.data
                parts.append(f" [V:{len(mesh.vertices)} F:{len(mesh.polygons)}]")
            lines.append("".join(parts))
        return "\n".join(lines)

    def _materials_section(self) -> str:
        """List all materials."""
        mats = self._data.materials
        items = [f"  {m.name}" for m in mats]
        return f"### Materials ({len(mats)})\n" + "\n".join(items) if items else "### Materials\n  (none)"

    def _selection_section(self) -> str:
        """List selected objects."""
        sel = bpy.context.selected_objects
        items = [f"  {o.name}" for o in sel]
        return f"### Selected ({len(sel)})\n" + "\n".join(items) if items else "### Selected\n  (none)"

    def _modifiers_section(self) -> str:
        """List modifiers on all objects (up to 30 entries)."""
        lines = ["### Modifiers"]
        count = 0
        for obj in self._data.objects:
            for mod in obj.modifiers:
                if count >= 30:
                    break
                lines.append(f"  {obj.name} → {mod.type} ({mod.name})")
                count += 1
            if count >= 30:
                lines.append("  ... (truncated)")
                break
        if count == 0:
            lines.append("  (none)")
        return "\n".join(lines)

    @staticmethod
    def _tool_help() -> str:
        """Return a brief listing of available tool names."""
        return (
            "read_file, write_file, edit_file, grep, glob, list_directory, "
            "get_selection, get_scene_info, modify_object, create_mesh, "
            "run_script, ask_user"
        )
