import { PromptManager } from '../brain/systemPrompt/manager.js';
import { ContextManager, ILLMService } from '../brain/llm/index.js';
import { MCPManager } from '../mcp/manager.js';
import { UnifiedToolManager } from '../brain/tools/unified-tool-manager.js';
import { logger } from '../logger/index.js';
import { env } from '../env.js';
import { createContextManager } from '../brain/llm/messages/factory.js';
import { createLLMService } from '../brain/llm/services/factory.js';
import { MemAgentStateManager } from '../brain/memAgent/state-manager.js';
import { ReasoningContentDetector } from '../brain/reasoning/content-detector.js';
import { SearchContextManager } from '../brain/reasoning/search-context-manager.js';
import { createDatabaseHistoryProvider } from '../brain/llm/messages/history/factory.js';
import { StorageManager } from '../storage/manager.js';
import type { ZodSchema } from 'zod';
import { setImmediate } from 'timers';
import { IConversationHistoryProvider } from '../brain/llm/messages/history/types.js';
export class ConversationSession {
	private contextManager!: ContextManager;
	private llmService!: ILLMService;
	private reasoningDetector?: ReasoningContentDetector;
	private searchContextManager?: SearchContextManager;
	private historyProvider: IConversationHistoryProvider | undefined;
	private historyEnabled: boolean = true;
	private historyBackend: 'database' | 'memory' = 'database';

	private sessionMemoryMetadata?: Record<string, any>;
	private mergeMetadata?: (
		sessionMeta: Record<string, any>,
		runMeta: Record<string, any>
	) => Record<string, any>;
	private metadataSchema?: ZodSchema<any>;
	private beforeMemoryExtraction?: (
		meta: Record<string, any>,
		context: Record<string, any>
	) => void;

	/**
	 * @param services - Required dependencies for the session, including unifiedToolManager
	 * @param id - Session identifier
	 * @param options - Optional advanced metadata options
	 */
	constructor(
		private services: {
			stateManager: MemAgentStateManager;
			promptManager: PromptManager;
			mcpManager: MCPManager;
			unifiedToolManager: UnifiedToolManager;
		},
		public readonly id: string,
		options?: {
			sessionMemoryMetadata?: Record<string, any>;
			mergeMetadata?: (
				sessionMeta: Record<string, any>,
				runMeta: Record<string, any>
			) => Record<string, any>;
			metadataSchema?: ZodSchema<any>;
			beforeMemoryExtraction?: (meta: Record<string, any>, context: Record<string, any>) => void;
			// New: history management options
			historyEnabled?: boolean;
			historyBackend?: 'database' | 'memory';
		}
	) {
		logger.debug('ConversationSession initialized with services', { services, id });
		if (
			options?.sessionMemoryMetadata &&
			typeof options.sessionMemoryMetadata === 'object' &&
			!Array.isArray(options.sessionMemoryMetadata)
		) {
			this.sessionMemoryMetadata = options.sessionMemoryMetadata;
		}
		if (options?.mergeMetadata) this.mergeMetadata = options.mergeMetadata;
		if (options?.metadataSchema) this.metadataSchema = options.metadataSchema;
		if (options?.beforeMemoryExtraction)
			this.beforeMemoryExtraction = options.beforeMemoryExtraction;
		// New: read history options
		if (typeof options?.historyEnabled === 'boolean') this.historyEnabled = options.historyEnabled;
		if (options?.historyBackend) this.historyBackend = options.historyBackend;
	}

	/**
	 * Update session-level memory metadata after construction.
	 */
	public updateSessionMetadata(newMeta: Record<string, any>) {
		this.sessionMemoryMetadata = { ...this.sessionMemoryMetadata, ...newMeta };
	}

	/**
	 * Initialize all services for the session, including history provider.
	 */
	public async init(): Promise<void> {
		await this.initializeServices();
		// Restore history if enabled and provider exists
		if (this.historyEnabled && this.historyProvider && this.contextManager) {
			try {
				await this.contextManager.restoreHistory?.();
				logger.debug(`Session ${this.id}: Conversation history restored.`);
			} catch (err) {
				logger.warn(`Session ${this.id}: Failed to restore conversation history: ${err}`);
			}
		}
	}

