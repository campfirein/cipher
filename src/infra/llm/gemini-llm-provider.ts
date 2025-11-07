import type {
  Content,
  FunctionCall,
  GenerateContentConfig,
  GenerateContentResponse,
  Part,
} from '@google/genai'

import {GoogleGenAI} from '@google/genai'

import type {ILlmProvider, LlmGenerateParams} from '../../core/interfaces/i-llm-provider.js'
import type {BaseLlmConfig, Tool, ToolExecutor} from '../../core/interfaces/llm-types.js'

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
  private readonly toolExecutor?: ToolExecutor
  private readonly tools: Tool[]

  public constructor(config: GeminiConfig, tools?: Tool[], toolExecutor?: ToolExecutor) {
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
  }

  /**
   * Generate a response from Gemini with tool calling support.
   * Implements an agentic loop that iterates until the model stops calling tools or max iterations is reached.
   * @param params - Generation parameters including prompt and optional model settings
   * @returns The generated text response
   */
  public async generate(params: LlmGenerateParams): Promise<string> {
    const contents: Content[] = [
      {
        parts: [{text: params.prompt}],
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
        // eslint-disable-next-line no-await-in-loop
        const response = await this.client.models.generateContent({
          config,
          contents,
          model,
        })

        const {candidateContent, functionCalls, textParts} = this.processResponse(response)

        contents.push(candidateContent)

        if (functionCalls.length === 0) {
          return textParts.join('')
        }

        if (!this.toolExecutor) {
          throw new Error('Function calls requested but no tool executor provided')
        }

        // eslint-disable-next-line no-await-in-loop
        const functionResponseParts = await this.executeFunctionCalls(functionCalls)
        contents.push({
          parts: functionResponseParts,
          role: 'user',
        })

        iteration++
      } catch (error) {
        if (error && typeof error === 'object' && 'message' in error) {
          throw new Error(`Gemini API error: ${(error as Error).message}`)
        }

        throw new Error(`Failed to generate response: ${String(error)}`)
      }
    }

    throw new Error(`Max iterations (${this.config.maxIterations}) reached without completion`)
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
   * Execute function calls and return response parts.
   */
  private async executeFunctionCalls(functionCalls: FunctionCall[]): Promise<Part[]> {
    const functionResponseParts: Part[] = []

    for (const functionCall of functionCalls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const toolResult = await this.toolExecutor!(
          functionCall.name ?? '',
          functionCall.args as Record<string, unknown>,
        )

        functionResponseParts.push({
          functionResponse: {
            name: functionCall.name ?? '',
            response: {
              result: toolResult,
            },
          },
        })
      } catch (error) {
        functionResponseParts.push({
          functionResponse: {
            name: functionCall.name ?? '',
            response: {
              error: `Error executing function ${functionCall.name ?? ''}: ${(error as Error).message}`,
            },
          },
        })
      }
    }

    return functionResponseParts
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

  /**
   * Extract text from Gemini response.
   * @param response - Gemini generate content response
   * @returns Extracted text
   */
  private getResponseText(response: GenerateContentResponse): string {
    const candidate = response.candidates?.[0]
    if (!candidate?.content?.parts) {
      return ''
    }

    const textParts: string[] = []
    for (const part of candidate.content.parts) {
      if ('text' in part && part.text) {
        textParts.push(part.text)
      }
    }

    return textParts.join('')
  }

  /**
   * Process and validate Gemini response, extracting text and function calls.
   */
  private processResponse(response: GenerateContentResponse | null): {
    candidateContent: Content
    functionCalls: FunctionCall[]
    textParts: string[]
  } {
    if (!response) {
      throw new Error('No response returned from Gemini')
    }

    const candidate = response.candidates?.[0]
    if (!candidate?.content?.parts) {
      throw new Error('No candidate or content returned from Gemini')
    }

    const textParts: string[] = []
    const functionCalls: FunctionCall[] = []

    for (const part of candidate.content.parts) {
      if ('text' in part && part.text) {
        textParts.push(part.text)
      }

      if ('functionCall' in part && part.functionCall) {
        functionCalls.push(part.functionCall)
      }
    }

    return {
      candidateContent: candidate.content,
      functionCalls,
      textParts,
    }
  }
}
