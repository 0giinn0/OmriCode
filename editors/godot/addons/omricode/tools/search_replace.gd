# ---------------------------------------------------------------
# tools/search_replace.gd
# OmriCode Godot Plugin — SEARCH/REPLACE block parser
# ---------------------------------------------------------------
extends RefCounted

class SearchReplaceBlock:
	var file_path: String = ""
	var search_text: String = ""
	var replace_text: String = ""

	func _init(p_file: String = "", p_search: String = "", p_replace: String = "") -> void:
		file_path = p_file
		search_text = p_search
		replace_text = p_replace

	func is_valid() -> bool:
		return not file_path.is_empty() and not search_text.is_empty()


const BLOCK_PATTERN: String = "(?s)(?:File:\\s*(\\S+))?\\s*<<<<<<<\\s*SEARCH\\s*\\n(.+?)=======\\n(.+?)>>>>>>>\\s*REPLACE"


func parse(text: String) -> Array[SearchReplaceBlock]:
	var blocks: Array[SearchReplaceBlock] = []
	var regex: RegEx = RegEx.create_from_string(BLOCK_PATTERN)
	if regex == null:
		push_error("OmriCode: invalid SEARCH/REPLACE regex")
		return blocks

	var matches: Array[RegExMatch] = regex.search_all(text)
	for match in matches:
		var block: SearchReplaceBlock = SearchReplaceBlock.new()
		block.file_path = match.get_string(1).strip_edges()
		block.search_text = _normalize_newlines(match.get_string(2).strip_edges(false, true))
		block.replace_text = _normalize_newlines(match.get_string(3).strip_edges(false, true))
		blocks.append(block)

	return blocks


func parse_from_file(file_path: String) -> Array[SearchReplaceBlock]:
	if not FileAccess.file_exists(file_path):
		push_error("OmriCode: file not found for SEARCH/REPLACE parsing: ", file_path)
		return []

	var file: FileAccess = FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		push_error("OmriCode: cannot open file: ", file_path)
		return []

	var content: String = file.get_as_text()
	file.close()
	return parse(content)


func apply_to_file(file_path: String, search_replace_text: String) -> Dictionary:
	if not FileAccess.file_exists(file_path):
		return {
			"success": false,
			"output": "",
			"error": "File not found: " + file_path
		}

	var blocks: Array[SearchReplaceBlock] = parse(search_replace_text)
	if blocks.is_empty():
		return {
			"success": false,
			"output": "",
			"error": "No valid SEARCH/REPLACE blocks found"
		}

	var file: FileAccess = FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		return {"success": false, "output": "", "error": "Cannot open: " + file_path}

	var content: String = file.get_as_text()
	file.close()

	var total_replacements: int = 0
	for block in blocks:
		var target_path: String = block.file_path
		if target_path.is_empty():
			target_path = file_path

		if target_path != file_path:
			continue

		var search_normalized: String = _normalize_newlines(block.search_text)
		var replace_normalized: String = _normalize_newlines(block.replace_text)
		var content_normalized: String = _normalize_newlines(content)

		if not content_normalized.contains(search_normalized):
			return {
				"success": false,
				"output": "",
				"error": "SEARCH text not found in " + file_path + ". Provide exact text including surrounding context."
			}

		content = content_normalized.replace(search_normalized, replace_normalized)
		total_replacements += 1

	if total_replacements == 0:
		return {
			"success": false,
			"output": "",
			"error": "No matching SEARCH block for file: " + file_path
		}

	var write_file: FileAccess = FileAccess.open(file_path, FileAccess.WRITE)
	if write_file == null:
		return {"success": false, "output": "", "error": "Cannot write: " + file_path}

	write_file.store_string(content)
	write_file.close()

	return {
		"success": true,
		"output": "Applied %d SEARCH/REPLACE block(s) to %s" % [total_replacements, file_path],
		"error": ""
	}


static func _normalize_newlines(text: String) -> String:
	return text.replace("\r\n", "\n").replace("\r", "\n")
