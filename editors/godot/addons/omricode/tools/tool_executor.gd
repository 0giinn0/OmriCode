# ---------------------------------------------------------------
# tools/tool_executor.gd
# OmriCode Godot Plugin — Tool registry and executor
# ---------------------------------------------------------------
extends RefCounted

signal tool_executed(name: String, success: bool, output: String)

var _tool_registry: Dictionary = {}
var _search_replace: Reference = null
var _scene_tools: Reference = null


func _init() -> void:
	_register_builtin_tools()


func _register_builtin_tools() -> void:
	_tool_registry["read_file"] = _tool_read_file
	_tool_registry["write_file"] = _tool_write_file
	_tool_registry["edit_file"] = _tool_edit_file
	_tool_registry["grep"] = _tool_grep
	_tool_registry["glob"] = _tool_glob
	_tool_registry["list_directory"] = _tool_list_directory
	_tool_registry["get_selection"] = _tool_get_selection
	_tool_registry["get_scene_tree"] = _tool_get_scene_tree
	_tool_registry["modify_node"] = _tool_modify_node
	_tool_registry["ask_user"] = _tool_ask_user


func set_search_replace(ref: Reference) -> void:
	_search_replace = ref


func set_scene_tools(ref: Reference) -> void:
	_scene_tools = ref


func execute(name: String, args: Dictionary) -> Dictionary:
	if not _tool_registry.has(name):
		return {
			"success": false,
			"output": "",
			"error": "Unknown tool: " + name
		}

	var callable: Callable = _tool_registry[name] as Callable
	if not callable.is_valid():
		return {
			"success": false,
			"output": "",
			"error": "Tool '" + name + "' callable is invalid"
		}

	var result: Dictionary = callable.call(args)
	tool_executed.emit(name, result.get("success", false), result.get("output", ""))
	return result


func get_tool_descriptions() -> Array[Dictionary]:
	var descriptions: Array[Dictionary] = []
	for tool_name in _tool_registry.keys():
		descriptions.append(_get_tool_schema(tool_name))
	return descriptions


func _get_tool_schema(name: String) -> Dictionary:
	match name:
		"read_file":
			return {
				"name": "read_file",
				"description": "Read a file's contents from the filesystem",
				"parameters": {
					"type": "object",
					"properties": {
						"filePath": {"type": "string", "description": "Absolute path to the file"}
					},
					"required": ["filePath"]
				}
			}
		"write_file":
			return {
				"name": "write_file",
				"description": "Write content to a file, overwriting if it exists",
				"parameters": {
					"type": "object",
					"properties": {
						"filePath": {"type": "string", "description": "Absolute path to the file"},
						"content": {"type": "string", "description": "Content to write"}
					},
					"required": ["filePath", "content"]
				}
			}
		"edit_file":
			return {
				"name": "edit_file",
				"description": "Edit a file using SEARCH/REPLACE blocks",
				"parameters": {
					"type": "object",
					"properties": {
						"filePath": {"type": "string", "description": "Absolute path to the file"},
						"searchReplaceText": {"type": "string", "description": "SEARCH/REPLACE block text"}
					},
					"required": ["filePath", "searchReplaceText"]
				}
			}
		"grep":
			return {
				"name": "grep",
				"description": "Search file contents using a regex pattern",
				"parameters": {
					"type": "object",
					"properties": {
						"pattern": {"type": "string", "description": "Regex pattern to search"},
						"include": {"type": "string", "description": "File pattern filter (e.g. *.gd)"},
						"path": {"type": "string", "description": "Directory to search"}
					},
					"required": ["pattern"]
				}
			}
		"glob":
			return {
				"name": "glob",
				"description": "Find files by glob pattern",
				"parameters": {
					"type": "object",
					"properties": {
						"pattern": {"type": "string", "description": "Glob pattern (e.g. **/*.gd)"}
					},
					"required": ["pattern"]
				}
			}
		"list_directory":
			return {
				"name": "list_directory",
				"description": "List all files and folders in a directory",
				"parameters": {
					"type": "object",
					"properties": {
						"path": {"type": "string", "description": "Directory path to list"}
					},
					"required": ["path"]
				}
			}
		"get_selection":
			return {
				"name": "get_selection",
				"description": "Get the currently selected text in the script editor",
				"parameters": {"type": "object", "properties": {}}
			}
		"get_scene_tree":
			return {
				"name": "get_scene_tree",
				"description": "Get the current scene tree hierarchy",
				"parameters": {"type": "object", "properties": {}}
			}
		"modify_node":
			return {
				"name": "modify_node",
				"description": "Modify a property on a scene node",
				"parameters": {
					"type": "object",
					"properties": {
						"path": {"type": "string", "description": "Node path in the scene"},
						"property": {"type": "string", "description": "Property name to modify"},
						"value": {"description": "New value for the property"}
					},
					"required": ["path", "property", "value"]
				}
			}
		"ask_user":
			return {
				"name": "ask_user",
				"description": "Ask the user a question and get their input",
				"parameters": {
					"type": "object",
					"properties": {
						"question": {"type": "string", "description": "Question to ask the user"}
					},
					"required": ["question"]
				}
			}
	return {
		"name": name,
		"description": "No description available",
		"parameters": {"type": "object", "properties": {}}
	}


func _tool_read_file(args: Dictionary) -> Dictionary:
	var path: String = args.get("filePath", "")
	if path.is_empty():
		return _error("filePath is required")
	if not FileAccess.file_exists(path):
		return _error("File not found: " + path)

	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return _error("Cannot open file: " + path)

	var content: String = file.get_as_text()
	file.close()
	return _ok(content)


