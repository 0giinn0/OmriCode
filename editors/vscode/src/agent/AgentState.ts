/**
 * AgentState.ts
 * OmriCode — Agent State Machine
 *
 * Finite state machine for the ReAct agent loop.
 * Tracks the current state, handles transitions, and
 * enforces iteration limits and timeouts.
 *
 * States:
 *   IDLE       → Waiting for user input
 *   THINKING   → Model is generating a response
 *   DECIDING   → Parsing model output (FC or S/R)
 *   EXECUTING  → Running a tool
 *   OBSERVING  → Feeding tool result back to model
 *   RESPOND    → Showing final answer to user
 */

import { MessageStatus } from '../types/message';

export type AgentStateName =
  | 'idle'
  | 'thinking'
  | 'deciding'
  | 'executing'
  | 'observing'
  | 'respond'
  | 'error';

interface StateTransition {
  from: AgentStateName[];
  to: AgentStateName;
}

const TRANSITIONS: StateTransition[] = [
  { from: ['idle'], to: 'thinking' },
  { from: ['thinking'], to: 'deciding' },
  { from: ['deciding'], to: 'executing' },
  { from: ['deciding'], to: 'respond' },
  { from: ['deciding'], to: 'thinking' }, // continued thinking
  { from: ['executing'], to: 'observing' },
  { from: ['observing'], to: 'thinking' },
  { from: ['observing'], to: 'respond' },
  { from: ['respond'], to: 'idle' },
  { from: ['thinking', 'executing', 'observing'], to: 'error' },
  { from: ['error'], to: 'idle' }
];

export class AgentState {
  private _state: AgentStateName = 'idle';
  private _iterationCount: number = 0;
  private _maxIterations: number;
  private _startTime: number = 0;

  constructor(maxIterations: number = 25) {
    this._maxIterations = maxIterations;
  }

  get state(): AgentStateName {
    return this._state;
  }

  get iterationCount(): number {
    return this._iterationCount;
  }

  get elapsedMs(): number {
    if (this._startTime === 0) return 0;
    return Date.now() - this._startTime;
  }

  get isActive(): boolean {
    return this._state !== 'idle' && this._state !== 'respond' && this._state !== 'error';
  }

  get maxIterations(): number {
    return this._maxIterations;
  }

  setMaxIterations(n: number): void {
    this._maxIterations = n;
  }

  /**
   * Transition to a new state. Throws if transition is invalid.
   */
  transition(to: AgentStateName): void {
    const valid = TRANSITIONS.find(
      t => t.to === to && t.from.includes(this._state)
    );

    if (!valid) {
      throw new Error(
        `Invalid state transition: ${this._state} → ${to}`
      );
    }

    // Track iterations (executing counts as an iteration)
    if (to === 'executing') {
      this._iterationCount++;
    }

    // Reset timer on turn start
    if (to === 'thinking' && this._state === 'idle') {
      this._startTime = Date.now();
      this._iterationCount = 0;
    }

    this._state = to;
  }

  /**
   * Force-set state (for error recovery).
   */
  forceState(state: AgentStateName): void {
    this._state = state;
  }

  /**
   * Check if iteration limit is reached.
   */
  isIterationLimitReached(): boolean {
    return this._iterationCount >= this._maxIterations;
  }

  /**
   * Map agent state to chat message status for UI display.
   */
  toMessageStatus(): MessageStatus {
    switch (this._state) {
      case 'thinking': return 'thinking';
      case 'deciding': return 'thinking';
      case 'executing': return 'executing_tool';
      case 'observing': return 'waiting_tool';
      case 'respond': return 'complete';
      case 'error': return 'error';
      case 'idle': return 'pending';
    }
  }

  /**
   * Reset state to idle for a new turn.
   */
  reset(): void {
    this._state = 'idle';
    this._iterationCount = 0;
    this._startTime = 0;
  }
}
