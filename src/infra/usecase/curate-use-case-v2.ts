import {randomUUID} from 'node:crypto'

import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {CurateExecuteOptionsV2, ICurateUseCaseV2} from '../../core/interfaces/usecase/i-curate-use-case-v2.js'

import {FileValidationError} from '../../core/domain/errors/task-error.js'
import {validateFileForCurate} from '../../utils/file-validator.js'
import {CipherAgent} from '../cipher/agent/index.js'
import {getAgentStorage} from '../cipher/storage/agent-storage.js'

/**
 * CurateUseCaseV2 - Simplified curate use case for v0.5.0 architecture.
 *
 * Key differences from v1:
 * - Only executeWithAgent method (no run() for REPL mode)
 * - No terminal/tracking dependencies (handled by caller)
 * - Pure business logic execution
 *
 * This class is designed for Transport-based task execution where:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - UseCase focuses solely on curate business logic
 */
export class CurateUseCaseV2 implements ICurateUseCaseV2 {
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
  public async executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptionsV2): Promise<string> {
    const {content, files} = options

    // Initialize storage for execution tracking
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Process file references if provided (validation + instructions)
      const fileReferenceInstructions = this.processFileReferences(files ?? [])
      if (fileReferenceInstructions === undefined) {
        throw new FileValidationError()
      }

      // Create execution with status='running'
      executionId = storage.createExecution('curate', content)

      // Build prompt with optional file reference instructions
      const prompt = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

      // Execute with curate commandType
      // Agent uses its default session (created during start())
      const cipherAgent = agent as CipherAgent
      const trackingRequestId = randomUUID()
      const response = await cipherAgent.execute(prompt, {
        executionContext: {commandType: 'curate'},
        trackingRequestId,
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
   * @returns Formatted instructions for the agent to read the specified files,
   *          or undefined if validation fails
   */
  private processFileReferences(filePaths: string[]): string | undefined {
    if (!filePaths || filePaths.length === 0) {
      return ''
    }

    // Truncate if exceeds max files
    let processedPaths = filePaths
    if (filePaths.length > CurateUseCaseV2.MAX_FILES) {
      processedPaths = filePaths.slice(0, CurateUseCaseV2.MAX_FILES)
    }

    // Get project root (current directory)
    const projectRoot = process.cwd()

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
