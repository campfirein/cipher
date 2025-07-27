import { MCPManager } from '@core/mcp/manager.js';
import { AgentServices } from '../../utils/service-initializer.js';
import { createAgentServices } from '../../utils/service-initializer.js';
import { EnhancedPromptManager } from '../systemPrompt/enhanced-manager.js';
import { MemAgentStateManager } from './state-manager.js';
import { SessionManager } from '../../session/session-manager.js';
import { ConversationSession } from '../../session/coversation-session.js';
import { AgentConfig } from './config.js';
import { logger } from '../../logger/index.js';
import { LLMConfig } from '../llm/config.js';
import { IMCPClient, McpServerConfig } from '../../mcp/types.js';
import { normalizeTextForRetrieval } from '../embedding/utils.js';

const requiredServices: (keyof AgentServices)[] = [
	'mcpManager',
	'promptManager',
	'stateManager',
	'sessionManager',
	'internalToolManager',
	'unifiedToolManager',
];

export class MemAgent {
	public readonly mcpManager!: MCPManager;
	public readonly promptManager!: EnhancedPromptManager;
	public readonly stateManager!: MemAgentStateManager;
	public readonly sessionManager!: SessionManager;
	public readonly internalToolManager!: any; // Will be properly typed later
	public readonly unifiedToolManager!: any; // Will be properly typed later
	public readonly services!: AgentServices;

	private defaultSession: ConversationSession | null = null;

	private currentDefaultSessionId: string = 'default';
	private currentActiveSessionId: string = 'default';

	private isStarted: boolean = false;
	private isStopped: boolean = false;

	private config: AgentConfig;

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
				internalToolManager: services.internalToolManager,
				unifiedToolManager: services.unifiedToolManager,
				services: services,
			});
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
	// This part to implement input refinement
	public async run(
		userInput: string,
		imageDataInput?: { image: string; mimeType: string },
		sessionId?: string,
		stream: boolean = false,
		options?: {
			memoryMetadata?: Record<string, any>;
			sessionOptions?: Record<string, any>;
		}
	): Promise<{ response: string | null; backgroundOperations: Promise<void> }> {
		this.ensureStarted();
		try {
			let session: ConversationSession;
			if (sessionId) {
				session =
					(await this.sessionManager.getSession(sessionId)) ??
					(await this.sessionManager.createSession(sessionId));
				this.currentActiveSessionId = sessionId;
			} else {
				// Use current active session or fall back to default
				session =
					(await this.sessionManager.getSession(this.currentActiveSessionId)) ??
					(await this.sessionManager.createSession(this.currentActiveSessionId));
			}
			logger.debug(`MemAgent.run: using session ${session.id}`);

			// --- input refinement --- 
			const refinementConfig = this.config.inputRefinement;

			if (refinementConfig) {
				logger.info(`Original input: "${userInput}"`);
				const normalizedInput = normalizeTextForRetrieval(userInput, refinementConfig);
				if (userInput !== normalizedInput) {
					logger.info(`Input has been normalized to: "${normalizedInput}"`);
					userInput = normalizedInput;
				}
			}

			const { response, backgroundOperations } = await session.run(
				userInput,
				imageDataInput,
				stream,
				{
					...(options?.memoryMetadata !== undefined && { memoryMetadata: options.memoryMetadata }),
					...(options?.sessionOptions !== undefined && {
						contextOverrides: options.sessionOptions,
					}),
				}
			);

			const finalResponse = response && response.trim() !== '' ? response : null;
			return { response: finalResponse, backgroundOperations };
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

	/**
	 * Get the current active session ID
	 */
	public getCurrentSessionId(): string {
		this.ensureStarted();
		return this.currentActiveSessionId;
	}

	/**
	 * Load (switch to) a specific session
	 */
	public async loadSession(sessionId: string): Promise<ConversationSession> {
		this.ensureStarted();
		let session = await this.sessionManager.getSession(sessionId);

		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		this.currentActiveSessionId = sessionId;
		logger.debug(`MemAgent: Switched to session ${sessionId}`);
		return session;
	}

	/**
	 * Get all active session IDs
	 */
	public async listSessions(): Promise<string[]> {
		this.ensureStarted();
		return await this.sessionManager.getActiveSessionIds();
	}

	/**
	 * Remove a session
	 */
	public async removeSession(sessionId: string): Promise<boolean> {
		this.ensureStarted();

		// Prevent removing the currently active session
		if (sessionId === this.currentActiveSessionId) {
			throw new Error(
				'Cannot remove the currently active session. Switch to another session first.'
			);
		}

		return await this.sessionManager.removeSession(sessionId);
	}

	/**
	 * Get session metadata including creation time and activity
	 */
	public async getSessionMetadata(sessionId: string): Promise<{
		id: string;
		createdAt?: number;
		lastActivity?: number;
		messageCount?: number;
	} | null> {
		this.ensureStarted();

		// Check if session exists
		const session = await this.sessionManager.getSession(sessionId);
		if (!session) {
			return null;
		}

		// For now, return basic metadata since SessionManager doesn't expose internal metadata
		// This could be enhanced later to track more detailed session statistics
		return {
			id: sessionId,
			createdAt: Date.now(), // Placeholder - actual creation time would need to be tracked
			lastActivity: Date.now(), // Placeholder - actual last activity would need to be tracked
			messageCount: 0, // Placeholder - message count would need to be tracked
		};
	}

	/**
	 * Get conversation history for a specific session
	 */
	public async getSessionHistory(sessionId: string): Promise<any[]> {
		this.ensureStarted();

		// Get the session
		const session = await this.sessionManager.getSession(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		// Access the context manager to get raw messages
		// Note: We need to access the private contextManager property
		// This is a temporary solution until we add a proper public method to ConversationSession
		const contextManager = (session as any).contextManager;
		if (!contextManager) {
			// Session might not be initialized yet
			return [];
		}

		// Get raw messages and convert them to a format suitable for API response
		const rawMessages = contextManager.getRawMessages();

		// Transform the messages to a more user-friendly format
		return rawMessages.map((msg: any, index: number) => ({
			id: index + 1,
			role: msg.role,
			content: msg.content,
			timestamp: new Date().toISOString(), // Placeholder - actual timestamps would need to be tracked
			...(msg.toolCalls && { toolCalls: msg.toolCalls }),
			...(msg.toolCallId && { toolCallId: msg.toolCallId }),
			...(msg.name && { name: msg.name }),
		}));
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

	public getCurrentActiveSessionId() {
		return this.currentActiveSessionId;
	}
}
