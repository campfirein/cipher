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
import {
	createMultiBackendHistoryProvider,
	createDatabaseHistoryProvider,
} from '../brain/llm/messages/history/factory.js';
import { WALHistoryProvider } from '../brain/llm/messages/history/wal.js';
import { StorageManager } from '../storage/manager.js';
import type { ZodSchema } from 'zod';
import { setImmediate } from 'timers';
import { IConversationHistoryProvider } from '../brain/llm/messages/history/types.js';
import type { SerializedSession } from './persistence-types.js';
import { SESSION_PERSISTENCE_CONSTANTS, SessionPersistenceError } from './persistence-types.js';

// This function is currently unused but kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractReasoningContentBlocks(aiResponse: any): string {
	// If the response is an object with a content array (Anthropic API best practice)
	if (aiResponse && Array.isArray(aiResponse.content)) {
		// Extract all 'thinking' and 'redacted_thinking' blocks
		const reasoningBlocks = aiResponse.content
			.filter((block: any) => block.type === 'thinking' || block.type === 'redacted_thinking')
			.map((block: any) => block.thinking)
			.filter(Boolean);
		if (reasoningBlocks.length > 0) {
			return reasoningBlocks.join('\n\n');
		}
		// Fallback: join all text blocks if no thinking blocks found
		const textBlocks = aiResponse.content
			.filter((block: any) => block.type === 'text' && block.text)
			.map((block: any) => block.text);
		if (textBlocks.length > 0) {
			return textBlocks.join('\n\n');
		}
		return '';
	}
	// Fallback: support legacy string input (regex for <thinking> tags)
	if (typeof aiResponse === 'string') {
		const matches = Array.from(aiResponse.matchAll(/<thinking>([\s\S]*?)<\/thinking>/gi));
		if (matches.length > 0) {
			return matches.map(m => m[1]?.trim() || '').join('\n\n');
		}
		return aiResponse;
	}
	return '';
}
import { EnhancedPromptManager } from '../brain/systemPrompt/enhanced-manager.js';
export class ConversationSession {
	private contextManager!: ContextManager;
	private _llmService?: ILLMService; // Changed to lazy-loaded
	private reasoningDetector?: ReasoningContentDetector;
	private searchContextManager?: SearchContextManager;
	private _historyProvider?: IConversationHistoryProvider | undefined; // Changed to lazy-loaded
	private _storageManager?: StorageManager; // Added for lazy loading
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

	// Lazy initialization flags
	private _servicesInitialized = false;
	private _llmServiceInitialized = false;
	private _storageInitialized = false;

	/**
	 * @param services - Required dependencies for the session, including unifiedToolManager
	 * @param id - Session identifier
	 * @param options - Optional advanced metadata options
	 */
	constructor(
		private services: {
			stateManager: MemAgentStateManager;
			promptManager: EnhancedPromptManager;
			contextManager: ContextManager;
			mcpManager: MCPManager;
			unifiedToolManager: UnifiedToolManager;
			embeddingManager?: any; // Optional embedding manager for status checking
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
			historyEnabled?: boolean;
			historyBackend?: 'database' | 'memory';
			sharedStorageManager?: StorageManager; // Allow sharing storage manager
		}
	) {
		if (options?.sessionMemoryMetadata) {
			this.sessionMemoryMetadata = options.sessionMemoryMetadata;
		}
		if (options?.mergeMetadata) {
			this.mergeMetadata = options.mergeMetadata;
		}
		if (options?.metadataSchema) {
			this.metadataSchema = options.metadataSchema;
		}
		if (options?.beforeMemoryExtraction) {
			this.beforeMemoryExtraction = options.beforeMemoryExtraction;
		}
		if (typeof options?.historyEnabled === 'boolean') {
			this.historyEnabled = options.historyEnabled;
		}
		if (options?.historyBackend) {
			this.historyBackend = options.historyBackend;
		}
		if (options?.sharedStorageManager) {
			this._storageManager = options.sharedStorageManager;
			this._storageInitialized = true;
		}
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
		// Note: History restoration will happen lazily when history is first accessed
		// This improves startup performance by not initializing storage until needed
	}

