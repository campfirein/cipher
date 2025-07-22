/**
 * Content-Based Reasoning Detection Service
 *
 * Analyzes user input to determine if it contains reasoning content that should
 * trigger reflection memory tools. This replaces the model-based activation mechanism.
 */

import { logger } from '../../logger/index.js';
import { ILLMService, LLMConfig } from '../llm/index.js';
import { createContextManager } from '../llm/messages/factory.js';
import { createLLMService } from '../llm/services/factory.js';
import { PromptManager } from '../systemPrompt/manager.js';
import { MCPManager } from '../../mcp/manager.js';
import { UnifiedToolManager } from '../tools/unified-tool-manager.js';

export interface ReasoningDetectionResult {
	containsReasoning: boolean;
	confidence: number;
	detectedPatterns: string[];
	explanation?: string;
}

export interface ReasoningDetectionOptions {
	confidenceThreshold?: number;
	maxPatterns?: number;
	enableDetailedAnalysis?: boolean;
}

/**
 * Default reasoning detection options
 */
const DEFAULT_OPTIONS: Required<ReasoningDetectionOptions> = {
	confidenceThreshold: 0.7,
	maxPatterns: 10,
	enableDetailedAnalysis: false,
};

// Keyword analysis removed - only LLM analysis is used

/**
 * Reasoning content detector that analyzes user input to determine
 * if it contains reasoning patterns that should trigger reflection tools.
 */
export class ReasoningContentDetector {
	private llmService?: ILLMService;
	private promptManager: PromptManager;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager;
	private options: Required<ReasoningDetectionOptions>;
	private evalLlmConfig: LLMConfig;

	constructor(
		promptManager: PromptManager,
		mcpManager: MCPManager,
		unifiedToolManager: UnifiedToolManager,
		evalLlmConfig: LLMConfig,
		options?: ReasoningDetectionOptions
	) {
		this.promptManager = promptManager;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this.evalLlmConfig = evalLlmConfig;
	}