	/**
	 * Initializes the services for the session, including the history provider.
	 */
	private async initializeServices(): Promise<void> {
		const llmConfig = this.services.stateManager.getLLMConfig(this.id);
		let historyProvider: IConversationHistoryProvider | undefined = undefined;
		if (this.historyEnabled) {
			try {
				if (this.historyBackend === 'database') {
					// Use a default in-memory storage config for now
					const storageConfig = {
						cache: { type: 'in-memory' as const },
						database: { type: 'in-memory' as const },
					};
					const storageManager = new StorageManager(storageConfig);
					await storageManager.connect();
					historyProvider = createDatabaseHistoryProvider(storageManager);
					logger.debug(`Session ${this.id}: Database history provider initialized.`);
				} else {
					// TODO: Implement or import an in-memory provider if needed
					logger.debug(`Session ${this.id}: In-memory history provider selected.`);
				}
			} catch (err) {
				logger.warn(
					`Session ${this.id}: Failed to initialize history provider, falling back to in-memory. Error: ${err}`
				);
				historyProvider = undefined;
			}
		}
		this.historyProvider = historyProvider;
		// Pass provider and sessionId to context manager
		this.contextManager = createContextManager(
			llmConfig,
			this.services.promptManager,
			historyProvider,
			this.id
		);
		this.llmService = createLLMService(
			llmConfig,
			this.services.mcpManager,
			this.contextManager,
			this.services.unifiedToolManager
		);
		logger.debug(`ChatSession ${this.id}: Services initialized`);
	}

	/**
	 * Extract session-level metadata, merging defaults, session, and per-run metadata.
	 * Uses custom merge and validation if provided.
	 * Now supports environment and extensible context.
	 */
	private getSessionMetadata(customMetadata?: Record<string, any>): Record<string, any> {
		const base = {
			sessionId: this.id,
			source: 'conversation-session',
			timestamp: new Date().toISOString(),
			environment: process.env.NODE_ENV || 'development',
			...this.getSessionContext(),
		};
		const sessionMeta = this.sessionMemoryMetadata || {};
		const customMeta =
			customMetadata && typeof customMetadata === 'object' && !Array.isArray(customMetadata)
				? customMetadata
				: {};
		let merged = this.mergeMetadata
			? this.mergeMetadata(sessionMeta, customMeta)
			: { ...base, ...sessionMeta, ...customMeta };
		if (this.metadataSchema && !this.metadataSchema.safeParse(merged).success) {
			logger.warn(
				'ConversationSession: Metadata validation failed, using session-level metadata only.'
			);
			merged = { ...base, ...sessionMeta };
		}
		return merged;
	}

	/**
	 * Optionally override to provide additional session context for metadata.
	 */
	protected getSessionContext(): Record<string, any> {
		return {};
	}

