/**
 * Internal Tool Manager
 *
 * Manages execution of internal tools with caching, statistics tracking,
 * and integration with the broader agent architecture.
 */

import { logger } from '../../logger/index.js';
import { ToolExecutionResult } from '../../mcp/types.js';
import { InternalToolRegistry } from './registry.js';
import {
	IInternalToolManager,
	InternalTool,
	InternalToolSet,
	InternalToolCategory,
	InternalToolManagerConfig,
	InternalToolContext,
	ToolExecutionStats,
	createInternalToolName,
} from './types.js';
import { EventManager } from '../../events/event-manager.js';
import { SessionEvents } from '../../events/event-types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Cache entry for tool execution statistics
 */
interface StatsEntry {
	stats: ToolExecutionStats;
	executionTimes: number[];
	maxHistorySize: number;
}

/**
 * Default configuration for the internal tool manager
 */
const DEFAULT_CONFIG: Required<InternalToolManagerConfig> = {
	enabled: true,
	timeout: 30000, // 30 seconds
	enableCache: true,
	cacheTimeout: 300000, // 5 minutes
};

/**
 * Internal Tool Manager implementation
 */
export class InternalToolManager implements IInternalToolManager {
	private config: Required<InternalToolManagerConfig>;
	private registry: InternalToolRegistry;
	private initialized = false;
	private stats = new Map<string, StatsEntry>();
	private readonly maxExecutionHistorySize = 100;
	private eventManager?: EventManager;
	private services?: {
		embeddingManager?: any;
		vectorStoreManager?: any;
		llmService?: any;
		knowledgeGraphManager?: any;
	};

	constructor(config: InternalToolManagerConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.registry = InternalToolRegistry.getInstance();

		// Initialize with mock services for testing environments
		this.services = {
			embeddingManager: {
				getEmbedder: () => ({
					embed: async (_text: string) =>
						Array(128)
							.fill(0)
							.map(() => Math.random()),
				}),
			},
			vectorStoreManager: {
				getStore: () => ({
					search: async (_embedding: number[], _maxResults: number = 5) => [
						{
							id: 1,
							score: 0.7,
							payload: { text: 'Similar existing memory', tags: ['programming'] },
						},
					],
					insert: async (_embeddings: number[][], _ids: number[], _payloads: any[]) => {
						// Mock successful insert
						return;
					},
					update: async (_id: number, _embedding: number[], _payload: any) => {
						// Mock successful update
						return;
					},
					delete: async (_id: number) => {
						// Mock successful delete
						return;
					},
				}),
			},
			llmService: {
				directGenerate: async (_prompt: string) =>
					'Operation: ADD\nConfidence: 0.8\nReasoning: New technical information to store',
			},
		};
	}

	/**
	 * Initialize the internal tool manager
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) {
			logger.warn('InternalToolManager: Already initialized');
			return;
		}

		if (!this.config.enabled) {
			logger.debug('InternalToolManager: Disabled by configuration');
			this.initialized = true; // Mark as initialized even when disabled
			return;
		}

		try {
			// InternalToolManager initialization logging reduced for cleaner CLI

			// Initialize the registry
			await this.registry.initialize();

			this.initialized = true;
			// InternalToolManager initialization success logging reduced for cleaner CLI
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`InternalToolManager: Initialization failed: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Register a new internal tool
	 */
	public registerTool(tool: InternalTool): {
		success: boolean;
		message: string;
		conflictedWith?: string;
	} {
		this.ensureInitialized();

		const result = this.registry.registerTool(tool);

		if (result.success) {
			// Initialize stats for the new tool using normalized name
			const normalizedName = createInternalToolName(tool.name);
			this.initializeToolStats(normalizedName);
			// Individual tool registration logging removed to reduce CLI noise
		} else {
			logger.warn(`InternalToolManager: Failed to register tool '${tool.name}': ${result.message}`);
		}

		return result;
	}

	/**
	 * Unregister an internal tool
	 */
	public unregisterTool(toolName: string): boolean {
		this.ensureInitialized();

		const normalizedName = createInternalToolName(toolName);
		const result = this.registry.unregisterTool(normalizedName);

		if (result) {
			// Clear stats for the removed tool
			this.stats.delete(normalizedName);
			logger.info(`InternalToolManager: Successfully unregistered tool '${normalizedName}'`);
		}

		return result;
	}

	/**
	 * Get all registered internal tools
	 */
	public getAllTools(): InternalToolSet {
		this.ensureInitialized();
		return this.registry.getAllTools();
	}

