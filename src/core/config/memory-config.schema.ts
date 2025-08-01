/**
 * Memory Configuration Schema
 *
 * Comprehensive Zod schemas for validating YAML configuration files
 * that define custom memory types in the Cipher system.
 */

import { z } from 'zod';

/**
 * Base validation types
 */
export const FieldValidationType = z.enum([
	'non_empty',
	'url',
	'email',
	'range',
	'enum',
	'regex',
	'custom',
	'uuid',
	'json',
	'positive_number',
	'identifier',
	'path',
]);

export const FieldType = z.enum(['string', 'number', 'boolean', 'array', 'object']);

/**
 * Field configuration schema
 */
export const FieldConfigSchema = z
	.object({
		name: z.string().min(1, 'Field name is required'),
		type: FieldType,
		required: z.boolean().default(false),
		description: z.string().optional(),
		validation: FieldValidationType.optional(),
		default: z.any().optional(),

		// Type-specific validations
		min_value: z.number().optional(),
		max_value: z.number().optional(),
		allowed_values: z.array(z.string()).optional(),
		pattern: z.string().optional(),

		// Array-specific
		item_type: z.string().optional(),

		// Object-specific
		properties: z.record(z.string()).optional(),
	})
	.refine(
		data => {
			// Array fields must specify item_type
			if (data.type === 'array' && !data.item_type) {
				return false;
			}
			// Range validation requires min/max for numbers
			if (data.validation === 'range' && data.type === 'number') {
				return data.min_value !== undefined || data.max_value !== undefined;
			}
			// Enum validation requires allowed_values
			if (data.validation === 'enum' && !data.allowed_values) {
				return false;
			}
			// Regex validation requires pattern
			if (data.validation === 'regex' && !data.pattern) {
				return false;
			}
			return true;
		},
		{
			message: 'Field configuration validation failed',
		}
	);

/**
 * Schema configuration
 */
export const SchemaConfigSchema = z.object({
	version: z.string().default('1.0'),
	custom_fields: z.array(FieldConfigSchema).default([]),
	cross_validations: z
		.array(
			z.object({
				rule: z.string(),
				message: z.string(),
			})
		)
		.optional(),
	business_rules: z
		.array(
			z.object({
				rule: z.string(),
				message: z.string(),
			})
		)
		.optional(),
});

/**
 * Embedding configuration schema
 */
export const EmbeddingConfigSchema = z.object({
	model: z
		.enum(['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'])
		.default('text-embedding-3-small'),
	dimension: z.number().positive().default(1536),
	batch_size: z.number().positive().default(100),
	timeout_ms: z.number().positive().default(30000),

	// Optional preprocessing
	preprocessing: z
		.object({
			normalize_whitespace: z.boolean().default(false),
			preserve_structure: z.boolean().default(false),
			include_comments: z.boolean().default(true),
		})
		.optional(),
});

/**
 * Vector store configuration schema
 */
export const VectorStoreConfigSchema = z.object({
	similarity_threshold: z.number().min(0).max(1).default(0.7),
	max_results: z.number().positive().default(10),
	rerank: z.boolean().default(false),
	time_decay_factor: z.number().min(0).max(1).optional(),

	// Search options
	search_options: z
		.object({
			include_metadata: z.boolean().default(true),
			include_values: z.boolean().default(false),
		})
		.optional(),
});

/**
 * Behavior trigger configuration
 */
export const BehaviorTriggerSchema = z.object({
	keyword_triggers: z.array(z.string()).optional(),
	pattern_triggers: z.array(z.string()).optional(),
	semantic_triggers: z.array(z.string()).optional(),
	conditions: z.string().optional(),
	exclusions: z.array(z.string()).optional(),

	// Store-specific field extraction rules
	field_extraction: z.record(z.string()).optional(),
});

/**
 * Behavior configuration schema
 */
export const BehaviorConfigSchema = z
	.object({
		search: BehaviorTriggerSchema.optional(),
		store: BehaviorTriggerSchema.optional(),
	})
	.refine(
		data => {
			return data.search || data.store;
		},
		{
			message: 'At least one of search or store behavior must be defined',
		}
	);

