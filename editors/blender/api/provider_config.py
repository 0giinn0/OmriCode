"""Provider configuration for OmriCode AI.

Holds provider endpoint, model, and auth settings as a Blender
PropertyGroup so it is automatically persisted in scene data.  Provides
CRUD helpers for managing multiple named provider rows.
"""

from __future__ import annotations

from typing import Any

import bpy
from bpy.props import (
    BoolProperty,
    CollectionProperty,
    FloatProperty,
    IntProperty,
    StringProperty,
)
from bpy.types import PropertyGroup


class OmriCodeProviderRow(PropertyGroup):
    """A single provider entry with name, endpoint, model, and auth."""

    name: StringProperty(
        name="Name",
        description="Human-readable provider name",
        default="Ollama",
    )
    endpoint: StringProperty(
        name="Endpoint",
        description="API endpoint URL",
        default="http://localhost:11434/v1",
    )
    model: StringProperty(
        name="Model",
        description="Model identifier",
        default="nous-hermes-gguf",
    )
    api_key: StringProperty(
        name="API Key",
        description="API key (stored as plaintext in .blend)",
        default="",
        subtype="PASSWORD",
    )
    timeout: IntProperty(
        name="Timeout",
        default=60,
        min=5,
        max=300,
    )
    max_tokens: IntProperty(
        name="Max Tokens",
        default=4096,
        min=64,
        max=65536,
    )
    temperature: FloatProperty(
        name="Temperature",
        default=0.7,
        min=0.0,
        max=2.0,
        precision=2,
    )
    is_active: BoolProperty(
        name="Active",
        description="Use this provider as the active one",
        default=False,
    )


class OmriCodeProviderConfig(PropertyGroup):
    """Persistent provider configuration group stored on the scene.

    Provides CRUD helpers to manage multiple named provider rows as well
    as convenience properties that reflect the currently active row.
    """

    rows: CollectionProperty(
        type=OmriCodeProviderRow,
        name="Providers",
        description="List of configured LLM providers",
    )

    # ── Active-row aliases (read/write through the active row) ───

    @property
    def provider_name(self) -> str:
        return self._active_val("name", "Ollama")

    @provider_name.setter
    def provider_name(self, value: str) -> None:
        self._set_active_val("name", value)

    @property
    def endpoint(self) -> str:
        return self._active_val("endpoint", "http://localhost:11434/v1")

    @endpoint.setter
    def endpoint(self, value: str) -> None:
        self._set_active_val("endpoint", value)

    @property
    def model(self) -> str:
        return self._active_val("model", "nous-hermes-gguf")

    @model.setter
    def model(self, value: str) -> None:
        self._set_active_val("model", value)

    @property
    def api_key(self) -> str:
        return self._active_val("api_key", "")

    @api_key.setter
    def api_key(self, value: str) -> None:
        self._set_active_val("api_key", value)

    @property
    def timeout(self) -> int:
        return self._active_val("timeout", 60)

    @timeout.setter
    def timeout(self, value: int) -> None:
        self._set_active_val("timeout", value)

    @property
    def max_tokens(self) -> int:
        return self._active_val("max_tokens", 4096)

    @max_tokens.setter
    def max_tokens(self, value: int) -> None:
        self._set_active_val("max_tokens", value)

    @property
    def temperature(self) -> float:
        return self._active_val("temperature", 0.7)

    @temperature.setter
    def temperature(self, value: float) -> None:
        self._set_active_val("temperature", value)

    # ── Internal helpers ─────────────────────────────────────────

    def _active_row(self):
        """Return the active row or None."""
        for row in self.rows:
            if row.is_active:
                return row
        return None

    def _active_val(self, attr: str, default: Any) -> Any:
        row = self._active_row()
        return getattr(row, attr) if row else default

    def _set_active_val(self, attr: str, value: Any) -> None:
        row = self._active_row()
        if row:
            setattr(row, attr, value)

    # ── CRUD ─────────────────────────────────────────────────────

    def add_provider(
        self,
        name: str = "New Provider",
        endpoint: str = "http://localhost:11434/v1",
        model: str = "nous-hermes-gguf",
        api_key: str = "",
        timeout: int = 60,
        make_active: bool = False,
    ) -> OmriCodeProviderRow:
        """Create a new provider row.

        Args:
            name: Display name.
            endpoint: API base URL.
            model: Model identifier.
            api_key: API key.
            timeout: HTTP timeout in seconds.
            make_active: If True, set this row as active.

        Returns:
            The newly created row.
        """
        row = self.rows.add()
        row.name = name
        row.endpoint = endpoint
        row.model = model
        row.api_key = api_key
        row.timeout = timeout
        if make_active or len(self.rows) == 1:
            row.is_active = True
        return row

    def remove_provider(self, index: int) -> None:
        """Remove the provider row at *index* (0-based)."""
        if 0 <= index < len(self.rows):
            self.rows.remove(index)

    def get_active_provider(self) -> OmriCodeProviderRow | None:
        """Return the active provider row."""
        return self._active_row()

    def to_dict(self) -> dict[str, Any]:
        """Export active provider config as a plain dict."""
        row = self._active_row()
        if not row:
            return {}
        return {
            "provider_name": row.name,
            "endpoint": row.endpoint,
            "model": row.model,
            "api_key": row.api_key,
            "timeout": row.timeout,
            "max_tokens": row.max_tokens if hasattr(row, "max_tokens") else 4096,
            "temperature": row.temperature if hasattr(row, "temperature") else 0.7,
        }