	/**
	 * Initialize the LLM service for reasoning analysis
	 */
	private async initializeLLMService(): Promise<void> {
		if (this.llmService) return;

		try {
			// Use the provided evaluation LLM configuration
			const evalConfig = {
				...this.evalLlmConfig,
				maxIterations: this.evalLlmConfig.maxIterations ?? 3, // Default for eval tasks
			};

			const contextManager = createContextManager(
				evalConfig,
				this.promptManager,
				undefined,
				undefined
			);
			this.llmService = createLLMService(
				evalConfig,
				this.mcpManager,
				contextManager,
				this.unifiedToolManager
			);

			logger.debug('ReasoningContentDetector: LLM service initialized for analysis', {
				provider: evalConfig.provider,
				model: evalConfig.model,
			});
		} catch (error) {
			logger.warn('ReasoningContentDetector: Failed to initialize LLM service for analysis', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Detect if user input contains reasoning content
	 */
	async detectReasoningContent(
		userInput: string,
		context?: {
			sessionId?: string;
			recentMessages?: string[];
			taskType?: string;
		}
	): Promise<ReasoningDetectionResult> {
		try {
			logger.debug('ReasoningContentDetector: Analyzing user input for reasoning content', {
				inputLength: userInput.length,
			});

			// Handle empty or very short input
			if (!userInput || userInput.trim().length < 3) {
				return {
					containsReasoning: false,
					confidence: 0,
					detectedPatterns: [],
					explanation: 'Input too short for reasoning analysis',
				};
			}

			// LLM-based analysis
			await this.initializeLLMService();
			if (this.llmService) {
				const result = await this.detectReasoningByLLM(userInput, context);

				logger.debug('ReasoningContentDetector: Detection completed', {
					containsReasoning: result.containsReasoning,
					confidence: result.confidence,
					patternCount: result.detectedPatterns.length,
				});

				return result;
			} else {
				// Fallback when LLM service is not available
				logger.warn(
					'ReasoningContentDetector: LLM service not available, cannot detect reasoning content'
				);
				return {
					containsReasoning: false,
					confidence: 0,
					detectedPatterns: [],
					explanation: 'LLM service not available for reasoning analysis',
				};
			}
		} catch (error) {
			logger.error('ReasoningContentDetector: Error during reasoning detection', {
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				containsReasoning: false,
				confidence: 0,
				detectedPatterns: [],
				explanation: 'Error during reasoning detection',
			};
		}
	}

	// Keyword analysis removed - only LLM analysis is used

	/**
	 * Detect reasoning content using LLM analysis
	 */
	private async detectReasoningByLLM(
		userInput: string,
		context?: {
			sessionId?: string;
			recentMessages?: string[];
			taskType?: string;
		}
	): Promise<ReasoningDetectionResult> {
		if (!this.llmService) {
			throw new Error('LLM service not available for reasoning analysis');
		}

		try {
			const analysisPrompt = `Analyze the following user input to determine if it contains reasoning content that would benefit from reflection memory tools.

User Input: "${userInput}"

Context: ${context?.taskType ? `Task type: ${context.taskType}` : 'General conversation'}

Please analyze this input and respond with a JSON object containing:
- "containsReasoning": boolean (true if the input contains reasoning patterns, thought processes, problem-solving steps, or analytical content)
- "confidence": number (0.0 to 1.0, how confident you are in this assessment)
- "detectedPatterns": array of strings (specific reasoning patterns you identified)
- "explanation": string (brief explanation of your reasoning)

Consider these factors:
1. Explicit reasoning markers (because, therefore, let me think, etc.)
2. Problem-solving language (debug, analyze, figure out, etc.)
3. Decision-making patterns (consider, evaluate, compare, etc.)
4. Technical reasoning (optimize, design, architecture, etc.)
5. Learning and reflection content (learn, understand, reflect, etc.)

Respond only with the JSON object, no additional text.`;

			const response = await this.llmService.directGenerate(analysisPrompt);

			try {
				// Clean the response to handle common LLM formatting issues
				let cleanedResponse = response.trim();

				logger.debug('ReasoningContentDetector: Raw LLM response', {
					rawResponse: response.substring(0, 300),
					responseLength: response.length,
				});

				// Remove markdown code block formatting if present
				if (cleanedResponse.startsWith('```json')) {
					cleanedResponse = cleanedResponse.replace(/^```json\s*/, '');
				}
				if (cleanedResponse.startsWith('```')) {
					cleanedResponse = cleanedResponse.replace(/^```\s*/, '');
				}
				if (cleanedResponse.endsWith('```')) {
					cleanedResponse = cleanedResponse.replace(/\s*```$/, '');
				}

				// Extract JSON if there's additional text around it
				const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					cleanedResponse = jsonMatch[0];
				}

				logger.debug('ReasoningContentDetector: Cleaned response for JSON parsing', {
					cleanedResponse: cleanedResponse.substring(0, 300),
					cleanedLength: cleanedResponse.length,
				});

				const result = JSON.parse(cleanedResponse);
				return {
					containsReasoning: result.containsReasoning || false,
					confidence: Math.max(0, Math.min(1, result.confidence || 0)),
					detectedPatterns: Array.isArray(result.detectedPatterns)
						? result.detectedPatterns.slice(0, this.options.maxPatterns)
						: [],
					explanation: result.explanation || 'LLM analysis',
				};
			} catch (parseError) {
				logger.warn('ReasoningContentDetector: Failed to parse LLM response', {
					response: response.substring(0, 200),
					error: parseError instanceof Error ? parseError.message : String(parseError),
				});
				return {
					containsReasoning: false,
					confidence: 0,
					detectedPatterns: [],
					explanation: 'Failed to parse LLM response for reasoning detection',
				};
			}
		} catch (error) {
			logger.warn('ReasoningContentDetector: LLM analysis failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				containsReasoning: false,
				confidence: 0,
				detectedPatterns: [],
				explanation: 'LLM analysis failed for reasoning detection',
			};
		}
	}

	// Combined analysis removed - only LLM analysis is used

	/**
	 * Update detection options
	 */
	updateOptions(newOptions: Partial<ReasoningDetectionOptions>): void {
		this.options = { ...this.options, ...newOptions };
		logger.debug('ReasoningContentDetector: Updated options', { newOptions });
	}

	/**
	 * Get current detection options
	 */
	getOptions(): Required<ReasoningDetectionOptions> {
		return { ...this.options };
	}
}
