import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * System prompt contributor that injects tool selection guidance for
 * parallel map tools (llm_map, agentic_map).
 *
 * Only active for 'curate' and 'curate-folder' commands, and only when
 * the map tools are available in the current tool set.
 *
 * Based on VoltCode's subagent-rules.txt and symbolic-recursion.txt.
 */
export class MapSelectionContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number

  constructor(id: string, priority: number) {
    this.id = id
    this.priority = priority
  }

  public async getContent(context: ContributorContext): Promise<string> {
    // Only inject for curate commands
    if (context.commandType !== 'curate') {
      return ''
    }

    const tools = context.availableTools ?? []
    const hasLlmMap = tools.includes(ToolName.LLM_MAP)
    const hasAgenticMap = tools.includes(ToolName.AGENTIC_MAP)

    // Only inject if at least one map tool is available
    if (!hasLlmMap && !hasAgenticMap) {
      return ''
    }

    const lines = [
      '<parallel-processing-guidance>',
      'When processing multiple items during curation, choose the right approach:',
      '',
      '| Scenario | Tool | Why |',
      '|----------|------|-----|',
      '| 1-5 items, context-dependent decisions | Direct curate tool | Cross-item awareness needed |',
    ]

    if (hasLlmMap) {
      lines.push(
        '| 5+ items, independent extraction/classification | llm_map | Parallel stateless LLM calls, fast |',
      )
    }

    if (hasAgenticMap) {
      lines.push(
        '| 5+ items, need file reads or tool access | agentic_map | Parallel sub-agents with tools |',
      )
    }

    lines.push(
      '| Cross-item dedup/merge decisions | Always direct curate | Needs full context tree visibility |',
      '',
      'Key rules:',
      '- Map tools process items in COMPLETE ISOLATION — each item cannot see others.',
      '- Use map tools for the extraction/classification PHASE, then curate tool for final decisions.',
      '- Two-phase pattern for folder curation: (1) llm_map to extract knowledge from each file, (2) curate to deduplicate and organize.',
      '- Input/output for map tools: JSONL files (one JSON object per line).',
      '',
      'Map tool output behavior:',
      '- Map tools may return a `summaryHandle` field — bounded continuation context summarizing processed items.',
      '- `summaryHandle` is optional helper context; its absence is non-fatal (fail-open design).',
      '- The JSONL output file is always the source of truth for per-item results.',
      '- Cross-item deduplication must happen in the curate phase, not during map processing.',
      '</parallel-processing-guidance>',
    )

    return lines.join('\n')
  }
}
