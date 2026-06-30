"""Chat panel UI for OmriCode AI add-on - thin client for OmriCode desktop app."""

import textwrap
import bpy
from bpy.types import Operator, Panel
from .. import OmriCodeAppClient


class OMRICODE_OT_send_message(Operator):
    """Send the current input text to the OmriCode app."""

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

        _append_chat(state, f"User: {text}")
        state.input_text = ""
        state.status_text = "Thinking..."
        state.session_active = True

        import threading

        def _worker():
            import bpy
            try:
                response = OmriCodeAppClient.send_message(text)
                bpy.app.timers.register(
                    lambda: _on_response(state, response),
                    first_interval=0.01
                )
            except Exception as e:
                bpy.app.timers.register(
                    lambda: _on_error(state, str(e)),
                    first_interval=0.01
                )

        threading.Thread(target=_worker, daemon=True).start()
        return {"FINISHED"}


def _on_response(state, response: str):
    _append_chat(state, f"Assistant: {response}")
    state.status_text = "Ready"
    state.session_active = False
    return False  # one-shot timer


def _on_error(state, error: str):
    _append_chat(state, f"Error: {error}")
    state.status_text = "Error"
    state.session_active = False
    return False


class OMRICODE_PT_chat_panel(Panel):
    """Chat panel in 3D View sidebar."""

    bl_label = "OmriCode"
    bl_idname = "OMRICODE_PT_chat_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "OmriCode"

    def draw(self, context):
        layout = self.layout
        state = context.scene.omricode_state

        # Connection status
        box = layout.box()
        if state.connected:
            box.label(text="● Connected", icon="CHECKBOX_HLT")
        else:
            box.label(text="○ Disconnected", icon="ERROR")
            box.operator("wm.url_open", text="Launch OmriCode App",
                         icon="URL").url = "https://github.com/0giinn0/OmriCode"

        # Chat log
        box = layout.box()
        chat_text = _get_chat_text(state)
        for line in chat_text.split("\n"):
            box.label(text=textwrap.shorten(line, width=60, placeholder="..."))

        # Status
        layout.label(text=f"Status: {state.status_text}")

        # Input
        layout.prop(state, "input_text", text="")
        row = layout.row(align=True)
        row.operator("omricode.send_message", text="Send", icon="PLAY")
        if state.session_active:
            row.enabled = False


# ─── Chat history helpers using Blender's text datablock ───

CHAT_TEXT_NAME = "omricode_chat_log"


def _get_chat_text(state) -> str:
    text_block = bpy.data.texts.get(CHAT_TEXT_NAME)
    return text_block.as_string() if text_block else ""


def _append_chat(state, line: str):
    text_block = bpy.data.texts.get(CHAT_TEXT_NAME)
    if not text_block:
        text_block = bpy.data.texts.new(CHAT_TEXT_NAME)
    text_block.write(line + "\n")