/**
 * Memory type configuration schema
 */
export const MemoryTypeConfigSchema = z.object({
	name: z
		.string()
		.min(1, 'Memory type name is required')
		.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Name must be a valid identifier'),
	collection_name: z
		.string()
		.min(1, 'Collection name is required')
		.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Collection name must be a valid identifier'),
	description: z.string().default(''),
	priority: z.number().int().min(0).default(0),

	embedding: EmbeddingConfigSchema,
	vector_store: VectorStoreConfigSchema,
	schema: SchemaConfigSchema,
	behavior: BehaviorConfigSchema,
});

/**
 * Global configuration schema
 */
export const GlobalConfigSchema = z.object({
	enabled: z.boolean().default(true),
	fallback_to_default: z.boolean().default(true),
	max_memory_types: z.number().positive().optional(),
	id_range_size: z.number().positive().default(100000),
});

/**
 * Advanced configuration schema
 */
export const AdvancedConfigSchema = z.object({
	orchestrator: z
		.object({
			decision_algorithm: z
				.enum(['priority_weighted', 'round_robin', 'semantic_routing'])
				.default('priority_weighted'),
			parallel_search: z.boolean().default(true),
			max_concurrent_searches: z.number().positive().default(3),
			search_timeout_ms: z.number().positive().default(5000),
		})
		.optional(),

	performance: z
		.object({
			cache_enabled: z.boolean().default(true),
			cache_ttl_seconds: z.number().positive().default(300),
			batch_operations: z.boolean().default(true),
			async_storage: z.boolean().default(true),
		})
		.optional(),

	monitoring: z
		.object({
			enable_metrics: z.boolean().default(true),
			log_decisions: z.boolean().default(true),
			performance_tracking: z.boolean().default(true),
			usage_analytics: z.boolean().default(true),
		})
		.optional(),

	error_handling: z
		.object({
			retry_attempts: z.number().int().min(0).default(3),
			retry_delay_ms: z.number().positive().default(1000),
			fallback_on_error: z.boolean().default(true),
			strict_validation: z.boolean().default(false),
		})
		.optional(),
});

/**
 * Main custom memory configuration schema
 */
export const CustomMemoryConfigSchema = z
	.object({
		global: GlobalConfigSchema,
		custom_memory_types: z
			.array(MemoryTypeConfigSchema)
			.min(1, 'At least one memory type must be defined'),
		advanced: AdvancedConfigSchema.optional(),
	})
	.refine(
		data => {
			// Validate unique memory type names
			const names = data.custom_memory_types.map(t => t.name);
			const uniqueNames = new Set(names);
			if (names.length !== uniqueNames.size) {
				return false;
			}

			// Validate unique collection names
			const collections = data.custom_memory_types.map(t => t.collection_name);
			const uniqueCollections = new Set(collections);
			if (collections.length !== uniqueCollections.size) {
				return false;
			}

			// Validate max memory types limit
			if (
				data.global.max_memory_types &&
				data.custom_memory_types.length > data.global.max_memory_types
			) {
				return false;
			}

			return true;
		},
		{
			message:
				'Memory type names and collection names must be unique, and count must not exceed max_memory_types',
		}
	);

/**
 * Type inference for configuration objects
 */
export type FieldConfig = z.infer<typeof FieldConfigSchema>;
export type SchemaConfig = z.infer<typeof SchemaConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type VectorStoreConfig = z.infer<typeof VectorStoreConfigSchema>;
export type BehaviorTrigger = z.infer<typeof BehaviorTriggerSchema>;
export type BehaviorConfig = z.infer<typeof BehaviorConfigSchema>;
export type MemoryTypeConfig = z.infer<typeof MemoryTypeConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type AdvancedConfig = z.infer<typeof AdvancedConfigSchema>;
export type CustomMemoryConfig = z.infer<typeof CustomMemoryConfigSchema>;

/**
 * Validation errors
 */