	/**
	 * Get a specific internal tool by name
	 */
	public getTool(toolName: string): InternalTool | undefined {
		this.ensureInitialized();
		return this.registry.getTool(toolName);
	}

	/**
	 * Check if a tool name is an internal tool
	 */
	public isInternalTool(toolName: string): boolean {
		if (!this.initialized || !this.config.enabled) {
			return false;
		}
		// Check both prefixed and non-prefixed versions
		const normalizedName = createInternalToolName(toolName);
		return this.registry.isInternalTool(toolName) || this.registry.isInternalTool(normalizedName);
	}

	/**
	 * Execute an internal tool
	 */
	public async executeTool(
		toolName: string,
		args: any,
		context?: Partial<InternalToolContext>
	): Promise<ToolExecutionResult> {
		this.ensureInitialized();

		const startTime = Date.now();
		const normalizedName = createInternalToolName(toolName);
		const executionId = uuidv4();

		// Get the tool
		const tool = this.registry.getTool(normalizedName);
		if (!tool) {
			throw new Error(`Internal tool '${normalizedName}' not found`);
		}

		// Create execution context
		const execContext: InternalToolContext = {
			toolName,
			startTime,
			sessionId: context?.sessionId,
			userId: context?.userId || '',
			metadata: context?.metadata,
			services: {
				...this.services,
				...context?.services,
			},
		};

		// Emit tool execution started event
		if (this.eventManager && execContext.sessionId) {
			this.eventManager.emitSessionEvent(
				execContext.sessionId,
				SessionEvents.TOOL_EXECUTION_STARTED,
				{
					toolName: normalizedName,
					toolType: 'internal',
					sessionId: execContext.sessionId,
					executionId,
					timestamp: startTime,
				}
			);
		}

		logger.debug(`InternalToolManager: Executing tool '${normalizedName}'`, {
			toolName: normalizedName,
			category: tool.category,
			hasArgs: !!args,
			sessionId: execContext.sessionId,
			executionId,
		});

		try {
			// Execute with timeout
			const result = await this.executeWithTimeout(tool, args, execContext);

			// Record successful execution
			const executionTime = Date.now() - startTime;
			this.recordExecution(normalizedName, true, executionTime);

			// Emit tool execution completed event
			if (this.eventManager && execContext.sessionId) {
				this.eventManager.emitSessionEvent(
					execContext.sessionId,
					SessionEvents.TOOL_EXECUTION_COMPLETED,
					{
						toolName: normalizedName,
						toolType: 'internal',
						sessionId: execContext.sessionId,
						executionId,
						duration: executionTime,
						success: true,
						timestamp: Date.now(),
					}
				);
			}

			logger.debug(`InternalToolManager: Tool '${normalizedName}' executed successfully`, {
				toolName: normalizedName,
				executionTime,
				executionId,
			});

			return result;
		} catch (error) {
			// Record failed execution
			const executionTime = Date.now() - startTime;
			this.recordExecution(normalizedName, false, executionTime);

			const errorMessage = error instanceof Error ? error.message : String(error);

			// Emit tool execution failed event
			if (this.eventManager && execContext.sessionId) {
				this.eventManager.emitSessionEvent(
					execContext.sessionId,
					SessionEvents.TOOL_EXECUTION_FAILED,
					{
						toolName: normalizedName,
						toolType: 'internal',
						sessionId: execContext.sessionId,
						executionId,
						error: errorMessage,
						duration: executionTime,
						timestamp: Date.now(),
					}
				);
			}

			logger.error(`InternalToolManager: Tool '${normalizedName}' execution failed`, {
				toolName: normalizedName,
				error: errorMessage,
				executionTime,
				executionId,
			});

			throw new Error(`Internal tool execution failed: ${errorMessage}`);
		}
	}

	/**
	 * Get tools by category
	 */
	public getToolsByCategory(category: InternalToolCategory): InternalToolSet {
		this.ensureInitialized();
		return this.registry.getToolsByCategory(category);
	}

	/**
	 * Get execution statistics for a tool
	 */
	public getToolStats(toolName: string): ToolExecutionStats | undefined {
		const normalizedName = createInternalToolName(toolName);
		const entry = this.stats.get(normalizedName);
		return entry ? { ...entry.stats } : undefined;
	}

	/**
	 * Get overall manager statistics
	 */
	public getManagerStats(): {
		totalTools: number;
		toolsByCategory: Record<InternalToolCategory, number>;
		totalExecutions: number;
	} {
		this.ensureInitialized();

		const registryStats = this.registry.getRegistryStats();
		let totalExecutions = 0;

		for (const entry of this.stats.values()) {
			totalExecutions += entry.stats.totalExecutions;
		}

		return {
			totalTools: registryStats.totalTools,
			toolsByCategory: registryStats.toolsByCategory,
			totalExecutions,
		};
	}

