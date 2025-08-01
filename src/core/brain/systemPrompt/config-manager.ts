/**
 * Configuration Manager for System Prompt Architecture
 *
 * Handles loading, parsing, and validation of system prompt configurations.
 * Supports both programmatic configuration and file-based configuration.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { SystemPromptConfig, ProviderConfig, ProviderType } from './interfaces.js';

export interface ConfigLoadOptions {
	/** Base directory for resolving relative file paths */
	baseDir?: string;
	/** Environment variables to replace in configuration */
	envVariables?: Record<string, string>;
	/** Whether to validate configuration after loading */
	validate?: boolean;
}

export class SystemPromptConfigManager {
	private config: SystemPromptConfig | null = null;
	private baseDir: string = process.cwd();

	/**
	 * Load configuration from an object
	 */
	public loadFromObject(config: SystemPromptConfig, options: ConfigLoadOptions = {}): void {
		this.baseDir = options.baseDir || process.cwd();

		if (options.validate !== false) {
			this.validateConfig(config);
		}

		this.config = this.processConfiguration(config, options);
	}

	/**
	 * Load configuration from a JSON file
	 */
	public async loadFromFile(filePath: string, options: ConfigLoadOptions = {}): Promise<void> {
		const fullPath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(options.baseDir || process.cwd(), filePath);
		this.baseDir = path.dirname(fullPath);

		try {
			const fileContent = await fs.readFile(fullPath, 'utf8');
			const rawConfig = JSON.parse(fileContent);

			if (options.validate !== false) {
				this.validateConfig(rawConfig);
			}

			this.config = this.processConfiguration(rawConfig, options);
		} catch (error) {
			throw new Error(
				`Failed to load configuration from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Get the current configuration
	 */
	public getConfig(): SystemPromptConfig {
		if (!this.config) {
			throw new Error('Configuration not loaded. Call loadFromObject() or loadFromFile() first.');
		}
		return this.config;
	}

	/**
	 * Get providers sorted by priority (highest first)
	 */
	public getProviders(): ProviderConfig[] {
		const config = this.getConfig();
		return [...config.providers].sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Get enabled providers sorted by priority
	 */
	public getEnabledProviders(): ProviderConfig[] {
		return this.getProviders().filter(provider => provider.enabled);
	}

	/**
	 * Get a specific provider by name
	 */
	public getProvider(name: string): ProviderConfig | undefined {
		const config = this.getConfig();
		return config.providers.find(provider => provider.name === name);
	}

	/**
	 * Check if configuration is loaded
	 */
	public isLoaded(): boolean {
		return this.config !== null;
	}

	/**
	 * Get configuration settings
	 */
	public getSettings() {
		const config = this.getConfig();
		return config.settings;
	}

	/**
	 * Create a default configuration
	 */
	public static createDefault(): SystemPromptConfig {
		return {
			providers: [
				{
					name: 'built-in-instructions',
					type: ProviderType.STATIC,
					priority: 0,
					enabled: true,
					config: {
						content:
							'# Built-in System Instructions\nThis section contains built-in tool instructions and agent behavior guidelines.',
					},
				},
			],
			settings: {
				maxGenerationTime: 5000,
				failOnProviderError: false,
				contentSeparator: '\n\n',
			},
		};
	}

	/**
	 * Validate configuration structure and content
	 */
	private validateConfig(config: any): void {
		if (!config || typeof config !== 'object') {
			throw new Error('Configuration must be an object');
		}

		// Validate providers array
		if (!Array.isArray(config.providers)) {
			throw new Error('Configuration must have a "providers" array');
		}

		// Validate each provider
		config.providers.forEach((provider: any, index: number) => {
			this.validateProvider(provider, index);
		});

		// Validate settings
		if (!config.settings || typeof config.settings !== 'object') {
			throw new Error('Configuration must have a "settings" object');
		}

		this.validateSettings(config.settings);
	}

	/**
	 * Validate a single provider configuration
	 */
	private validateProvider(provider: any, index: number): void {
		const prefix = `Provider at index ${index}`;

		if (!provider || typeof provider !== 'object') {
			throw new Error(`${prefix} must be an object`);
		}

		// Validate required fields
		if (typeof provider.name !== 'string' || !provider.name.trim()) {
			throw new Error(`${prefix} must have a non-empty "name" string`);
		}

		if (
			typeof provider.type !== 'string' ||
			!Object.values(ProviderType).includes(provider.type as ProviderType)
		) {
			throw new Error(
				`${prefix} must have a valid "type" (${Object.values(ProviderType).join(', ')})`
			);
		}

		if (typeof provider.priority !== 'number') {
			throw new Error(`${prefix} must have a numeric "priority"`);
		}

		if (typeof provider.enabled !== 'boolean') {
			throw new Error(`${prefix} must have a boolean "enabled" field`);
		}

		// Validate config field if present
		if (
			provider.config !== undefined &&
			(typeof provider.config !== 'object' || provider.config === null)
		) {
			throw new Error(`${prefix} "config" must be an object if provided`);
		}
	}

	/**
	 * Validate settings configuration
	 */
	private validateSettings(settings: any): void {
		if (typeof settings.maxGenerationTime !== 'number' || settings.maxGenerationTime <= 0) {
			throw new Error('Settings "maxGenerationTime" must be a positive number');
		}

		if (typeof settings.failOnProviderError !== 'boolean') {
			throw new Error('Settings "failOnProviderError" must be a boolean');
		}

		if (typeof settings.contentSeparator !== 'string') {
			throw new Error('Settings "contentSeparator" must be a string');
		}
	}

	/**
	 * Process configuration with environment variable replacement and path resolution
	 */
	private processConfiguration(
		config: SystemPromptConfig,
		options: ConfigLoadOptions
	): SystemPromptConfig {
		const processed = JSON.parse(JSON.stringify(config)); // Deep clone

		// Process environment variables if provided
		if (options.envVariables) {
			this.replaceEnvironmentVariables(processed, options.envVariables);
		}

		// Process file paths for file-based providers - only if providers is an array
		if (Array.isArray(processed.providers)) {
			processed.providers.forEach((provider: any) => {
				if (provider.type === ProviderType.FILE_BASED && provider.config?.filePath) {
					if (!path.isAbsolute(provider.config.filePath)) {
						provider.config.filePath = path.resolve(this.baseDir, provider.config.filePath);
					}
				}
			});
		}

		return processed;
	}

	/**
	 * Replace environment variables in configuration
	 */
	private replaceEnvironmentVariables(obj: any, envVars: Record<string, string>): void {
		for (const key in obj) {
			if (typeof obj[key] === 'string') {
				// Replace ${VAR_NAME} patterns
				obj[key] = obj[key].replace(/\$\{([^}]+)\}/g, (match: string, varName: string) => {
					return envVars[varName] || match;
				});
			} else if (typeof obj[key] === 'object' && obj[key] !== null) {
				this.replaceEnvironmentVariables(obj[key], envVars);
			}
		}
	}
}
