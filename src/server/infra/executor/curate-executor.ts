import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {CurateExecuteOptions, ICurateExecutor} from '../../../core/interfaces/executor/i-curate-executor.js'

import {FileValidationError} from '../../../core/domain/errors/task-error.js'
import {validateFileForCurate} from '../../../utils/file-validator.js'

/**
 * CurateExecutor - Executes curate tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with curate-specific options.
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on curate execution
 */
export class CurateExecutor implements ICurateExecutor {
  /**
   * Maximum number of files allowed in --files flag
   */
  private static readonly MAX_FILES = 5

  public async executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string> {
    const {clientCwd, content, files, taskId} = options

    // Process file references (throws FileValidationError if validation fails)
    const fileReferenceInstructions = this.processFileReferences(files ?? [], clientCwd)

    // Build prompt with optional file reference instructions
    const prompt = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

    // Execute with curate commandType
    // Agent uses its default session (created during start())
    // Task lifecycle is managed by Transport (task:started, task:completed, task:error)
    const response = await agent.execute(prompt, {
      executionContext: {commandType: 'curate'},
      taskId,
    })

    return response
  }

  /**
   * Process file paths from --files flag.
   *
   * @param filePaths - Array of file paths (relative or absolute)
   * @param clientCwd - Client's working directory for file validation (optional, defaults to process.cwd())
   * @returns Formatted instructions for the agent to read the specified files
   * @throws {FileValidationError} If any file validation fails
   */
  private processFileReferences(filePaths: string[], clientCwd?: string): string {
    if (!filePaths || filePaths.length === 0) {
      return ''
    }

    // Truncate if exceeds max files
    let processedPaths = filePaths
    if (filePaths.length > CurateExecutor.MAX_FILES) {
      processedPaths = filePaths.slice(0, CurateExecutor.MAX_FILES)
    }

    const projectRoot = clientCwd ?? process.cwd()

    // Validate each file and collect errors
    const validPaths: string[] = []
    const errors: string[] = []

    for (const filePath of processedPaths) {
      const result = validateFileForCurate(filePath, projectRoot)

      if (result.valid && result.normalizedPath) {
        validPaths.push(result.normalizedPath)
      } else {
        errors.push(result.error ?? `Invalid file: ${filePath}`)
      }
    }

    // If there are any validation errors, throw with specific messages
    if (errors.length > 0) {
      const errorMessage = `File validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
      throw new FileValidationError(errorMessage)
    }

    // Format instructions for the agent
    const instructions = [
      '\n## IMPORTANT: Critical Files to Read (--files flag)',
      '',
      'The user has explicitly specified these files as critical context that MUST be read before creating knowledge topics:',
      '',
      ...validPaths.map((p) => `- ${p}`),
      '',
      '**MANDATORY INSTRUCTIONS:**',
      '- You MUST use the `read_file` tool to read ALL of these files IN PARALLEL (in a single iteration) before proceeding to create knowledge topics',
      '- These files contain essential context that will help you create comprehensive and accurate knowledge topics',
      '- Read them in parallel to maximize efficiency - they do not depend on each other',
      '- **CRITICAL:** Only curate files where `read_file` returns `success: true`. Files that return `success: false` are error messages and should not be curated.',
      '- After reading all files, proceed with the normal workflow: detect domains, find existing knowledge, and create/update topics',
      '',
    ]

    return instructions.join('\n')
  }
}
