# ---------------------------------------------------------------
# context/scene_context.gd
# OmriCode Godot Plugin — Builds system prompts from editor state
# ---------------------------------------------------------------
extends RefCounted

const MAX_SCENE_NODES := 50
const MAX_SCRIPT_LINES := 100


func build_system_prompt() -> String:
	var parts: PackedStringArray = []
	parts.append("You are OmriCode, an AI coding assistant embedded in the Godot 4 editor.")
	parts.append("")
	parts.append("=== Current Editor Context ===")
	parts.append("")
	parts.append(_get_project_info())
	parts.append("")
	parts.append(_get_scene_context())
	parts.append("")
	parts.append(_get_selection_context())
	parts.append("")
	parts.append(_get_open_scripts_context())
	parts.append("")
	parts.append(_get_tool_instructions())
	parts.append("")
	parts.append("Respond with tool calls using the available functions. Follow the ReAct loop: think, decide, execute, observe, respond.")

	return "\n".join(parts)


func _get_project_info() -> String:
	var parts: PackedStringArray = []
	parts.append("## Project Info")
	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor:
		var project_path: String = ProjectSettings.globalize_path("res://")
		parts.append("- Project path: " + project_path)
		var scene_root: Node = editor.get_edited_scene_root()
		if scene_root:
			parts.append("- Current scene: " + scene_root.scene_file_path)
	return "\n".join(parts)


func _get_scene_context() -> String:
	var parts: PackedStringArray = []
	parts.append("## Scene Tree")
	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor == null:
		return ""

	var scene_root: Node = editor.get_edited_scene_root()
	if scene_root == null:
		parts.append("(No scene open)")
		return "\n".join(parts)

	var tree_lines: PackedStringArray = []
	_build_tree(scene_root, tree_lines, 0, 0)
	if tree_lines.is_empty():
		parts.append("(Empty scene)")
	else:
		parts.append("```")
		for line in tree_lines:
			parts.append(line)
		parts.append("```")

	return "\n".join(parts)


func _build_tree(node: Node, lines: PackedStringArray, depth: int, count: int) -> int:
	if count >= MAX_SCENE_NODES:
		lines.append("  " * depth + "... (truncated)")
		return count

	var indent: String = "  " * depth
	var class_name: String = node.get_class()
	var node_name: String = node.name

	var details: PackedStringArray = []
	if node.has_method("get_script") and node.get_script():
		var script_path: String = node.get_script().resource_path if node.get_script().resource_path else "inline"
		details.append("script=" + script_path)

	var detail_str: String = ""
	if not details.is_empty():
		detail_str = " [" + ", ".join(details) + "]"

	lines.append("%s[%s] %s%s" % [indent, class_name, node_name, detail_str])
	count += 1

	for child in node.get_children():
		count = _build_tree(child, lines, depth + 1, count)
		if count >= MAX_SCENE_NODES:
			break

	return count


func _get_selection_context() -> String:
	var parts: PackedStringArray = []
	parts.append("## Selection")
	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor == null:
		return ""

	var selection: EditorSelection = editor.get_selection()
	if selection == null:
		parts.append("(Nothing selected)")
		return "\n".join(parts)

	var selected_nodes: Array[Node] = selection.get_selected_nodes()
	if selected_nodes.is_empty():
		parts.append("(Nothing selected)")
	else:
		for node in selected_nodes:
			parts.append("- Selected: " + node.name + " [" + node.get_class() + "]")
			parts.append("  Path: " + str(editor.get_edited_scene_root().get_path_to(node)))

	return "\n".join(parts)


func _get_open_scripts_context() -> String:
	var parts: PackedStringArray = []
	parts.append("## Open Scripts")

	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor == null:
		return ""

	var script_editor: ScriptEditor = editor.get_script_editor()
	if script_editor == null:
		return ""

	var open_scripts: Array = script_editor.get_open_scripts()
	if open_scripts.is_empty():
		parts.append("(No scripts open)")
		return "\n".join(parts)

	var count: int = 0
	for script in open_scripts:
		if count >= 3:
			parts.append("... and %d more scripts" % [open_scripts.size() - count])
			break

		if script is GDScript:
			var source: String = script.source_code
			var source_lines: PackedStringArray = source.split("\n")
			var preview_lines: PackedStringArray = []

			var max_lines: int = mini(MAX_SCRIPT_LINES, source_lines.size())
			for i in range(max_lines):
				preview_lines.append(source_lines[i])

			if source_lines.size() > MAX_SCRIPT_LINES:
				preview_lines.append("... (%d more lines)" % [source_lines.size() - MAX_SCRIPT_LINES])

			parts.append("\n### " + script.resource_path + "\n```gdscript")
			for line in preview_lines:
				parts.append(line)
			parts.append("```")
			count += 1

	return "\n".join(parts)


func _get_tool_instructions() -> String:
	return """## Available Tools

You have these tools available through function calling:

1. **read_file(filePath)** — Read file contents
2. **write_file(filePath, content)** — Write content to a file (overwrites!)
3. **edit_file(filePath, searchReplaceText)** — Apply SEARCH/REPLACE blocks to edit a file
4. **grep(pattern, include, path)** — Search file contents with regex
5. **glob(pattern)** — List files matching a glob pattern
6. **list_directory(path)** — List directory contents
7. **get_selection()** — Get selected text from the script editor
8. **get_scene_tree()** — Get the current scene tree hierarchy
9. **modify_node(path, property, value)** — Modify a property on a scene node
10. **ask_user(question)** — Ask the user a question

When editing files, prefer using edit_file with SEARCH/REPLACE blocks to make targeted changes. Always read a file before editing it.

## SEARCH/REPLACE Block Format
```
<<<<<<< SEARCH
<exact code to find>
=======
<replacement code>
>>>>>>> REPLACE
```
"""
