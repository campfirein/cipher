/**
 * Internal Tool Registry
 *
 * Singleton registry for managing internal tool registration, validation,
 * and lookup operations with O(1) performance.
 */

import { logger } from '../../logger/index.js';
import {
	InternalTool,
	InternalToolSet,
	InternalToolCategory,
	createInternalToolName,
} from './types.js';

/**
 * Registry for managing internal tools with singleton pattern
 */
export class InternalToolRegistry {
	private static instance: InternalToolRegistry | null = null;

	private tools = new Map<string, InternalTool>();
	private toolsByCategory = new Map<InternalToolCategory, Set<string>>();
	private initialized = false;

	private constructor() {
		// Initialize category maps
		this.toolsByCategory.set('memory', new Set());
		this.toolsByCategory.set('session', new Set());
		this.toolsByCategory.set('system', new Set());
	}

	/**
	 * Get the singleton instance of the registry
	 */
	public static getInstance(): InternalToolRegistry {
		if (!InternalToolRegistry.instance) {
			InternalToolRegistry.instance = new InternalToolRegistry();
		}
		return InternalToolRegistry.instance;
	}

	/**
	 * Initialize the registry
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) {
			logger.warn('InternalToolRegistry: Already initialized');
			return;
		}

		logger.info('InternalToolRegistry: Initializing...');
		this.initialized = true;
		logger.info('InternalToolRegistry: Initialized successfully');
	}

	/**
	 * Register a new internal tool
	 */
	public registerTool(tool: InternalTool): {
		success: boolean;
		message: string;
		conflictedWith?: string;
	} {
		try {
			// Validate tool structure
			const validation = this.validateTool(tool);
			if (!validation.valid) {
				return {
					success: false,
					message: `Tool validation failed: ${validation.error}`,
				};
			}

			// Ensure proper naming
			const toolName = createInternalToolName(tool.name);

			// Check for conflicts
			if (this.tools.has(toolName)) {
				return {
					success: false,
					message: `Tool '${toolName}' is already registered`,
					conflictedWith: toolName,
				};
			}

			// Update tool name if it was modified
			const normalizedTool: InternalTool = {
				...tool,
				name: toolName,
			};

			// Register the tool
			this.tools.set(toolName, normalizedTool);

			// Update category index
			const categorySet = this.toolsByCategory.get(tool.category);
			if (categorySet) {
				categorySet.add(toolName);
			}

			// Individual tool registration logging removed to reduce CLI noise

			return {
				success: true,
				message: `Tool '${toolName}' registered successfully`,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`InternalToolRegistry: Failed to register tool '${tool.name}': ${errorMessage}`);

			return {
				success: false,
				message: `Registration failed: ${errorMessage}`,
			};
		}
	}

	/**
	 * Unregister an internal tool
	 */
	public unregisterTool(toolName: string): boolean {
		try {
			const normalizedName = createInternalToolName(toolName);

			const tool = this.tools.get(normalizedName);
			if (!tool) {
				logger.warn(`InternalToolRegistry: Tool '${normalizedName}' not found for unregistration`);
				return false;
			}

			// Remove from main registry
			this.tools.delete(normalizedName);

			// Remove from category index
			const categorySet = this.toolsByCategory.get(tool.category);
			if (categorySet) {
				categorySet.delete(normalizedName);
			}

			logger.debug(`InternalToolRegistry: Unregistered tool '${normalizedName}'`);
			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(
				`InternalToolRegistry: Failed to unregister tool '${toolName}': ${errorMessage}`
			);
			return false;
		}
	}

	/**
	 * Get a specific tool by name
	 */
	public getTool(toolName: string): InternalTool | undefined {
		const normalizedName = createInternalToolName(toolName);
		return this.tools.get(normalizedName);
	}

	/**
	 * Get all registered tools
	 */
	public getAllTools(): InternalToolSet {
		const toolSet: InternalToolSet = {};

		for (const [name, tool] of this.tools) {
			toolSet[name] = tool;
		}

		return toolSet;
	}

	/**
	 * Get tools by category
	 */
	public getToolsByCategory(category: InternalToolCategory): InternalToolSet {
		const toolSet: InternalToolSet = {};
		const categorySet = this.toolsByCategory.get(category);

		if (categorySet) {
			for (const toolName of categorySet) {
				const tool = this.tools.get(toolName);
				if (tool) {
					toolSet[toolName] = tool;
				}
			}
		}

		return toolSet;
	}

