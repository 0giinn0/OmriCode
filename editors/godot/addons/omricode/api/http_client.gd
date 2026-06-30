# ---------------------------------------------------------------
# api/http_client.gd
# OmriCode Godot Plugin — Non-blocking HTTP client for LLM API calls
# ---------------------------------------------------------------
extends Node

signal request_completed(success: bool, data: Dictionary)
signal streaming_chunk(content: String)

const REQUEST_TIMEOUT := 120
const MAX_RETRIES := 3
const RETRY_DELAY_MS := 1000

enum ProviderType { OPENAI, ANTHROPIC, OLLAMA }

var _http_request: HTTPRequest
var _current_provider: String = ""
var _buffer: String = ""
var _retry_count: int = 0
var _cancelled: bool = false


func _init() -> void:
	_http_request = HTTPRequest.new()
	_http_request.request_completed.connect(_on_request_completed)
	add_child(_http_request)


func send_message(messages: Array, tools: Array, provider_config: Dictionary) -> void:
	_cancelled = false
	_buffer = ""
	_retry_count = 0
	_current_provider = provider_config.get("id", "")

	var endpoint: String = provider_config.get("endpoint", "")
	var api_key: String = provider_config.get("api_key", "")
	var model: String = provider_config.get("model", "")
	var max_tokens: int = provider_config.get("max_tokens", 4096)
	var temperature: float = provider_config.get("temperature", 0.7)
	var supports_fc: bool = provider_config.get("supports_fc", false)

	if endpoint.is_empty():
		request_completed.emit(false, {"error": "No endpoint configured"})
		return

	var provider_type: ProviderType = _detect_provider(endpoint, api_key)
	var headers: PackedStringArray = _build_headers(provider_type, api_key)
	var body: Dictionary = _build_body(provider_type, model, messages, tools, max_tokens, temperature, supports_fc)

	var body_json: String = JSON.stringify(body)
	var err: int = _http_request.request(endpoint, headers, HTTPClient.METHOD_POST, body_json)

	if err != OK:
		request_completed.emit(false, {"error": "HTTP request failed: " + error_string(err)})
		return

	_http_request.timeout = REQUEST_TIMEOUT


func cancel() -> void:
	_cancelled = true
	if _http_request:
		_http_request.cancel_request()


func _detect_provider(endpoint: String, _api_key: String) -> ProviderType:
	if endpoint.contains("anthropic.com"):
		return ProviderType.ANTHROPIC
	if endpoint.contains("localhost") or endpoint.contains("127.0.0.1") or endpoint.contains("ollama"):
		return ProviderType.OLLAMA
	return ProviderType.OPENAI


func _build_headers(provider_type: ProviderType, api_key: String) -> PackedStringArray:
	var headers: PackedStringArray = [
		"Content-Type: application/json",
		"Accept: text/event-stream",
		"User-Agent: OmriCode/1.0"
	]
	match provider_type:
		ProviderType.OPENAI:
			if not api_key.is_empty():
				headers.append("Authorization: Bearer " + api_key)
		ProviderType.ANTHROPIC:
			if not api_key.is_empty():
				headers.append("x-api-key: " + api_key)
				headers.append("anthropic-version: 2023-06-01")
		ProviderType.OLLAMA:
			pass
	return headers


func _build_body(
	provider_type: ProviderType,
	model: String,
	messages: Array,
	tools: Array,
	max_tokens: int,
	temperature: float,
	supports_fc: bool
) -> Dictionary:
	var body: Dictionary = {}
	match provider_type:
		ProviderType.OPENAI:
			body["model"] = model
			body["messages"] = messages
			body["max_tokens"] = max_tokens
			body["temperature"] = temperature
			body["stream"] = false
			if supports_fc and not tools.is_empty():
				body["tools"] = tools
				body["tool_choice"] = "auto"

		ProviderType.ANTHROPIC:
			body["model"] = model
			body["max_tokens"] = max_tokens
			body["temperature"] = temperature
			var filtered: Array[Dictionary] = []
			for msg in messages:
				var role: String = msg.get("role", "")
				if role == "system":
					if not body.has("system"):
						body["system"] = msg.get("content", "")
					continue
				filtered.append({"role": role, "content": msg.get("content", "")})
			body["messages"] = filtered
			if supports_fc and not tools.is_empty():
				body["tools"] = tools

		ProviderType.OLLAMA:
			body["model"] = model
			body["messages"] = messages
			body["stream"] = false
			body["options"] = {
				"temperature": temperature,
				"num_predict": max_tokens
			}

	return body


