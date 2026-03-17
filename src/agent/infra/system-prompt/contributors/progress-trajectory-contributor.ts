import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'
import type {SessionProgressTracker} from '../../llm/context/session-progress-tracker.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on output characters (~200 tokens at ~4 chars/token). */
const MAX_OUTPUT_CHARS = 800

// ---------------------------------------------------------------------------
// ProgressTrajectoryContributor
// ---------------------------------------------------------------------------

/**
 * Session-scoped system prompt contributor that injects a compact progress summary.
 *
 * Renders a markdown table with iteration count, tool call success/failure ratios,
 * compression events, token utilization trend, and top tools.
 *
 * Returns empty string when no iterations have completed yet (iteration 0),
 * so the very first prompt is unaffected.
 *
 * **Note**: Since session contributors are appended after SystemPromptManager.build(),
 * the `priority` field has no effect on ordering — it is kept for interface compatibility.
 */
export class ProgressTrajectoryContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly tracker: SessionProgressTracker

  constructor(id: string, priority: number, tracker: SessionProgressTracker) {
    this.id = id
    this.priority = priority
    this.tracker = tracker
  }

  public async getContent(_context: ContributorContext): Promise<string> {
    const snapshot = this.tracker.getSnapshot()

    // Nothing to report on first iteration
    if (snapshot.iterationCount === 0) {
      return ''
    }

    const lines: string[] = [
      '<sessionProgress>',
      '## Session Progress',
      '| Metric | Value |',
      '|---|---|',
      `| Iterations | ${snapshot.iterationCount} |`,
      `| Tool calls | ${snapshot.toolCallCount} (${snapshot.toolSuccessCount} ok, ${snapshot.toolFailureCount} err) |`,
    ]

    if (snapshot.compressionCount > 0) {
      lines.push(`| Compressions | ${snapshot.compressionCount} |`)
    }

    if (snapshot.tokenUtilizationHistory.length > 0) {
      const trend = snapshot.tokenUtilizationHistory
        .map((p) => `${p}%`)
        .join(' \u2192 ')
      lines.push(`| Token trend | ${trend} |`)
    }

    if (snapshot.topTools.length > 0) {
      const toolSummary = snapshot.topTools
        .map((t) => `${t.name}(${t.count})`)
        .join(', ')
      lines.push(`| Top tools | ${toolSummary} |`)
    }

    if (snapshot.doomLoopCount > 0) {
      lines.push(`| Doom loops | ${snapshot.doomLoopCount} |`)
    }

    if (snapshot.errorCount > 0) {
      lines.push(`| Errors | ${snapshot.errorCount} |`)
    }

    lines.push('</sessionProgress>')

    let output = lines.join('\n')

    // Hard-cap output to stay within token budget
    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.slice(0, MAX_OUTPUT_CHARS - 20) + '\n</sessionProgress>'
    }

    return output
  }
}