	/**
	 * Check if a tool is registered
	 */
	public hasTool(toolName: string): boolean {
		const normalizedName = createInternalToolName(toolName);
		return this.tools.has(normalizedName);
	}

	/**
	 * Check if a tool name is an internal tool
	 */
	public isInternalTool(toolName: string): boolean {
		// Check both prefixed and non-prefixed versions
		const normalizedName = createInternalToolName(toolName);
		return this.hasTool(normalizedName) || this.hasTool(toolName);
	}

	/**
	 * Get the total number of registered tools
	 */
	public getToolCount(): number {
		return this.tools.size;
	}

	/**
	 * Get tool count by category
	 */
	public getToolCountByCategory(): Record<InternalToolCategory, number> {
		const memoryCount = this.toolsByCategory.get('memory')?.size || 0;
		const sessionCount = this.toolsByCategory.get('session')?.size || 0;
		const systemCount = this.toolsByCategory.get('system')?.size || 0;
		const knowledgeGraphCount = this.toolsByCategory.get('knowledge_graph')?.size || 0;

		return {
			memory: memoryCount,
			session: sessionCount,
			system: systemCount,
			knowledge_graph: knowledgeGraphCount,
		};
	}

	/**
	 * Get all tool names
	 */
	public getToolNames(): string[] {
		return Array.from(this.tools.keys());
	}

	/**
	 * Get tool names by category
	 */
	public getToolNamesByCategory(category: InternalToolCategory): string[] {
		const categorySet = this.toolsByCategory.get(category);
		return categorySet ? Array.from(categorySet) : [];
	}

	/**
	 * Clear all registered tools
	 */
	public clear(): void {
		this.tools.clear();

		for (const categorySet of this.toolsByCategory.values()) {
			categorySet.clear();
		}

		logger.info('InternalToolRegistry: Cleared all registered tools');
	}

	/**
	 * Validate tool structure and properties
	 */
	private validateTool(tool: InternalTool): { valid: boolean; error?: string } {
		// Check required properties
		if (!tool.name || typeof tool.name !== 'string') {
			return { valid: false, error: 'Tool name is required and must be a string' };
		}

		if (!tool.description || typeof tool.description !== 'string') {
			return { valid: false, error: 'Tool description is required and must be a string' };
		}

		// Use all available categories instead of hardcoded list
		const validCategories: InternalToolCategory[] = [
			'memory',
			'session',
			'system',
			'knowledge_graph',
		];
		if (!tool.category || !validCategories.includes(tool.category)) {
			return { valid: false, error: `Tool category must be one of: ${validCategories.join(', ')}` };
		}

		if (tool.internal !== true) {
			return { valid: false, error: 'Tool must have internal property set to true' };
		}

		if (!tool.handler || typeof tool.handler !== 'function') {
			return { valid: false, error: 'Tool handler is required and must be a function' };
		}

		if (!tool.parameters || typeof tool.parameters !== 'object') {
			return { valid: false, error: 'Tool parameters are required and must be an object' };
		}

		// Validate parameters structure
		if (tool.parameters.type !== 'object') {
			return { valid: false, error: 'Tool parameters type must be "object"' };
		}

		if (!tool.parameters.properties || typeof tool.parameters.properties !== 'object') {
			return { valid: false, error: 'Tool parameters must have a properties object' };
		}

		// Tool name should not conflict with MCP naming conventions
		if (tool.name.includes('.') && !tool.name.startsWith('cipher_')) {
			return { valid: false, error: 'Tool names with dots should start with cipher_ prefix' };
		}

		return { valid: true };
	}

	/**
	 * Get registry statistics
	 */
	public getRegistryStats(): {
		totalTools: number;
		toolsByCategory: Record<InternalToolCategory, number>;
		initialized: boolean;
	} {
		return {
			totalTools: this.getToolCount(),
			toolsByCategory: this.getToolCountByCategory(),
			initialized: this.initialized,
		};
	}

	/**
	 * Reset the singleton instance (mainly for testing)
	 */
	public static reset(): void {
		InternalToolRegistry.instance = null;
	}
}
