"""Chat panel UI for OmriCode AI add-on.

Provides a 3D View sidebar panel with chat log, input field, provider
selection, connection testing, and send/cancel controls.  Uses a dark
theme that matches the OmriCode portfolio aesthetic.
"""

import textwrap

import bpy
from bpy.types import Operator, Panel


# -------------------------------------------------------------------
# Operators
# -------------------------------------------------------------------


class OMRICODE_OT_send_message(Operator):
    """Send the current input text to the agent loop for processing."""

    bl_idname = "omricode.send_message"
    bl_label = "Send"
    bl_description = "Send message to the AI agent"

    def execute(self, context):
        state = context.scene.omricode_state
        text = state.input_text.strip()
        if not text:
            self.report({"WARNING"}, "No input text to send")
            return {"CANCELLED"}
        if state.session_active:
            self.report({"WARNING"}, "Session already in progress")
            return {"CANCELLED"}

        # Append user message to chat log
        _append_chat(state, f"User: {text}")
        state.input_text = ""
        state.status_text = "Thinking..."
        state.session_active = True

        # Run the agent loop in a background thread
        import threading

        cfg = context.scene.omricode_provider

        def _worker():
            try:
                from ..agent.agent_loop import OmriCodeAgentLoop

                loop = OmriCodeAgentLoop(state, cfg)
                loop.process_message(text)
            except Exception as exc:
                _append_chat(state, f"Error: {exc}")
                state.status_text = "Error"
            finally:
                state.session_active = False

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()

        return {"FINISHED"}


class OMRICODE_OT_test_connection(Operator):
    """Test the connection to the configured LLM provider endpoint."""

    bl_idname = "omricode.test_connection"
    bl_label = "Test Connection"
    bl_description = "Test LLM provider connection"

    def execute(self, context):
        cfg = context.scene.omricode_provider
        state = context.scene.omricode_state
        state.status_text = "Testing connection..."

        import urllib.request
        import json

        try:
            req = urllib.request.Request(
                cfg.endpoint.rstrip("/") + "/chat/completions",
                data=json.dumps({
                    "model": cfg.model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                }).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {cfg.api_key}" if cfg.api_key else "",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    state.status_text = "Connection OK"
                    _append_chat(state, "System: Connection successful.")
                else:
                    state.status_text = f"HTTP {resp.status}"
                    _append_chat(state, f"System: Connection failed (HTTP {resp.status}).")
        except Exception as exc:
            state.status_text = "Connection failed"
            _append_chat(state, f"System: Connection error — {exc}")

        return {"FINISHED"}


class OMRICODE_OT_cancel_session(Operator):
    """Cancel the currently running agent session."""

    bl_idname = "omricode.cancel_session"
    bl_label = "Cancel"
    bl_description = "Cancel the running agent session"

    def execute(self, context):
        state = context.scene.omricode_state
        if not state.session_active:
            self.report({"WARNING"}, "No active session to cancel")
            return {"CANCELLED"}

        try:
            from ..agent.agent_loop import OmriCodeAgentLoop
            OmriCodeAgentLoop.cancel_all()
        except Exception:
            pass

        state.session_active = False
        state.status_text = "Cancelled"
        _append_chat(state, "System: Session cancelled by user.")
        return {"FINISHED"}


# -------------------------------------------------------------------
# Panel
# -------------------------------------------------------------------


class VIEW3D_PT_omricode(Panel):
    """OmriCode AI chat panel in the 3D View sidebar."""

    bl_label = "OmriCode AI"
    bl_idname = "VIEW3D_PT_omricode"
    bl_category = "OmriCode"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"

    @staticmethod
    def _draw_dark_box(layout, text, height=120):
        """Draw a read-only multiline text box with dark styling."""
        box = layout.box()
        box.scale_y = 1.0
        col = box.column(align=True)
        # Approximate line count based on height
        lines = max(3, height // 18)
        for _ in range(lines):
            row = col.row(align=True)
            row.label(text="")

        # Use a label that shows the actual chat content
        # We overlay by clearing the dummy rows and using a single label
        # Since we cannot nest rows, just use a single text block
        # Better approach: use a template with a text editor read-only
        return box

    def draw(self, context):
        state = context.scene.omricode_state
        cfg = context.scene.omricode_provider
        layout = self.layout

        # ── Chat log ──────────────────────────────────────────────
        box = layout.box()
        col = box.column(align=True)
        chat = state.chat_log or ""
        # Split into lines and show last ~20
        lines = chat.split("\n")
        visible = lines[-80:] if len(lines) > 80 else lines
        for line in visible:
            # Wrap long lines
            wrapped = textwrap.wrap(line, width=72)
            for wl in wrapped:
                row = col.row(align=True)
                row.scale_y = 0.85
                row.label(text=wl or " ")

        layout.separator(factor=0.5)

        # ── Input field ───────────────────────────────────────────
        row = layout.row(align=True)
        row.prop(state, "input_text", text="", emboss=True)
        send_op = row.operator("omricode.send_message", text="", icon="PLAY")
        if state.session_active:
            send_op.enabled = False

        # ── Action row ────────────────────────────────────────────
        row = layout.row(align=True)
        if state.session_active:
            row.operator("omricode.cancel_session", text="Cancel", icon="CANCEL")
        else:
            row.operator("omricode.send_message", text="Send", icon="PLAY")

        row.operator("omricode.test_connection", text="Test", icon="LINKED")

        layout.separator(factor=0.5)

        # ── Provider config ───────────────────────────────────────
        col = layout.column(align=True)
        col.prop(cfg, "provider_name", text="Provider")
        col.prop(cfg, "model", text="Model")

        # ── Status ────────────────────────────────────────────────
        layout.separator(factor=0.5)
        row = layout.row(align=True)
        row.label(text="Status:")
        row.label(text=state.status_text or "Ready")


# -------------------------------------------------------------------
# Internal helpers
# -------------------------------------------------------------------


def _append_chat(state, text: str) -> None:
    """Append a line to the chat log, keeping total length reasonable."""
    MAX_LOG = 32000
    current = state.chat_log or ""
    if len(current) + len(text) + 1 > MAX_LOG:
        # Drop oldest quarter
        lines = current.split("\n")
        lines = lines[len(lines) // 4:]
        current = "\n".join(lines)
    state.chat_log = current + "\n" + text if current else text
