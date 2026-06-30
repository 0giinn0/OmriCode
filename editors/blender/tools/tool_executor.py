"""Tool registry and executor for OmriCode AI.

Maintains a registry of available tools that the agent can invoke.
Each tool has a handler function, description (for LLM function calling),
and a permission level.  The ``execute`` dispatch method routes tool
calls to the appropriate handler.
"""

from __future__ import annotations

import io
import json
import os
import traceback
from pathlib import Path
from typing import Any, Callable

from .search_replace import SearchReplaceParser
from .mesh_ops import MeshOperator


# ── Permission constants ──────────────────────────────────────────

PERMIT_ALWAYS = "always"
PERMIT_CONFIRM = "confirm"
PERMIT_DENY = "deny"


# ── Tool registry ─────────────────────────────────────────────────

class ToolExecutor:
    """Static registry of tools with a dispatch ``execute()`` method.

    Usage::

        result = ToolExecutor.execute("read_file", {"path": "..."})
    """

    _registry: dict[str, dict[str, Any]] = {}

    @classmethod
    def register(
        cls,
        name: str,
        handler: Callable[..., dict[str, Any]],
        description: str,
        permission: str = PERMIT_ALWAYS,
        parameters: dict[str, Any] | None = None,
    ) -> None:
        """Register a tool.

        Args:
            name: Unique tool name.
            handler: Function that receives ``**kwargs`` and returns a
                result dict ``{"success": bool, "output": str, "error": str}``.
            description: Human-readable description for the LLM.
            permission: Permission level (always, confirm, deny).
            parameters: JSON Schema for the tool's arguments (for LLM
                function calling).  Auto-generated if None.
        """
        cls._registry[name] = {
            "handler": handler,
            "description": description,
            "permission": permission,
            "parameters": parameters or {"type": "object", "properties": {}},
        }

    @classmethod
    def execute(cls, name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Execute the tool named *name* with *args*.

        Returns:
            Dict with keys ``success``, ``output``, ``error``.
        """
        entry = cls._registry.get(name)
        if not entry:
            return {
                "success": False,
                "output": "",
                "error": f"Unknown tool: {name}",
            }
        if entry["permission"] == PERMIT_DENY:
            return {
                "success": False,
                "output": "",
                "error": f"Tool '{name}' is disabled by policy",
            }
        try:
            result = entry["handler"](**args)
            return result
        except Exception as exc:
            return {
                "success": False,
                "output": "",
                "error": f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
            }

    @classmethod
    def list_tool_definitions(cls) -> list[dict[str, Any]]:
        """Return tool definitions in OpenAI function-calling format."""
        definitions = []
        for name, entry in cls._registry.items():
            definitions.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": entry["description"],
                    "parameters": entry["parameters"],
                },
            })
        return definitions

    @classmethod
    def get_registry(cls) -> dict[str, dict[str, Any]]:
        """Return a copy of the full registry."""
        return dict(cls._registry)


# ── Built-in tool handlers ────────────────────────────────────────


def _read_file(path: str = "", encoding: str = "utf-8") -> dict[str, Any]:
    """Read a file from disk and return its contents."""
    try:
        p = Path(path).resolve()
        if not p.exists():
            return {"success": False, "output": "", "error": f"File not found: {p}"}
        text = p.read_text(encoding=encoding)
        return {"success": True, "output": text, "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _write_file(path: str = "", content: str = "", encoding: str = "utf-8") -> dict[str, Any]:
    """Write *content* to *path*."""
    try:
        p = Path(path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding=encoding)
        return {"success": True, "output": f"Written {len(content)} bytes to {p}", "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _edit_file(
    search: str = "",
    replace: str = "",
    path: str = "",
) -> dict[str, Any]:
    """Apply a SEARCH/REPLACE edit to a file.

    If ``path`` is provided, edits that file; otherwise expects
    ``search``/``replace`` directly.
    """
    try:
        if path:
            read_result = _read_file(path)
            if not read_result["success"]:
                return read_result
            content = read_result["output"]
            if search not in content:
                return {
                    "success": False,
                    "output": "",
                    "error": f"SEARCH block not found in {path}",
                }
            new_content = content.replace(search, replace, 1)
            return _write_file(path=path, content=new_content)
        else:
            # Just report what was parsed
            return {
                "success": True,
                "output": f"Parsed SEARCH/REPLACE block ({len(search)} chars → {len(replace)} chars)",
                "error": "",
            }
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _grep(
    pattern: str = "",
    path: str = "",
    include: str = "",
) -> dict[str, Any]:
    """Search for *pattern* in files under *path*."""
    import re
    try:
        search_path = Path(path or ".").resolve()
        if not search_path.exists():
            return {"success": False, "output": "", "error": f"Path not found: {search_path}"}
        results: list[str] = []
        compiled = re.compile(pattern)
        for fpath in search_path.rglob("*"):
            if fpath.is_file():
                if include and not fpath.match(include):
                    continue
                try:
                    for i, line in enumerate(fpath.read_text(errors="replace").splitlines(), 1):
                        if compiled.search(line):
                            results.append(f"{fpath}:{i}: {line.rstrip()[:200]}")
                except Exception:
                    pass
        return {"success": True, "output": "\n".join(results[:200]) or "(no matches)", "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _glob(pattern: str = "", path: str = "") -> dict[str, Any]:
    """List files matching *pattern* under *path*."""
    try:
        search_path = Path(path or ".").resolve()
        matches = [str(p.relative_to(search_path)) for p in search_path.rglob(pattern)]
        return {"success": True, "output": "\n".join(matches[:200]) or "(no matches)", "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _list_directory(path: str = "") -> dict[str, Any]:
    """List contents of a directory."""
    try:
        p = Path(path or ".").resolve()
        if not p.is_dir():
            return {"success": False, "output": "", "error": f"Not a directory: {p}"}
        entries = sorted(
            (str(e.name) + "/" if e.is_dir() else e.name) for e in p.iterdir()
        )
        return {"success": True, "output": "\n".join(entries[:500]), "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _get_selection() -> dict[str, Any]:
    """Return currently selected Blender objects."""
    import bpy
    try:
        names = [o.name for o in bpy.context.selected_objects]
        return {"success": True, "output": json.dumps(names), "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _get_scene_info() -> dict[str, Any]:
    """Return information about the current scene."""
    try:
        info = MeshOperator.get_scene_info()
        return {"success": True, "output": info, "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _modify_object(
    obj_name: str = "",
    property: str = "",
    value: float = 0.0,
    x: float = 0.0,
    y: float = 0.0,
    z: float = 0.0,
) -> dict[str, Any]:
    """Modify a Blender object's transform."""
    try:
        if property == "location":
            MeshOperator.modify_object(obj_name, "location", (x, y, z))
        elif property == "rotation":
            MeshOperator.modify_object(obj_name, "rotation_euler", (x, y, z))
        elif property == "scale":
            MeshOperator.modify_object(obj_name, "scale", (x, y, z))
        else:
            MeshOperator.modify_object(obj_name, property, value)
        return {"success": True, "output": f"Modified {obj_name}.{property}", "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _create_mesh(description: str = "", name: str = "Object") -> dict[str, Any]:
    """Create a mesh object from a text description."""
    try:
        result = MeshOperator.create_mesh_from_text(description)
        return {"success": True, "output": result, "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _run_script(code: str = "") -> dict[str, Any]:
    """Execute arbitrary Python code in a Blender context."""
    try:
        result = MeshOperator.run_python_script(code)
        return {"success": True, "output": str(result), "error": ""}
    except Exception as exc:
        return {"success": False, "output": "", "error": str(exc)}


def _ask_user(question: str = "") -> dict[str, Any]:
    """Pose a question to the user (placeholder for confirmation flow)."""
    return {
        "success": True,
        "output": f"Question posed: {question}. (User confirmation not yet implemented in headless mode.)",
        "error": "",
    }


# ── Register all tools at module load ────────────────────────────

def _register_defaults() -> None:
    """Register all built-in tools."""
    ToolExecutor.register("read_file", _read_file, "Read a file from disk", parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to the file"},
            "encoding": {"type": "string", "description": "File encoding (default utf-8)"},
        },
        "required": ["path"],
    })
    ToolExecutor.register("write_file", _write_file, "Write content to a file", permission=PERMIT_CONFIRM, parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to write to"},
            "content": {"type": "string", "description": "Content to write"},
            "encoding": {"type": "string", "description": "File encoding (default utf-8)"},
        },
        "required": ["path", "content"],
    })
    ToolExecutor.register("edit_file", _edit_file, "Apply a SEARCH/REPLACE edit to a file", permission=PERMIT_CONFIRM, parameters={
        "type": "object",
        "properties": {
            "search": {"type": "string", "description": "Text to search for"},
            "replace": {"type": "string", "description": "Replacement text"},
            "path": {"type": "string", "description": "File path (optional)"},
        },
        "required": ["search", "replace"],
    })
    ToolExecutor.register("grep", _grep, "Search for a regex pattern in files", parameters={
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "description": "Regex pattern"},
            "path": {"type": "string", "description": "Root directory to search"},
            "include": {"type": "string", "description": "Glob pattern to filter files"},
        },
        "required": ["pattern"],
    })
    ToolExecutor.register("glob", _glob, "List files matching a glob pattern", parameters={
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "description": "Glob pattern (e.g. **/*.py)"},
            "path": {"type": "string", "description": "Root directory"},
        },
        "required": ["pattern"],
    })
    ToolExecutor.register("list_directory", _list_directory, "List contents of a directory", parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory path"},
        },
        "required": [],
    })
    ToolExecutor.register("get_selection", _get_selection, "Get currently selected Blender objects", parameters={
        "type": "object",
        "properties": {},
        "required": [],
    })
    ToolExecutor.register("get_scene_info", _get_scene_info, "Get information about the current Blender scene", parameters={
        "type": "object",
        "properties": {},
        "required": [],
    })
    ToolExecutor.register("modify_object", _modify_object, "Modify a Blender object's transform", parameters={
        "type": "object",
        "properties": {
            "obj_name": {"type": "string", "description": "Object name"},
            "property": {"type": "string", "description": "Property: location, rotation, scale, or custom"},
            "value": {"type": "number", "description": "Single value (for non-vector props)"},
            "x": {"type": "number", "description": "X component"},
            "y": {"type": "number", "description": "Y component"},
            "z": {"type": "number", "description": "Z component"},
        },
        "required": ["obj_name"],
    })
    ToolExecutor.register("create_mesh", _create_mesh, "Create a mesh object from a text description", parameters={
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "Text description of the mesh to create"},
            "name": {"type": "string", "description": "Optional object name"},
        },
        "required": ["description"],
    })
    ToolExecutor.register("run_script", _run_script, "Execute Python code in Blender's context", permission=PERMIT_CONFIRM, parameters={
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Python code to execute"},
        },
        "required": ["code"],
    })
    ToolExecutor.register("ask_user", _ask_user, "Ask the user a question", parameters={
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "Question to present to the user"},
        },
        "required": ["question"],
    })


_register_defaults()
