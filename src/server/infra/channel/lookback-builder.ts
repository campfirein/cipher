import {createHash} from 'node:crypto'

import type {ContentBlock, Turn, TurnEvent} from '../../../shared/types/channel.js'

/**
 * Capability-gated lookback rendering (CHANNEL_PROTOCOL.md §5.2,
 * DESIGN.md §4.3).
 *
 * Inputs:
 *   - `priorTurns` — the most recent turns (and their replayed events) to
 *     fold into the lookback transcript.
 *   - `capabilities` — strings derived from the agent's
 *     `agentCapabilities.promptCapabilities` (e.g. `'embeddedContext'`).
 *   - `normalisedPromptBlocks` — the §8.4-normalised prompt blocks the
 *     orchestrator dispatches. We prepend the lookback to these and never
 *     synthesise a trailing text block.
 *
 * Outputs:
 *   - `blocks`: lookback prefix (or nothing) + the user blocks verbatim.
 *   - `digest`: sha256 hex of the rendered lookback bytes — empty string
 *     when no lookback block is emitted (the channel has no prior turns).
 *   - `summary`: short human-readable description for `_meta.brv.channel`.
 *
 * Phase-2 hardcodes the rendering caps:
 *   - last 20 turns
 *   - 4000 chars per turn body
 * Both move to config in Phase 3.
 */

const MAX_TURNS = 20
const MAX_BODY_CHARS = 4000

export type LookbackBuilderArgs = {
  capabilities: string[]
  channelId: string
  normalisedPromptBlocks: ContentBlock[]
  priorTurns: Array<{events: TurnEvent[]; turn: Turn}>
}

export type LookbackBuilderResult = {
  blocks: ContentBlock[]
  digest: string
  summary: string
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max)}… (truncated)`

const renderTurn = (entry: {events: TurnEvent[]; turn: Turn}): string => {
  const headerAuthor = entry.turn.author.handle
  const messageEvents = entry.events.filter((e): e is Extract<TurnEvent, {kind: 'message'}> => e.kind === 'message')
  const messageBody = messageEvents.map((m) => m.content).join('\n')
  return `### Turn ${entry.turn.turnId} — ${headerAuthor}\n\n${truncate(messageBody, MAX_BODY_CHARS)}`
}

export const buildLookback = (args: LookbackBuilderArgs): LookbackBuilderResult => {
  if (args.priorTurns.length === 0) {
    return {blocks: [...args.normalisedPromptBlocks], digest: '', summary: 'no prior turns'}
  }

  const trimmedTurns = args.priorTurns.slice(-MAX_TURNS)
  const transcript = trimmedTurns.map((t) => renderTurn(t)).join('\n\n')
  const heading = `## brv channel lookback\n\n`
  const rendered = `${heading}${transcript}`

  const digest = createHash('sha256').update(rendered, 'utf8').digest('hex')

  const lookbackBlock: ContentBlock = args.capabilities.includes('embeddedContext')
    ? {
        resource: {
          mimeType: 'text/markdown',
          text: rendered,
          uri: `brv-channel://${args.channelId}/lookback`,
        },
        type: 'resource',
      }
    : {text: rendered, type: 'text'}

  return {
    blocks: [lookbackBlock, ...args.normalisedPromptBlocks],
    digest,
    summary: `lookback covers ${trimmedTurns.length} prior turn(s)`,
  }
}