	/**
	 * Initializes the services for the session, including the history provider.
	 */
	private async initializeServices(): Promise<void> {
		this.contextManager = this.services.contextManager;

		this._servicesInitialized = true;
	}

	/**
	 * Lazy initialization of LLM service
	 */
	private async getLLMServiceLazy(): Promise<ILLMService> {
		if (!this._servicesInitialized || !this.contextManager) {
			throw new Error(
				'ConversationSession is not initialized. Call init() before accessing services.'
			);
		}

		if (!this._llmServiceInitialized) {
			try {
				const llmConfig = this.services.stateManager.getLLMConfig(this.id);
				this._llmService = createLLMService(
					llmConfig,
					this.services.mcpManager,
					this.contextManager,
					this.services.unifiedToolManager
				);
				this._llmServiceInitialized = true;
				logger.debug(`Session ${this.id}: LLM service lazy-initialized`);
			} catch (error) {
				logger.error(`Session ${this.id}: Failed to lazy-initialize LLM service`, { error });
				throw error;
			}
		}
		return this._llmService!;
	}

	/**
	 * Lazy initialization of storage manager and history provider with PostgreSQL/SQLite support
	 */
	private async getStorageManagerLazy(): Promise<StorageManager | undefined> {
		if (!this._storageInitialized) {
			try {
				if (this.historyEnabled) {
					// Multi-backend config example (can be extended to use env/config)
					const multiBackendEnabled = !!process.env.CIPHER_MULTI_BACKEND;
					const flushIntervalMs = process.env.CIPHER_WAL_FLUSH_INTERVAL
						? parseInt(process.env.CIPHER_WAL_FLUSH_INTERVAL, 10)
						: 5000;

					if (multiBackendEnabled) {
						// Example: primary = Postgres, backup = SQLite, WAL = in-memory
						const primaryStorage = new StorageManager({
							database: { type: 'postgres' as const, url: process.env.CIPHER_PG_URL },
							cache: { type: 'in-memory' as const },
						});
						await primaryStorage.connect();
						const backupStorage = new StorageManager({
							database: { type: 'sqlite' as const, path: './cipher-backup.db' },
							cache: { type: 'in-memory' as const },
						});
						await backupStorage.connect();
						const primaryProvider = createDatabaseHistoryProvider(primaryStorage);
						const backupProvider = createDatabaseHistoryProvider(backupStorage);
						const wal = new WALHistoryProvider();
						this._historyProvider = createMultiBackendHistoryProvider(
							primaryProvider,
							backupProvider,
							wal,
							flushIntervalMs
						);
						logger.debug(`Session ${this.id}: Multi-backend history provider lazy-initialized.`);
					} else if (this.historyBackend === 'database') {
						// Use shared storage manager if available, otherwise create new one
						if (!this._storageManager) {
							// Use the same storage configuration as the session manager
							// This ensures both session data and conversation history use the same backend
							const postgresUrl = process.env.CIPHER_PG_URL;
							const postgresHost = process.env.STORAGE_DATABASE_HOST;
							const postgresDatabase = process.env.STORAGE_DATABASE_NAME;

							let storageConfig: any;

							if (postgresUrl || (postgresHost && postgresDatabase)) {
								// Use PostgreSQL if configured
								if (postgresUrl) {
									storageConfig = {
										database: { type: 'postgres' as const, url: postgresUrl },
										cache: { type: 'in-memory' as const },
									};
								} else {
									storageConfig = {
										database: {
											type: 'postgres' as const,
											host: postgresHost,
											database: postgresDatabase,
											port: process.env.STORAGE_DATABASE_PORT
												? parseInt(process.env.STORAGE_DATABASE_PORT, 10)
												: 5432,
											user: process.env.STORAGE_DATABASE_USER,
											password: process.env.STORAGE_DATABASE_PASSWORD,
											ssl: process.env.STORAGE_DATABASE_SSL === 'true',
										},
										cache: { type: 'in-memory' as const },
									};
								}
								logger.debug(
									`Session ${this.id}: Using PostgreSQL for history provider (lazy-loaded)`
								);
							} else {
								// Fallback to SQLite
								storageConfig = {
									database: {
										type: 'sqlite' as const,
										path: env.STORAGE_DATABASE_PATH || './data',
										database: env.STORAGE_DATABASE_NAME || 'cipher-sessions.db',
									},
									cache: { type: 'in-memory' as const },
								};
								logger.debug(`Session ${this.id}: Using SQLite for history provider (lazy-loaded)`);
							}

							this._storageManager = new StorageManager(storageConfig);
							await this._storageManager.connect();
							logger.debug(
								`Session ${this.id}: Database history provider lazy-initialized with ${storageConfig.database.type} backend.`
							);
						} else {
							logger.debug(
								`Session ${this.id}: Using shared storage manager for history provider.`
							);
						}

						this._historyProvider = createDatabaseHistoryProvider(this._storageManager);
					} else {
						// TODO: Implement or import an in-memory provider if needed
						logger.debug(`Session ${this.id}: In-memory history provider selected (lazy-loaded).`);
					}
				}
				this._storageInitialized = true;
			} catch (error) {
				logger.warn(`Session ${this.id}: Failed to lazy-initialize storage manager`, { error });
				this._storageInitialized = true; // Mark as initialized to prevent retry
			}
		}
		return this._storageManager;
	}

