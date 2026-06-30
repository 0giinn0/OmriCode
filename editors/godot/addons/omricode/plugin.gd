@tool
extends EditorPlugin

const PLUGIN_NAME := "omricode"
const DOCK_SCENE_PATH := "res://addons/omricode/dock/omri_dock.tscn"

var dock_instance: Control = null

func _enter_tree() -> void:
	name = PLUGIN_NAME
	_add_omricode_dock()

func _exit_tree() -> void:
	_remove_omricode_dock()

func _add_omricode_dock() -> void:
	var scene: PackedScene = load(DOCK_SCENE_PATH)
	if scene == null:
		push_error("OmriCode: failed to load dock scene at ", DOCK_SCENE_PATH)
		return

	dock_instance = scene.instantiate()
	if dock_instance == null:
		push_error("OmriCode: failed to instantiate dock scene")
		return

	dock_instance.name = "OmriCode"
	add_control_to_dock(DOCK_SLOT_LEFT_UL, dock_instance)

func _remove_omricode_dock() -> void:
	if dock_instance != null:
		remove_control_from_docks(dock_instance)
		dock_instance.queue_free()
		dock_instance = null
