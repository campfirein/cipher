import { PromptManager } from '../brain/systemPrompt/manager.js';
import { MemAgentStateManager } from '../brain/memAgent/state-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { SessionManager } from '../session/session-manager.js';
import { logger } from '../logger/index.js';
import { AgentConfig } from '../brain/memAgent/config.js';
import { ServerConfigsSchema } from '../mcp/config.js';
import { ServerConfigs } from '../mcp/types.js';
import { createLLMService } from '../brain/llm/services/factory.js';
import { ContextManager } from '../brain/llm/messages/manager.js';
import { LLMConfig } from '../brain/llm/config.js';
import type { ILLMService } from '../brain/llm/services/types.js';
import { getFormatter } from '../brain/llm/messages/factory.js';

export type AgentServices = {
	mcpManager: MCPManager;
	promptManager: PromptManager;
	stateManager: MemAgentStateManager;
	sessionManager: SessionManager;
	llmService: ILLMService;
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

	// 5. Initialize prompt manager
	const promptManager = new PromptManager();
	if (config.systemPrompt) {
		promptManager.load(config.systemPrompt);
	}

	// 6. Initialize state manager for runtime state tracking
	const stateManager = new MemAgentStateManager(config);
	logger.debug('Agent state manager initialized');

	// 7. Initialize session manager
	const sessionConfig: { maxSessions?: number; sessionTTL?: number } = {};
	if (config.sessions?.maxSessions !== undefined) {
		sessionConfig.maxSessions = config.sessions.maxSessions;
	}
	if (config.sessions?.sessionTTL !== undefined) {
		sessionConfig.sessionTTL = config.sessions.sessionTTL;
	}

	const sessionManager = new SessionManager(
		{ stateManager, promptManager, mcpManager },
		sessionConfig
	);

	// Initialize the session manager with persistent storage
	await sessionManager.init();

	logger.debug('Session manager initialized with storage support');

	// 8. Initialize LLM service
	const formatter = getFormatter((config.llm as LLMConfig).provider);
	const contextManager = new ContextManager(formatter, promptManager);
	const llmService = createLLMService(config.llm as LLMConfig, mcpManager, contextManager);
	logger.debug('LLM service initialized');

	// 9. Return the core services
	return {
		mcpManager,
		promptManager,
		stateManager,
		sessionManager,
		llmService
	};
}
