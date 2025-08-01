/**
 * Tests for Configuration Schemas and Examples
 */

import { describe, it, expect } from 'vitest';
import {
	SYSTEM_PROMPT_CONFIG_SCHEMA,
	BASIC_CONFIG_EXAMPLE,
	DYNAMIC_CONFIG_EXAMPLE,
	FILE_BASED_CONFIG_EXAMPLE,
	CONDITIONAL_CONFIG_EXAMPLE,
	MINIMAL_CONFIG_EXAMPLE,
	getAllExampleConfigs,
} from '../config-schemas.js';
import { SystemPromptConfigManager } from '../config-manager.js';
import { ProviderType } from '../interfaces.js';

describe('Configuration Schemas and Examples', () => {
	describe('SYSTEM_PROMPT_CONFIG_SCHEMA', () => {
		it('should have correct structure', () => {
			expect(SYSTEM_PROMPT_CONFIG_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema#');
			expect(SYSTEM_PROMPT_CONFIG_SCHEMA.type).toBe('object');
			expect(SYSTEM_PROMPT_CONFIG_SCHEMA.required).toContain('providers');
			expect(SYSTEM_PROMPT_CONFIG_SCHEMA.required).toContain('settings');
		});

		it('should define provider schema correctly', () => {
			const providerSchema = SYSTEM_PROMPT_CONFIG_SCHEMA.properties.providers.items;

			expect(providerSchema.required).toContain('name');
			expect(providerSchema.required).toContain('type');
			expect(providerSchema.required).toContain('priority');
			expect(providerSchema.required).toContain('enabled');

			expect(providerSchema.properties.type.enum).toEqual(Object.values(ProviderType));
		});

		it('should define settings schema correctly', () => {
			const settingsSchema = SYSTEM_PROMPT_CONFIG_SCHEMA.properties.settings;

			expect(settingsSchema.required).toContain('maxGenerationTime');
			expect(settingsSchema.required).toContain('failOnProviderError');
			expect(settingsSchema.required).toContain('contentSeparator');
		});
	});

	describe('example configurations', () => {
		let configManager: SystemPromptConfigManager;

		beforeEach(() => {
			configManager = new SystemPromptConfigManager();
		});

		it('should validate BASIC_CONFIG_EXAMPLE', () => {
			expect(() => configManager.loadFromObject(BASIC_CONFIG_EXAMPLE)).not.toThrow();

			const config = configManager.getConfig();
			expect(config.providers).toHaveLength(2);
			expect(config.providers[0]!.name).toBe('user-prompt');
			expect(config.providers[1]!.name).toBe('built-in-instructions');
		});

		it('should validate DYNAMIC_CONFIG_EXAMPLE', () => {
			expect(() => configManager.loadFromObject(DYNAMIC_CONFIG_EXAMPLE)).not.toThrow();

			const config = configManager.getConfig();
			const dynamicProviders = config.providers.filter(p => p.type === ProviderType.DYNAMIC);
			expect(dynamicProviders).toHaveLength(2);

			const contextProvider = config.providers.find(p => p.name === 'context-info');
			expect(contextProvider?.config?.generator).toBe('session-context');
		});

		it('should validate FILE_BASED_CONFIG_EXAMPLE', () => {
			expect(() => configManager.loadFromObject(FILE_BASED_CONFIG_EXAMPLE)).not.toThrow();

			const config = configManager.getConfig();
			const fileProviders = config.providers.filter(p => p.type === ProviderType.FILE_BASED);
			expect(fileProviders).toHaveLength(2);

			expect(config.settings.failOnProviderError).toBe(true);
		});

		it('should validate CONDITIONAL_CONFIG_EXAMPLE', () => {
			expect(() => configManager.loadFromObject(CONDITIONAL_CONFIG_EXAMPLE)).not.toThrow();

			const config = configManager.getConfig();
			const conditionalProvider = config.providers.find(p => p.name === 'adaptive-prompt');
			expect(conditionalProvider?.config?.generator).toBe('conditional');
			expect(conditionalProvider?.config?.generatorConfig.conditions).toHaveLength(2);
		});

		it('should validate MINIMAL_CONFIG_EXAMPLE', () => {
			expect(() => configManager.loadFromObject(MINIMAL_CONFIG_EXAMPLE)).not.toThrow();

			const config = configManager.getConfig();
			expect(config.providers).toHaveLength(1);
			expect(config.providers[0]!.name).toBe('basic-prompt');
		});

		it('should have correct priority ordering in examples', () => {
			configManager.loadFromObject(DYNAMIC_CONFIG_EXAMPLE);
			const providers = configManager.getProviders();

			// Should be sorted by priority (highest first)
			for (let i = 1; i < providers.length; i++) {
				expect(providers[i - 1]!.priority).toBeGreaterThanOrEqual(providers[i]!.priority);
			}
		});

		it('should have realistic settings in examples', () => {
			const examples = [
				BASIC_CONFIG_EXAMPLE,
				DYNAMIC_CONFIG_EXAMPLE,
				FILE_BASED_CONFIG_EXAMPLE,
				CONDITIONAL_CONFIG_EXAMPLE,
				MINIMAL_CONFIG_EXAMPLE,
			];

			examples.forEach(config => {
				expect(config.settings.maxGenerationTime).toBeGreaterThan(0);
				expect(config.settings.maxGenerationTime).toBeLessThanOrEqual(30000); // Reasonable upper limit
				expect(typeof config.settings.failOnProviderError).toBe('boolean');
				expect(typeof config.settings.contentSeparator).toBe('string');
			});
		});
	});

	describe('getAllExampleConfigs', () => {
		it('should return all example configurations', () => {
			const examples = getAllExampleConfigs();

			expect(examples).toHaveProperty('basic');
			expect(examples).toHaveProperty('dynamic');
			expect(examples).toHaveProperty('fileBased');
			expect(examples).toHaveProperty('conditional');
			expect(examples).toHaveProperty('minimal');

			expect(examples.basic).toBe(BASIC_CONFIG_EXAMPLE);
			expect(examples.dynamic).toBe(DYNAMIC_CONFIG_EXAMPLE);
			expect(examples.fileBased).toBe(FILE_BASED_CONFIG_EXAMPLE);
			expect(examples.conditional).toBe(CONDITIONAL_CONFIG_EXAMPLE);
			expect(examples.minimal).toBe(MINIMAL_CONFIG_EXAMPLE);
		});

		it('should have all examples validate successfully', () => {
			const examples = getAllExampleConfigs();
			const configManager = new SystemPromptConfigManager();

			Object.entries(examples).forEach(([name, config]) => {
				expect(
					() => configManager.loadFromObject(config),
					`Example "${name}" should validate successfully`
				).not.toThrow();
			});
		});
	});

	describe('provider type coverage', () => {
		it('should have examples for all provider types', () => {
			const allExamples = Object.values(getAllExampleConfigs());
			const usedTypes = new Set<string>();

			allExamples.forEach(config => {
				config.providers.forEach(provider => {
					usedTypes.add(provider.type);
				});
			});

			Object.values(ProviderType).forEach(type => {
				expect(usedTypes.has(type), `Provider type ${type} should have examples`).toBe(true);
			});
		});

		it('should demonstrate various configuration patterns', () => {
			// Test that examples show different configuration patterns

			// Template variables in static provider
			const basicExample = BASIC_CONFIG_EXAMPLE;
			expect(basicExample.providers.some(p => p.config?.variables)).toBeFalsy(); // Basic doesn't use variables

			// Dynamic content generation
			const dynamicExample = DYNAMIC_CONFIG_EXAMPLE;
			expect(dynamicExample.providers.some(p => p.type === ProviderType.DYNAMIC)).toBe(true);

			// File watching
			const fileExample = FILE_BASED_CONFIG_EXAMPLE;
			const fileProvider = fileExample.providers.find(p => p.type === ProviderType.FILE_BASED);
			expect(fileProvider?.config?.watchForChanges).toBeDefined();

			// Conditional logic
			const conditionalExample = CONDITIONAL_CONFIG_EXAMPLE;
			const conditionalProvider = conditionalExample.providers.find(
				p => p.config?.generator === 'conditional'
			);
			expect(conditionalProvider?.config?.generatorConfig?.conditions).toBeDefined();
		});
	});
});
