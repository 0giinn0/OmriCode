"""OmriCode AI - Blender 4.x add-on for AI-powered 3D scene manipulation.

Connects to LLM providers to enable natural-language-driven 3D editing
via a ReAct agent loop, tool execution, and context-aware prompting.
"""

import importlib
import pkgutil
import sys

import bpy
from bpy.props import (
    BoolProperty,
    FloatProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)
from bpy.types import PropertyGroup

bl_info = {
    "name": "OmriCode AI",
    "author": "Omer Bin Asif",
    "version": (0, 1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > OmriCode",
    "description": "AI agent for 3D scene manipulation via LLM providers",
    "category": "3D View",
}


def _reload_subpackages():
    """Reload all submodules to avoid stale bytecode during development."""
    prefix = __name__ + "."
    for importer, modname, ispkg in pkgutil.walk_packages(
        path=__path__, prefix=prefix, onerror=lambda x: None
    ):
        if modname in sys.modules:
            importlib.reload(sys.modules[modname])


_reload_subpackages()

# -------------------------------------------------------------------
# Lazy imports for submodules so circular deps are harmless at module level
# -------------------------------------------------------------------

from .api.provider_config import OmriCodeProviderConfig
from .api.http_client import OmriCodeHTTPClient
from .agent.agent_state import AgentState
from .agent.message_history import MessageHistory
from .agent.agent_loop import OmriCodeAgentLoop
from .context.blender_context import BlenderContextBuilder
from .memory.comment_index import CommentIndex
from .tools.tool_executor import ToolExecutor
from .tools.search_replace import SearchReplaceParser
from .tools.mesh_ops import MeshOperator


# -------------------------------------------------------------------
# Persistent global state for the add-on
# -------------------------------------------------------------------


class OmriCodeGlobalState(PropertyGroup):
    """PropertyGroup holding non-persistent runtime state for the agent."""

    session_active: BoolProperty(
        name="Session Active",
        description="Whether an agent session is currently running",
        default=False,
    )
    iteration_count: IntProperty(
        name="Iteration Count",
        description="Current loop iteration count",
        default=0,
        min=0,
        max=25,
    )
    status_text: StringProperty(
        name="Status",
        description="Current status label text",
        default="Ready",
    )
    chat_log: StringProperty(
        name="Chat Log",
        description="Full conversation log (plain text, newline-separated)",
        default="",
    )
    input_text: StringProperty(
        name="Input",
        description="User input text field",
        default="",
    )


# -------------------------------------------------------------------
# Registration helpers
# -------------------------------------------------------------------

_classes_to_register = []


def register_class(cls):
    """Register a Blender class and track it for unregistration."""
    _classes_to_register.append(cls)
    bpy.utils.register_class(cls)


def register():
    """Register all add-on classes, properties, and panels."""
    # Property groups
    register_class(OmriCodeGlobalState)
    register_class(OmriCodeProviderConfig)

    # Preferences
    from .ui.preferences import OmriCodePreferences

    register_class(OmriCodePreferences)

    # Operators
    from .ui.chat_panel import (
        OMRICODE_OT_send_message,
        OMRICODE_OT_test_connection,
        OMRICODE_OT_cancel_session,
    )

    register_class(OMRICODE_OT_send_message)
    register_class(OMRICODE_OT_test_connection)
    register_class(OMRICODE_OT_cancel_session)

    # Panels
    from .ui.chat_panel import VIEW3D_PT_omricode

    register_class(VIEW3D_PT_omricode)

    # Global pointer
    bpy.types.Scene.omricode_state = PointerProperty(type=OmriCodeGlobalState)
    bpy.types.Scene.omricode_provider = PointerProperty(type=OmriCodeProviderConfig)


def unregister():
    """Unregister all add-on classes and remove properties."""
    for cls in reversed(_classes_to_register):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass
    _classes_to_register.clear()

    try:
        del bpy.types.Scene.omricode_state
    except Exception:
        pass
    try:
        del bpy.types.Scene.omricode_provider
    except Exception:
        pass


if __name__ == "__main__":
    register()
