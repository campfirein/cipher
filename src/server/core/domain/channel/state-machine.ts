import type {Turn, TurnState, TurnTransitionEvent} from './types.js'

import {InvalidTransitionError} from './errors.js'

/**
 * Pure state-machine for channel turn lifecycle.
 *
 * Returns a new `Turn` with `state` updated and `endedAt` populated when
 * the next state is terminal. Throws `InvalidTransitionError` for any
 * illegal move (including any transition out of a terminal state).
 *
 * Failure reasons are NOT stored on `Turn` — they flow into `events.jsonl`
 * as a `{kind: 'error', ...}` `TurnEvent` written by the orchestrator.
 */
export function transition(turn: Turn, event: TurnTransitionEvent, now: () => string = isoNow): Turn {
  const next = nextState(turn.state, event)
  if (next === null) {
    throw new InvalidTransitionError(turn.state, event.type)
  }

  const updated: Turn = {...turn, state: next}
  if (TERMINAL_STATES.has(next) && !updated.endedAt) {
    updated.endedAt = now()
  }

  return updated
}

export function isTerminalState(state: TurnState): boolean {
  return TERMINAL_STATES.has(state)
}

const TERMINAL_STATES: ReadonlySet<TurnState> = new Set([
  'cancelled',
  'completed',
  'expired',
  'failed',
])

function nextState(state: TurnState, event: TurnTransitionEvent): null | TurnState {
  // Terminal states accept no further transitions.
  if (TERMINAL_STATES.has(state)) {
    return null
  }

  switch (event.type) {
    case 'await_permission': {
      return state === 'in_flight' ? 'awaiting_permission' : null
    }

    case 'cancel': {
      // Any non-terminal state can be cancelled.
      return 'cancelled'
    }

    case 'complete': {
      return state === 'in_flight' ? 'completed' : null
    }

    case 'expire': {
      return state === 'awaiting_permission' ? 'expired' : null
    }

    case 'fail': {
      // Any non-terminal state can fail.
      return 'failed'
    }

    case 'permission_decision': {
      if (state !== 'awaiting_permission') {
        return null
      }

      return event.decision === 'deny' ? 'failed' : 'in_flight'
    }

    case 'route': {
      return state === 'submitted' ? 'routing' : null
    }

    case 'start': {
      return state === 'routing' ? 'in_flight' : null
    }
  }
}

function isoNow(): string {
  return new Date().toISOString()
}
