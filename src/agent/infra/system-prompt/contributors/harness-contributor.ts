import type {
  ContributorContext,
  SystemPromptContributor,
} from '../../../core/domain/system-prompt/types.js'

import {contributeHarnessPrompt} from '../../harness/harness-prompt-contributor.js'

/**
 * System-prompt contributor that renders the mode-specific harness
 * prompt block. Reads `harnessMode` + `harnessVersion` from
 * `ContributorContext` — both are set by `AgentLLMService` after it
 * runs `ensureHarnessReady()` (which does bootstrap + loadHarness +
 * mode selection + event emission). When either is absent, the
 * contributor emits an empty string and the harness block does not
 * land in the system prompt.
 *
 * Priority 18 per `phase_5/task_04-agent-wiring.md`: after context
 * tree (15), map selection (16), swarm state (17) — but before
 * memories (20) so the harness block lands in the high-priority
 * prefix with the other capability-context blocks.
 */
export class HarnessContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number

  public constructor(id: string = 'harness', priority: number = 18) {
    this.id = id
    this.priority = priority
  }

  public async getContent(context: ContributorContext): Promise<string> {
    const {harnessMode, harnessVersion} = context
    if (harnessMode === undefined || harnessVersion === undefined) return ''

    return contributeHarnessPrompt({mode: harnessMode, version: harnessVersion})
  }
}
