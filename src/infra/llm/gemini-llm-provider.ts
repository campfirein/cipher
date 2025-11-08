import type {GenerateContentConfig} from '@google/genai'

import {GoogleGenAI} from '@google/genai'

import type {ILlmProvider, LlmGenerateParams} from '../../core/interfaces/i-llm-provider.js'
import type {BaseLlmConfig, Tool, ToolExecutor} from '../../core/interfaces/llm-types.js'
import type {InternalMessage, ToolCall} from '../../core/interfaces/message-types.js'

import {
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmMissingToolExecutorError,
  LlmResponseParsingError,
} from '../../core/domain/errors/llm-error.js'
import {GeminiMessageFormatter} from './formatters/gemini-formatter.js'

/**
 * Gemini-specific configuration.
 * Extends the base LLM config with Gemini-specific options.
 */
export type GeminiConfig = BaseLlmConfig

/**
 * Google Gemini LLM provider implementation with tool calling support.
 */
export class GeminiLlmProvider implements ILlmProvider {
  private readonly client: GoogleGenAI
  private readonly config: Required<Omit<GeminiConfig, 'timeout'>> & {timeout?: number}
  private readonly formatter: GeminiMessageFormatter
  private readonly toolExecutor?: ToolExecutor
  private readonly tools: Tool[]

  public constructor(
    config: GeminiConfig,
    tools?: Tool[],
    toolExecutor?: ToolExecutor,
    formatter?: GeminiMessageFormatter,
  ) {
    this.config = {
      apiKey: config.apiKey,
      maxIterations: config.maxIterations ?? 50,
      maxTokens: config.maxTokens ?? 8192,
      model: config.model ?? 'gemini-2.5-flash',
      temperature: config.temperature ?? 0.7,
      timeout: config.timeout,
    }

    this.client = new GoogleGenAI({apiKey: this.config.apiKey})
    this.tools = tools ?? []
    this.toolExecutor = toolExecutor
    this.formatter = formatter ?? new GeminiMessageFormatter()
  }

  /**
   * Generate a response from Gemini with tool calling support.
   * Implements an agentic loop that iterates until the model stops calling tools or max iterations is reached.
   * @param params - Generation parameters including prompt and optional model settings
   * @returns The generated text response
   */
  public async generate(params: LlmGenerateParams): Promise<string> {
    // Initialize history with user message
    const history: InternalMessage[] = [
      {
        content: params.prompt,
        role: 'user',
      },
    ]

    const model = params.model ?? this.config.model
    const temperature = params.temperature ?? this.config.temperature
    const maxOutputTokens = params.maxTokens ?? this.config.maxTokens
    const config = this.buildGenerationConfig(maxOutputTokens, temperature)

    let iteration = 0

    while (iteration < this.config.maxIterations) {
      try {
        // Convert internal messages to Gemini format
        const contents = this.formatter.format(history)

        // Call Gemini API
        // eslint-disable-next-line no-await-in-loop
        const response = await this.client.models.generateContent({
          config,
          contents,
          model,
        })

        // Parse response back to internal format
        const messages = this.formatter.parseResponse(response)
        if (messages.length === 0) {
          throw new LlmResponseParsingError('No messages returned from formatter', 'gemini', model)
        }

        const lastMessage = messages.at(-1)!
        history.push(...messages)

        // Check if there are tool calls
        if (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
          // Return text content, handling different content types
          if (typeof lastMessage.content === 'string') {
            return lastMessage.content
          }

          if (Array.isArray(lastMessage.content)) {
            // Extract text from message parts
            return lastMessage.content
              .filter((part) => part.type === 'text')
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('')
          }

          return ''
        }

        if (!this.toolExecutor) {
          throw new LlmMissingToolExecutorError('gemini', model)
        }

        // Execute tool calls and add results to history
        // eslint-disable-next-line no-await-in-loop
        const toolResults = await this.executeToolCalls(lastMessage.toolCalls)
        history.push(...toolResults)

        iteration++
      } catch (error) {
        // Re-throw LLM errors as-is
        if (
          error instanceof LlmResponseParsingError ||
          error instanceof LlmMissingToolExecutorError ||
          error instanceof LlmGenerationError
        ) {
          throw error
        }

        // Wrap other errors as generation errors
        if (error && typeof error === 'object' && 'message' in error) {
          throw new LlmGenerationError((error as Error).message, 'gemini', model)
        }

        throw new LlmGenerationError(String(error), 'gemini', model)
      }
    }

    throw new LlmMaxIterationsError(this.config.maxIterations, 'gemini', model)
  }

  /**
   * Build generation configuration for Gemini API.
   */
  private buildGenerationConfig(
    maxOutputTokens: number,
    temperature: number,
  ): GenerateContentConfig {
    return {
      maxOutputTokens,
      temperature,
      topP: 1,
      ...(this.tools.length > 0 && {
        tools: [
          {
            functionDeclarations: this.formatToolsForGemini(this.tools),
          },
        ],
      }),
    }
  }

  /**
   * Execute tool calls and return internal messages with results.
   * @param toolCalls - Array of tool calls to execute
   * @returns Array of internal messages containing tool results
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<InternalMessage[]> {
    const results: InternalMessage[] = []

    for (const tc of toolCalls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.toolExecutor!(
          tc.function.name,
          JSON.parse(tc.function.arguments),
        )

        results.push({
          content: result,
          name: tc.function.name,
          role: 'tool',
          toolCallId: tc.id,
        })
      } catch (error) {
        results.push({
          content: `Error: ${(error as Error).message}`,
          name: tc.function.name,
          role: 'tool',
          toolCallId: tc.id,
        })
      }
    }

    return results
  }

  /**
   * Format tools for Gemini API.
   * @param tools - Array of tool definitions
   * @returns Gemini-compatible function declarations
   */
  private formatToolsForGemini(
    tools: Tool[],
  ): Array<{description: string; name: string; parameters: Record<string, unknown>}> {
    return tools.map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: tool.parameters,
    }))
  }
}
