import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'
import type {MemoryStore} from './memory-store.js'
import type {NCLMCompletion, NCLMCoreConfig, NCLMState} from './nclm-core-types.js'

import {NCLMErrorThresholdError, NCLMTimeoutError, NCLMTokenLimitError} from './nclm-core-types.js'
import {buildNCLMSystemPrompt} from './nclm-prompts.js'
import {NCLMSandbox} from './nclm-sandbox.js'

const CODE_BLOCK_PATTERN = /```(?:javascript|js|repl)\n([\s\S]*?)```/g

/**
 * Extract fenced code blocks from LLM response text.
 */
export function findCodeBlocks(text: string): string[] {
  const blocks: string[] = []
  let match: null | RegExpExecArray
  // Reset lastIndex for safety
  CODE_BLOCK_PATTERN.lastIndex = 0
  while ((match = CODE_BLOCK_PATTERN.exec(text)) !== null) {
    const code = match[1].trim()
    if (code) {
      blocks.push(code)
    }
  }

  return blocks
}

/**
 * NCLMCore — the iteration loop for SDK mode.
 *
 * Calls the LLM, parses code blocks from the response, executes them
 * in NCLMSandbox with memory_* functions, and repeats until FINAL
 * is called or resource limits are exceeded.
 */
export class NCLMCore {
  private readonly config: NCLMCoreConfig & Required<Pick<NCLMCoreConfig, 'maxDepth' | 'maxErrors' | 'maxIterations' | 'persistent'>>
  private readonly controller: IContentGenerator
  private readonly memoryStore: MemoryStore
  private sandbox: NCLMSandbox

  constructor(
    controller: IContentGenerator,
    memoryStore: MemoryStore,
    config?: NCLMCoreConfig,
  ) {
    this.controller = controller
    this.memoryStore = memoryStore
    this.config = {
      maxDepth: 2,
      maxErrors: 3,
      maxIterations: 10,
      persistent: true,
      ...config,
    }
    this.sandbox = this.createSandbox()
  }

  /**
   * Run the full iteration loop until FINAL or limits exceeded.
   */
  async completion(prompt: string): Promise<NCLMCompletion> {
    // In non-persistent mode, reset sandbox each call
    if (!this.config.persistent) {
      this.sandbox = this.createSandbox()
    }

    const state: NCLMState = {
      bestPartialAnswer: null,
      cumulativeTokens: {input: 0, output: 0},
      errorCount: 0,
      iterationCount: 0,
      messageHistory: [],
      startTime: Date.now(),
    }

    // Build system prompt with memory state
    const memoryInjection = this.memoryStore.buildInjection(this.config.injectionBudgets)
    const systemPrompt = buildNCLMSystemPrompt(memoryInjection)

    // System prompt is passed via request.systemPrompt, not in messageHistory.
    // Only user/assistant messages go in contents to avoid duplication.
    state.messageHistory.push({content: prompt, role: 'user'})

    for (let i = 0; i < this.config.maxIterations; i++) {
      this.checkLimits(state)

      // Call the LLM — sequential by design: each iteration depends on previous results
      // eslint-disable-next-line no-await-in-loop
      const response = await this.controller.generateContent({
        config: {maxTokens: 8192, temperature: 0.7},
        contents: state.messageHistory.map((m) => ({
          content: m.content,
          role: m.role as 'assistant' | 'user',
        })),
        model: '',
        systemPrompt,
        taskId: `nclm-${Date.now()}`,
      })

      state.iterationCount++

      // Track usage
      if (response.usage) {
        state.cumulativeTokens.input += response.usage.promptTokens
        state.cumulativeTokens.output += response.usage.completionTokens
      }

      // Parse code blocks
      const codeBlocks = findCodeBlocks(response.content)

      if (codeBlocks.length === 0) {
        // No code blocks — treat the response text as a partial answer
        state.bestPartialAnswer = response.content
        state.messageHistory.push({content: response.content, role: 'assistant'}, {content: 'Please write code to continue or call FINAL() with your answer.', role: 'user'})
        continue
      }

      // Execute code blocks
      let hadError = false
      for (const code of codeBlocks) {
        const result = this.sandbox.execute(code)

        if (result.finalAnswer) {
          return {
            executionTime: Date.now() - state.startTime,
            iterations: state.iterationCount,
            response: result.finalAnswer,
            usage: {
              inputTokens: state.cumulativeTokens.input,
              outputTokens: state.cumulativeTokens.output,
            },
          }
        }

        if (result.stderr) {
          hadError = true
          state.messageHistory.push({content: response.content, role: 'assistant'}, {content: `Error: ${result.stderr}`, role: 'user'})

          break
        }

        // Format execution results for the LLM
        const output = [
          result.stdout ? `stdout: ${result.stdout}` : '',
          result.returnValue === undefined ? '' : `result: ${JSON.stringify(result.returnValue)}`,
        ].filter(Boolean).join('\n')

        state.messageHistory.push({content: response.content, role: 'assistant'}, {content: output || '(code executed successfully, no output)', role: 'user'})
      }

      if (hadError) {
        state.errorCount++
      } else {
        state.errorCount = 0
        state.bestPartialAnswer = response.content
      }

      // Compact history if it grows too large (keep first user prompt + last 6 messages)
      if (state.messageHistory.length > 20) {
        this.compactHistory(state)
      }
    }

    // Max iterations reached
    return {
      executionTime: Date.now() - state.startTime,
      iterations: state.iterationCount,
      response: state.bestPartialAnswer ?? 'Max iterations reached without a final answer.',
      usage: {
        inputTokens: state.cumulativeTokens.input,
        outputTokens: state.cumulativeTokens.output,
      },
    }
  }

