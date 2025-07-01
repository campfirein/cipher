import { MCPManager } from '@core/mcp/manager.js';
import { AgentServices } from '../../utils/service-initializer.js';
import { createAgentServices } from '../../utils/service-initializer.js';
import { PromptManager } from '../systemPrompt/manager.js';
import { MemAgentStateManager } from './state-manager.js';
import { SessionManager } from '../../session/session-manager.js';
import { ConversationSession } from '../../session/coversation-session.js';
import { AgentConfig } from './config.js';
import { logger } from '../../logger/index.js';
import { LLMConfig } from '../llm/config.js';
import { IMCPClient, McpServerConfig } from '../../mcp/types.js';
import { MemoryService, ChatMemoryEntry } from '../services/memory-service.js';
import { QdrantClientService } from '../services/qdrant-client.js';
import { isProgrammingRelatedLLM } from './utils/isProgrammingRelatedLLM.js';

const requiredServices: (keyof AgentServices)[] = [
	'mcpManager',
	'promptManager',
	'stateManager',
	'sessionManager',
];

export class MemAgent {
	public readonly mcpManager!: MCPManager;
	public readonly promptManager!: PromptManager;
	public readonly stateManager!: MemAgentStateManager;
	public readonly sessionManager!: SessionManager;
	public readonly services!: AgentServices;

	private defaultSession: ConversationSession | null = null;

	private currentDefaultSessionId: string = 'default';

	private isStarted: boolean = false;
	private isStopped: boolean = false;

	private config: AgentConfig;
	private memoryService!: MemoryService;
	private openaiService!: import('../llm/services/openai.js').OpenAIService;

	constructor(config: AgentConfig) {
		this.config = config;
		logger.info('MemAgent created');
	}

	/**
	 * Start the MemAgent
	 */
	public async start(): Promise<void> {
		if (this.isStarted) {
			throw new Error('MemAgent is already started');
		}

		try {
			logger.info('Starting MemAgent...');
			// 1. Initialize services
			const services = await createAgentServices(this.config);
			for (const service of requiredServices) {
				if (!services[service]) {
					throw new Error(`Required service ${service} is missing during agent start`);
				}
			}

			Object.assign(this, {
				mcpManager: services.mcpManager,
				promptManager: services.promptManager,
				stateManager: services.stateManager,
				sessionManager: services.sessionManager,
				services: services,
			});
			// Assign OpenAIService if available
			if (services.llmService && services.llmService.getConfig().provider === 'openai') {
				this.openaiService = services.llmService as import('../llm/services/openai.js').OpenAIService;
			}

			// Initialize MemoryService with Qdrant or file backend
			if (process.env.QDRANT_URL) {
				this.memoryService = new MemoryService({
					backend: 'qdrant',
					qdrant: new QdrantClientService({
						url: process.env.QDRANT_URL!,
						apiKey: process.env.QDRANT_API_KEY,
						collection: process.env.QDRANT_COLLECTION || 'chat_memory',
					}),
				});
			} else {
				this.memoryService = new MemoryService({ backend: 'file' });
			}

			this.isStarted = true;
			logger.info('MemAgent started successfully');
		} catch (error) {
			logger.error('Failed to start MemAgent:', error);
			throw error;
		}
	}

	/**
	 * Stop the MemAgent
	 */
	public async stop(): Promise<void> {
		if (this.isStopped) {
			logger.warn('MemAgent is already stopped');
			return;
		}

		if (!this.isStarted) {
			throw new Error('MemAgent must be started before stopping');
		}

		try {
			logger.info('Stopping MemAgent...');
			const shutdownErrors: Error[] = [];
			try {
				if (this.mcpManager) {
					await this.mcpManager.disconnectAll();
					logger.debug('MCPManager disconnected all clients successfully');
				}
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				shutdownErrors.push(new Error(`MCPManager disconnect failed: ${err.message}`));
			}

			this.isStopped = true;
			this.isStarted = false;
			if (shutdownErrors.length > 0) {
				const errorMessages = shutdownErrors.map(e => e.message).join('; ');
				logger.warn(`MemAgent stopped with some errors: ${errorMessages}`);
				// Still consider it stopped, but log the errors
			} else {
				logger.info('MemAgent stopped successfully.');
			}
		} catch (error) {
			logger.error('Failed to stop MemAgent:', error);
			throw error;
		}
	}

	/**
	 * Get the status of the MemAgent
	 */
	public getIsStarted(): boolean {
		return this.isStarted;
	}

	/**
	 * Get the status of the MemAgent
	 */
	public getIsStopped(): boolean {
		return this.isStopped;
	}

	private ensureStarted(): void {
		if (this.isStopped) {
			throw new Error('MemAgent has been stopped and cannot be used');
		}
		if (!this.isStarted) {
			throw new Error('MemAgent must be started before use. Call agent.start() first.');
		}
	}

