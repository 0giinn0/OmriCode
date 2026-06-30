"""Agent state machine for OmriCode AI.

Defines the possible states of the ReAct agent loop and provides a
simple state machine with transition validation, iteration tracking,
and elapsed-time measurement.
"""

import time
from enum import Enum, auto


class AgentStates(Enum):
    """Possible states for the agent execution loop."""

    idle = auto()
    thinking = auto()
    deciding = auto()
    executing = auto()
    observing = auto()
    respond = auto()


# Valid transitions: current_state -> set of allowed next states
_VALID_TRANSITIONS = {
    AgentStates.idle: {AgentStates.thinking},
    AgentStates.thinking: {AgentStates.deciding, AgentStates.respond},
    AgentStates.deciding: {AgentStates.executing, AgentStates.respond},
    AgentStates.executing: {AgentStates.observing},
    AgentStates.observing: {AgentStates.thinking, AgentStates.respond},
    AgentStates.respond: {AgentStates.idle},
}


class AgentState:
    """Finite state machine for the agent loop.

    Attributes:
        state: Current AgentStates value.
        iteration: Number of completed thinking/deciding/executing cycles.
        _start_time: Monotonic timestamp when state machine was last reset.
        _max_iterations: Maximum allowed iterations before forced stop.
    """

    def __init__(self, max_iterations: int = 25):
        self._state: AgentStates = AgentStates.idle
        self.iteration: int = 0
        self._start_time: float = time.monotonic()
        self._max_iterations: int = max_iterations

    # ── Properties ───────────────────────────────────────────────

    @property
    def state(self) -> AgentStates:
        """Get the current agent state."""
        return self._state

    @property
    def elapsed_ms(self) -> float:
        """Return milliseconds elapsed since last reset."""
        return (time.monotonic() - self._start_time) * 1000.0

    @property
    def max_iterations(self) -> int:
        """Get the maximum allowed iterations."""
        return self._max_iterations

    # ── Transitions ──────────────────────────────────────────────

    def transition(self, to: AgentStates) -> None:
        """Transition to *to* state if the move is valid.

        Args:
            to: Target state.

        Raises:
            ValueError: If the transition is not allowed.
        """
        allowed = _VALID_TRANSITIONS.get(self._state, set())
        if to not in allowed:
            raise ValueError(
                f"Invalid transition: {self._state.name} -> {to.name}. "
                f"Allowed: {[s.name for s in allowed]}"
            )
        self._state = to

    def reset(self) -> None:
        """Reset state machine to idle with zero iteration count."""
        self._state = AgentStates.idle
        self.iteration = 0
        self._start_time = time.monotonic()

    def is_iteration_limit_reached(self) -> bool:
        """Check whether the agent has exceeded max iterations.

        Returns:
            True if iteration >= max_iterations.
        """
        return self.iteration >= self._max_iterations
