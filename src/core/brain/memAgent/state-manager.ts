import { LLMConfig } from '../llm/config.js';
import { AgentConfig } from './config.js';
import { logger } from '../../logger/index.js';
import { McpServerValidationResult, validateMcpServerConfig } from '../../mcp/validation.js';
import { McpServerConfig } from '../../mcp/types.js';

export interface SessionOverride {
	/** Override LLM config for this session */
	llm?: Partial<LLMConfig>;
	/** Override evaluation LLM config for this session */
	evalLlm?: Partial<LLMConfig>;
}

export class MemAgentStateManager {
	private runtimeConfig: AgentConfig;
	private readonly baselineConfig: AgentConfig;
	private sessionOverrides: Map<string, SessionOverride> = new Map();

	constructor(staticConfig: AgentConfig) {
		this.baselineConfig = structuredClone(staticConfig);
		this.runtimeConfig = structuredClone(staticConfig);
	}

	public addMcpServer(
		serverName: string,
		serverConfig: McpServerConfig
	): McpServerValidationResult {
		logger.debug(`Adding/updating MCP server: ${serverName}`);

		// Ensure mcpServers is initialized
		if (!this.runtimeConfig.mcpServers) {
			this.runtimeConfig.mcpServers = {};
		}

		// Validate the server configuration
		const existingServerNames = Object.keys(this.runtimeConfig.mcpServers);
		const validation = validateMcpServerConfig(serverName, serverConfig, existingServerNames);

		if (!validation.isValid) {
			logger.warn('MCP server configuration validation failed', {
				serverName,
				errors: validation.errors.map(e => e.message),
				warnings: validation.warnings,
			});
			return validation;
		}

		// Log warnings if any
		if (validation.warnings.length > 0) {
			logger.warn('MCP server configuration warnings', {
				serverName,
				warnings: validation.warnings,
			});
		}

		const isUpdate = this.runtimeConfig.mcpServers && serverName in this.runtimeConfig.mcpServers;
		// Use the validated config with defaults applied from validation result
		this.runtimeConfig.mcpServers[serverName] = validation.config!;

		logger.info(`MCP server '${serverName}' ${isUpdate ? 'updated' : 'added'} successfully`);

		return validation;
	}

	public removeMcpServer(serverName: string): void {
		logger.debug(`Removing MCP server: ${serverName}`);

		if (this.runtimeConfig.mcpServers && serverName in this.runtimeConfig.mcpServers) {
			delete this.runtimeConfig.mcpServers[serverName];

			logger.info(`MCP server '${serverName}' removed successfully`);
		} else {
			logger.warn(`MCP server '${serverName}' not found for removal`);
		}
	}

	public getRuntimeConfig(sessionId?: string): Readonly<AgentConfig> {
		if (!sessionId) {
			return structuredClone(this.runtimeConfig);
		}

		const override = this.sessionOverrides.get(sessionId);
		if (!override) {
			return structuredClone(this.runtimeConfig);
		}

		const result = {
			...this.runtimeConfig,
			llm: { ...this.runtimeConfig.llm, ...override.llm },
		} as AgentConfig;

		if (override.evalLlm && this.runtimeConfig.evalLlm) {
			result.evalLlm = { ...this.runtimeConfig.evalLlm, ...override.evalLlm };
		} else if (override.evalLlm) {
			result.evalLlm = override.evalLlm as LLMConfig;
		} else {
			result.evalLlm = this.runtimeConfig.evalLlm;
		}

		return result;
	}

	public getLLMConfig(sessionId?: string): Readonly<LLMConfig> {
		const config = this.getRuntimeConfig(sessionId);
		return {
			...config.llm,
			maxIterations: config.llm.maxIterations ?? 10, // Provide default value
		};
	}

	/**
	 * Get evaluation LLM configuration with fallback to main LLM config
	 * Used for evaluation tasks that typically require non-thinking models
	 */
	public getEvalLLMConfig(sessionId?: string): Readonly<LLMConfig> {
		const config = this.getRuntimeConfig(sessionId);

		// If evalLlm is provided and valid, use it
		if (config.evalLlm) {
			try {
				// Validate the evalLlm configuration
				const evalConfig = {
					...config.evalLlm,
					maxIterations: config.evalLlm.maxIterations ?? 5, // Default for eval tasks
				};

				// Check if required fields are present
				if (evalConfig.provider && evalConfig.model) {
					logger.debug('Using configured evalLlm for evaluation tasks', {
						provider: evalConfig.provider,
						model: evalConfig.model,
					});
					return evalConfig;
				}
			} catch (error) {
				logger.warn('Invalid evalLlm configuration, falling back to main LLM', {
					error: error instanceof Error ? error.message : String(error),
					sessionId,
				});
			}
		}

		// Fallback to main LLM configuration
		const fallbackConfig = {
			...config.llm,
			maxIterations: 5, // Use lower iterations for eval tasks
		};

		logger.debug('Using fallback LLM configuration for evaluation tasks', {
			provider: fallbackConfig.provider,
			model: fallbackConfig.model,
			sessionId,
		});

		return fallbackConfig;
	}

	/**
	 * Update LLM configuration globally or for a specific session
	 */
	public updateLLMConfig(newConfig: Partial<LLMConfig>, sessionId?: string): void {
		if (sessionId) {
			// Update session-specific config
			const existingOverride = this.sessionOverrides.get(sessionId) || {};
			this.sessionOverrides.set(sessionId, {
				...existingOverride,
				llm: { ...existingOverride.llm, ...newConfig },
			});
			logger.info(`Updated LLM config for session ${sessionId}`, { newConfig });
		} else {
			// Update global runtime config
			this.runtimeConfig.llm = { ...this.runtimeConfig.llm, ...newConfig };
			logger.info('Updated global LLM config', { newConfig });
		}
	}

	/**
	 * Remove session-specific LLM configuration override
	 */
	public clearSessionLLMOverride(sessionId: string): void {
		const override = this.sessionOverrides.get(sessionId);
		if (override) {
			if (override.llm) {
				delete override.llm;
				if (Object.keys(override).length === 0) {
					this.sessionOverrides.delete(sessionId);
				}
				logger.info(`Cleared LLM config override for session ${sessionId}`);
			}
		}
	}

	/**
	 * Get all active session overrides (for debugging/inspection)
	 */
	public getSessionOverrides(): Map<string, SessionOverride> {
		return new Map(this.sessionOverrides);
	}
}