	/**
	 * Run the MemAgent
	 */
	public async run(
		userInput: string,
		imageDataInput?: { image: string; mimeType: string },
		sessionId?: string,
		stream: boolean = false
	): Promise<string | null> {
		this.ensureStarted();
		try {
			let session: ConversationSession;
			if (sessionId) {
				session =
					(await this.sessionManager.getSession(sessionId)) ??
					(await this.sessionManager.createSession(sessionId));
			} else {
				if (!this.defaultSession || this.defaultSession.id !== this.currentDefaultSessionId) {
					this.defaultSession = await this.sessionManager.createSession(
						this.currentDefaultSessionId
					);
					logger.debug(`MemAgent.run: created/loaded default session ${this.defaultSession.id}`);
				}
				session = this.defaultSession;
			}
			logger.debug(`MemAgent.run: using session ${session.id}`);
			const response = await session.run(userInput, imageDataInput, stream);
			if (response && response.trim() !== '' && this.openaiService) {
				const openaiApiKey = this.openaiService["openai"]?.apiKey || process.env.OPENAI_API_KEY;
				if (openaiApiKey) {
					// Generate embeddings for user input and response
					Promise.all([
						import('../llm/services/openai.js').then(m => m.OpenAIService.generateEmbedding(openaiApiKey, userInput)),
						import('../llm/services/openai.js').then(m => m.OpenAIService.generateEmbedding(openaiApiKey, response)),
					]).then(async ([userEmbedding, responseEmbedding]) => {
						const entry: ChatMemoryEntry = {
							userPurpose: userInput,
							cursorResponse: response,
							userEmbedding,
							responseEmbedding,
							timestamp: new Date().toISOString(),
							sessionId,
						};

						// LLM-based programming relevance check
						let userRelevant = false;
						let responseRelevant = false;
						try {
							[userRelevant, responseRelevant] = await Promise.all([
								isProgrammingRelatedLLM(userInput, openaiApiKey),
								isProgrammingRelatedLLM(response, openaiApiKey)
							]);
							// eslint-disable-next-line no-console
							console.debug('[MemAgent] Programming relevance:', { userRelevant, responseRelevant });
						} catch (err) {
							// eslint-disable-next-line no-console
							console.error('[MemAgent] Error during programming relevance check:', err);
						}
						if (userRelevant || responseRelevant) {
							// eslint-disable-next-line no-console
							console.info('[MemAgent] Saving programming-related chat to Qdrant.');
							this.memoryService.saveChatInteraction(entry).catch(err => {
								logger.error('Failed to save chat interaction to memory service:', err);
							});
						} else {
							// eslint-disable-next-line no-console
							console.info('[MemAgent] Skipped saving non-programming-related chat to Qdrant.');
						}
					});
				}
			}
			return response;
			// Return null if the response is empty or just whitespace.
			return null;
		} catch (error) {
			logger.error('MemAgent.run: error', error);
			throw error;
		}
	}

	public async createSession(sessionId?: string): Promise<ConversationSession> {
		this.ensureStarted();
		return await this.sessionManager.createSession(sessionId);
	}

	public async getSession(sessionId: string): Promise<ConversationSession | null> {
		this.ensureStarted();
		return await this.sessionManager.getSession(sessionId);
	}

	public getCurrentLLMConfig(): LLMConfig {
		this.ensureStarted();
		return structuredClone(this.stateManager.getLLMConfig());
	}

	public async connectMcpServer(name: string, config: McpServerConfig): Promise<void> {
		this.ensureStarted();
		try {
			// Add to runtime state first with validation
			const validation = this.stateManager.addMcpServer(name, config);

			if (!validation.isValid) {
				const errorMessages = validation.errors.map(e => e.message).join(', ');
				throw new Error(`Invalid MCP server configuration: ${errorMessages}`);
			}

			// Then connect the server
			await this.mcpManager.connectServer(name, config);
			logger.info(`MemAgent: Successfully added and connected to MCP server '${name}'.`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`MemAgent: Failed to add MCP server '${name}': ${errorMessage}`);

			// Clean up state if connection failed
			this.stateManager.removeMcpServer(name);
			throw error;
		}
	}

	public async removeMcpServer(name: string): Promise<void> {
		this.ensureStarted();
		// Disconnect the client first
		await this.mcpManager.removeClient(name);

		// Then remove from runtime state
		this.stateManager.removeMcpServer(name);
	}

	public async executeMcpTool(toolName: string, args: any): Promise<any> {
		this.ensureStarted();
		return await this.mcpManager.executeTool(toolName, args);
	}

	public async getAllMcpTools(): Promise<any> {
		this.ensureStarted();
		return await this.mcpManager.getAllTools();
	}

	public getMcpClients(): Map<string, IMCPClient> {
		this.ensureStarted();
		return this.mcpManager.getClients();
	}

	public getMcpFailedConnections(): Record<string, string> {
		this.ensureStarted();
		return this.mcpManager.getFailedConnections();
	}

	public getEffectiveConfig(sessionId?: string): Readonly<AgentConfig> {
		this.ensureStarted();
		return sessionId
			? this.stateManager.getRuntimeConfig(sessionId)
			: this.stateManager.getRuntimeConfig();
	}
}
