import { MCPManager } from '@core/mcp/manager.js';
import { AgentServices } from '../../utils/service-initializer.js';
import { createAgentServices } from '../../utils/service-initializer.js';
import {
	createEnhancedAgentServices,
	shouldEnableLazyLoading,
	LazyAgentServices,
} from '../memory/enhanced-service-initializer.js';
import { EnhancedPromptManager } from '../systemPrompt/enhanced-manager.js';
import { MemAgentStateManager } from './state-manager.js';
import { SessionManager } from '../../session/session-manager.js';
import { ConversationSession } from '../../session/coversation-session.js';
import { AgentConfig } from './config.js';
import { logger } from '../../logger/index.js';
import { LLMConfig } from '../llm/config.js';
import { IMCPClient, McpServerConfig } from '../../mcp/types.js';

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
	private currentActiveSessionId: string = 'default'; // Will be set properly in constructor

	private isStarted: boolean = false;
	private isStopped: boolean = false;

	private config: AgentConfig;
	private appMode: 'cli' | 'mcp' | 'api' | null = null;

	constructor(config: AgentConfig, appMode?: 'cli' | 'mcp' | 'api') {
		this.config = config;
		this.appMode = appMode || null;

		// Set session ID based on mode
		if (appMode === 'cli') {
			// For CLI, use default session to enable persistence
			this.currentActiveSessionId = this.currentDefaultSessionId;
		} else {
			// For API/MCP, generate unique session IDs
			this.currentActiveSessionId = this.generateUniqueSessionId();
		}

		if (appMode !== 'cli') {
			logger.debug('MemAgent created');
		}
	}

	/**
	 * Generate a unique session ID for API/MCP modes
	 * CLI mode uses the default session for persistence
	 */
	private generateUniqueSessionId(): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		return `session-${timestamp}-${random}`;
	}

	/**
	 * Start the MemAgent
	 */
	public async start(): Promise<void> {
		if (this.isStarted) {
			throw new Error('MemAgent is already started');
		}

		try {
			if (this.appMode !== 'cli') {
				logger.debug('Starting MemAgent...');
			}

			// 1. Initialize services with optional lazy loading
			const useLazyLoading = shouldEnableLazyLoading({
				appMode: this.appMode || undefined,
			});
			let services: AgentServices | LazyAgentServices;

			if (useLazyLoading) {
				logger.debug('MemAgent: Using enhanced services with lazy loading');
				services = await createEnhancedAgentServices(this.config, {
					enableLazyLoading: true,
					...(this.appMode && { appMode: this.appMode }),
				});
			} else {
				logger.debug('MemAgent: Using standard services');
				services = await createAgentServices(this.config, this.appMode || undefined);
			}

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

			// Sessions are already loaded during SessionManager initialization
			// No need to load them again here

			this.isStarted = true;
			if (this.appMode !== 'cli') {
				logger.debug('MemAgent started successfully');
			}
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

			// Save all sessions before shutdown
			try {
				if (this.sessionManager) {
					logger.info('Saving all sessions before shutdown...');
					await this.sessionManager.shutdown(); // This will call saveAllSessions internally
					logger.debug('SessionManager shutdown completed');
				}
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				shutdownErrors.push(new Error(`SessionManager shutdown failed: ${err.message}`));
			}

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
		logger.debug(`MemAgent: Creating session with ID: ${sessionId || 'auto-generated'}`);
		const session = await this.sessionManager.createSession(sessionId);
		logger.info(`MemAgent: Created session: ${session.id}`);
		return session;
	}

	public async getSession(sessionId: string): Promise<ConversationSession | null> {
		this.ensureStarted();
		let session = await this.sessionManager.getSession(sessionId);

		// For CLI mode, automatically create the default session if it doesn't exist
		if (!session && this.appMode === 'cli' && sessionId === 'default') {
			logger.debug(
				'MemAgent: Default session not found, creating new default session for CLI mode'
			);
			try {
				session = await this.sessionManager.createSession('default');
				logger.info('MemAgent: Created default session for CLI mode');
			} catch (error) {
				logger.error('MemAgent: Failed to create default session:', error);
				return null;
			}
		}

		return session;
	}

	/**
	 * Get the current active session ID
	 */
	public getCurrentSessionId(): string {
		this.ensureStarted();
		return this.currentActiveSessionId;
	}

	/**
	 * Load conversation history for a specific session
	 */
	public async loadSessionHistory(sessionId: string): Promise<void> {
		this.ensureStarted();
		const session = await this.sessionManager.getSession(sessionId);

		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		try {
			await session.refreshConversationHistory();
		} catch (error) {
			logger.warn(`MemAgent: Failed to load conversation history for session ${sessionId}:`, error);
			throw error;
		}
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

		// Initialize services and load conversation history
		try {
			logger.debug(`MemAgent: Loading session ${sessionId}...`);
			await session.init(); // Initialize services first

			// Load conversation history so AI can see previous messages
			await session.refreshConversationHistory();
			logger.info(`MemAgent: Successfully loaded session ${sessionId} with conversation history`);
		} catch (error) {
			logger.warn(`MemAgent: Failed to initialize session ${sessionId}:`, error);
			// Continue even if initialization fails
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

		// Get actual message count from the session
		let messageCount = 0;
		try {
			const history = await session.getConversationHistory();
			messageCount = history.length;
		} catch (error) {
			logger.warn(`Failed to get message count for session ${sessionId}:`, error);
		}

		// For now, return basic metadata since SessionManager doesn't expose internal metadata
		// This could be enhanced later to track more detailed session statistics
		return {
			id: sessionId,
			createdAt: Date.now(), // Placeholder - actual creation time would need to be tracked
			lastActivity: Date.now(), // Placeholder - actual last activity would need to be tracked
			messageCount,
		};
	}

	/**
	 * Get conversation history for the current session
	 */
	public async getCurrentSessionHistory(): Promise<any[]> {
		this.ensureStarted();
		const session = await this.sessionManager.getSession(this.currentActiveSessionId);
		if (!session) {
			return [];
		}
		return await session.getConversationHistory();
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

	/**
	 * Manually save all sessions to persistent storage
	 */
	public async saveAllSessions(): Promise<{ saved: number; failed: number; total: number }> {
		this.ensureStarted();
		const stats = await this.sessionManager.saveAllSessions();
		return {
			saved: stats.savedSessions,
			failed: stats.failedSessions,
			total: stats.totalSessions,
		};
	}

	/**
	 * Manually load all sessions from persistent storage
	 */
	public async loadAllSessions(): Promise<{ restored: number; failed: number; total: number }> {
		this.ensureStarted();
		const stats = await this.sessionManager.loadAllSessions();
		return {
			restored: stats.restoredSessions,
			failed: stats.failedSessions,
			total: stats.totalSessions,
		};
	}
}