	/**
	 * Run a conversation session with input, optional image data, streaming, and custom options.
	 * @param input - User input string
	 * @param imageDataInput - Optional image data
	 * @param stream - Optional stream flag
	 * @param options - Optional parameters for memory extraction:
	 *   - memoryMetadata: Custom metadata to attach to memory extraction (merged with session defaults)
	 *   - contextOverrides: Overrides for context fields passed to memory extraction
	 *   - historyTracking: Enable/disable history tracking
	 * @returns An object containing the response and a promise for background operations
	 */
	public async run(
		input: string,
		imageDataInput?: { image: string; mimeType: string },
		stream?: boolean,
		options?: {
			memoryMetadata?: Record<string, any>;
			contextOverrides?: Record<string, any>;
			historyTracking?: boolean;
		}
	): Promise<{ response: string; backgroundOperations: Promise<void> }> {
		// --- Input validation ---
		if (typeof input !== 'string' || input.trim() === '') {
			logger.error('ConversationSession.run: input must be a non-empty string');
			throw new Error('Input must be a non-empty string');
		}

		// --- Session initialization check ---
		if (!this.llmService || !this.contextManager) {
			logger.error('ConversationSession.run: Session not initialized. Call init() before run().');
			throw new Error('ConversationSession is not initialized. Call init() before run().');
		}

		// --- imageDataInput validation ---
		if (imageDataInput !== undefined) {
			if (
				typeof imageDataInput !== 'object' ||
				!imageDataInput.image ||
				typeof imageDataInput.image !== 'string' ||
				!imageDataInput.mimeType ||
				typeof imageDataInput.mimeType !== 'string'
			) {
				logger.error(
					'ConversationSession.run: imageDataInput must have image and mimeType as non-empty strings'
				);
				throw new Error('imageDataInput must have image and mimeType as non-empty strings');
			}
		}

		// --- stream validation ---
		if (stream !== undefined && typeof stream !== 'boolean') {
			logger.warn('ConversationSession.run: stream should be a boolean. Coercing to boolean.');
			stream = Boolean(stream);
		}

		// --- options validation ---
		if (options && typeof options === 'object') {
			const allowedKeys = ['memoryMetadata', 'contextOverrides', 'historyTracking'];
			const unknownKeys = Object.keys(options).filter(k => !allowedKeys.includes(k));
			if (unknownKeys.length > 0) {
				logger.warn(
					`ConversationSession.run: Unknown option keys provided: ${unknownKeys.join(', ')}`
				);
			}
		}

		logger.debug('ConversationSession.run called');
		logger.debug(
			`Running session ${this.id} with input: ${input} and imageDataInput: ${imageDataInput} and stream: ${stream}`
		);

		// Initialize reasoning detector and search context manager if not already done
		await this.initializeReasoningServices();

		// Generate response
		const response = await this.llmService.generate(input, imageDataInput, stream);

		// PROGRAMMATIC ENFORCEMENT: Run memory extraction asynchronously in background AFTER response is returned
		// This ensures users see the response immediately without waiting for memory operations
		const backgroundOperations = new Promise<void>(resolve => {
			setImmediate(async () => {
				logger.debug('Starting background memory operations', { sessionId: this.id });
				try {
					await this.enforceMemoryExtraction(input, response, options);
					logger.debug('Background memory operations completed successfully', {
						sessionId: this.id,
					});
				} catch (error) {
					logger.debug('Background memory extraction failed', {
						sessionId: this.id,
						error: error instanceof Error ? error.message : String(error),
					});
					// Silently continue - memory extraction failures shouldn't affect user experience
				}
				resolve();
			});
		});

		return { response, backgroundOperations };
	}