	/**
	 * Get all tool statistics
	 */
	public getStatistics(): Record<string, ToolExecutionStats> {
		const allStats: Record<string, ToolExecutionStats> = {};

		for (const [toolName, entry] of this.stats.entries()) {
			allStats[toolName] = { ...entry.stats };
		}

		return allStats;
	}

	/**
	 * Get available tools list
	 */
	public async getAvailableTools(): Promise<
		Array<{ name: string; description: string; category: string }>
	> {
		this.ensureInitialized();

		const tools = this.registry.getAllTools();
		return Object.values(tools).map(tool => ({
			name: tool.name,
			description: tool.description,
			category: tool.category,
		}));
	}

	/**
	 * Clear all execution statistics
	 */
	public clearStats(): void {
		this.stats.clear();
		logger.info('InternalToolManager: Cleared all execution statistics');
	}

	/**
	 * Shutdown the internal tool manager
	 */
	public async shutdown(): Promise<void> {
		if (!this.initialized) {
			return;
		}

		try {
			logger.info('InternalToolManager: Shutting down...');

			// Clear all data
			this.clearStats();
			this.registry.clear();

			this.initialized = false;
			logger.info('InternalToolManager: Shutdown completed');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`InternalToolManager: Shutdown failed: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Execute tool with timeout handling
	 */
	private async executeWithTimeout(
		tool: InternalTool,
		args: any,
		context: InternalToolContext
	): Promise<ToolExecutionResult> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Tool execution timeout after ${this.config.timeout}ms`));
			}, this.config.timeout);

			tool
				.handler(args, context)
				.then(result => {
					clearTimeout(timeoutId);
					resolve(result);
				})
				.catch(error => {
					clearTimeout(timeoutId);
					reject(error);
				});
		});
	}

	/**
	 * Record tool execution statistics
	 */
	private recordExecution(toolName: string, success: boolean, executionTime: number): void {
		let entry = this.stats.get(toolName);

		if (!entry) {
			entry = this.createStatsEntry(toolName);
			this.stats.set(toolName, entry);
		}

		// Update statistics
		entry.stats.totalExecutions++;
		entry.stats.lastExecution = new Date().toISOString();

		if (success) {
			entry.stats.successfulExecutions++;
		} else {
			entry.stats.failedExecutions++;
		}

		// Update execution times for average calculation
		entry.executionTimes.push(executionTime);

		// Keep only recent execution times for memory efficiency
		if (entry.executionTimes.length > entry.maxHistorySize) {
			entry.executionTimes = entry.executionTimes.slice(-entry.maxHistorySize);
		}

		// Calculate average execution time
		entry.stats.averageExecutionTime =
			entry.executionTimes.reduce((sum, time) => sum + time, 0) / entry.executionTimes.length;
	}

	/**
	 * Initialize statistics for a tool
	 */
	private initializeToolStats(toolName: string): void {
		// toolName should already be normalized when called from registerTool
		if (!this.stats.has(toolName)) {
			this.stats.set(toolName, this.createStatsEntry(toolName));
		}
	}

	/**
	 * Create a new stats entry
	 */
	private createStatsEntry(toolName: string): StatsEntry {
		return {
			stats: {
				toolName,
				totalExecutions: 0,
				successfulExecutions: 0,
				failedExecutions: 0,
				averageExecutionTime: 0,
			},
			executionTimes: [],
			maxHistorySize: this.maxExecutionHistorySize,
		};
	}

	/**
	 * Ensure the manager is initialized
	 */
	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error(
				'InternalToolManager must be initialized before use. Call initialize() first.'
			);
		}

		if (!this.config.enabled) {
			throw new Error('InternalToolManager is disabled by configuration');
		}
	}

	/**
	 * Get configuration
	 */
	public getConfig(): Required<InternalToolManagerConfig> {
		return { ...this.config };
	}

	/**
	 * Check if manager is initialized
	 */
	public isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Check if manager is enabled
	 */
	public isEnabled(): boolean {
		return this.config.enabled;
	}

	/**
	 * Set agent services for tools that need access to them
	 */
	public setServices(services: {
		embeddingManager?: any;
		vectorStoreManager?: any;
		llmService?: any;
		knowledgeGraphManager?: any;
	}): void {
		this.services = services;
		// InternalToolManager services configuration logging reduced for cleaner CLI
	}

	/**
	 * Set the event manager for emitting tool execution events
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
	}
}
