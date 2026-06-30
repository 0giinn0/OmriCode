# ---------------------------------------------------------------
# tools/scene_tools.gd
# OmriCode Godot Plugin — Godot scene manipulation tools
# ---------------------------------------------------------------
extends RefCounted

signal node_modified(path: String, property: String, value: Variant)


func get_scene_tree() -> Dictionary:
	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor == null:
		return _err("Not running in the Godot editor")

	var scene_root: Node = editor.get_edited_scene_root()
	if scene_root == nil:
		return _err("No scene open")

	var lines: PackedStringArray = []
	_build_tree_text(scene_root, lines, 0, 0)
	return _ok("\n".join(lines))


func _build_tree_text(node: Node, lines: PackedStringArray, depth: int, limit: int) -> int:
	if limit >= 50:
		return limit

	var indent: String = ""
	for _i in range(depth):
		indent += "  "

	var node_type: String = node.get_class()
	var node_name: String = node.name
	var props: String = ""
	var pos: Variant = node.get("position")
	if pos != null:
		props = " pos=" + str(pos)
	var size: Variant = node.get("size")
	if size != null:
		props += " size=" + str(size)

	lines.append("%s[%s] %s%s" % [indent, node_type, node_name, props])
	limit += 1

	for child in node.get_children():
		limit = _build_tree_text(child, lines, depth + 1, limit)
		if limit >= 50:
			break

	return limit


func modify_node(path: String, property: String, value: Variant) -> Dictionary:
	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor == null:
		return _err("Not running in the Godot editor")

	var scene_root: Node = editor.get_edited_scene_root()
	if scene_root == nil:
		return _err("No scene open")

	var target: Node = _resolve_path(scene_root, path)
	if target == null:
		return _err("Node not found: " + path)

	if not target.has_property(property) and not property in target:
		return _err("Property '" + property + "' not found on node " + path)

	var converted: Variant = _convert_value(value, target.get(property))
	target.set(property, converted)

	var editor_selection: EditorSelection = editor.get_selection()
	editor_selection.clear()
	editor_selection.add_node(target)

	node_modified.emit(path, property, converted)

	return _ok("Set %s.%s = %s" % [path, property, str(converted)])


func create_scene_from_text(description: String) -> Dictionary:
	var lines: PackedStringArray = description.split("\n")
	var root_name: String = "GeneratedRoot"
	var result: Node = Node.new()
	result.name = root_name
	result.set_script(null)

	var stack: Array[Node] = [result]
	var current_indent: int = 0

	for line in lines:
		line = line.strip_edges()
		if line.is_empty() or line.begins_with("#"):
			continue

		var indent: int = 0
		for ch in line:
			if ch == " " or ch == "\t":
				indent += 1
			else:
				break

		var content: String = line.strip_edges()
		var node_type: String = "Node"
		var node_name: String = content

		var parts: PackedStringArray = content.split(" ", false, 1)
		if parts.size() >= 2:
			var class_test: String = parts[0]
			if ClassDB.class_exists(class_test):
				node_type = class_test
				node_name = parts[1]
			else:
				node_name = content

		var new_node: Node
		if ClassDB.can_instantiate(node_type) and ClassDB.is_parent_class(node_type, "Node"):
			new_node = ClassDB.instantiate(node_type)
		else:
			new_node = Node.new()

		new_node.name = node_name

		if indent <= current_indent:
			var diff: int = current_indent - indent
			for _d in range(diff + 1):
				if stack.size() > 1:
					stack.pop_back()

		var parent: Node = stack[-1]
		parent.add_child(new_node)
		new_node.owner = parent.owner if parent.owner else parent
		stack.append(new_node)
		current_indent = indent

	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor:
		editor.get_editor_main_screen().add_child(result)

	return _ok("Created scene root: " + root_name + " with " + str(_count_nodes(result)) + " nodes")


func _resolve_path(root: Node, path: String) -> Node:
	if path == "." or path == "":
		return root

	if path.begins_with("."):
		return root.get_node_or_null(path.trim_prefix("."))

	var node_path: NodePath = NodePath(path)
	if root.has_node(node_path):
		return root.get_node(node_path)

	for child in root.get_children(true):
		var found: Node = _resolve_path(child, path)
		if found:
			return found

	return null


func _convert_value(value: Variant, existing: Variant) -> Variant:
	if value is String and existing is float:
		return float(value)
	if value is String and existing is int:
		return int(value)
	if value is String and existing is Vector2:
		var parts: PackedStringArray = value.replace("(", "").replace(")", "").split(",")
		if parts.size() >= 2:
			return Vector2(float(parts[0].strip_edges()), float(parts[1].strip_edges()))
	if value is String and existing is Color:
		return Color(value)
	return value


func _count_nodes(node: Node) -> int:
	var count: int = 1
	for child in node.get_children():
		count += _count_nodes(child)
	return count


static func _ok(output: String) -> Dictionary:
	return {"success": true, "output": output, "error": ""}


static func _err(msg: String) -> Dictionary:
	return {"success": false, "output": "", "error": msg}