func _on_request_completed(result: int, _response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if _cancelled:
		return

	if result != HTTPRequest.RESULT_SUCCESS:
		if _retry_count < MAX_RETRIES:
			_retry_count += 1
			_http_request.start_request()
			return
		request_completed.emit(false, {"error": "HTTP request result: " + error_string(result)})
		return

	var body_text: String = body.get_string_from_utf8()
	if _response_code < 200 or _response_code >= 300:
		request_completed.emit(false, {
			"error": "API error (HTTP %d): %s" % [_response_code, body_text],
			"status_code": _response_code
		})
		return

	var parsed: Dictionary = _parse_response(body_text)
	if parsed.is_empty():
		request_completed.emit(false, {"error": "Failed to parse response"})
		return

	request_completed.emit(true, parsed)


func _parse_response(body_text: String) -> Dictionary:
	var json: Variant = JSON.parse_string(body_text)
	if json == null:
		return _try_parse_sse(body_text)

	if json is Dictionary:
		return _extract_from_json(json)

	return {}


func _try_parse_sse(body_text: String) -> Dictionary:
	var lines: PackedStringArray = body_text.split("\n")
	var content_parts: PackedStringArray = []
	var tool_calls: Array = []

	for line in lines:
		if line.begins_with("data: "):
			var data_str: String = line.trim_prefix("data: ").strip_edges()
			if data_str == "[DONE]":
				continue
			var chunk: Variant = JSON.parse_string(data_str)
			if chunk is Dictionary:
				var delta: Dictionary = _extract_delta(chunk)
				if delta.has("content"):
					content_parts.append(delta.content)
				if delta.has("tool_calls"):
					tool_calls = delta.tool_calls

	var result: Dictionary = {}
	if not content_parts.is_empty():
		result["content"] = "".join(content_parts)
	if not tool_calls.is_empty():
		result["tool_calls"] = tool_calls
	return result


func _extract_delta(chunk: Dictionary) -> Dictionary:
	var result: Dictionary = {}
	var provider_type: ProviderType = _detect_provider(_get_endpoint(), "")

	match provider_type:
		ProviderType.OPENAI:
			var choice: Variant = chunk.get("choices", [])
			if choice is Array and choice.size() > 0:
				var delta: Dictionary = choice[0].get("delta", {})
				if delta.has("content"):
					result["content"] = delta["content"]
				if delta.has("tool_calls"):
					result["tool_calls"] = delta["tool_calls"]

		ProviderType.ANTHROPIC:
			var delta: Variant = chunk.get("delta", {})
			if delta is Dictionary:
				if delta.get("type") == "text_delta" and delta.has("text"):
					result["content"] = delta["text"]
				if delta.has("tool_calls"):
					result["tool_calls"] = delta["tool_calls"]

		ProviderType.OLLAMA:
			if chunk.has("message"):
				var msg: Dictionary = chunk["message"]
				if msg.has("content"):
					result["content"] = msg["content"]
				if msg.has("tool_calls"):
					result["tool_calls"] = msg["tool_calls"]

	return result


func _extract_from_json(json: Dictionary) -> Dictionary:
	var result: Dictionary = {}
	var provider_type: ProviderType = _detect_provider(_get_endpoint(), "")

	match provider_type:
		ProviderType.OPENAI:
			var choices: Variant = json.get("choices", [])
			if choices is Array and choices.size() > 0:
				var message: Dictionary = choices[0].get("message", {})
				result["content"] = message.get("content", "")
				if message.has("tool_calls"):
					result["tool_calls"] = message["tool_calls"]
			result["usage"] = json.get("usage", {})

		ProviderType.ANTHROPIC:
			var content: Variant = json.get("content", [])
			if content is Array:
				var texts: PackedStringArray = []
				var tcs: Array = []
				for block in content:
					if block is Dictionary:
						if block.get("type") == "text":
							texts.append(block.get("text", ""))
						if block.get("type") == "tool_use":
							tcs.append(block)
				result["content"] = "\n".join(texts)
				if not tcs.is_empty():
					result["tool_calls"] = tcs
			result["usage"] = json.get("usage", {})

		ProviderType.OLLAMA:
			if json.has("message"):
				var msg: Dictionary = json["message"]
				result["content"] = msg.get("content", "")
				if msg.has("tool_calls"):
					result["tool_calls"] = msg["tool_calls"]
			result["usage"] = json.get("usage", {})

	return result


func _get_endpoint() -> String:
	if _http_request and _http_request.get_http_client_status() == HTTPClient.STATUS_CONNECTING:
		return ""
	return _current_provider


func is_busy() -> bool:
	return _http_request and _http_request.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED
