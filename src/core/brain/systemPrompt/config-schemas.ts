/**
 * Configuration Schema Definitions and Examples
 *
 * Provides schema definitions and example configurations for the system prompt architecture.
 * These can be used for validation, documentation, and as templates for new configurations.
 */

import { SystemPromptConfig, ProviderType } from './interfaces.js';

/**
 * JSON Schema for SystemPromptConfig validation
 */
export const SYSTEM_PROMPT_CONFIG_SCHEMA = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	type: 'object',
	required: ['providers', 'settings'],
	properties: {
		providers: {
			type: 'array',
			items: {
				type: 'object',
				required: ['name', 'type', 'priority', 'enabled'],
				properties: {
					name: {
						type: 'string',
						minLength: 1,
						description: 'Unique identifier for the provider',
					},
					type: {
						type: 'string',
						enum: Object.values(ProviderType),
						description: 'Type of provider (static, dynamic, file-based)',
					},
					priority: {
						type: 'number',
						description: 'Execution priority (higher numbers execute first)',
					},
					enabled: {
						type: 'boolean',
						description: 'Whether this provider is enabled',
					},
					config: {
						type: 'object',
						description: 'Provider-specific configuration',
					},
				},
			},
		},
		settings: {
			type: 'object',
			required: ['maxGenerationTime', 'failOnProviderError', 'contentSeparator'],
			properties: {
				maxGenerationTime: {
					type: 'number',
					minimum: 1,
					description: 'Maximum time to wait for all providers (milliseconds)',
				},
				failOnProviderError: {
					type: 'boolean',
					description: 'Whether to fail if any provider fails',
				},
				contentSeparator: {
					type: 'string',
					description: 'Separator between provider outputs',
				},
			},
		},
	},
};

/**
 * Example configuration for basic setup
 */
export const BASIC_CONFIG_EXAMPLE: SystemPromptConfig = {
	providers: [
		{
			name: 'user-prompt',
			type: ProviderType.STATIC,
			priority: 100,
			enabled: true,
			config: {
				content: 'You are a helpful AI assistant. Please provide accurate and helpful responses.',
			},
		},
		{
			name: 'built-in-instructions',
			type: ProviderType.STATIC,
			priority: 0,
			enabled: true,
			config: {
				content:
					'Follow all safety guidelines and provide responses that are helpful, harmless, and honest.',
			},
		},
	],
	settings: {
		maxGenerationTime: 5000,
		failOnProviderError: false,
		contentSeparator: '\n\n',
	},
};

/**
 * Example configuration with dynamic content
 */
export const DYNAMIC_CONFIG_EXAMPLE: SystemPromptConfig = {
	providers: [
		{
			name: 'user-prompt',
			type: ProviderType.STATIC,
			priority: 100,
			enabled: true,
			config: {
				content: 'You are a helpful AI assistant specialized in {{domain}}.',
				variables: {
					domain: 'software development',
				},
			},
		},
		{
			name: 'context-info',
			type: ProviderType.DYNAMIC,
			priority: 90,
			enabled: true,
			config: {
				generator: 'session-context',
				generatorConfig: {
					includeFields: ['sessionId', 'userId', 'timestamp'],
					format: 'list',
				},
				template: '# Session Context\n{{content}}',
			},
		},
		{
			name: 'timestamp',
			type: ProviderType.DYNAMIC,
			priority: 80,
			enabled: true,
			config: {
				generator: 'timestamp',
				generatorConfig: {
					format: 'locale',
					includeTimezone: true,
				},
				template: 'Current time: {{content}}',
			},
		},
		{
			name: 'built-in-instructions',
			type: ProviderType.STATIC,
			priority: 0,
			enabled: true,
			config: {
				content: 'Follow all safety guidelines and tool usage instructions.',
			},
		},
	],
	settings: {
		maxGenerationTime: 10000,
		failOnProviderError: false,
		contentSeparator: '\n\n---\n\n',
	},
};

/**
 * Example configuration with file-based providers
 */
export const FILE_BASED_CONFIG_EXAMPLE: SystemPromptConfig = {
	providers: [
		{
			name: 'main-prompt',
			type: ProviderType.FILE_BASED,
			priority: 100,
			enabled: true,
			config: {
				filePath: './prompts/main-system-prompt.txt',
				watchForChanges: true,
				variables: {
					version: '2.0',
					environment: 'production',
				},
			},
		},
		{
			name: 'tool-instructions',
			type: ProviderType.FILE_BASED,
			priority: 50,
			enabled: true,
			config: {
				filePath: './prompts/tool-instructions.md',
				watchForChanges: false,
			},
		},
		{
			name: 'context-banner',
			type: ProviderType.DYNAMIC,
			priority: 90,
			enabled: true,
			config: {
				generator: 'environment',
				generatorConfig: {
					environment: 'production',
					messages: {
						production: '⚠️ Production Environment - Exercise caution with all operations',
						development: '🔧 Development Environment - Debug mode enabled',
					},
				},
			},
		},
	],
	settings: {
		maxGenerationTime: 15000,
		failOnProviderError: true,
		contentSeparator: '\n\n',
	},
};

/**
 * Example configuration with conditional content
 */
export const CONDITIONAL_CONFIG_EXAMPLE: SystemPromptConfig = {
	providers: [
		{
			name: 'adaptive-prompt',
			type: ProviderType.DYNAMIC,
			priority: 100,
			enabled: true,
			config: {
				generator: 'conditional',
				generatorConfig: {
					conditions: [
						{
							if: { field: 'userId', operator: 'exists' },
							then: 'You are assisting a registered user. Personalization features are available.',
						},
						{
							if: { field: 'sessionId', operator: 'exists' },
							then: 'This is a tracked session. Conversation history is available.',
						},
					],
					else: 'You are in anonymous mode. Limited features are available.',
				},
			},
		},
		{
			name: 'memory-status',
			type: ProviderType.DYNAMIC,
			priority: 80,
			enabled: true,
			config: {
				generator: 'memory-context',
				generatorConfig: {
					format: 'summary',
					emptyMessage: 'No previous conversation context available',
				},
				template: '# Memory Status\n{{content}}',
			},
		},
		{
			name: 'base-instructions',
			type: ProviderType.STATIC,
			priority: 0,
			enabled: true,
			config: {
				content: 'Provide helpful, accurate, and safe responses to all user queries.',
			},
		},
	],
	settings: {
		maxGenerationTime: 8000,
		failOnProviderError: false,
		contentSeparator: '\n\n',
	},
};

/**
 * Minimal configuration example
 */
export const MINIMAL_CONFIG_EXAMPLE: SystemPromptConfig = {
	providers: [
		{
			name: 'basic-prompt',
			type: ProviderType.STATIC,
			priority: 100,
			enabled: true,
			config: {
				content: 'You are a helpful AI assistant.',
			},
		},
	],
	settings: {
		maxGenerationTime: 5000,
		failOnProviderError: false,
		contentSeparator: '\n\n',
	},
};

/**
 * Get all example configurations
 */
export function getAllExampleConfigs(): Record<string, SystemPromptConfig> {
	return {
		basic: BASIC_CONFIG_EXAMPLE,
		dynamic: DYNAMIC_CONFIG_EXAMPLE,
		fileBased: FILE_BASED_CONFIG_EXAMPLE,
		conditional: CONDITIONAL_CONFIG_EXAMPLE,
		minimal: MINIMAL_CONFIG_EXAMPLE,
	};
}
