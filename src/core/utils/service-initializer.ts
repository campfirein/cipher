import { PromptManager } from '../brain/systemPrompt/manager.js';
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

export type AgentServices = {
	mcpManager: MCPManager;
	promptManager: PromptManager;
	stateManager: MemAgentStateManager;
	sessionManager: SessionManager;
	internalToolManager: InternalToolManager;
	unifiedToolManager: UnifiedToolManager;
	embeddingManager: EmbeddingManager;
	vectorStoreManager: VectorStoreManager | DualCollectionVectorManager;
	llmService?: ILLMService;
	knowledgeGraphManager?: KnowledgeGraphManager;
};

export async function createAgentServices(agentConfig: AgentConfig): Promise<AgentServices> {
	// 1. Initialize agent config
	const config = agentConfig;

	const mcpManager = new MCPManager();

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

	// 2. Initialize embedding manager with environment configuration
	logger.debug('Initializing embedding manager...');
	const embeddingManager = new EmbeddingManager();

	try {
		// Try to create embedder from environment variables
		const embeddingResult = await embeddingManager.createEmbedderFromEnv('default');
		if (embeddingResult) {
			logger.info('Embedding manager initialized successfully', {
				provider: embeddingResult.info.provider,
				model: embeddingResult.info.model,
				dimension: embeddingResult.info.dimension,
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
		const { env } = await import('../env.js');

		// Use dual collection manager if reflection memory is not disabled and reflection collection is configured
		const reflectionEnabled =
			!env.DISABLE_REFLECTION_MEMORY &&
			env.REFLECTION_VECTOR_STORE_COLLECTION &&
			env.REFLECTION_VECTOR_STORE_COLLECTION.trim() !== '';

		if (reflectionEnabled) {
			logger.debug('Reflection memory enabled, using dual collection vector manager');
			const { manager } = await createDualCollectionVectorStoreFromEnv();
			vectorStoreManager = manager;

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
	const promptManager = new PromptManager();
	if (config.systemPrompt) {
		promptManager.load(config.systemPrompt);
	}

	// 6. Initialize state manager for runtime state tracking
	const stateManager = new MemAgentStateManager(config);
	logger.debug('Agent state manager initialized');

	// 7. Prepare session manager configuration
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

	// 10. Initialize unified tool manager
	const unifiedToolManager = new UnifiedToolManager(mcpManager, internalToolManager, {
		enableInternalTools: true,
		enableMcpTools: true,
		conflictResolution: 'prefix-internal',
	});

	logger.debug('Unified tool manager initialized');

	// 11. Initialize LLM service with unified tool manager
	let llmService: ILLMService | undefined = undefined;
	try {
		logger.debug('Initializing LLM service...');
		const llmConfig = stateManager.getLLMConfig();
		const contextManager = createContextManager(llmConfig, promptManager);

		llmService = createLLMService(llmConfig, mcpManager, contextManager, unifiedToolManager);

		logger.info('LLM service initialized successfully', {
			provider: llmConfig.provider,
			model: llmConfig.model,
		});
	} catch (error) {
		logger.warn('Failed to initialize LLM service', {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// 12. Configure the internal tool manager with services for advanced tools
	internalToolManager.setServices({
		embeddingManager,
		vectorStoreManager,
		llmService,
		knowledgeGraphManager,
	});

	// 13. Create session manager with unified tool manager
	const sessionManager = new SessionManager(
		{
			stateManager,
			promptManager,
			mcpManager,
			unifiedToolManager,
		},
		sessionConfig
	);

	// Initialize the session manager with persistent storage
	await sessionManager.init();

	logger.debug('Session manager with unified tools initialized');

	// 14. Return the core services
	const services: AgentServices = {
		mcpManager,
		promptManager,
		stateManager,
		sessionManager,
		internalToolManager,
		unifiedToolManager,
		embeddingManager,
		vectorStoreManager,
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

	return services;
}
