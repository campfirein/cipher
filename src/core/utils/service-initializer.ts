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
import { EmbeddingManager } from '../brain/embedding/index.js';
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

export type AgentServices = {
	mcpManager: MCPManager;
	promptManager: EnhancedPromptManager;
	stateManager: MemAgentStateManager;
	sessionManager: SessionManager;
	internalToolManager: InternalToolManager;
	unifiedToolManager: UnifiedToolManager;
	embeddingManager: EmbeddingManager;
	vectorStoreManager: VectorStoreManager | DualCollectionVectorManager;
	eventManager: EventManager;
	llmService?: ILLMService;
	knowledgeGraphManager?: KnowledgeGraphManager;
};

export async function createAgentServices(agentConfig: AgentConfig): Promise<AgentServices> {
	// 1. Initialize agent config
	const config = agentConfig;

	// 1.1. Initialize event manager first (other services will use it)
	logger.debug('Initializing event manager...');

	// Use eventPersistence config if present
	const eventPersistenceConfig = config.eventPersistence || {};

	// Support EVENT_FILTERING_ENABLED env variable
	const enableFiltering = process.env.EVENT_FILTERING_ENABLED === 'true';

	// Support EVENT_FILTERED_TYPES env variable (comma-separated)
	const filteredTypes = (process.env.EVENT_FILTERED_TYPES || '')
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);

	const eventManager = new EventManager({
		enableLogging: true,
		enablePersistence: eventPersistenceConfig.enabled ?? true,
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

	// Emit cipher startup event
	eventManager.emitServiceEvent('cipher:started', {
		timestamp: Date.now(),
		version: process.env.npm_package_version || '1.0.0',
	});

	logger.info('Event manager initialized successfully');

	const mcpManager = new MCPManager();

	// Set event manager for connection lifecycle events
	mcpManager.setEventManager(eventManager);

	// Parse and validate the MCP server configurations to ensure required fields are present
	// The ServerConfigsSchema.parse() will transform input types to output types with required fields
	const parsedMcpServers = ServerConfigsSchema.parse(config.mcpServers) as ServerConfigs;
	await mcpManager.initializeFromConfig(parsedMcpServers);

	const mcpServerCount = Object.keys(config.mcpServers || {}).length;
	if (mcpServerCount === 0) {
		logger.info('Agent initialized without MCP servers - only built-in capabilities available');
	} else {
		logger.debug(`Client manager initialized with ${mcpServerCount} MCP server(s)`);
	}

	// Emit MCP manager initialization event
	eventManager.emitServiceEvent('cipher:serviceStarted', {
		serviceType: 'MCPManager',
		timestamp: Date.now(),
	});

	// 2. Initialize embedding manager with YAML configuration first, then environment fallback
	logger.debug('Initializing embedding manager...');
	const embeddingManager = new EmbeddingManager(agentConfig.inputRefinement);

	try {
		let embeddingResult: { embedder: any; info: any } | null = null;

		// First try YAML embedding configuration if available
		if (config.embedding) {
			logger.debug('Found embedding configuration in YAML, using it');
			embeddingResult = await embeddingManager.createEmbedderFromConfig(
				config.embedding as any,
				'default'
			);
		}

		// If no YAML config or it failed, fallback to environment variables
		if (!embeddingResult) {
			logger.debug('No YAML embedding config or it failed, trying environment variables');
			embeddingResult = await embeddingManager.createEmbedderFromEnv('default');
		}
		if (embeddingResult) {
			logger.info('Embedding manager initialized successfully', {
				provider: embeddingResult.info.provider,
				model: embeddingResult.info.model,
				dimension: embeddingResult.info.dimension,
			});

			// Emit embedding manager initialization event
			eventManager.emitServiceEvent('cipher:serviceStarted', {
				serviceType: 'EmbeddingManager',
				timestamp: Date.now(),
			});
		} else {
			logger.warn(
				'No embedding configuration found in environment - memory operations will be limited'
			);
		}
	} catch (error) {
		logger.warn('Failed to initialize embedding manager', {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// 3. Initialize vector storage manager with configuration
	// Use dual collection manager if reflection memory is enabled, otherwise use regular manager
	logger.debug('Initializing vector storage manager...');

	let vectorStoreManager: VectorStoreManager | DualCollectionVectorManager;

	try {
		// Check if reflection memory is enabled to determine which manager to use
		const reflectionEnabled =
			!env.DISABLE_REFLECTION_MEMORY &&
			env.REFLECTION_VECTOR_STORE_COLLECTION &&
			env.REFLECTION_VECTOR_STORE_COLLECTION.trim() !== '';

		if (reflectionEnabled) {
			logger.debug('Reflection memory enabled, using dual collection vector manager');
			const { manager } = await createDualCollectionVectorStoreFromEnv();
			vectorStoreManager = manager;

			// Set event manager for memory operation events
			(vectorStoreManager as DualCollectionVectorManager).setEventManager(eventManager);

			const info = (vectorStoreManager as DualCollectionVectorManager).getInfo();
			logger.info('Dual collection vector storage manager initialized successfully', {
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
			const { manager } = await createVectorStoreFromEnv();
			vectorStoreManager = manager;

			// Set event manager for memory operation events
			(vectorStoreManager as VectorStoreManager).setEventManager(eventManager);

			logger.info('Vector storage manager initialized successfully', {
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
		const { manager } = await createVectorStoreFromEnv();
		vectorStoreManager = manager;
	}

	// 4. Initialize knowledge graph manager with configuration
	logger.debug('Initializing knowledge graph manager...');
	let knowledgeGraphManager: KnowledgeGraphManager | undefined = undefined;

	try {
		const kgFactory = await createKnowledgeGraphFromEnv();
		if (kgFactory) {
			knowledgeGraphManager = kgFactory.manager;
			logger.info('Knowledge graph manager initialized successfully', {
				backend: knowledgeGraphManager.getInfo().backend.type,
				connected: knowledgeGraphManager.isConnected(),
				fallback: knowledgeGraphManager.getInfo().backend.fallback || false,
			});
		} else {
			logger.info('Knowledge graph is disabled in environment configuration');
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
			enabled = promptObj.enabled !== false;
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
	logger.debug('Agent state manager initialized');

	// 7. Initialize LLM service
	let llmService: ILLMService | undefined = undefined;
	try {
		logger.debug('Initializing LLM service...');
		const llmConfig = stateManager.getLLMConfig();
		const contextManager = createContextManager(llmConfig, promptManager, undefined, undefined);

		llmService = createLLMService(llmConfig, mcpManager, contextManager);

		logger.info('LLM service initialized successfully', {
			provider: llmConfig.provider,
			model: llmConfig.model,
		});

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
	const toolRegistrationResult = await registerAllTools(internalToolManager);
	logger.info('Internal tools registration completed', {
		totalTools: toolRegistrationResult.total,
		registered: toolRegistrationResult.registered.length,
		failed: toolRegistrationResult.failed.length,
	});

	if (toolRegistrationResult.failed.length > 0) {
		logger.warn('Some internal tools failed to register', {
			failedTools: toolRegistrationResult.failed,
		});
	}

	// Configure the internal tool manager with services for advanced tools
	internalToolManager.setServices({
		embeddingManager,
		vectorStoreManager,
		llmService,
		knowledgeGraphManager,
	});

	// 10. Initialize unified tool manager
	const unifiedToolManager = new UnifiedToolManager(mcpManager, internalToolManager, {
		enableInternalTools: true,
		enableMcpTools: true,
		conflictResolution: 'prefix-internal',
	});

	// Set event manager for tool execution events
	unifiedToolManager.setEventManager(eventManager);

	logger.debug('Unified tool manager initialized');

	// 11. Create session manager with unified tool manager
	const sessionManager = new SessionManager(
		{
			stateManager,
			promptManager,
			mcpManager,
			unifiedToolManager,
			eventManager,
		},
		sessionConfig
	);

	// Initialize the session manager with persistent storage
	await sessionManager.init();

	logger.debug('Session manager with unified tools initialized');

	// Emit session manager initialization event
	eventManager.emitServiceEvent('cipher:serviceStarted', {
		serviceType: 'SessionManager',
		timestamp: Date.now(),
	});

	// 12. Return the core services
	const services: AgentServices = {
		mcpManager,
		promptManager,
		stateManager,
		sessionManager,
		internalToolManager,
		unifiedToolManager,
		embeddingManager,
		vectorStoreManager,
		eventManager,
		llmService: llmService || {
			generate: async () => '',
			directGenerate: async () => '',
			getAllTools: async () => ({}),
			getConfig: () => ({ provider: 'unknown', model: 'unknown' }),
		},
	};

	// Only include knowledgeGraphManager when it's defined
	if (knowledgeGraphManager) {
		services.knowledgeGraphManager = knowledgeGraphManager;
	}

	// Emit all services ready event
	const serviceTypes = Object.keys(services).filter(key => services[key as keyof AgentServices]);
	eventManager.emitServiceEvent('cipher:allServicesReady', {
		timestamp: Date.now(),
		services: serviceTypes,
	});

	// Only call normalizeData if it exists on vectorStoreManager
	// MY CODE!!!, this part of code should be closely monitored and tested 
	// This may not be the best way to do it!!!
	if (env.NORMALIZATION_ENABLED && env.NORMALIZATION_PAST_DATA &&typeof (vectorStoreManager as any).normalizeData === 'function') {
		await (vectorStoreManager as any).normalizeData(services.embeddingManager, agentConfig.inputRefinement);
	}
	else if (env.NORMALIZATION_ENABLED && !env.NORMALIZATION_PAST_DATA) {
		logger.info('Normalization of past data is disabled!');
		logger.info('Potential future retrieval inconsistencies may occur!');
	}

	return services;
}