	/**
	 * Lazy initialization of history provider
	 */
	private async getHistoryProviderLazy(): Promise<IConversationHistoryProvider | undefined> {
		if (!this._storageInitialized) {
			await this.getStorageManagerLazy();
		}
		return this._historyProvider;
	}

	/**
	 * Restore history when history provider is lazy-loaded
	 */
	private async restoreHistoryLazy(): Promise<void> {
		if (this.historyEnabled) {
			try {
				const historyProvider = await this.getHistoryProviderLazy();
				if (historyProvider && this.contextManager) {
					// Update context manager with the lazy-loaded history provider
					(this.contextManager as any).historyProvider = historyProvider;
					await this.contextManager.restoreHistory?.();
					logger.debug(`Session ${this.id}: Conversation history restored (lazy-loaded)`);
				}
			} catch (err) {
				logger.warn(`Session ${this.id}: Failed to restore conversation history: ${err}`);
			}
		}
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
		if (!this._servicesInitialized || !this.contextManager) {
			logger.error('ConversationSession.run: Session not initialized. Call init() before run().');
			throw new Error('ConversationSession is not initialized. Call init() before run().');
		}

		// --- imageDataInput validation ---
		if (
			imageDataInput !== undefined &&
			(typeof imageDataInput !== 'object' ||
				!imageDataInput.image ||
				typeof imageDataInput.image !== 'string' ||
				!imageDataInput.mimeType ||
				typeof imageDataInput.mimeType !== 'string')
		) {
			logger.error(
				'ConversationSession.run: imageDataInput must have image and mimeType as non-empty strings'
			);
			throw new Error('imageDataInput must have image and mimeType as non-empty strings');
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

		// Restore history if enabled (lazy-loaded)
		await this.restoreHistoryLazy();

		// Lazy initialize LLM service when first needed
		const llmService = await this.getLLMServiceLazy();

		// Generate response
		const response = await llmService.generate(input, imageDataInput, stream);

		// PROGRAMMATIC ENFORCEMENT: Run memory extraction asynchronously in background AFTER response is returned
		// This ensures users see the response immediately without waiting for memory operations
		const backgroundOperations = new Promise<void>(resolve => {
			setImmediate(async () => {
				// Quick check to skip all background operations if embeddings are disabled
				const embeddingsDisabled = env.DISABLE_EMBEDDINGS || env.EMBEDDING_DISABLED;

				// Also check embedding manager status if available
				let embeddingManagerDisabled = false;
				if (this.services.embeddingManager) {
					// Check global embedding state
					try {
						const { EmbeddingSystemState } = require('../embedding/manager.js');
						if (EmbeddingSystemState.getInstance().isDisabled()) {
							embeddingManagerDisabled = true;
						}
					} catch {
						// If EmbeddingSystemState is not available, continue with other checks
					}

					// Check if no embeddings are available
					if (!this.services.embeddingManager?.hasAvailableEmbeddings()) {
						embeddingManagerDisabled = true;
					}

					// Check if any embedders are disabled
					const embeddingStatus = this.services.embeddingManager?.getEmbeddingStatus();
					if (embeddingStatus) {
						const disabledEmbedders = Object.values(embeddingStatus).filter(
							(status: any) => status.status === 'DISABLED'
						);
						if (disabledEmbedders.length > 0) {
							embeddingManagerDisabled = true;
						}
					}
				}

				if (embeddingsDisabled || embeddingManagerDisabled) {
					logger.debug('Skipping all background memory operations - embeddings disabled', {
						sessionId: this.id,
						envDisabled: embeddingsDisabled,
						managerDisabled: embeddingManagerDisabled,
					});
					resolve();
					return;
				}

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

			// Check if embeddings are disabled via environment variables or configuration
			const embeddingsDisabled = env.DISABLE_EMBEDDINGS || env.EMBEDDING_DISABLED;

			// Also check embedding manager status if available
			let embeddingManagerDisabled = false;
			if (this.services.embeddingManager) {
				// Check global embedding state
				try {
					const { EmbeddingSystemState } = require('../embedding/manager.js');
					if (EmbeddingSystemState.getInstance().isDisabled()) {
						embeddingManagerDisabled = true;
					}
				} catch {
					// If EmbeddingSystemState is not available, continue with other checks
				}

				// Check if no embeddings are available
				if (!this.services.embeddingManager?.hasAvailableEmbeddings()) {
					embeddingManagerDisabled = true;
				}

				// Check if any embedders are disabled
				const embeddingStatus = this.services.embeddingManager?.getEmbeddingStatus();
				if (embeddingStatus) {
					const disabledCount = Object.values(embeddingStatus).filter(
						(status: any) => status.status === 'DISABLED'
					).length;
					if (disabledCount > 0) {
						embeddingManagerDisabled = true;
					}
				}
			}

			if (embeddingsDisabled || embeddingManagerDisabled) {
				logger.debug('ConversationSession: Embeddings disabled, skipping memory extraction', {
					envDisabled: embeddingsDisabled,
					managerDisabled: embeddingManagerDisabled,
				});
				return;
			}

			// Check if the unifiedToolManager is available
			if (!this.services.unifiedToolManager) {
				logger.debug(
					'ConversationSession: UnifiedToolManager not available, skipping memory extraction'
				);
				return;
			}

			// Check if workspace memory is enabled
			const workspaceMemoryEnabled = env.USE_WORKSPACE_MEMORY;
			const shouldDisableDefaultMemory = workspaceMemoryEnabled && env.DISABLE_DEFAULT_MEMORY;

			// Determine which memory tools to run based on configuration
			const shouldRunWorkspace = workspaceMemoryEnabled;
			const shouldRunDefault = !shouldDisableDefaultMemory;

			if (embeddingsDisabled) {
				logger.debug('ConversationSession: Memory extraction skipped - embeddings disabled', {
					embeddingsDisabled,
					workspaceMemoryEnabled,
					shouldDisableDefaultMemory,
				});
				return;
			}

			logger.debug('ConversationSession: Memory tools to execute', {
				workspaceMemoryEnabled,
				shouldDisableDefaultMemory,
				shouldRunWorkspace,
				shouldRunDefault,
			});

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

			// Execute memory tools based on configuration
			const memoryResults: any[] = [];

			// Execute workspace memory tool if enabled
			if (shouldRunWorkspace) {
				const workspaceArgs = {
					interaction: comprehensiveInteractionData,
					context: mergedContext,
					options: {
						similarityThreshold: 0.8,
						confidenceThreshold: 0.6,
						enableBatchProcessing: true,
						autoExtractWorkspaceInfo: true,
					},
				};

				try {
					const workspaceResult = await this.services.unifiedToolManager.executeToolWithoutLoading(
						'cipher_workspace_store',
						workspaceArgs
					);
					memoryResults.push({ tool: 'cipher_workspace_store', result: workspaceResult });
					logger.debug('ConversationSession: Workspace memory tool executed successfully');
				} catch (error) {
					logger.debug('ConversationSession: Workspace memory tool execution failed', {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}

			// Execute default memory tool if not disabled
			if (shouldRunDefault) {
				const defaultArgs = {
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
				};

				try {
					const defaultResult = await this.services.unifiedToolManager.executeToolWithoutLoading(
						'cipher_extract_and_operate_memory',
						defaultArgs
					);
					memoryResults.push({ tool: 'cipher_extract_and_operate_memory', result: defaultResult });
					logger.debug('ConversationSession: Default memory tool executed successfully');
				} catch (error) {
					logger.debug('ConversationSession: Default memory tool execution failed', {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}

			// If no tools were executed successfully, return early
			if (memoryResults.length === 0) {
				logger.debug('ConversationSession: No memory tools executed successfully');
				return;
			}

			// Aggregate results from all executed tools
			let totalExtractedFacts = 0;
			let totalMemoryActions = 0;
			const toolSummary: any = {};
			const combinedActions: any[] = [];

			for (const { tool, result } of memoryResults) {
				if (result.success) {
					totalExtractedFacts += result.extraction?.extracted || 0;

					// Get actions from the appropriate field based on tool type
					const actions =
						tool === 'cipher_workspace_store' ? result.workspace || [] : result.memory || [];

					totalMemoryActions += actions.length;
					combinedActions.push(...actions);

					toolSummary[tool] = {
						success: true,
						extractedFacts: result.extraction?.extracted || 0,
						memoryActions: actions.length,
					};
				} else {
					toolSummary[tool] = { success: false };
				}
			}

			logger.debug('ConversationSession: Memory extraction completed', {
				toolsExecuted: memoryResults.map(r => r.tool),
				shouldRunWorkspace,
				shouldRunDefault,
				totalExtractedFacts,
				totalMemoryActions,
				toolSummary,
				actionBreakdown:
					combinedActions.length > 0
						? {
								ADD: combinedActions.filter((a: any) => a.event === 'ADD').length,
								UPDATE: combinedActions.filter((a: any) => a.event === 'UPDATE').length,
								DELETE: combinedActions.filter((a: any) => a.event === 'DELETE').length,
								NONE: combinedActions.filter((a: any) => a.event === 'NONE').length,
							}
						: {},
			});

			// **NEW: Automatic Reflection Memory Processing**
			// Process reasoning traces in the background, similar to knowledge memory
			// Load tools for reflection processing (separate from background memory extraction)
			const allTools = await this.services.unifiedToolManager.getAllTools();
			await this.enforceReflectionMemoryProcessing(userInput, aiResponse, allTools);
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
	 * @param userInput - The user input string
	 * @param aiResponse - The AI response string
	 * @param allTools - Pre-loaded tools to avoid redundant loading
	 */
	private async enforceReflectionMemoryProcessing(
		userInput: string,
		_aiResponse: string,
		allTools: Record<string, any>
	): Promise<void> {
		try {
			logger.debug('ConversationSession: Enforcing reflection memory processing');

			// Check if embeddings are disabled via environment variables or configuration
			const embeddingsDisabled = env.DISABLE_EMBEDDINGS || env.EMBEDDING_DISABLED;

			// Check if the unifiedToolManager is available
			if (!this.services.unifiedToolManager) {
				logger.debug(
					'ConversationSession: UnifiedToolManager not available, skipping reflection memory processing'
				);
				return;
			}

			// Check if reflection memory tools are available (using pre-loaded tools)
			const reflectionToolsAvailable =
				allTools['cipher_extract_reasoning_steps'] && allTools['cipher_store_reasoning_memory'];

			if (embeddingsDisabled || !reflectionToolsAvailable) {
				logger.debug('ConversationSession: Reflection memory processing skipped', {
					embeddingsDisabled,
					reflectionToolsAvailable: !!reflectionToolsAvailable,
					reason: embeddingsDisabled ? 'embeddings disabled' : 'reflection tools unavailable',
				});
				return;
			}

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
		const recentMessages = this.contextManager.getRawMessages();

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
				if (args.query) {
					return `query: "${args.query.substring(0, 30)}${args.query.length > 30 ? '...' : ''}"`;
				}
				if (args.path) {
					return `path: ${args.path}`;
				}
				if (args.file) {
					return `file: ${args.file}`;
				}
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
		if (this._historyProvider && typeof (this._historyProvider as any).disconnect === 'function') {
			try {
				await (this._historyProvider as any).disconnect();
				logger.debug(`Session ${this.id}: History provider disconnected.`);
			} catch (err) {
				logger.warn(`Session ${this.id}: Failed to disconnect history provider: ${err}`);
			}
		}
	}

	public getContextManager(): ContextManager {
		return this.contextManager;
	}

	/**
	 * Get LLM service with lazy initialization
	 */
	public async getLLMService(): Promise<ILLMService> {
		return await this.getLLMServiceLazy();
	}

	public getUnifiedToolManager(): UnifiedToolManager {
		return this.services.unifiedToolManager;
	}

	/**
	 * Get the storageManager with lazy initialization
	 */
	public async getStorageManager(): Promise<StorageManager | undefined> {
		return await this.getStorageManagerLazy();
	}

	/**
	 * Get the history provider with lazy initialization
	 */
	public async getHistoryProvider(): Promise<IConversationHistoryProvider | undefined> {
		return await this.getHistoryProviderLazy();
	}

	/**
	 * Force refresh conversation history from the database
	 */
	public async refreshConversationHistory(): Promise<void> {
		if (this._historyProvider && this.historyEnabled && this.contextManager) {
			try {
				await this.contextManager.restoreHistory?.();
			} catch (error) {
				logger.warn(`Session ${this.id}: Failed to refresh conversation history:`, error);
			}
		}
	}

	/**
	 * Get the current conversation history for debugging
	 */
	public async getConversationHistory(): Promise<any[]> {
		if (this._historyProvider && this.historyEnabled) {
			try {
				const history = await this._historyProvider.getHistory(this.id);
				logger.debug(
					`Session ${this.id}: Current conversation history has ${history.length} messages`
				);
				return history;
			} catch (error) {
				logger.warn(`Session ${this.id}: Failed to get conversation history:`, error);
				return [];
			}
		} else {
			logger.debug(`Session ${this.id}: No history provider available`);
			return [];
		}
	}

	/**
	 * Get the current conversation history from context manager
	 */
	public getContextHistory(): any[] {
		if (this.contextManager) {
			const messages = this.contextManager.getRawMessages();
			logger.debug(`Session ${this.id}: Context manager has ${messages.length} messages`);
			return messages;
		} else {
			logger.debug(`Session ${this.id}: No context manager available`);
			return [];
		}
	}

	/**
	 * Serialize the current session state for persistence
	 * @returns SerializedSession containing all necessary data to restore this session
	 */
	public async serialize(): Promise<SerializedSession> {
		try {
			// Get conversation history from the history provider
			let conversationHistory: any[] = [];
			if (this._historyProvider && this.historyEnabled) {
				try {
					conversationHistory = await this._historyProvider.getHistory(this.id);
				} catch (error) {
					logger.warn(
						`Session ${this.id}: Failed to retrieve history for session during serialization:`,
						error
					);
				}
			}

			// Note: We don't serialize functions (mergeMetadata, beforeMemoryExtraction)
			// as they're unsafe to deserialize and restore. These will need to be
			// re-configured when the session is restored.
			const options: any = {};
			if (this.metadataSchema) {
				// For Zod schemas, we only store a basic indicator that a schema existed
				// The actual schema will need to be re-provided during restoration
				try {
					options.hadMetadataSchema = true;
				} catch (error) {
					logger.warn(`Failed to serialize metadata schema for session ${this.id}:`, error);
				}
			}

			const serialized: SerializedSession = {
				id: this.id,
				metadata: {
					createdAt: Date.now(), // We don't track creation time currently, use now as fallback
					lastActivity: Date.now(),
					...(this.sessionMemoryMetadata && {
						sessionMemoryMetadata: { ...this.sessionMemoryMetadata },
					}),
					historyEnabled: this.historyEnabled,
					historyBackend: this.historyBackend,
				},
				conversationHistory: conversationHistory,
				options: Object.keys(options).length > 0 ? options : undefined,
				version: SESSION_PERSISTENCE_CONSTANTS.CURRENT_VERSION,
				serializedAt: Date.now(),
			};

			logger.info(`Session ${this.id}: Serialized with ${conversationHistory.length} messages`);
			return serialized;
		} catch (error) {
			throw new SessionPersistenceError(
				`Failed to serialize session ${this.id}`,
				'serialize',
				this.id,
				error as Error
			);
		}
	}

	/**
	 * Deserialize and restore a session from serialized data
	 * @param data - Serialized session data
	 * @param services - Service dependencies required for session creation
	 * @returns A new ConversationSession instance restored from the data
	 */
	public static async deserialize(
		data: SerializedSession,
		services: {
			stateManager: MemAgentStateManager;
			promptManager: EnhancedPromptManager;
			mcpManager: MCPManager;
			unifiedToolManager: UnifiedToolManager;
			embeddingManager?: any;
		}
	): Promise<ConversationSession> {
		try {
			// Validate version compatibility
			if (data.version !== SESSION_PERSISTENCE_CONSTANTS.CURRENT_VERSION) {
				logger.warn(
					`Session ${data.id} has version ${data.version}, current is ${SESSION_PERSISTENCE_CONSTANTS.CURRENT_VERSION}. Attempting to restore anyway.`
				);
			}

			// Reconstruct options
			const options: any = {
				sessionMemoryMetadata: data.metadata.sessionMemoryMetadata,
				historyEnabled: data.metadata.historyEnabled,
				historyBackend: data.metadata.historyBackend,
			};

			// Note: Functions (mergeMetadata, beforeMemoryExtraction) are not restored from
			// serialized data for security reasons. These need to be re-configured by the
			// application when creating sessions that require these custom behaviors.
			if (data.options?.hadMetadataSchema) {
				logger.debug(
					`Session ${data.id} had a metadata schema, but it will need to be re-provided during configuration.`
				);
			}

			// Create new session instance
			// Ensure contextManager is included in services if available
			const sessionServices = {
				...services,
				...((services as any).contextManager && {
					contextManager: (services as any).contextManager,
				}),
			};
			const session = new ConversationSession(sessionServices as any, data.id, options);

			// Initialize the session
			await session.init();

			// Restore conversation history if we have a history provider and serialized history
			if (session._historyProvider && data.conversationHistory.length > 0) {
				try {
					// Clear any existing history first
					await session._historyProvider.clearHistory(data.id);

					// Restore messages one by one to maintain order and validation
					for (const message of data.conversationHistory) {
						await session._historyProvider.saveMessage(data.id, message);
					}

					// Restore conversation history to context manager so AI can see previous messages
					await session.refreshConversationHistory();
					logger.info(
						`Session ${data.id}: Restored ${data.conversationHistory.length} messages to context manager`
					);
				} catch (error) {
					logger.warn(
						`Session ${data.id}: Failed to restore conversation history from serialized data:`,
						error
					);
					// Continue without history rather than failing
				}
			}

			return session;
		} catch (error) {
			throw new SessionPersistenceError(
				`Failed to deserialize session ${data.id}`,
				'deserialize',
				data.id,
				error as Error
			);
		}
	}
}
