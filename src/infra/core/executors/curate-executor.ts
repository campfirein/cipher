import type {ICipherAgent} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {CurateExecuteOptions, ICurateExecutor} from '../../../core/interfaces/executor/i-curate-executor.js'

import {FileValidationError} from '../../../core/domain/errors/task-error.js'
import {validateFileForCurate} from '../../../utils/file-validator.js'
import {getAgentStorage} from '../../cipher/storage/agent-storage.js'

/**
 * CurateExecutor - Executes curate tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with curate-specific options.
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - Executor focuses solely on curate execution
 */
export class CurateExecutor implements ICurateExecutor {
  /**
   * Maximum number of files allowed in --files flag
   */
  private static readonly MAX_FILES = 5

  /**
   * Execute curate with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (content, file references)
   * @returns Result string from agent execution
   */
  public async executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string> {
    const {clientCwd, content, files, taskId} = options

    // Initialize storage for execution tracking
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      const fileReferenceInstructions = this.processFileReferences(files ?? [], clientCwd)
      if (fileReferenceInstructions === undefined) {
        throw new FileValidationError()
      }

      // Create execution with status='running'
      // Save in JSON format with all fields for tracking:
      // - content: the context to curate
      // - files: original file paths (if provided)
      // - fileReferenceInstructions: generated instructions (if files provided and valid)
      const executionInput = JSON.stringify({
        content,
        ...(fileReferenceInstructions ? {fileReferenceInstructions} : {}),
        ...(files && files.length > 0 ? {files} : {}),
      })
      executionId = storage.createExecution('curate', executionInput)

      // Build prompt with optional file reference instructions
      const prompt = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

      // Execute with curate commandType
      // Agent uses its default session (created during start())
      const response = await agent.execute(prompt, {
        executionContext: {commandType: 'curate'},
        taskId,
      })

      // Mark execution as completed
      storage.updateExecutionStatus(executionId, 'completed', response)

      // Cleanup old executions
      storage.cleanupOldExecutions(100)

      return response
    } catch (error) {
      // Mark execution as failed
      if (executionId) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        storage.updateExecutionStatus(executionId, 'failed', undefined, errorMessage)
      }

      throw error
    }
  }

  /**
   * Process file paths from --files flag.
   *
   * @param filePaths - Array of file paths (relative or absolute)
   * @param clientCwd - Client's working directory for file validation (optional, defaults to process.cwd())
   * @returns Formatted instructions for the agent to read the specified files,
   *          or undefined if validation fails
   */
  private processFileReferences(filePaths: string[], clientCwd?: string): string | undefined {
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

    // If there are any validation errors, return undefined
    if (errors.length > 0) {
      return undefined
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
      '- After reading all files, proceed with the normal workflow: detect domains, find existing knowledge, and create/update topics',
      '',
    ]

    return instructions.join('\n')
  }
}