  private checkLimits(state: NCLMState): void {
    if (this.config.maxTimeout) {
      const elapsed = Date.now() - state.startTime
      if (elapsed > this.config.maxTimeout) {
        throw new NCLMTimeoutError(state.bestPartialAnswer)
      }
    }

    if (this.config.maxTokens) {
      const totalTokens = state.cumulativeTokens.input + state.cumulativeTokens.output
      if (totalTokens > this.config.maxTokens) {
        throw new NCLMTokenLimitError(state.bestPartialAnswer)
      }
    }

    if (this.config.maxErrors && state.errorCount >= this.config.maxErrors) {
      throw new NCLMErrorThresholdError(state.bestPartialAnswer)
    }
  }

  private compactHistory(state: NCLMState): void {
    // Keep user prompt (first message) + last 6 messages
    const head = state.messageHistory.slice(0, 1)
    const tail = state.messageHistory.slice(-6)
    const compactedCount = state.messageHistory.length - head.length - tail.length

    state.messageHistory = [
      ...head,
      {content: `[${compactedCount} earlier messages compacted]`, role: 'user' as const},
      ...tail,
    ]
  }

  private createSandbox(): NCLMSandbox {
    const depth = this.config.depth ?? 0

    return new NCLMSandbox(this.memoryStore, {
      llmQuery: async (prompt: string) => {
        const response = await this.controller.generateContent({
          config: {maxTokens: 4096, temperature: 0.7},
          contents: [{content: prompt, role: 'user'}],
          model: '',
          taskId: `nclm-llm-${Date.now()}`,
        })

        return response.content
      },
      nclmQuery: depth < (this.config.maxDepth ?? 2)
        ? async (prompt: string) => {
          const child = new NCLMCore(this.controller, this.memoryStore, {
            ...this.config,
            depth: depth + 1,
            persistent: false,
          })
          const result = await child.completion(prompt)

          return result.response
        }
        : async (prompt: string) => {
          // At max depth — fallback to plain LLM call
          const response = await this.controller.generateContent({
            config: {maxTokens: 4096, temperature: 0.7},
            contents: [{content: prompt, role: 'user'}],
            model: '',
            taskId: `nclm-fallback-${Date.now()}`,
          })

          return response.content
        },
    })
  }
}