	/**
	 * Programmatically enforce memory extraction after each user interaction (runs in background)
	 * This ensures the extract_and_operate_memory tool is always called, regardless of AI decisions
	 * NOTE: This method runs asynchronously in the background to avoid delaying the user response
	 */
	private async enforceMemoryExtraction(
		userInput: string,
		aiResponse: string,
		options?: {
			memoryMetadata?: Record<string, any>;
			contextOverrides?: Record<string, any>;
			historyTracking?: boolean;
		}
	): Promise<void> {
		logger.debug('ConversationSession.enforceMemoryExtraction called');
		logger.debug('enforceMemoryExtraction: unifiedToolManager at entry', {
			unifiedToolManager: this.services.unifiedToolManager,
			type: typeof this.services.unifiedToolManager,
		});
		try {
			logger.debug('ConversationSession: Enforcing memory extraction for interaction');

			// Check if the unifiedToolManager is available
			if (!this.services.unifiedToolManager) {
				logger.debug(
					'ConversationSession: UnifiedToolManager not available, skipping memory extraction'
				);
				return;
			}

			// Extract comprehensive interaction data including tool usage
			const comprehensiveInteractionData = await this.extractComprehensiveInteractionData(
				userInput,
				aiResponse
			);

			// Prepare context with overrides
			const defaultContext = {
				sessionId: this.id,
				conversationTopic: 'Interactive CLI session',
				recentMessages: comprehensiveInteractionData,
			};
			const mergedContext = {
				...defaultContext,
				...(options?.contextOverrides &&
				typeof options.contextOverrides === 'object' &&
				!Array.isArray(options.contextOverrides)
					? options.contextOverrides
					: {}),
			};

			// Prepare memory metadata (merge session-level and per-run, per-run takes precedence)
			let memoryMetadata: Record<string, any> = {};
			if (options?.memoryMetadata !== undefined) {
				if (typeof options.memoryMetadata === 'object' && !Array.isArray(options.memoryMetadata)) {
					memoryMetadata = this.getSessionMetadata(options.memoryMetadata);
				} else {
					logger.warn(
						'ConversationSession: Invalid memoryMetadata provided, expected a plain object. Using session-level or default metadata.'
					);
					memoryMetadata = this.getSessionMetadata();
				}
			} else {
				memoryMetadata = this.getSessionMetadata();
			}

			// Call the extract_and_operate_memory tool directly (with cipher_ prefix)
			const memoryResult = await this.services.unifiedToolManager.executeTool(
				'cipher_extract_and_operate_memory',
				{
					interaction: comprehensiveInteractionData,
					context: mergedContext,
					memoryMetadata,
					options: {
						similarityThreshold: 0.7,
						maxSimilarResults: 5,
						useLLMDecisions: true,
						confidenceThreshold: 0.4,
						enableDeleteOperations: true,
						historyTracking: options?.historyTracking ?? true,
					},
				}
			);

			logger.debug('ConversationSession: Memory extraction completed', {
				success: memoryResult.success,
				extractedFacts: memoryResult.extraction?.extracted || 0,
				totalMemoryActions: memoryResult.memory?.length || 0,
				actionBreakdown: memoryResult.memory
					? {
							ADD: memoryResult.memory.filter((a: any) => a.event === 'ADD').length,
							UPDATE: memoryResult.memory.filter((a: any) => a.event === 'UPDATE').length,
							DELETE: memoryResult.memory.filter((a: any) => a.event === 'DELETE').length,
							NONE: memoryResult.memory.filter((a: any) => a.event === 'NONE').length,
						}
					: {},
			});

			// **NEW: Automatic Reflection Memory Processing**
			// Process reasoning traces in the background, similar to knowledge memory
			await this.enforceReflectionMemoryProcessing(userInput, aiResponse);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('ConversationSession: Memory extraction failed', {
				error: errorMessage,
			});
			// Continue execution even if memory extraction fails
		}
	}