func _tool_write_file(args: Dictionary) -> Dictionary:
	var path: String = args.get("filePath", "")
	var content: String = args.get("content", "")
	if path.is_empty():
		return _error("filePath is required")

	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return _error("Cannot write file: " + path)

	file.store_string(content)
	file.close()
	return _ok("Written %d bytes to %s" % [content.length(), path])


func _tool_edit_file(args: Dictionary) -> Dictionary:
	var path: String = args.get("filePath", "")
	var search_replace_text: String = args.get("searchReplaceText", "")
	if path.is_empty() or search_replace_text.is_empty():
		return _error("filePath and searchReplaceText are required")

	if _search_replace and _search_replace.has_method("apply_to_file"):
		return _search_replace.apply_to_file(path, search_replace_text)

	return _error("Search/replace module not available")


func _tool_grep(args: Dictionary) -> Dictionary:
	var pattern: String = args.get("pattern", "")
	var include: String = args.get("include", "")
	var search_path: String = args.get("path", "")
	if pattern.is_empty():
		return _error("pattern is required")

	var dir: String = search_path
	if dir.is_empty():
		dir = "res://"

	var results: PackedStringArray = []
	var flags: int = 0
	var regex: RegEx = RegEx.create_from_string(pattern)
	if regex == null:
		return _error("Invalid regex pattern")

	var files: PackedStringArray = _get_gd_files(dir, include)
	for file_path in files:
		var file: FileAccess = FileAccess.open(file_path, FileAccess.READ)
		if file == null:
			continue
		var line_num: int = 0
		while not file.eof_reached():
			var line: String = file.get_line()
			line_num += 1
			if regex.search(line):
				results.append("%s:%d: %s" % [file_path, line_num, line.strip_edges()])
		file.close()

	if results.is_empty():
		return _ok("No matches found for pattern: " + pattern)
	return _ok("\n".join(results))


func _tool_glob(args: Dictionary) -> Dictionary:
	var pattern: String = args.get("pattern", "")
	if pattern.is_empty():
		return _error("pattern is required")

	var dir: Directory = Directory.new()
	var files: PackedStringArray = []
	var base: String = "res://"
	_glob_recursive(base, pattern, files)

	if files.is_empty():
		return _ok("No files matched pattern: " + pattern)
	return _ok("\n".join(files))


func _glob_recursive(path: String, _pattern: String, results: PackedStringArray) -> void:
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var file_name: String = dir.get_next()
	while not file_name.is_empty():
		if file_name == "." or file_name == "..":
			file_name = dir.get_next()
			continue
		var full: String = path.path_join(file_name)
		if dir.current_is_dir():
			_glob_recursive(full, _pattern, results)
		else:
			if full.match(_pattern):
				results.append(full)
		file_name = dir.get_next()
	dir.list_dir_end()


func _tool_list_directory(args: Dictionary) -> Dictionary:
	var path: String = args.get("path", "")
	if path.is_empty():
		path = "res://"

	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return _error("Cannot open directory: " + path)

	var entries: PackedStringArray = []
	dir.list_dir_begin()
	var name: String = dir.get_next()
	while not name.is_empty():
		if name == "." or name == "..":
			name = dir.get_next()
			continue
		var suffix: String = "/" if dir.current_is_dir() else ""
		entries.append(name + suffix)
		name = dir.get_next()
	dir.list_dir_end()

	entries.sort()
	return _ok("\n".join(entries))


func _tool_get_selection(_args: Dictionary) -> Dictionary:
	var editor: EditorInterface = Engine.get_singleton("EditorInterface")
	if editor == null:
		return _error("Not running in the Godot editor")

	var script_editor: ScriptEditor = editor.get_script_editor()
	if script_editor == null:
		return _error("No script editor available")

	var selection: String = script_editor.get_current_script().get_selection()
	if selection.is_empty():
		return _ok("No text selected")
	return _ok(selection)


func _tool_get_scene_tree(_args: Dictionary) -> Dictionary:
	if _scene_tools and _scene_tools.has_method("get_scene_tree"):
		return _scene_tools.get_scene_tree()
	return _error("Scene tools not available")


func _tool_modify_node(args: Dictionary) -> Dictionary:
	if _scene_tools and _scene_tools.has_method("modify_node"):
		return _scene_tools.modify_node(
			args.get("path", ""),
			args.get("property", ""),
			args.get("value", "")
		)
	return _error("Scene tools not available")


func _tool_ask_user(args: Dictionary) -> Dictionary:
	var question: String = args.get("question", "Proceed?")
	return _ok("User input required for: " + question + " (implement dialog)")


func _get_gd_files(dir_path: String, include_filter: String) -> PackedStringArray:
	var result: PackedStringArray = []
	var dir: DirAccess = DirAccess.open(dir_path)
	if dir == null:
		return result
	dir.list_dir_begin()
	var name: String = dir.get_next()
	while not name.is_empty():
		if name == "." or name == "..":
			name = dir.get_next()
			continue
		var full: String = dir_path.path_join(name)
		if dir.current_is_dir():
			result.append_array(_get_gd_files(full, include_filter))
		else:
			if include_filter.is_empty():
				result.append(full)
			elif full.match(include_filter):
				result.append(full)
		name = dir.get_next()
	dir.list_dir_end()
	return result


static func _ok(output: String) -> Dictionary:
	return {"success": true, "output": output, "error": ""}


static func _error(msg: String) -> Dictionary:
	return {"success": false, "output": "", "error": msg}
