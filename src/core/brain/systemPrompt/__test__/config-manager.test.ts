/**
 * Tests for System Prompt Configuration Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { SystemPromptConfigManager } from '../config-manager.js';
import { SystemPromptConfig, ProviderType } from '../interfaces.js';

describe('SystemPromptConfigManager', () => {
	let configManager: SystemPromptConfigManager;
	let tempDir: string;

	beforeEach(async () => {
		configManager = new SystemPromptConfigManager();

		// Create temporary directory for test config files
		tempDir = path.join(process.cwd(), 'temp-test-configs');
		try {
			await fs.mkdir(tempDir, { recursive: true });
		} catch (error) {
			// If directory already exists, that's fine
			if ((error as any).code !== 'EEXIST') {
				throw error;
			}
		}
	});

	afterEach(async () => {
		// Clean up temporary files
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('loadFromObject', () => {
		it('should load valid configuration', () => {
			const config: SystemPromptConfig = {
				providers: [
					{
						name: 'test-provider',
						type: ProviderType.STATIC,
						priority: 100,
						enabled: true,
						config: { content: 'test' },
					},
				],
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			};

			expect(() => configManager.loadFromObject(config)).not.toThrow();
			expect(configManager.isLoaded()).toBe(true);
		});

		it('should validate configuration by default', () => {
			const invalidConfig = {
				providers: 'not an array',
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig)).toThrow('providers');
		});

		it('should skip validation when requested', () => {
			const invalidConfig = {
				providers: 'not an array',
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig, { validate: false })).not.toThrow();
		});

		it('should process environment variables', () => {
			const config: SystemPromptConfig = {
				providers: [
					{
						name: 'env-provider',
						type: ProviderType.STATIC,
						priority: 100,
						enabled: true,
						config: {
							content: 'Environment: ${ENV_NAME}',
							variables: { version: '${APP_VERSION}' },
						},
					},
				],
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			};

			const envVars = { ENV_NAME: 'test', APP_VERSION: '1.0.0' };
			configManager.loadFromObject(config, { envVariables: envVars });

			const loadedConfig = configManager.getConfig();
			expect(loadedConfig.providers[0]!.config!.content).toBe('Environment: test');
			expect(loadedConfig.providers[0]!.config!.variables.version).toBe('1.0.0');
		});
	});

	describe('loadFromFile', () => {
		it('should load configuration from JSON file', async () => {
			const config: SystemPromptConfig = {
				providers: [
					{
						name: 'file-provider',
						type: ProviderType.STATIC,
						priority: 100,
						enabled: true,
						config: { content: 'from file' },
					},
				],
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			};

			const configFile = path.join(tempDir, 'test-config.json');
			await fs.writeFile(configFile, JSON.stringify(config, null, 2));

			await configManager.loadFromFile(configFile);

			expect(configManager.isLoaded()).toBe(true);
			const loadedConfig = configManager.getConfig();
			expect(loadedConfig.providers[0]!.name).toBe('file-provider');
		});

		it('should handle relative file paths', async () => {
			const config: SystemPromptConfig = {
				providers: [
					{
						name: 'test',
						type: ProviderType.FILE_BASED,
						priority: 100,
						enabled: true,
						config: { filePath: 'relative/path.txt' },
					},
				],
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			};

			const configFile = path.join(tempDir, 'config.json');
			await fs.writeFile(configFile, JSON.stringify(config));

			await configManager.loadFromFile(configFile);

			const loadedConfig = configManager.getConfig();
			const filePath = loadedConfig.providers[0]!.config!.filePath;
			expect(path.isAbsolute(filePath)).toBe(true);
			expect(filePath).toContain('relative/path.txt');
		});

		it('should throw error for non-existent file', async () => {
			const nonExistentFile = path.join(tempDir, 'non-existent.json');

			await expect(configManager.loadFromFile(nonExistentFile)).rejects.toThrow(
				'Failed to load configuration'
			);
		});

		it('should throw error for invalid JSON', async () => {
			const invalidJsonFile = path.join(tempDir, 'invalid.json');
			await fs.writeFile(invalidJsonFile, 'invalid json content');

			await expect(configManager.loadFromFile(invalidJsonFile)).rejects.toThrow(
				'Failed to load configuration'
			);
		});
	});

	describe('getters', () => {
		beforeEach(() => {
			const config: SystemPromptConfig = {
				providers: [
					{
						name: 'high-priority',
						type: ProviderType.STATIC,
						priority: 100,
						enabled: true,
						config: { content: 'high' },
					},
					{
						name: 'low-priority',
						type: ProviderType.STATIC,
						priority: 50,
						enabled: true,
						config: { content: 'low' },
					},
					{
						name: 'disabled',
						type: ProviderType.STATIC,
						priority: 75,
						enabled: false,
						config: { content: 'disabled' },
					},
				],
				settings: {
					maxGenerationTime: 8000,
					failOnProviderError: true,
					contentSeparator: '\n---\n',
				},
			};

			configManager.loadFromObject(config);
		});

		it('should throw error when configuration not loaded', () => {
			const emptyManager = new SystemPromptConfigManager();
			expect(() => emptyManager.getConfig()).toThrow('Configuration not loaded');
		});

		it('should return providers sorted by priority', () => {
			const providers = configManager.getProviders();

			expect(providers).toHaveLength(3);
			expect(providers[0]!.name).toBe('high-priority');
			expect(providers[1]!.name).toBe('disabled');
			expect(providers[2]!.name).toBe('low-priority');
		});

		it('should return only enabled providers', () => {
			const enabledProviders = configManager.getEnabledProviders();

			expect(enabledProviders).toHaveLength(2);
			expect(enabledProviders.find(p => p.name === 'disabled')).toBeUndefined();
		});

		it('should find provider by name', () => {
			const provider = configManager.getProvider('high-priority');

			expect(provider).toBeDefined();
			expect(provider!.name).toBe('high-priority');
			expect(provider!.priority).toBe(100);
		});

		it('should return undefined for non-existent provider', () => {
			const provider = configManager.getProvider('non-existent');
			expect(provider).toBeUndefined();
		});

		it('should return settings', () => {
			const settings = configManager.getSettings();

			expect(settings.maxGenerationTime).toBe(8000);
			expect(settings.failOnProviderError).toBe(true);
			expect(settings.contentSeparator).toBe('\n---\n');
		});

		it('should report loaded status correctly', () => {
			expect(configManager.isLoaded()).toBe(true);

			const emptyManager = new SystemPromptConfigManager();
			expect(emptyManager.isLoaded()).toBe(false);
		});
	});

	describe('createDefault', () => {
		it('should create valid default configuration', () => {
			const defaultConfig = SystemPromptConfigManager.createDefault();

			expect(defaultConfig.providers).toHaveLength(1);
			expect(defaultConfig.providers[0]!.name).toBe('built-in-instructions');
			expect(defaultConfig.providers[0]!.type).toBe(ProviderType.STATIC);
			expect(defaultConfig.settings.maxGenerationTime).toBe(5000);
			expect(defaultConfig.settings.failOnProviderError).toBe(false);
		});

		it('should pass validation', () => {
			const defaultConfig = SystemPromptConfigManager.createDefault();
			expect(() => configManager.loadFromObject(defaultConfig)).not.toThrow();
		});
	});

	describe('validation', () => {
		it('should reject configuration without providers', () => {
			const invalidConfig = {
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig)).toThrow('providers');
		});

		it('should reject configuration without settings', () => {
			const invalidConfig = {
				providers: [],
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig)).toThrow('settings');
		});

		it('should reject provider without required fields', () => {
			const invalidConfig = {
				providers: [
					{
						name: 'test',
						// missing type, priority, enabled
					},
				],
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig)).toThrow('Provider at index 0');
		});

		it('should reject provider with invalid type', () => {
			const invalidConfig = {
				providers: [
					{
						name: 'test',
						type: 'invalid-type',
						priority: 100,
						enabled: true,
					},
				],
				settings: {
					maxGenerationTime: 5000,
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig)).toThrow('valid "type"');
		});

		it('should reject settings with invalid values', () => {
			const invalidConfig = {
				providers: [],
				settings: {
					maxGenerationTime: -1, // invalid
					failOnProviderError: false,
					contentSeparator: '\n\n',
				},
			} as any;

			expect(() => configManager.loadFromObject(invalidConfig)).toThrow('positive number');
		});
	});
});
