import { EnhancedPromptManager } from '../brain/systemPrompt/enhanced-manager.js';
import { MemAgentStateManager } from '../brain/memAgent/state-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { SessionManager } from '../session/session-manager.js';
import { InternalToolManager } from '../brain/tools/manager.js';
import { UnifiedToolManager } from '../brain/tools/unified-tool-manager.js';
import { registerAllTools } from '../brain/tools/definitions/index.js';
import { logger } from '../logger/index.js';
import { AgentConfig } from '../brain/memAgent/config.js';
import { ServerConfigsSchema } from '../mcp/config.js';
import { ServerConfigs } from '../mcp/types.js';
import { EmbeddingManager, SessionEmbeddingState } from '../brain/embedding/index.js';
import { VectorStoreManager, DualCollectionVectorManager } from '../vector_storage/index.js';
import { createLLMService } from '../brain/llm/services/factory.js';
import { createContextManager } from '../brain/llm/messages/factory.js';
import { ILLMService } from '../brain/llm/index.js';
import {
	createVectorStoreFromEnv,
	createDualCollectionVectorStoreFromEnv,
} from '../vector_storage/factory.js';
import { KnowledgeGraphManager } from '../knowledge_graph/manager.js';
import { createKnowledgeGraphFromEnv } from '../knowledge_graph/factory.js';
import { EventManager } from '../events/event-manager.js';
import { EventPersistenceConfig } from '../events/persistence.js';
import { env } from '../env.js';
import { ProviderType } from '../brain/systemPrompt/interfaces.js';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

/**
 * Create embedding configuration from LLM provider settings
 */
