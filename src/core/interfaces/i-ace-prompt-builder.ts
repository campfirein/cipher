import type {ExecutorOutput} from '../domain/entities/executor-output.js'
import type {Playbook} from '../domain/entities/playbook.js'
import type {ReflectorOutput} from '../domain/entities/reflector-output.js'

/**
 * Port for building prompts for ACE pipeline
 * This abstraction allows different prompt strategies for different roles of coding agent
 */
export interface IAcePromptBuilder {
  /**
   * Builds the curator prompt for updating the playbook.
   * The curator transforms reflections into structured playbook updates.
   *
   * @param reflection The reflector's analysis and insights
   * @param playbook The current playbook to update
   * @param questionContext Context about what task was being solved
   * @returns A prompt string ready for the coding agent
   */
  buildCuratorPrompt: (
    reflection: ReflectorOutput,
    playbook: Playbook,
    questionContext: string,
  ) => string

  /**
   * Builds the executor (generator) prompt for coding agents.
   * The executor uses the playbook to solve tasks with context-aware reasoning.
   *
   * @param task The task or question to solve
   * @param context Additional context about the task (e.g., file contents, error messages)
   * @param playbook The knowledge playbook containing strategies and lessons
   * @param recentReflections Recent reflection summaries to avoid repeating mistakes
   * @returns A prompt string ready for the coding aqgent
   */
  buildExecutorPrompt: (
    task: string,
    context: string,
    playbook: Playbook,
    recentReflections: string[],
  ) => string

  /**
   * Builds the reflector prompt for analyzing execution results.
   * The reflector identifies errors, root causes, and key insights.
   *
   * @param task The original task that was attempted
   * @param executorOutput The executor's reasoning and answer
   * @param playbook The current playbook for reference
   * @param feedback Environment feedback (e.g., test results, error messages)
   * @param groundTruth Optional correct answer for comparison
   * @returns A prompt string ready for the coding agent
   */
  // eslint-disable-next-line max-params
  buildReflectorPrompt: (
    task: string,
    executorOutput: ExecutorOutput,
    playbook: Playbook,
    feedback: string,
    groundTruth?: string,
  ) => string
}
