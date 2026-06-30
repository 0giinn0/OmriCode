"""OmriCode AI - Blender 4.x add-on thin client for OmriCode App.

Connects to the OmriCode desktop app for AI-powered 3D scene manipulation.
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
    "description": "AI agent for 3D scene manipulation via OmriCode desktop app",
    "category": "3D View",
}


def _reload_subpackages():
    prefix = __name__ + "."
    for importer, modname, ispkg in pkgutil.walk_packages(
        path=__path__, prefix=prefix, onerror=lambda x: None
    ):
        if modname in sys.modules:
            importlib.reload(sys.modules[modname])


_reload_subpackages()


class OmriCodeAppClient:
    """Thin HTTP client for the OmriCode desktop app."""

    APP_URL = "http://127.0.0.1:18427"
    client_id = ""

    @classmethod
    def is_connected(cls):
        import urllib.request
        import json
        try:
            req = urllib.request.Request(f"{cls.APP_URL}/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                return resp.status == 200
        except:
            return False

    @classmethod
    def register(cls):
        import urllib.request
        import json
        if cls.client_id:
            return True
        try:
            body = json.dumps({
                "name": "Blender",
                "type": "blender",
                "capabilities": ["mesh:create", "mesh:modify", "mesh:modifier", "mesh:material"]
            }).encode()
            req = urllib.request.Request(f"{cls.APP_URL}/register", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read())
                cls.client_id = data.get("clientId", "")
                return True
        except:
            return False

    @classmethod
    def send_message(cls, text: str) -> str:
        import urllib.request
        import json
        if not cls.client_id:
            cls.register()
        body = json.dumps({"message": text, "clientId": cls.client_id}).encode()
        req = urllib.request.Request(f"{cls.APP_URL}/chat/sync", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            return data.get("response", data.get("error", "No response"))


# ─── Property Groups ───


class OmriCodeSceneProperties(PropertyGroup):
    input_text: StringProperty(
        name="Input",
        description="Message to send",
        default="",
    )
    status_text: StringProperty(
        name="Status",
        default="Ready",
    )
    session_active: BoolProperty(
        name="Active",
        default=False,
    )
    connected: BoolProperty(
        name="Connected",
        default=False,
    )


# ─── Registration ───

classes = [
    OmriCodeSceneProperties,
]

from .ui.chat_panel import OMRICODE_OT_send_message, OMRICODE_PT_chat_panel

classes.extend([OMRICODE_OT_send_message, OMRICODE_PT_chat_panel])


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.omricode_state = PointerProperty(type=OmriCodeSceneProperties)

    # Try to register with app
    if OmriCodeAppClient.register():
        for s in bpy.data.scenes:
            s.omricode_state.connected = True
            s.omricode_state.status_text = "Connected to OmriCode"
    else:
        print("[OmriCode] App not running. Launch OmriCode desktop app first.")


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.omricode_state
