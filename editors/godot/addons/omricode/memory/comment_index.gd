# ---------------------------------------------------------------
# memory/comment_index.gd
# OmriCode Godot Plugin — Extracts and indexes comments from .gd files
# ---------------------------------------------------------------
extends RefCounted

class CommentEntry:
	var file_path: String
	var line_number: int
	var text: String
	var is_doc_comment: bool  # ## (doc) vs # (regular)

	func _init(p_path: String, p_line: int, p_text: String, p_doc: bool) -> void:
		file_path = p_path
		line_number = p_line
		text = p_text
		is_doc_comment = p_doc

	func to_dict() -> Dictionary:
		return {
			"file_path": file_path,
			"line_number": line_number,
			"text": text,
			"is_doc_comment": is_doc_comment
		}


var _index: Dictionary = {}  # keyword -> Array[CommentEntry]
var _all_comments: Array[CommentEntry] = []
var _indexed_files: Dictionary = {}
var _project_path: String = ""


func _init() -> void:
	_project_path = ProjectSettings.globalize_path("res://")


func scan_project() -> void:
	_index.clear()
	_all_comments.clear()
	_indexed_files.clear()

	var dir: DirAccess = DirAccess.open("res://")
	if dir == null:
		push_error("OmriCode: cannot open project root")
		return

	_scan_directory("res://")
	print("OmriCode: indexed %d comments from %d files" % [_all_comments.size(), _indexed_files.size()])


func _scan_directory(path: String) -> void:
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return

	dir.list_dir_begin()
	var name: String = dir.get_next()
	while not name.is_empty():
		if name == "." or name == "..":
			name = dir.get_next()
			continue

		var full_path: String = path.path_join(name)
		if dir.current_is_dir():
			if _should_skip_dir(name):
				name = dir.get_next()
				continue
			_scan_directory(full_path)
		elif name.ends_with(".gd"):
			index_file(full_path)

		name = dir.get_next()
	dir.list_dir_end()


func _should_skip_dir(name: String) -> bool:
	var skip_dirs: PackedStringArray = ["addons", ".git", ".godot", "import", ".import"]
	for d in skip_dirs:
		if name == d:
			return true
	return false


func index_file(path: String) -> void:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return

	if _indexed_files.has(path):
		_unindex_file(path)

	var comments: Array[CommentEntry] = []
	var line_number: int = 0

	while not file.eof_reached():
		var line: String = file.get_line()
		line_number += 1
		var trimmed: String = line.strip_edges()

		if trimmed.begins_with("##"):
			var comment_text: String = trimmed.trim_prefix("##").strip_edges()
			if not comment_text.is_empty():
				var entry: CommentEntry = CommentEntry.new(path, line_number, comment_text, true)
				comments.append(entry)
				_all_comments.append(entry)
				_index_entry(entry)

		elif trimmed.begins_with("#") and not trimmed.begins_with("#!"):
			var comment_text: String = trimmed.trim_prefix("#").strip_edges()
			if not comment_text.is_empty():
				var entry: CommentEntry = CommentEntry.new(path, line_number, comment_text, false)
				comments.append(entry)
				_all_comments.append(entry)
				_index_entry(entry)

	file.close()
	_indexed_files[path] = comments


func _unindex_file(path: String) -> void:
	if not _indexed_files.has(path):
		return

	var old_entries: Array = _indexed_files[path]
	for entry in old_entries:
		if entry is CommentEntry:
			var idx: int = _all_comments.find(entry)
			if idx >= 0:
				_all_comments.remove_at(idx)
			_remove_from_index(entry)

	_indexed_files.erase(path)


func _index_entry(entry: CommentEntry) -> void:
	var words: PackedStringArray = _extract_keywords(entry.text)
	for word in words:
		var key: String = word.to_lower()
		if not _index.has(key):
			_index[key] = []
		_index[key].append(entry)


func _remove_from_index(entry: CommentEntry) -> void:
	var words: PackedStringArray = _extract_keywords(entry.text)
	for word in words:
		var key: String = word.to_lower()
		if _index.has(key):
			_index[key].erase(entry)
			if _index[key].is_empty():
				_index.erase(key)


func _extract_keywords(text: String) -> PackedStringArray:
	var words: PackedStringArray = []
	var parts: PackedStringArray = text.split(" ", false)
	for part in parts:
		var clean: String = ""
		for ch in part:
			if ch.is_valid_unicode_char() and (ch.is_valid_identifier() or ch.is_digit()):
				clean += ch
			elif clean.length() > 0:
				break
		if clean.length() >= 3:
			words.append(clean)
	return words


func search(query: String, max_results: int = 20) -> Array[CommentEntry]:
	var results: Array[CommentEntry] = []
	var seen: Dictionary = {}

	var query_words: PackedStringArray = _extract_keywords(query)
	if query_words.is_empty():
		return results

	var scored: Dictionary = {}
	for word in query_words:
		var key: String = word.to_lower()
		if _index.has(key):
			for entry in _index[key]:
				var entry_key: String = entry.file_path + ":" + str(entry.line_number)
				if not scored.has(entry_key):
					scored[entry_key] = {"entry": entry, "score": 0}
				scored[entry_key]["score"] += 1

	var sorted_entries: Array[Dictionary] = []
	for entry_key in scored:
		sorted_entries.append(scored[entry_key])

	sorted_entries.sort_custom(_sort_by_score)

	for item in sorted_entries:
		if results.size() >= max_results:
			break
		results.append(item["entry"])

	return results


static func _sort_by_score(a: Dictionary, b: Dictionary) -> bool:
	return a["score"] > b["score"]


func get_comments_for_file(path: String) -> Array[CommentEntry]:
	if _indexed_files.has(path):
		return _indexed_files[path].duplicate()
	return []


func get_all_comments() -> Array[CommentEntry]:
	return _all_comments.duplicate()


func get_stats() -> Dictionary:
	return {
		"total_comments": _all_comments.size(),
		"indexed_files": _indexed_files.size(),
		"unique_keywords": _index.size()
	}


func clear() -> void:
	_index.clear()
	_all_comments.clear()
	_indexed_files.clear()
