# ---------------------------------------------------------------
# agent/message_history.gd
# OmriCode Godot Plugin — Chat message history manager
# ---------------------------------------------------------------
extends RefCounted

var messages: Array[Dictionary] = []

const DEFAULT_SYSTEM_PROMPT := "You are OmriCode, an AI coding assistant embedded in the Godot editor. You have access to tools for reading, writing, and modifying files, as well as inspecting the editor's scene tree and node properties. Follow the ReAct loop: Think carefully about the user's request, Decide which tool to call, Execute it, Observe the result, and Respond to the user. Always check file contents before editing."


func add(role: String, content: String) -> void:
	messages.append({
		"role": role,
		"content": content
	})


func get_provider_messages(system_prompt: String = "") -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var prompt: String = system_prompt
	if prompt.is_empty():
		prompt = DEFAULT_SYSTEM_PROMPT

	result.append({
		"role": "system",
		"content": prompt
	})

	for msg in messages:
		result.append(msg.duplicate())

	return result


func clear() -> void:
	messages.clear()


func truncate_if_needed(max_tokens: int = 25000) -> void:
	var total: int = 0
	var keep: Array[Dictionary] = []

	for i in range(messages.size() - 1, -1, -1):
		var msg: Dictionary = messages[i]
		var tokens: int = _estimate_tokens(msg.get("content", ""))
		if total + tokens > max_tokens:
			continue
		total += tokens
		keep.push_front(msg)

	messages = keep


func _estimate_tokens(text: String) -> int:
	if text.is_empty():
		return 0
	return int(ceil(text.length() * 0.35))


func get_total_tokens() -> int:
	var total: int = 0
	for msg in messages:
		total += _estimate_tokens(msg.get("content", ""))
	return total


func get_message_count() -> int:
	return messages.size()


func get_last_message() -> Dictionary:
	if messages.is_empty():
		return {}
	return messages[-1].duplicate()


func to_text() -> String:
	var parts: PackedStringArray = []
	for msg in messages:
		var role: String = msg.get("role", "unknown")
		var content: String = msg.get("content", "")
		parts.append(role.to_upper() + ": " + content)
	return "\n\n".join(parts)