export class ConfigValidationError extends Error {
	constructor(
		message: string,
		public readonly issues?: z.ZodIssue[]
	) {
		super(message);
		this.name = 'ConfigValidationError';
	}
}

/**
 * Validate custom memory configuration
 */
export function validateCustomMemoryConfig(config: unknown): CustomMemoryConfig {
	const result = CustomMemoryConfigSchema.safeParse(config);

	if (!result.success) {
		throw new ConfigValidationError('Configuration validation failed', result.error.issues);
	}

	return result.data;
}

/**
 * Validate a single memory type configuration
 */
export function validateMemoryTypeConfig(config: unknown): MemoryTypeConfig {
	const result = MemoryTypeConfigSchema.safeParse(config);

	if (!result.success) {
		throw new ConfigValidationError(
			'Memory type configuration validation failed',
			result.error.issues
		);
	}

	return result.data;
}

/**
 * Default configurations for common use cases
 */
export const DEFAULT_CONFIGURATIONS = {
	research_notes: {
		name: 'research_notes',
		collection_name: 'research_collection',
		description: 'Stores research findings and references',
		priority: 1,
		embedding: {
			model: 'text-embedding-3-small' as const,
			dimension: 1536,
			batch_size: 100,
			timeout_ms: 30000,
		},
		vector_store: {
			similarity_threshold: 0.7,
			max_results: 10,
			rerank: true,
		},
		schema: {
			version: '1.0',
			custom_fields: [
				{
					name: 'source_url',
					type: 'string' as const,
					required: false,
					validation: 'url' as const,
					description: 'URL of the research source',
				},
				{
					name: 'research_domain',
					type: 'string' as const,
					required: true,
					validation: 'non_empty' as const,
					description: 'Domain/field of research',
				},
				{
					name: 'confidence_score',
					type: 'number' as const,
					required: false,
					validation: 'range' as const,
					min_value: 0.0,
					max_value: 1.0,
					default: 0.5,
				},
			],
		},
		behavior: {
			search: {
				keyword_triggers: ['research', 'study', 'paper', 'academic'],
				pattern_triggers: ['.*research.*', '.*study shows.*'],
				semantic_triggers: ['asking about academic topics', 'requesting research information'],
			},
			store: {
				keyword_triggers: ['learned', 'discovered', 'research shows'],
				pattern_triggers: ['.*according to.*', '.*study found.*'],
				semantic_triggers: ['sharing research findings', 'providing academic information'],
			},
		},
	},

	code_snippets: {
		name: 'code_snippets',
		collection_name: 'code_collection',
		description: 'Stores code examples and implementation patterns',
		priority: 2,
		embedding: {
			model: 'text-embedding-3-small' as const,
			dimension: 1536,
			preprocessing: {
				normalize_whitespace: true,
				preserve_structure: true,
				include_comments: true,
			},
		},
		vector_store: {
			similarity_threshold: 0.8,
			max_results: 5,
			rerank: false,
		},
		schema: {
			version: '1.0',
			custom_fields: [
				{
					name: 'language',
					type: 'string' as const,
					required: true,
					validation: 'enum' as const,
					allowed_values: ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'other'],
				},
				{
					name: 'function_name',
					type: 'string' as const,
					required: false,
					validation: 'identifier' as const,
				},
				{
					name: 'complexity_score',
					type: 'number' as const,
					required: false,
					validation: 'range' as const,
					min_value: 1,
					max_value: 10,
				},
			],
		},
		behavior: {
			search: {
				keyword_triggers: ['code', 'implementation', 'function', 'example'],
				pattern_triggers: ['.*how to implement.*', '.*code example.*', '.*function.*'],
				semantic_triggers: ['asking for code help', 'requesting implementation examples'],
			},
			store: {
				keyword_triggers: ['function', 'class', 'method', 'implementation'],
				pattern_triggers: ['```.*```', '.*\\.js:|.*\\.py:|.*\\.ts:'],
				field_extraction: {
					language: 'detect_programming_language(text)',
					function_name: 'extract_function_names(text)',
					complexity_score: 'calculate_code_complexity(text)',
				},
			},
		},
	},
} as const;
