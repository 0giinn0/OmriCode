# ---------------------------------------------------------------
# agent/agent_loop.gd
# OmriCode Godot Plugin — ReAct loop controller
# ---------------------------------------------------------------
extends RefCounted

signal loop_started()
signal loop_finished(success: bool, response: String)
signal step_completed(step: Dictionary)
signal error_occurred(message: String)

const MAX_ITERATIONS := 25

enum LoopState { IDLE, THINKING, DECIDING, EXECUTING, OBSERVING, RESPOND }

var state_machine: Resource = null
var message_history: Resource = null
var tool_executor: Resource = null
var http_client: Node = null
var scene_context: Resource = null
var provider_config: Resource = null

var _current_state: LoopState = LoopState.IDLE
var _iteration: int = 0
var _current_thinking: String = ""
var _cancelled: bool = false
var _user_callback: Callable = Callable()


func _init() -> void:
	state_machine = preload("agent_state.gd").new()
	message_history = preload("message_history.gd").new()


func process_message(text: String) -> void:
	if _current_state != LoopState.IDLE:
		push_warning("OmriCode: loop already running")
		return

	_cancelled = false
	_iteration = 0
	_current_state = LoopState.THINKING
	state_machine.reset()
	state_machine.transition(agent_state.State.THINKING)
	message_history.add("user", text)

	loop_started.emit()
	_run_loop()


func cancel() -> void:
	_cancelled = true
	_current_state = LoopState.IDLE
	state_machine.transition(agent_state.State.IDLE)
	if http_client and http_client.has_method("cancel"):
		http_client.cancel()


func _run_loop() -> void:
	if _cancelled:
		_finish(false, "Cancelled")
		return

	if _iteration >= MAX_ITERATIONS:
		_finish(false, "Maximum iterations (%d) reached" % MAX_ITERATIONS)
		return

	if state_machine.is_timed_out():
		_finish(false, "Timed out after %d ms" % state_machine.get_elapsed_ms())
		return

	match _current_state:
		LoopState.THINKING:
			_do_thinking()
		LoopState.DECIDING:
			_do_deciding()
		LoopState.EXECUTING:
			_do_executing()
		LoopState.OBSERVING:
			_do_observing()
		LoopState.RESPOND:
			_do_respond()


func _do_thinking() -> void:
	_iteration += 1
	_current_thinking = ""
	if not state_machine.transition(agent_state.State.THINKING):
		return

	var provider: Resource
	if provider_config:
		provider = provider_config.get_current()

	if provider == null:
		error_occurred.emit("No provider configured")
		_finish(false, "No provider configured")
		return

	var system_prompt: String = ""
	if scene_context:
		system_prompt = scene_context.build_system_prompt()

	var messages: Array = message_history.get_provider_messages(system_prompt)
	var tool_descriptions: Array = []
	if tool_executor:
		tool_descriptions = tool_executor.get_tool_descriptions()

	var provider_dict: Dictionary = provider.to_dict()

	if http_client == null or not is_instance_valid(http_client):
		error_occurred.emit("HTTP client not available")
		_finish(false, "HTTP client not available")
		return

	# Connect temporarily for the response
	var connection = http_client.request_completed.connect(_on_llm_response, CONNECT_ONE_SHOT)
	if connection != OK:
		error_occurred.emit("Failed to connect to HTTP client")
		_finish(false, "Internal error")
		return

	http_client.send_message(messages, tool_descriptions, provider_dict)


func _on_llm_response(success: bool, data: Dictionary) -> void:
	if _cancelled:
		return

	if not success:
		error_occurred.emit(data.get("error", "Unknown error"))
		message_history.add("system", "[Error: " + data.get("error", "API call failed") + "]")
		_current_state = LoopState.RESPOND
		_run_loop()
		return

	var content: String = data.get("content", "")
	var tool_calls: Array = data.get("tool_calls", [])

	_current_thinking = content
	message_history.add("assistant", content)

	if tool_calls.is_empty():
		# No tools needed, respond directly
		state_machine.transition(agent_state.State.RESPOND)
		_current_state = LoopState.RESPOND
	else:
		message_history.add("assistant", "[Tool calls: " + str(tool_calls.size()) + "]")
		state_machine.transition(agent_state.State.DECIDING)
		_current_state = LoopState.DECIDING
		_current_tool_calls = tool_calls

	_run_loop()


var _current_tool_calls: Array = []


func _do_deciding() -> void:
	if not state_machine.transition(agent_state.State.DECIDING):
		return

	if _current_tool_calls.is_empty():
		_current_state = LoopState.RESPOND
		state_machine.transition(agent_state.State.RESPOND)
		_run_loop()
		return

	state_machine.transition(agent_state.State.EXECUTING)
	_current_state = LoopState.EXECUTING
	_run_loop()


func _do_executing() -> void:
	if not state_machine.transition(agent_state.State.EXECUTING):
		return

	if _current_tool_calls.is_empty():
		_current_state = LoopState.OBSERVING
		_run_loop()
		return

	var tool_call: Dictionary = _current_tool_calls[0]
	_current_tool_calls.remove_at(0)

	var name: String = tool_call.get("function", {}).get("name", "") if tool_call.has("function") else tool_call.get("name", "")
	var args_raw: Variant = tool_call.get("function", {}).get("arguments", "{}") if tool_call.has("function") else tool_call.get("input", "{}")
	var args: Dictionary = {}

	if args_raw is String:
		var parsed: Variant = JSON.parse_string(args_raw)
		if parsed is Dictionary:
			args = parsed
	elif args_raw is Dictionary:
		args = args_raw

	var result: Dictionary = {}
	if tool_executor:
		result = tool_executor.execute(name, args)
	else:
		result = {"success": false, "output": "", "error": "Tool executor not available"}

	var observation: String = ""
	if result.get("success", false):
		observation = result.get("output", "")
	else:
		observation = "[Error: " + result.get("error", "Unknown error") + "]"

	message_history.add("system", "[Tool result: " + name + "]\n" + observation)

	step_completed.emit({
		"tool": name,
		"args": args,
		"success": result.get("success", false),
		"output": observation,
		"iteration": _iteration
	})

	_current_state = LoopState.EXECUTING
	_run_loop()


func _do_observing() -> void:
	if not state_machine.transition(agent_state.State.OBSERVING):
		return

	state_machine.transition(agent_state.State.THINKING)
	_current_state = LoopState.THINKING
	_run_loop()


func _do_respond() -> void:
	if not state_machine.transition(agent_state.State.RESPOND):
		return

	var response: String = _current_thinking
	if response.is_empty():
		response = "I've completed the task. Let me know what else you need."

	state_machine.transition(agent_state.State.IDLE)
	_current_state = LoopState.IDLE

	_finish(true, response)


func _finish(success: bool, response: String) -> void:
	_current_state = LoopState.IDLE
	state_machine.reset()
	loop_finished.emit(success, response)

	if _user_callback.is_valid():
		_user_callback.call(success, response)
		_user_callback = Callable()


func is_running() -> bool:
	return _current_state != LoopState.IDLE


func get_state_info() -> Dictionary:
	return {
		"state": LoopState.keys()[_current_state],
		"iteration": _iteration,
		"max_iterations": MAX_ITERATIONS,
		"cancelled": _cancelled,
		"elapsed_ms": state_machine.get_elapsed_ms() if state_machine else 0
	}
