"""Add-on preferences panel for OmriCode AI.

Provides per-user configuration for endpoint URL, model name, API key,
max tokens, temperature, and provider selection.  Stored in Blender's
native add-on preferences system.
"""

import bpy
from bpy.props import (
    BoolProperty,
    EnumProperty,
    FloatProperty,
    IntProperty,
    StringProperty,
)
from bpy.types import AddonPreferences

ADDON_NAME = __package__.split(".")[0] if "." in __package__ else __package__


class OmriCodePreferences(AddonPreferences):
    """User preferences for the OmriCode AI add-on."""

    bl_idname = ADDON_NAME

    endpoint: StringProperty(
        name="Endpoint",
        description="LLM provider API endpoint (OpenAI / Ollama / Anthropic compatible)",
        default="http://localhost:11434/v1",
        subtype="NONE",
    )
    model: StringProperty(
        name="Model",
        description="Model name to use (e.g. gpt-4, claude-3, nous-hermes-gguf)",
        default="nous-hermes-gguf",
    )
    api_key: StringProperty(
        name="API Key",
        description="API key for authentication (leave blank if not required)",
        default="",
        subtype="PASSWORD",
    )
    max_tokens: IntProperty(
        name="Max Tokens",
        description="Maximum tokens per LLM response",
        default=4096,
        min=64,
        max=65536,
        soft_max=32768,
    )
    temperature: FloatProperty(
        name="Temperature",
        description="LLM sampling temperature (0.0 = deterministic, 2.0 = creative)",
        default=0.7,
        min=0.0,
        max=2.0,
        soft_min=0.0,
        soft_max=2.0,
        step=0.05,
        precision=2,
    )
    timeout: IntProperty(
        name="Timeout (s)",
        description="HTTP request timeout in seconds",
        default=60,
        min=5,
        max=300,
    )

    def draw(self, context):
        """Draw preferences UI."""
        layout = self.layout

        flow = layout.grid_flow(row_major=True, columns=2, even_columns=True, even_rows=False, align=True)

        col = flow.column(align=True)
        col.prop(self, "endpoint")
        col.prop(self, "model")
        col.prop(self, "api_key")

        col = flow.column(align=True)
        col.prop(self, "max_tokens")
        col.prop(self, "temperature")
        col.prop(self, "timeout")
