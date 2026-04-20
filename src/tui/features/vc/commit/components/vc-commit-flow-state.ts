/**
 * Pure state machine for the TUI commit flow.
 *
 * Split out of vc-commit-flow.tsx so the transitions are unit-testable
 * without spinning up an Ink tree. The component owns side effects
 * (firing mutations, rendering Ink nodes); this module owns decisions.
 *
 * Required by ENG-2002 §Signing Flow step 2: encrypted-key passphrase
 * prompting must live in the TUI (not oclif).
 */

import {VcErrorCode} from '../../../../../shared/transport/events/vc-events.js'
import {formatTransportError, getTransportErrorCode} from '../../../../utils/error-messages.js'

/** Cap matches the retry limit the pre-B1 oclif command used to enforce. */
export const MAX_PASSPHRASE_RETRIES = 3

export type CommitFlowState =
  | {attempt: number; kind: 'awaiting-passphrase'}
  | {attempt: number; kind: 'committing'}
  | {kind: 'done'; message: string; outcome: 'cancelled' | 'error' | 'success'}

export type CommitFlowEvent =
  | {error: unknown; type: 'commit-error'}
  | {message: string; sha: string; signed?: boolean; type: 'commit-success'}
  | {type: 'passphrase-cancelled'}
  | {type: 'passphrase-submitted'}

export const initialCommitFlowState: CommitFlowState = {attempt: 0, kind: 'committing'}

export function reduceCommitFlow(
  state: CommitFlowState,
  event: CommitFlowEvent,
): CommitFlowState {
  if (state.kind === 'done') return state

  switch (event.type) {
    case 'commit-error': {
      const code = getTransportErrorCode(event.error)
      if (code === VcErrorCode.PASSPHRASE_REQUIRED && state.kind === 'committing') {
        // Daemon re-rejected after a passphrase retry: cap the loop.
        if (state.attempt >= MAX_PASSPHRASE_RETRIES) {
          return {
            kind: 'done',
            message: `Too many failed passphrase attempts (${MAX_PASSPHRASE_RETRIES}).`,
            outcome: 'error',
          }
        }

        return {attempt: state.attempt + 1, kind: 'awaiting-passphrase'}
      }

      return {
        kind: 'done',
        message: `Failed to commit: ${formatTransportError(event.error)}`,
        outcome: 'error',
      }
    }

    case 'commit-success': {
      const signed = event.signed ? ' 🔏' : ''
      return {
        kind: 'done',
        message: `[${event.sha.slice(0, 7)}] ${event.message}${signed}`,
        outcome: 'success',
      }
    }

    case 'passphrase-cancelled': {
      if (state.kind !== 'awaiting-passphrase') return state
      return {
        kind: 'done',
        message: 'Passphrase entry cancelled.',
        outcome: 'cancelled',
      }
    }

    case 'passphrase-submitted': {
      if (state.kind !== 'awaiting-passphrase') return state
      return {attempt: state.attempt, kind: 'committing'}
    }
  }
}
