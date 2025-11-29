// TODO: Will deprecate. Replaced by Context Tree

import type {Playbook} from '../../core/domain/entities/playbook.js'
import type {ReflectorOutput} from '../../core/domain/entities/reflector-output.js'
import type {IAcePromptBuilder, ReflectorPromptParams} from '../../core/interfaces/i-ace-prompt-builder.js'

/**
 * Default implementation of ACE prompts using template strings.
 * These prompts are designed to work with coding agents (Claude Code, Cursor, etc.)
 * and LLMs that understand structured JSON output.
 */
export class AcePromptTemplates implements IAcePromptBuilder {
  public buildCuratorPrompt(reflection: ReflectorOutput, playbook: Playbook, questionContext: string): string {
    const playbookText = playbook.asPrompt()
    const stats = playbook.stats()

    return `You are the curator of the ACE playbook.
Your role is to transform reflections into structured playbook updates.

## Your Principles
- Only add genuinely NEW insights not already captured in the playbook
- Update existing bullets if the reflection provides better clarity
- Remove bullets that have been proven incorrect or harmful
- Keep bullets concise, specific, and actionable
- Organize bullets into clear sections (e.g., "Common Errors", "Best Practices", "Strategies")

## Recent Reflection

**Task Context**: ${questionContext}

**Error Identified**: ${reflection.errorIdentification}

**Root Cause**: ${reflection.rootCauseAnalysis}

**Correct Approach**: ${reflection.correctApproach}

**Key Insight**: ${reflection.keyInsight}

**Bullet Tags**:
${reflection.bulletTags.map((bt) => `- ${bt.id}: ${bt.tag}`).join('\n')}

## Current Playbook (${stats.bullets} bullets, ${stats.sections} sections)
${playbookText}

## Instructions

Review the reflection and determine what changes to make to the playbook.

**Operation Types**:
- **ADD**: Create a new bullet with fresh insights
- **UPDATE**: Modify an existing bullet with better information
- **REMOVE**: Delete a bullet that's been proven incorrect

For each operation, provide:
- **type**: The operation type (ADD, UPDATE, or REMOVE)
- **section**: Which section (e.g., "Common Errors", "Best Practices")
- **content**: The bullet text (for ADD/UPDATE)
- **bulletId**: The existing bullet ID (for UPDATE/REMOVE)
- **metadata**: Structured metadata with:
  - codebasePath: Relevant file path or context
  - tags: Array of relevant tags (e.g., ["typescript", "error-handling"])
  - timestamp: Will be auto-generated

Output as a JSON object:
{
  "reasoning": "Explain your curation decisions",
  "operations": [
    {
      "type": "ADD",
      "section": "Common Errors",
      "content": "Specific, actionable lesson learned",
      "metadata": {
        "codebasePath": "/relevant/path",
        "tags": ["tag1", "tag2"],
        "timestamp": "${new Date().toISOString()}"
      }
    },
    {
      "type": "UPDATE",
      "section": "Best Practices",
      "bulletId": "practices-00001",
      "content": "Updated guidance based on reflection",
      "metadata": {
        "codebasePath": "/relevant/path",
        "tags": ["tag1", "tag2"],
        "timestamp": "${new Date().toISOString()}"
      }
    },
    {
      "type": "REMOVE",
      "section": "Strategies",
      "bulletId": "strategies-00003"
    }
  ]
}

If no changes are needed, return an empty operations array.`
  }

  public buildExecutorPrompt(task: string, context: string, playbook: Playbook, recentReflections: string[]): string {
    const playbookText = playbook.asPrompt()
    const reflectionsText =
      recentReflections.length > 0 ? recentReflections.join('\n\n---\n\n') : 'No recent reflections.'

    const stats = playbook.stats()
    const statsText = `Playbook contains ${stats.bullets} bullets across ${stats.sections} sections.`

    return `You are a software developer solving tasks using a knowledge playbook.
The playbook contains strategies, lessons learned, and common errors to avoid.

## Your Task
${task}

## Additional Context
${context || 'None provided'}

## Playbook (${statsText})
${playbookText}

## Recent Reflections
${reflectionsText}

## Instructions
1. Review the playbook for relevant strategies and common errors
2. Consider recent reflections to avoid repeating mistakes
3. Reference specific bullets by their IDs when applying strategies
4. Show your step-by-step reasoning
5. Use tools as needed to complete the task
6. Track which bullets you reference and which tools you use

Your response will be captured for later analysis, so be thorough in your reasoning.`
  }

  public buildReflectorPrompt(params: ReflectorPromptParams): string {
    const {executorOutput, feedback, groundTruth, playbook, task} = params
    const playbookText = playbook.asPrompt()
    const groundTruthText = groundTruth ?? 'Not available'

    return `You are a senior code reviewer analyzing an execution trajectory.
Your goal is to identify what went wrong, why it happened, and what lessons can be learned.

## Original Task
${task}

## Executor's Reasoning
${executorOutput.reasoning}

## Executor's Final Answer
${executorOutput.finalAnswer}

## Bullets Referenced
${executorOutput.bulletIds.length > 0 ? executorOutput.bulletIds.join(', ') : 'None'}

## Tools Used
${executorOutput.toolUsage.length > 0 ? executorOutput.toolUsage.join(', ') : 'None'}

## Environment Feedback
${feedback}

## Ground Truth (Expected Answer)
${groundTruthText}

## Current Playbook
${playbookText}

## Instructions
Analyze the executor's performance and provide:

1. **Error Identification**: What specifically went wrong? Be precise.
2. **Root Cause Analysis**: Why did this error occur? What was the underlying cause?
3. **Correct Approach**: What should have been done instead? Be specific and actionable.
4. **Key Insight**: What reusable lesson can be extracted for the playbook?
5. **Bullet Tags**: For each bullet the executor referenced, tag it with a relevant tags

Output your analysis as a JSON object with this structure:
{
  "reasoning": "Your detailed analysis of what happened",
  "errorIdentification": "What went wrong",
  "rootCauseAnalysis": "Why it happened",
  "correctApproach": "What should have been done",
  "keyInsight": "Reusable lesson for the playbook",
  "bulletTags": [
    {"id": "bullet-00001", "tag": ["tag1", "tag2"]}
    {"id": "bullet-00002", "tag": ["tag1", "tag2"]}
  ]
}

Be thorough and constructive in your analysis.`
  }
}
