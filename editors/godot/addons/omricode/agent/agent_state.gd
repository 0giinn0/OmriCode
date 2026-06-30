# ---------------------------------------------------------------
# agent/agent_state.gd
# OmriCode Godot Plugin — ReAct loop state machine
# ---------------------------------------------------------------
extends RefCounted

enum State {
	IDLE,
	THINKING,
	DECIDING,
	EXECUTING,
	OBSERVING,
	RESPOND
}

const MAX_ITERATIONS := 25
const MAX_ELAPSED_MS := 300000

var current_state: State = State.IDLE
var iterations: int = 0
var _start_time: int = 0
var _last_transition_time: int = 0


func _init() -> void:
	reset()


func transition(to: State) -> bool:
	if not _is_valid_transition(to):
		push_warning("OmriCode: invalid state transition from ", State.keys()[current_state], " to ", State.keys()[to])
		return false

	current_state = to
	_last_transition_time = Time.get_ticks_msec()

	if to == State.EXECUTING or to == State.THINKING:
		iterations += 1

	return true


func _is_valid_transition(to: State) -> bool:
	match current_state:
		State.IDLE:
			return to == State.THINKING
		State.THINKING:
			return to == State.DECIDING
		State.DECIDING:
			return to == State.EXECUTING or to == State.RESPOND
		State.EXECUTING:
			return to == State.OBSERVING
		State.OBSERVING:
			return to == State.THINKING or to == State.RESPOND
		State.RESPOND:
			return to == State.IDLE or to == State.THINKING
		_:
			return false


func reset() -> void:
	current_state = State.IDLE
	iterations = 0
	_start_time = Time.get_ticks_msec()
	_last_transition_time = _start_time


func is_iteration_limit_reached() -> bool:
	return iterations >= MAX_ITERATIONS


func get_elapsed_ms() -> int:
	return Time.get_ticks_msec() - _start_time


func is_timed_out() -> bool:
	return get_elapsed_ms() >= MAX_ELAPSED_MS


func get_state_name() -> String:
	return State.keys()[current_state]


func get_iteration_info() -> Dictionary:
	return {
		"state": get_state_name(),
		"iterations": iterations,
		"max_iterations": MAX_ITERATIONS,
		"elapsed_ms": get_elapsed_ms(),
		"timed_out": is_timed_out()
	}