async function createEmbeddingFromLLMProvider(
	embeddingManager: EmbeddingManager,
	llmConfig: any
): Promise<{ embedder: any; info: any } | null> {
	const provider = llmConfig.provider?.toLowerCase();

	try {
		switch (provider) {
			case 'openai': {
				const apiKey = llmConfig.apiKey || process.env.OPENAI_API_KEY;
				if (!apiKey || apiKey.trim() === '') {
					logger.debug(
						'No OpenAI API key available for embedding fallback - switching to chat-only mode'
					);
					return null;
				}
				const embeddingConfig = {
					type: 'openai' as const,
					apiKey,
					model: 'text-embedding-3-small' as const,
					baseUrl: llmConfig.baseUrl,
					organization: llmConfig.organization,
					timeout: 30000,
					maxRetries: 3,
				};
				logger.debug('Using OpenAI embedding fallback: text-embedding-3-small');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'ollama': {
				const baseUrl =
					llmConfig.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
				// Ollama doesn't require API key, so proceed with embedding config
				const embeddingConfig = {
					type: 'ollama' as const,
					baseUrl,
					model: 'nomic-embed-text' as const,
					timeout: 30000,
					maxRetries: 3,
				};
				logger.debug('Using Ollama embedding fallback: nomic-embed-text');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'lmstudio': {
				const baseUrl =
					llmConfig.baseUrl || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
				// LM Studio doesn't require API key, so proceed with embedding config
				const embeddingConfig = {
					type: 'lmstudio' as const,
					baseUrl,
					model: 'nomic-embed-text-v1.5' as const,
					timeout: 30000,
					maxRetries: 3,
				};
				logger.debug('Using LM Studio embedding fallback: nomic-embed-text-v1.5');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'gemini': {
				const apiKey = llmConfig.apiKey || process.env.GEMINI_API_KEY;
				if (!apiKey || apiKey.trim() === '') {
					logger.debug(
						'No Gemini API key available for embedding fallback - switching to chat-only mode'
					);
					// API key not available - will skip embedding
					return null;
				}
				const embeddingConfig = {
					type: 'gemini' as const,
					apiKey,
					model: 'gemini-embedding-001' as const,
					timeout: 30000,
					maxRetries: 3,
				};
				logger.debug('Using Gemini embedding fallback: gemini-embedding-001');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'anthropic': {
				// Anthropic doesn't have native embeddings, use Voyage as recommended fallback
				const apiKey = llmConfig.apiKey || process.env.VOYAGE_API_KEY;
				if (!apiKey || apiKey.trim() === '') {
					logger.debug(
						'No Voyage API key available for Anthropic - switching to chat-only mode (set VOYAGE_API_KEY)'
					);
					// Voyage API key not available
					return null;
				}
				const embeddingConfig = {
					type: 'voyage' as const,
					apiKey,
					model: 'voyage-3-large' as const,
					timeout: 30000,
					maxRetries: 3,
					dimensions: 1024,
				};
				logger.debug('Using Voyage embedding for Anthropic LLM', {
					voyageModel: 'voyage-3-large',
					voyageDimensions: 1024,
					provider: 'voyage',
				});
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'aws': {
				// AWS Bedrock has native embeddings via Amazon Titan and Cohere
				const accessKeyId = llmConfig.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
				const secretAccessKey = llmConfig.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
				if (
					!accessKeyId ||
					accessKeyId.trim() === '' ||
					!secretAccessKey ||
					secretAccessKey.trim() === ''
				) {
					logger.debug(
						'No AWS credentials available for AWS Bedrock embedding - switching to chat-only mode (need AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)'
					);
					// AWS credentials not available
					return null;
				}
				const embeddingConfig = {
					type: 'aws-bedrock' as const,
					region: llmConfig.region || process.env.AWS_DEFAULT_REGION || 'us-east-1',
					accessKeyId,
					secretAccessKey,
					sessionToken: llmConfig.sessionToken || process.env.AWS_SESSION_TOKEN,
					model: 'amazon.titan-embed-text-v2:0' as const,
					timeout: 30000,
					maxRetries: 3,
					dimensions: 1024,
				};
				logger.debug('Using AWS Bedrock native embedding: amazon.titan-embed-text-v2:0');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'azure': {
				// Azure OpenAI - try to use same Azure setup for embeddings
				const azureApiKey = llmConfig.apiKey || process.env.AZURE_OPENAI_API_KEY;
				if (!azureApiKey || azureApiKey.trim() === '') {
					logger.debug('No Azure OpenAI API key available for embedding fallback');
					// Fallback to regular OpenAI if Azure not available
					const openaiApiKey = process.env.OPENAI_API_KEY;
					if (openaiApiKey && openaiApiKey.trim() !== '') {
						const embeddingConfig = {
							type: 'openai' as const,
							apiKey: openaiApiKey,
							model: 'text-embedding-3-small' as const,
							timeout: 30000,
							maxRetries: 3,
						};
						logger.debug('Using OpenAI embedding fallback for Azure LLM: text-embedding-3-small');
						return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
					}
					logger.debug('No OpenAI API key available either - switching to chat-only mode');
					// Neither Azure nor OpenAI API key provided
					return null;
				}
				const embeddingConfig = {
					type: 'openai' as const,
					apiKey: azureApiKey,
					model: 'text-embedding-3-small' as const,
					baseUrl: llmConfig.azure?.endpoint || process.env.AZURE_OPENAI_ENDPOINT,
					timeout: 30000,
					maxRetries: 3,
				};
				logger.debug('Using Azure OpenAI embedding fallback: text-embedding-3-small');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'qwen': {
				// Qwen has native embeddings via DashScope API
				const apiKey =
					llmConfig.apiKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
				if (!apiKey || apiKey.trim() === '') {
					logger.debug(
						'No Qwen API key available for native embedding - switching to chat-only mode (need QWEN_API_KEY or DASHSCOPE_API_KEY)'
					);
					// Removed global embedding state -('Qwen API key not provided');
					return null;
				}
				const embeddingConfig = {
					type: 'qwen' as const,
					apiKey,
					model: 'text-embedding-v3' as const,
					baseUrl: llmConfig.baseUrl,
					timeout: 30000,
					maxRetries: 3,
					dimensions: 1024,
				};
				logger.debug('Using Qwen native embedding: text-embedding-v3');
				return await embeddingManager.createEmbedderFromConfig(embeddingConfig, 'default');
			}

			case 'openrouter': {
				// OpenRouter doesn't support embeddings and no fallback should be used
				logger.debug(
					'OpenRouter does not support embedding models - embeddings disabled for this provider'
				);
				return null;
			}

			default: {
				logger.debug(`No embedding fallback available for LLM provider: ${provider}`);
				return null;
			}
		}
	} catch (error) {
		logger.warn(`Failed to create embedding from LLM provider ${provider}`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export type AgentServices = {
	mcpManager: MCPManager;
	promptManager: EnhancedPromptManager;
	stateManager: MemAgentStateManager;
	sessionManager: SessionManager;
	internalToolManager: InternalToolManager;
	unifiedToolManager: UnifiedToolManager;
	embeddingManager?: EmbeddingManager;
	vectorStoreManager: VectorStoreManager | DualCollectionVectorManager;
	eventManager: EventManager;
	llmService?: ILLMService;
	knowledgeGraphManager?: KnowledgeGraphManager;
};

export async function createAgentServices(
	agentConfig: AgentConfig,
	appMode?: 'cli' | 'mcp' | 'api'
): Promise<AgentServices> {
	// 1. Initialize agent config
	const config = agentConfig;

	// 1.1. Initialize event manager first (other services will use it)
	logger.debug('Initializing event manager...');

	// Use eventPersistence config if present, with environment variable overrides
	const eventPersistenceConfig = {
		...config.eventPersistence,
		// Support EVENT_PERSISTENCE_ENABLED env variable
		enabled:
			process.env.EVENT_PERSISTENCE_ENABLED === 'true' ||
			(config.eventPersistence?.enabled ?? false),
		// Support EVENT_PERSISTENCE_PATH env variable
		filePath: process.env.EVENT_PERSISTENCE_PATH || config.eventPersistence?.filePath,
	};

	// Support EVENT_FILTERING_ENABLED env variable
	const enableFiltering = process.env.EVENT_FILTERING_ENABLED === 'true';

	// Support EVENT_FILTERED_TYPES env variable (comma-separated)
	const filteredTypes = (process.env.EVENT_FILTERED_TYPES || '')
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);

	const eventManager = new EventManager({
		enableLogging: true,
		enablePersistence: eventPersistenceConfig.enabled,
		enableFiltering,
		maxServiceListeners: 300,
		maxSessionListeners: 150,
		maxSessionHistorySize: 1000,
		sessionCleanupInterval: 300000, // 5 minutes
		// Pass through eventPersistenceConfig for use by persistence provider
		eventPersistenceConfig: eventPersistenceConfig as Partial<EventPersistenceConfig>,
	});

	// Register filter for filtered event types
	if (enableFiltering && filteredTypes.length > 0) {
		eventManager.registerFilter({
			name: 'env-filtered-types',
			description: 'Block event types from EVENT_FILTERED_TYPES',
			enabled: true,
			filter: event => !filteredTypes.includes(event.type),
		});
	}

	// Log event persistence configuration
	if (eventPersistenceConfig.enabled) {
		logger.info('Event persistence enabled', {
			storageType: eventPersistenceConfig.storageType || 'file',
			filePath: eventPersistenceConfig.filePath || './data/events',
			enabled: eventPersistenceConfig.enabled,
		});
	}

	// Emit cipher startup event
	eventManager.emitServiceEvent('cipher:started', {
		timestamp: Date.now(),
		version: process.env.npm_package_version || '1.0.0',
	});

	const mcpManager = new MCPManager();

	// Set event manager for connection lifecycle events
	mcpManager.setEventManager(eventManager);

	// Set quiet mode for CLI to reduce MCP logging noise
	if (appMode === 'cli') {
		mcpManager.setQuietMode(true);
	}

	// Parse and validate the MCP server configurations to ensure required fields are present
	// The ServerConfigsSchema.parse() will transform input types to output types with required fields
	const parsedMcpServers = ServerConfigsSchema.parse(config.mcpServers) as ServerConfigs;
	await mcpManager.initializeFromConfig(parsedMcpServers);

	const mcpServerCount = Object.keys(config.mcpServers || {}).length;
	if (mcpServerCount === 0) {
		if (appMode !== 'cli') {
			logger.debug('Agent initialized without MCP servers - only built-in capabilities available');
		}
	} else {
		if (appMode !== 'cli') {
			logger.debug(`Client manager initialized with ${mcpServerCount} MCP server(s)`);
		}
	}

	// Emit MCP manager initialization event
	eventManager.emitServiceEvent('cipher:serviceStarted', {
		serviceType: 'MCPManager',
		timestamp: Date.now(),
	});

	// 2. Initialize embedding manager with new fallback mechanism
	if (appMode !== 'cli') {
		logger.debug('Initializing embedding manager...');
	}
	const embeddingManager = new EmbeddingManager();
	let embeddingEnabled = false;

	try {
		let embeddingResult: { embedder: any; info: any } | null = null;

		// Check if embeddings are explicitly disabled
		const explicitlyDisabled =
			(config.embedding &&
				typeof config.embedding === 'object' &&
				'disabled' in config.embedding &&
				config.embedding.disabled === true) ||
			config.embedding === null ||
			config.embedding === false ||
			process.env.DISABLE_EMBEDDINGS === 'true' ||
			process.env.EMBEDDING_DISABLED === 'true';

		if (explicitlyDisabled) {
			logger.warn(
				'Embeddings are explicitly disabled - all embedding-dependent tools will be unavailable (chat-only mode)'
			);
			// Removed global embedding state -('Explicitly disabled in configuration');
			embeddingEnabled = false;
		} else {
			// Priority 1: Try explicit YAML embedding configuration if available
			if (
				config.embedding &&
				typeof config.embedding === 'object' &&
				!('disabled' in config.embedding)
			) {
				logger.debug('Found explicit embedding configuration in YAML, using it');

				// Validate API key for explicit embedding config
				const embeddingConfig = config.embedding as any;
				const needsApiKey = ['openai', 'gemini', 'anthropic', 'voyage', 'qwen'].includes(
					embeddingConfig.type
				);
				const needsAwsCredentials = embeddingConfig.type === 'aws-bedrock';

				if (needsApiKey) {
					const apiKey =
						embeddingConfig.apiKey || process.env[`${embeddingConfig.type.toUpperCase()}_API_KEY`];
					if (!apiKey || apiKey.trim() === '') {
						logger.debug(
							`No API key available for explicit ${embeddingConfig.type} embedding config - switching to chat-only mode`
						);
						// API key not provided for explicit embedding config
						embeddingResult = null;
					} else {
						embeddingResult = await embeddingManager.createEmbedderFromConfig(
							embeddingConfig,
							'default'
						);
					}
				} else if (needsAwsCredentials) {
					const accessKeyId = embeddingConfig.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
					const secretAccessKey =
						embeddingConfig.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
					if (
						!accessKeyId ||
						accessKeyId.trim() === '' ||
						!secretAccessKey ||
						secretAccessKey.trim() === ''
					) {
						logger.debug(
							'No AWS credentials available for explicit aws-bedrock embedding config - switching to chat-only mode'
						);
						// AWS credentials not available
						embeddingResult = null;
					} else {
						embeddingResult = await embeddingManager.createEmbedderFromConfig(
							embeddingConfig,
							'default'
						);
					}
				} else {
					// Ollama, LM Studio - no API key needed
					embeddingResult = await embeddingManager.createEmbedderFromConfig(
						embeddingConfig,
						'default'
					);
				}
			}

			// Priority 2: If no explicit embedding config (undefined) or disabled:false, fallback to LLM provider's embedding
			if (!embeddingResult) {
				if (config.llm?.provider) {
					logger.debug(
						'No explicit embedding config found, falling back to LLM provider embedding'
					);
					embeddingResult = await createEmbeddingFromLLMProvider(embeddingManager, config.llm);

					// Update agent config with the embedding info so vector store can use correct dimension
					if (embeddingResult && embeddingResult.info) {
						// Create embedding config object for the agent config
						const embeddingConfig = {
							type: embeddingResult.info.provider,
							model: embeddingResult.info.model,
							dimensions: embeddingResult.info.dimension,
						};

						// Update the agent config with the embedding configuration
						(config as any).embedding = embeddingConfig;

						logger.debug('Updated agent config with embedding fallback configuration', {
							provider: embeddingResult.info.provider,
							model: embeddingResult.info.model,
							dimension: embeddingResult.info.dimension,
						});
					}
				} else {
					logger.debug(
						'No LLM provider available for embedding fallback, trying environment auto-detection'
					);
					embeddingResult = await embeddingManager.createEmbedderFromEnv('default');
				}
			}

			if (embeddingResult) {
				if (appMode !== 'cli') {
					logger.info('Embedding manager initialized successfully', {
						provider: embeddingResult.info.provider,
						model: embeddingResult.info.model,
						dimension: embeddingResult.info.dimension,
					});
				}

				// Emit embedding manager initialization event
				eventManager.emitServiceEvent('cipher:serviceStarted', {
					serviceType: 'EmbeddingManager',
					timestamp: Date.now(),
				});
				embeddingEnabled = true;
			} else {
				logger.warn(
					'No embedding configuration available - embedding-dependent tools will be disabled (chat-only mode)'
				);
				embeddingEnabled = false;
			}
		}
	} catch (error) {
		logger.error('Failed to initialize embedding manager - activating fallback mode', {
			error: error instanceof Error ? error.message : String(error),
			fallbackMode: 'chat-only',
		});
		embeddingEnabled = false;

		// Log detailed fallback information
		logger.warn('🔄 Embedding system in fallback mode:', {
			mode: 'chat-only',
			availableFeatures: ['LLM conversation', 'MCP tools', 'System prompts'],
			unavailableFeatures: [
				'Memory search',
				'Knowledge storage',
				'Reasoning patterns',
				'Vector operations',
			],
			recoveryAction: 'Check embedding configuration and credentials, then restart the service',
		});
	}

	// 3. Initialize vector storage manager with configuration
	// Use dual collection manager if reflection memory is enabled, otherwise use regular manager
	if (appMode !== 'cli') {
		logger.debug('Initializing vector storage manager...');
	}

	let vectorStoreManager: VectorStoreManager | DualCollectionVectorManager;

	try {
		// Check if reflection memory is enabled to determine which manager to use
		const reflectionEnabled =
			!env.DISABLE_REFLECTION_MEMORY &&
			env.REFLECTION_VECTOR_STORE_COLLECTION &&
			env.REFLECTION_VECTOR_STORE_COLLECTION.trim() !== '';

		if (reflectionEnabled) {
			logger.debug('Reflection memory enabled, using dual collection vector manager');
			const { manager } = await createDualCollectionVectorStoreFromEnv(config);
			vectorStoreManager = manager;

			// Set event manager for memory operation events
			(vectorStoreManager as DualCollectionVectorManager).setEventManager(eventManager);

			const info = (vectorStoreManager as DualCollectionVectorManager).getInfo();
			logger.debug('Dual collection vector storage manager initialized successfully', {
				backend: info.knowledge.manager.getInfo().backend.type,
				knowledgeCollection: info.knowledge.collectionName,
				reflectionCollection: info.reflection.collectionName,
				dimension: info.knowledge.manager.getInfo().backend.dimension,
				knowledgeConnected: info.knowledge.connected,
				reflectionConnected: info.reflection.connected,
				reflectionEnabled: info.reflection.enabled,
			});
		} else {
			logger.debug('Reflection memory disabled, using single collection vector manager');
			const { manager } = await createVectorStoreFromEnv(config);
			vectorStoreManager = manager;

			// Set event manager for memory operation events
			(vectorStoreManager as VectorStoreManager).setEventManager(eventManager);

			logger.debug('Vector storage manager initialized successfully', {
				backend: vectorStoreManager.getInfo().backend.type,
				collection: vectorStoreManager.getInfo().backend.collectionName,
				dimension: vectorStoreManager.getInfo().backend.dimension,
				fallback: vectorStoreManager.getInfo().backend.fallback || false,
			});
		}
	} catch (error) {
		logger.warn('Failed to initialize vector storage manager', {
			error: error instanceof Error ? error.message : String(error),
		});
		// Fallback to regular manager in case of error
		const { manager } = await createVectorStoreFromEnv(config);
		vectorStoreManager = manager;
	}

	// 4. Initialize knowledge graph manager with configuration
	if (appMode !== 'cli') {
		logger.debug('Initializing knowledge graph manager...');
	}
	let knowledgeGraphManager: KnowledgeGraphManager | undefined = undefined;

	try {
		const kgFactory = await createKnowledgeGraphFromEnv();
		if (kgFactory) {
			knowledgeGraphManager = kgFactory.manager;
			logger.debug('Knowledge graph manager initialized successfully', {
				backend: knowledgeGraphManager.getInfo().backend.type,
				connected: knowledgeGraphManager.isConnected(),
				fallback: knowledgeGraphManager.getInfo().backend.fallback || false,
			});
		} else {
			logger.debug('Knowledge graph is disabled in environment configuration');
		}
	} catch (error) {
		logger.warn('Failed to initialize knowledge graph manager', {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// 5. Initialize prompt manager
	// --- BEGIN MERGE ADVANCED PROMPT CONFIG ---
	const promptManager = new EnhancedPromptManager();

	// Load static provider from cipher.yml
	let staticProvider: any = null;
	if (config.systemPrompt) {
		let enabled = true;
		let content = '';
		if (typeof config.systemPrompt === 'string') {
			content = config.systemPrompt;
		} else if (typeof config.systemPrompt === 'object' && config.systemPrompt !== null) {
			const promptObj = config.systemPrompt as any;
			enabled = promptObj.enabled !== false && promptObj.enabled !== undefined;
			content = promptObj.content || '';
		}
		staticProvider = {
			name: 'user-instruction',
			type: ProviderType.STATIC,
			priority: 100,
			enabled,
			config: { content },
		};
	}

	// Load providers from cipher-advanced-prompt.yml
	let advancedProviders: any[] = [];
	let advancedSettings: any = {};
	const advancedPromptPath = path.resolve(process.cwd(), 'memAgent/cipher-advanced-prompt.yml');
	if (fs.existsSync(advancedPromptPath)) {
		const fileContent = fs.readFileSync(advancedPromptPath, 'utf8');
		const parsed = yaml.parse(fileContent);
		if (Array.isArray(parsed.providers)) {
			advancedProviders = parsed.providers;
		}
		if (parsed.settings) {
			advancedSettings = parsed.settings;
		}
	}

	// Merge providers: staticProvider (from cipher.yml) + advancedProviders (from cipher-advanced-prompt.yml)
	const mergedProviders = [
		...(staticProvider ? [staticProvider] : []),
		...advancedProviders.filter(p => !staticProvider || p.name !== staticProvider.name),
	];

	// DEBUG: Print merged provider list
	console.log('Merged system prompt providers:');
	for (const p of mergedProviders) {
		console.log(`  - ${p.name} (${p.type}) enabled: ${p.enabled}`);
	}

	// Merge settings: advancedSettings takes precedence, fallback to default
	const mergedSettings = {
		maxGenerationTime: 10000,
		failOnProviderError: false,
		contentSeparator: '\n\n',
		...advancedSettings,
	};

	const mergedPromptConfig = {
		providers: mergedProviders,
		settings: mergedSettings,
	};

	await promptManager.initialize(mergedPromptConfig);
	// --- END MERGE ADVANCED PROMPT CONFIG ---

	// 6. Initialize state manager for runtime state tracking
	const stateManager = new MemAgentStateManager(config);
	if (appMode !== 'cli') {
		logger.debug('Agent state manager initialized');
	}

	// 7. Initialize LLM service
	let llmService: ILLMService | undefined = undefined;
	try {
		if (appMode !== 'cli') {
			logger.debug('Initializing LLM service...');
		}
		const llmConfig = stateManager.getLLMConfig();
		logger.debug('LLM Config retrieved', { llmConfig });
		const contextManager = createContextManager(llmConfig, promptManager, undefined, undefined);

		llmService = createLLMService(llmConfig, mcpManager, contextManager);

		if (appMode !== 'cli') {
			logger.info('LLM service initialized successfully', {
				provider: llmConfig.provider,
				model: llmConfig.model,
			});
		}

		// Inject llmService into promptManager for dynamic providers
		promptManager.setLLMService(llmService);
	} catch (error) {
		logger.warn('Failed to initialize LLM service', {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// 8. Prepare session manager configuration
	const sessionConfig: { maxSessions?: number; sessionTTL?: number } = {};
	if (config.sessions?.maxSessions !== undefined) {
		sessionConfig.maxSessions = config.sessions.maxSessions;
	}
	if (config.sessions?.sessionTTL !== undefined) {
		sessionConfig.sessionTTL = config.sessions.sessionTTL;
	}

	// 9. Initialize internal tool manager
	const internalToolManager = new InternalToolManager({
		enabled: true,
		timeout: 30000,
		enableCache: true,
		cacheTimeout: 300000,
	});

	await internalToolManager.initialize();

	// Set event manager for internal tool execution events
	internalToolManager.setEventManager(eventManager);

	// Register all internal tools
	const toolRegistrationResult = await registerAllTools(internalToolManager, { embeddingEnabled });
	// Only log tool registration results if there are failures or in non-CLI mode
	if (appMode !== 'cli' || toolRegistrationResult.failed.length > 0) {
		logger.info('Internal tools registration completed', {
			totalTools: toolRegistrationResult.total,
			registered: toolRegistrationResult.registered.length,
			failed: toolRegistrationResult.failed.length,
		});
	}

	if (toolRegistrationResult.failed.length > 0) {
		logger.warn('Some internal tools failed to register', {
			failedTools: toolRegistrationResult.failed,
		});
	}

	// Configure the internal tool manager with services for advanced tools
	// Only include embeddingManager if embeddings are enabled
	const services: any = {
		vectorStoreManager,
		llmService,
		knowledgeGraphManager,
	};

	if (embeddingEnabled) {
		services.embeddingManager = embeddingManager;
	}

	internalToolManager.setServices(services);

	// 10. Initialize unified tool manager with proper mode handling
	let unifiedToolManagerConfig: any;

	if (appMode === 'cli') {
		// CLI Mode: Only search tools accessible to Cipher's LLM, background tools executed separately
		unifiedToolManagerConfig = {
			enableInternalTools: true,
			enableMcpTools: true,
			conflictResolution: 'prefix-internal',
			mode: 'cli', // Special CLI mode
		};
	} else if (appMode === 'mcp') {
		// MCP Mode: Respect MCP_SERVER_MODE for external tool exposure
		const mcpServerMode = (process.env.MCP_SERVER_MODE as 'default' | 'aggregator') || 'default';
		unifiedToolManagerConfig = {
			enableInternalTools: true,
			enableMcpTools: true,
			conflictResolution: 'prefix-internal',
			mode: mcpServerMode,
		};
	} else {
		// API Mode: Similar to CLI for now
		unifiedToolManagerConfig = {
			enableInternalTools: true,
			enableMcpTools: true,
			conflictResolution: 'prefix-internal',
			mode: 'api',
		};
	}

	const unifiedToolManager = new UnifiedToolManager(
		mcpManager,
		internalToolManager,
		unifiedToolManagerConfig
	);

	// Set event manager for tool execution events
	unifiedToolManager.setEventManager(eventManager);

	// Set embedding manager for embedding status checking
	if (embeddingManager) {
		unifiedToolManager.setEmbeddingManager(embeddingManager);
	}

	if (appMode !== 'cli') {
		logger.debug('Unified tool manager initialized');
	}

	// 11. Create session manager with unified tool manager
	const sessionManager = new SessionManager(
		{
			stateManager,
			promptManager,
			mcpManager,
			unifiedToolManager,
			eventManager,
			...(embeddingManager && { embeddingManager }), // Only include if available
		},
		sessionConfig
	);

	// Initialize the session manager with persistent storage
	await sessionManager.init();

	if (appMode !== 'cli') {
		logger.debug('Session manager with unified tools initialized');
	}

	// Emit session manager initialization event
	eventManager.emitServiceEvent('cipher:serviceStarted', {
		serviceType: 'SessionManager',
		timestamp: Date.now(),
	});

	// 12. Return the core services
	const agentServices: AgentServices = {
		mcpManager,
		promptManager,
		stateManager,
		sessionManager,
		internalToolManager,
		unifiedToolManager,
		vectorStoreManager,
		eventManager,
		llmService: llmService || {
			generate: async () => '',
			directGenerate: async () => '',
			getAllTools: async () => ({}),
			getConfig: () => ({ provider: 'unknown', model: 'unknown' }),
		},
	};

	// Only include embeddingManager if embeddings are enabled
	if (embeddingEnabled) {
		agentServices.embeddingManager = embeddingManager;
	}

	// Only include knowledgeGraphManager when it's defined
	if (knowledgeGraphManager) {
		agentServices.knowledgeGraphManager = knowledgeGraphManager;
	}

	// Emit all services ready event
	const serviceTypes = Object.keys(agentServices).filter(
		key => agentServices[key as keyof AgentServices]
	);
	eventManager.emitServiceEvent('cipher:allServicesReady', {
		timestamp: Date.now(),
		services: serviceTypes,
	});

	return agentServices;
}