	/**
	 * Initialize reasoning services (content detector and search context manager)
	 */
	private async initializeReasoningServices(): Promise<void> {
		if (this.reasoningDetector && this.searchContextManager) {
			return; // Already initialized
		}

		try {
			// Initialize reasoning content detector with evaluation LLM config
			const evalLlmConfig = this.services.stateManager.getEvalLLMConfig(this.id);
			this.reasoningDetector = new ReasoningContentDetector(
				this.services.promptManager,
				this.services.mcpManager,
				this.services.unifiedToolManager,
				evalLlmConfig,
				undefined // Use default options
			);

			// Initialize search context manager
			this.searchContextManager = new SearchContextManager();

			logger.debug('ConversationSession: Reasoning services initialized', { sessionId: this.id });
		} catch (error) {
			logger.warn('ConversationSession: Failed to initialize reasoning services', {
				sessionId: this.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Programmatically enforce reflection memory processing after each interaction (runs in background)
	 * This automatically extracts, evaluates, and stores reasoning patterns in the background
	 * NOTE: This method is called from enforceMemoryExtraction which already runs asynchronously
	 */
	private async enforceReflectionMemoryProcessing(
		userInput: string,
		_aiResponse: string
	): Promise<void> {
		try {
			logger.debug('ConversationSession: Enforcing reflection memory processing');

			// Check if reflection memory is force disabled
			if (env.DISABLE_REFLECTION_MEMORY) {
				logger.debug(
					'ConversationSession: Reflection memory force disabled via DISABLE_REFLECTION_MEMORY, skipping processing'
				);
				return;
			}

			// Initialize reasoning services if not already done
			await this.initializeReasoningServices();

			// Check if reasoning content is detected in user input
			if (!this.reasoningDetector) {
				logger.debug(
					'ConversationSession: Reasoning detector not available, skipping reflection processing'
				);
				return;
			}

			const reasoningDetection = await this.reasoningDetector.detectReasoningContent(userInput, {
				sessionId: this.id,
				taskType: 'conversation',
			});

			// Only proceed if reasoning content is detected
			if (!reasoningDetection.containsReasoning) {
				logger.debug(
					'ConversationSession: No reasoning content detected in user input, skipping reflection processing',
					{
						confidence: reasoningDetection.confidence,
						detectedPatterns: reasoningDetection.detectedPatterns,
					}
				);
				return;
			}

			logger.debug(
				'ConversationSession: Reasoning content detected, proceeding with reflection processing',
				{
					confidence: reasoningDetection.confidence,
					detectedPatterns: reasoningDetection.detectedPatterns,
				}
			);

			// Step 1: Extract reasoning steps from the interaction (only from user input)
			let extractionResult: any;
			try {
				extractionResult = await this.services.unifiedToolManager.executeTool(
					'cipher_extract_reasoning_steps',
					{
						userInput: userInput,
						options: {
							extractExplicit: true,
							extractImplicit: true,
							includeMetadata: true,
						},
					}
				);

				logger.debug('ConversationSession: Reasoning extraction completed', {
					success: extractionResult.success,
					stepCount: extractionResult.result?.trace?.steps?.length || 0,
					traceId: extractionResult.result?.trace?.id,
				});
			} catch (extractError) {
				logger.debug('ConversationSession: Reasoning extraction failed', {
					error: extractError instanceof Error ? extractError.message : String(extractError),
				});
				return; // Skip if extraction fails
			}

			// Only proceed if we extracted reasoning steps
			if (!extractionResult.success || !extractionResult.result?.trace?.steps?.length) {
				logger.debug(
					'ConversationSession: No reasoning steps extracted, skipping evaluation and storage'
				);
				return;
			}

			const reasoningTrace = extractionResult.result.trace;

			// Step 2: Evaluate the reasoning quality using a non-thinking model
			let evaluationResult: any;
			try {
				// Use configured evaluation model or fallback to main LLM
				const evalConfig = this.services.stateManager.getEvalLLMConfig(this.id);
				const evalContextManager = createContextManager(
					evalConfig,
					this.services.promptManager,
					undefined,
					undefined
				);
				const evalLLMService = createLLMService(
					evalConfig,
					this.services.mcpManager,
					evalContextManager,
					this.services.unifiedToolManager
				);
				// Directly call the evaluation tool using the non-thinking model
				evaluationResult = await this.services.unifiedToolManager.executeTool(
					'cipher_evaluate_reasoning',
					{
						trace: reasoningTrace,
						options: {
							checkEfficiency: true,
							detectLoops: true,
							generateSuggestions: true,
						},
						llmService: evalLLMService,
					}
				);

				logger.debug('ConversationSession: Reasoning evaluation completed', {
					success: evaluationResult.success,
					qualityScore: evaluationResult.result?.evaluation?.qualityScore,
					shouldStore: evaluationResult.result?.evaluation?.shouldStore,
				});
			} catch (evalError) {
				logger.debug('ConversationSession: Reasoning evaluation failed', {
					error: evalError instanceof Error ? evalError.message : String(evalError),
					traceId: reasoningTrace.id,
				});
				return; // Skip if evaluation fails
			}

			// Only proceed if evaluation was successful and indicates we should store
			if (!evaluationResult.success || !evaluationResult.result?.evaluation?.shouldStore) {
				logger.debug(
					'ConversationSession: Evaluation indicates should not store, skipping storage',
					{
						shouldStore: evaluationResult.result?.evaluation?.shouldStore,
						qualityScore: evaluationResult.result?.evaluation?.qualityScore,
					}
				);
				return;
			}

			const evaluation = evaluationResult.result.evaluation;

			// Step 3: Store the unified reasoning entry
			try {
				const storageResult = await this.services.unifiedToolManager.executeTool(
					'cipher_store_reasoning_memory',
					{
						trace: reasoningTrace,
						evaluation: evaluation,
					}
				);

				logger.debug('ConversationSession: Reflection memory storage completed', {
					success: storageResult.success,
					stored: storageResult.result?.stored,
					traceId: storageResult.result?.traceId,
					vectorId: storageResult.result?.vectorId,
					stepCount: storageResult.result?.metrics?.stepCount,
					qualityScore: storageResult.result?.metrics?.qualityScore,
				});

				// Log successful end-to-end reflection processing
				if (storageResult.success && storageResult.result?.stored) {
					logger.debug('ConversationSession: Reflection memory processing completed successfully', {
						pipeline: 'extract → evaluate → store',
						traceId: storageResult.result.traceId,
						stepCount: reasoningTrace.steps.length,
						qualityScore: evaluation.qualityScore.toFixed(3),
						issueCount: evaluation.issues?.length || 0,
						suggestionCount: evaluation.suggestions?.length || 0,
					});
				}
			} catch (storageError) {
				logger.debug('ConversationSession: Reflection memory storage failed', {
					error: storageError instanceof Error ? storageError.message : String(storageError),
					traceId: reasoningTrace.id,
					qualityScore: evaluation.qualityScore,
				});
				// Continue execution even if storage fails
			}
		} catch (error) {
			logger.debug('ConversationSession: Reflection memory processing failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			// Continue execution even if reflection processing fails
		}
	}

	/**
	 * Extract comprehensive interaction data including tool calls and results
	 * This captures the complete technical workflow, not just user input and final response
	 */
	private async extractComprehensiveInteractionData(
		userInput: string,
		aiResponse: string
	): Promise<string[]> {
		const interactionData: string[] = [];

		// Start with the user input
		interactionData.push(`User: ${userInput}`);

		// Get recent messages from context manager to extract tool usage
		const recentMessages = await this.contextManager.getRawMessages();

		// Find messages from this current interaction (after the user input)
		// We'll look for the most recent assistant and tool messages
		const currentInteractionMessages = [];
		let foundUserMessage = false;

		// Process messages in reverse to get the most recent interaction
		for (let i = recentMessages.length - 1; i >= 0; i--) {
			const message = recentMessages[i];

			if (!message) {
				continue;
			}

			// Skip if we haven't reached the current user message yet
			if (!foundUserMessage) {
				if (
					message.role === 'user' &&
					Array.isArray(message.content) &&
					message.content.length > 0 &&
					message.content[0] &&
					message.content[0].type === 'text' &&
					'text' in message.content[0] &&
					message.content[0].text === userInput
				) {
					foundUserMessage = true;
				}
				continue;
			}

			// Add messages from this interaction
			if (message.role === 'assistant' || message.role === 'tool') {
				currentInteractionMessages.unshift(message);
			} else {
				// Stop when we hit another user message (previous interaction)
				break;
			}
		}

		// Process the interaction messages to extract technical details
		const toolsUsed: string[] = [];
		const toolResults: string[] = [];

		for (const message of currentInteractionMessages) {
			if (!message) {
				continue;
			}

			if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
				// Extract tool calls
				for (const toolCall of message.toolCalls) {
					const toolName = toolCall.function.name;
					let args = '';
					try {
						const parsedArgs = JSON.parse(toolCall.function.arguments);
						// Summarize key arguments for memory (avoid storing full large content)
						const keyArgs = this.summarizeToolArguments(toolName, parsedArgs);
						args = keyArgs ? ` with ${keyArgs}` : '';
					} catch {
						// If parsing fails, just note that there were arguments
						args = ' with arguments';
					}
					toolsUsed.push(`${toolName}${args}`);
				}
			} else if (message.role === 'tool') {
				// Extract tool results (summarized)
				const toolName = message.name || 'unknown_tool';
				const resultSummary = this.summarizeToolResult(toolName, message.content);
				toolResults.push(`${toolName}: ${resultSummary}`);
			}
		}

		// Add tool usage information to interaction data
		if (toolsUsed.length > 0) {
			interactionData.push(`Tools used: ${toolsUsed.join(', ')}`);
		}

		if (toolResults.length > 0) {
			interactionData.push(`Tool results: ${toolResults.join('; ')}`);
		}

		// Finally add the assistant response
		interactionData.push(`Assistant: ${aiResponse}`);

		logger.debug('ConversationSession: Extracted comprehensive interaction data', {
			userInput: userInput.substring(0, 50),
			toolsUsed: toolsUsed.length,
			toolResults: toolResults.length,
			totalDataPoints: interactionData.length,
		});

		return interactionData;
	}

	/**
	 * Summarize tool arguments for memory storage
	 */
	private summarizeToolArguments(toolName: string, args: any): string {
		switch (toolName) {
			case 'read_file':
				return args.path ? `path: ${args.path}` : 'file read';
			case 'write_file':
				return args.path ? `path: ${args.path}` : 'file write';
			case 'list_files':
				return args.path ? `directory: ${args.path}` : 'directory listing';
			case 'cipher_memory_search':
				return args.query
					? `query: "${args.query.substring(0, 50)}${args.query.length > 50 ? '...' : ''}"`
					: 'memory search';
			default:
				// For other tools, try to extract key identifying information
				if (args.query)
					return `query: "${args.query.substring(0, 30)}${args.query.length > 30 ? '...' : ''}"`;
				if (args.path) return `path: ${args.path}`;
				if (args.file) return `file: ${args.file}`;
				return 'arguments provided';
		}
	}

	/**
	 * Summarize tool results for memory storage
	 */
	private summarizeToolResult(toolName: string, content: any): string {
		try {
			// Handle string content
			if (typeof content === 'string') {
				const parsed = JSON.parse(content);
				return this.formatToolResultSummary(toolName, parsed);
			}

			// Handle object content
			if (typeof content === 'object') {
				return this.formatToolResultSummary(toolName, content);
			}

			return 'result received';
		} catch {
			// If parsing fails, provide a basic summary
			const contentStr = String(content);
			return contentStr.length > 100 ? `${contentStr.substring(0, 100)}...` : contentStr;
		}
	}

	/**
	 * Format tool result summary based on tool type
	 */
	private formatToolResultSummary(toolName: string, result: any): string {
		switch (toolName) {
			case 'read_file':
				if (result.content && Array.isArray(result.content) && result.content.length > 0) {
					const text = result.content[0].text || '';
					const lines = text.split('\n').length;
					const size = text.length;
					return `file read (${lines} lines, ${size} chars)`;
				}
				return 'file read';

			case 'cipher_memory_search':
				if (result.results && Array.isArray(result.results)) {
					return `found ${result.results.length} memory entries`;
				}
				return 'memory search completed';

			case 'list_files':
				if (result.content && Array.isArray(result.content)) {
					const files = result.content.filter((item: any) => item.type === 'file').length;
					const dirs = result.content.filter((item: any) => item.type === 'directory').length;
					return `listed ${files} files, ${dirs} directories`;
				}
				return 'directory listing';

			default:
				// Generic result summary
				if (result.success !== undefined) {
					return result.success ? 'completed successfully' : 'failed';
				}
				if (result.error) {
					return `error: ${String(result.error).substring(0, 50)}`;
				}
				return 'completed';
		}
	}

	/**
	 * Disconnects the history provider if it exists (for session teardown).
	 */
	public async disconnect(): Promise<void> {
		if (this.historyProvider && typeof (this.historyProvider as any).disconnect === 'function') {
			try {
				await (this.historyProvider as any).disconnect();
				logger.debug(`Session ${this.id}: History provider disconnected.`);
			} catch (err) {
				logger.warn(`Session ${this.id}: Failed to disconnect history provider: ${err}`);
			}
		}
	}

	public getContextManager(): ContextManager {
		return this.contextManager;
	}

	public getLLMService(): ILLMService {
		return this.llmService;
	}

	public getUnifiedToolManager(): UnifiedToolManager {
		return this.services.unifiedToolManager;
	}
}
