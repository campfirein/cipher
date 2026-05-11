import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {BRV_DIR} from '../../server/constants.js'

/**
 * Curate session protocol — CLI-side placeholder for the multi-step
 * curate flow that byterover-tool-mode introduces.
 *
 * Background. Today's `brv curate` runs an LLM agent inside byterover.
 * Tool mode removes that agent: the calling agent (Claude Code) owns
 * the LLM, byterover validates + writes. Because a subprocess can't
 * call back into its parent, the protocol is multi-step: kickoff
 * returns `needs-llm-step` with a prompt; the calling agent produces
 * the response and re-invokes `brv curate` with `--session`/`--response`.
 * Byterover holds session state between invocations.
 *
 * Scope of this module (TKT 01). The placeholder always emits one
 * `needs-llm-step` on kickoff and `done` on the first continuation —
 * no real orchestration, no search, no validation. The point is to
 * lock the wire protocol so TKT 02's real state machine and TKT 04's
 * SKILL.md can be written against a stable envelope.
 *
 * Storage. CLI-local state on disk under `<projectRoot>/.brv/sessions/
 * curate-<id>/state.json`. TKT 02 will move state into the daemon's
 * existing task-session sandbox vars when the real orchestrator lands
 * (the search service + index already live in the daemon, so the move
 * collapses two state-stores into one).
 */

export const CURATE_SESSIONS_DIR = 'sessions'
export const CURATE_SESSION_PREFIX = 'curate-'

/**
 * Wire envelope returned by both kickoff and continuation calls.
 * Stable. Reviewer note in the task file: renaming a key here is a
 * breaking change once SKILL.md (TKT 04) ships against this shape.
 */
export type CurateSessionEnvelope = {
  /** Validation errors. Present on `correct-html` steps and on `failed`. */
  errors?: Array<{
    attribute?: string
    kind: string
    message: string
    tag?: string
  }>
  /** Set when `status === 'done'` — relative path under `.brv/context-tree/`. */
  filePath?: string
  /** Aggregated success flag — `true` when the overall protocol made progress (not the LLM-step result). */
  ok: boolean
  /** Free-text instruction for the calling agent's LLM. Placeholder emits a stub string. */
  prompt?: string
  /** Optional per-step schema slice (e.g. bv-* spec subset). Placeholder omits. */
  schema?: object
  /** Returned by every `needs-llm-step` so the caller can address subsequent continuations. */
  sessionId?: string
  status: 'done' | 'failed' | 'needs-llm-step'
  /** Tells the calling agent what kind of completion to produce. */
  step?: 'correct-html' | 'generate-html'
}

/**
 * On-disk session record. Schema is intentionally minimal for the
 * placeholder — TKT 02's real orchestrator will extend with state
 * enum, retry counter, user intent, etc.
 */
type CurateSessionState = {
  createdAt: number
  /** Session step the placeholder last emitted; trivial state machine. */
  step: 'awaiting-generate'
  userIntent: string
}

type KickoffOptions = {
  content: string
  projectRoot: string
}

type ContinueOptions = {
  projectRoot: string
  response: string
  sessionId: string
}

/**
 * Kickoff a new placeholder session. Persists state and returns the
 * `needs-llm-step` envelope. Always succeeds (no validation in the
 * placeholder).
 */
export async function kickoffSession(options: KickoffOptions): Promise<CurateSessionEnvelope> {
  const {content, projectRoot} = options
  const sessionId = randomUUID()

  const state: CurateSessionState = {
    createdAt: Date.now(),
    step: 'awaiting-generate',
    userIntent: content,
  }

  await writeSessionState(projectRoot, sessionId, state)

  return {
    ok: true,
    prompt: buildStubGeneratePrompt(content),
    sessionId,
    status: 'needs-llm-step',
    step: 'generate-html',
  }
}

/**
 * Continue an existing session. Reads state, marks the session
 * complete, removes state. The placeholder always succeeds on first
 * continuation; TKT 02 wires real validation and the correct-html
 * retry loop.
 */
export async function continueSession(options: ContinueOptions): Promise<CurateSessionEnvelope> {
  const {projectRoot, response, sessionId} = options

  const state = await readSessionState(projectRoot, sessionId)
  if (!state) {
    return {
      errors: [
        {
          kind: 'unknown-session',
          message: `No active session with id ${sessionId}. Either the kickoff was never run, or the session was already completed/cleaned up.`,
        },
      ],
      ok: false,
      status: 'failed',
    }
  }

  // Placeholder: validate response is non-empty as a sanity check;
  // TKT 02 replaces this with the real validateHtmlTopic + correction
  // retry loop.
  if (!response || response.trim().length === 0) {
    return {
      errors: [
        {
          kind: 'empty-response',
          message: 'Continuation --response must be non-empty.',
        },
      ],
      ok: false,
      sessionId,
      status: 'failed',
    }
  }

  await clearSessionState(projectRoot, sessionId)

  return {
    filePath: `placeholder/${sessionId}.html`,
    ok: true,
    status: 'done',
  }
}

function buildStubGeneratePrompt(userIntent: string): string {
  return [
    `Generate a <bv-topic>...</bv-topic> HTML document for the following user intent:`,
    '',
    userIntent,
    '',
    `[PLACEHOLDER PROMPT — TKT 03 replaces this with the full schema + UPDATE-vs-CREATE framing.]`,
    `Return ONLY the bv-topic document. No prose, no code fences.`,
  ].join('\n')
}

async function writeSessionState(projectRoot: string, sessionId: string, state: CurateSessionState): Promise<void> {
  const dir = sessionDir(projectRoot, sessionId)
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8')
}

async function readSessionState(projectRoot: string, sessionId: string): Promise<CurateSessionState | undefined> {
  const file = join(sessionDir(projectRoot, sessionId), 'state.json')
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw) as CurateSessionState
  } catch {
    return undefined
  }
}

async function clearSessionState(projectRoot: string, sessionId: string): Promise<void> {
  await rm(sessionDir(projectRoot, sessionId), {force: true, recursive: true})
}

function sessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, BRV_DIR, CURATE_SESSIONS_DIR, `${CURATE_SESSION_PREFIX}${sessionId}`)
}
