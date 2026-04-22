import type {HarnessMode, HarnessVersion} from '../../core/domain/harness/types.js'

export interface PromptContributionContext {
  readonly mode: HarnessMode
  readonly version: HarnessVersion
}

// Per-mode body text. Kept short on purpose — each block ≤ 400 chars
// advisory, ≤ 600 hard ceiling in tests — because this text lands on
// every turn's system prompt. Longer bodies burn context without
// improving weak-model behavior.
const MODE_BODIES: Readonly<Record<HarnessMode, string>> = {
  assisted: [
    'A learned `harness.curate(ctx)` function is available for curate tasks in this project.',
    'It has been validated on recent invocations; call it when the task is a clean match for curate.',
    'For tasks that don\'t fit, orchestrate with `tools.*` as usual.',
  ].join(' '),

  filter: [
    'A `harness.curate(ctx)` function is available for curate tasks here.',
    'When the task fits the harness, state your plan briefly and then invoke `harness.curate(ctx)`.',
    'If the harness approach does not fit this task, write your own orchestration instead.',
  ].join(' '),

  policy: [
    'This project has a proven `harness.curate(ctx)` for curate tasks.',
    'For this request, invoke `harness.curate(ctx)` directly.',
    'Do NOT write your own orchestration code — the harness handles this end to end.',
  ].join(' '),
}

/**
 * Render the mode-specific harness prompt block. Returns an empty
 * string when `ctx` is `undefined` (harness disabled, below Mode A
 * threshold, or no version in store). Block is wrapped in identifiable
 * `<harness-v2 …>` tags so a downstream prompt assembler can locate or
 * strip it.
 */
export function contributeHarnessPrompt(ctx?: PromptContributionContext): string {
  if (ctx === undefined) return ''

  const body = MODE_BODIES[ctx.mode]
  return `<harness-v2 mode="${ctx.mode}" version="${ctx.version.id}">\n${body}\n</harness-v2>`
}
