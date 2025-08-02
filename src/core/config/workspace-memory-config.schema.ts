/**
 * Workspace Memory Configuration Schema
 *
 * Configuration schema for workspace memory settings, including tool descriptions,
 * hyperparameters, and behavior triggers specific to team collaboration.
 */

import { z } from 'zod';

/**
 * Workspace memory tool configuration schema
 */
export const WorkspaceToolConfigSchema = z.object({
	// Search tool configuration
	search: z.object({
		name: z.string().default('cipher_workspace_search'),
		description: z
			.string()
			.default(
				'Search workspace memory for team and project information including progress, bugs, and collaboration context.'
			),
		enabled: z.boolean().default(true),
		similarity_threshold: z.number().min(0).max(1).default(0.7),
		max_results: z.number().positive().default(10),
		timeout_ms: z.number().positive().default(15000),
	}),

	// Store tool configuration
	store: z.object({
		name: z.string().default('cipher_workspace_store'),
		description: z
			.string()
			.default(
				'Background tool that automatically stores team-related information including project progress, bugs, and collaboration context.'
			),
		enabled: z.boolean().default(true),
		auto_extraction: z.boolean().default(true),
		confidence_threshold: z.number().min(0).max(1).default(0.6),
		batch_processing: z.boolean().default(true),
		skip_patterns: z
			.array(z.string())
			.default(['search_results', 'retrieved_content', 'tool_output', 'system_message']),
	}),
});

/**
 * Workspace memory behavior configuration
 */
export const WorkspaceBehaviorConfigSchema = z.object({
	// Search behavior triggers
	search_triggers: z.object({
		keywords: z
			.array(z.string())
			.default([
				'team',
				'project',
				'progress',
				'feature',
				'bug',
				'issue',
				'collaborate',
				'working on',
				'assigned to',
				'status',
				'milestone',
				'deadline',
				'repository',
				'branch',
			]),
		patterns: z
			.array(z.string())
			.default([
				'who.*working.*on',
				'what.*status.*of',
				'progress.*on.*feature',
				'bugs.*in.*project',
				'team.*member.*assigned',
				'repository.*branch',
				'current.*milestone',
			]),
		semantic_triggers: z
			.array(z.string())
			.default([
				'asking about team member activities',
				'inquiring about project status',
				'requesting progress updates',
				'looking for bug reports',
				'checking collaboration history',
			]),
	}),

	// Store behavior triggers
	store_triggers: z.object({
		keywords: z
			.array(z.string())
			.default([
				'completed',
				'working on',
				'implemented',
				'fixed',
				'bug',
				'issue',
				'feature',
				'milestone',
				'deployed',
				'released',
				'blocked',
				'reviewing',
				'testing',
				'merged',
				'committed',
			]),
		patterns: z
			.array(z.string())
			.default([
				'.*completed.*feature',
				'.*working.*on.*task',
				'.*fixed.*bug',
				'.*implemented.*component',
				'.*deployed.*to.*environment',
				'.*merged.*pull.*request',
				'.*created.*branch',
				'.*assigned.*to.*team',
			]),
		semantic_triggers: z
			.array(z.string())
			.default([
				'reporting progress on tasks',
				'documenting bug fixes',
				'sharing feature implementations',
				'updating project status',
				'recording team assignments',
			]),
	}),

	// Field extraction rules for automatic information parsing
	field_extraction: z.object({
		team_member: z.object({
			patterns: z
				.array(z.string())
				.default([
					'(?:worked on by|assigned to|developer|dev|team member)\\s+([a-zA-Z]+(?:\\s+[a-zA-Z]+)?)',
					'(@[a-zA-Z_]+)',
					'([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s+(?:is working on|completed|fixed|implemented)',
				]),
			required: z.boolean().default(false),
		}),
		project_context: z.object({
			patterns: z
				.array(z.string())
				.default([
					'(?:project|app|application):\\s*([a-zA-Z0-9_-]+)',
					'(?:in|for|on)\\s+(?:the\\s+)?([a-zA-Z0-9_-]+)\\s+project',
					'(?:repo|repository):\\s*([a-zA-Z0-9_/-]+)',
					'(?:branch|git checkout)\\s+([a-zA-Z0-9_/-]+)',
				]),
			required: z.boolean().default(false),
		}),
		progress_status: z.object({
			patterns: z
				.array(z.string())
				.default([
					'(?:working on|implementing|developing|building)\\s+([^.!?]+)',
					'(?:completed|done|finished|deployed|released)\\b',
					'(?:blocked|stuck|waiting|pending)\\b',
					'(?:reviewing|review|testing|qa)\\b',
				]),
			required: z.boolean().default(false),
		}),
		bug_tracking: z.object({
			patterns: z
				.array(z.string())
				.default([
					'(?:bug|issue|error|problem):\\s*([^.!?]+)',
					'(?:fixed|resolved|closed)\\s+(?:bug|issue|error):\\s*([^.!?]+)',
					'(?:critical|high|medium|low)\\s+(?:priority|severity)',
				]),
			required: z.boolean().default(false),
		}),
	}),
});

/**
 * Workspace vector store configuration
 */
export const WorkspaceVectorStoreConfigSchema = z.object({
	collection_name: z.string().default('workspace_memory'),
	similarity_threshold: z.number().min(0).max(1).default(0.7),
	max_results: z.number().positive().default(10),
	rerank: z.boolean().default(false),
	time_decay_factor: z.number().min(0).max(1).optional(),

	// Workspace-specific search options
	search_options: z.object({
		include_team_context: z.boolean().default(true),
		include_project_context: z.boolean().default(true),
		include_progress_info: z.boolean().default(true),
		include_bug_reports: z.boolean().default(true),
		filter_by_domain: z.boolean().default(false),
		filter_by_team_member: z.boolean().default(false),
	}),
});

/**
 * Workspace embedding configuration
 */
export const WorkspaceEmbeddingConfigSchema = z.object({
	model: z.string().default('text-embedding-3-small'),
	dimension: z.number().positive().default(1536),
	batch_size: z.number().positive().default(50),
	timeout_ms: z.number().positive().default(30000),

	// Workspace-specific preprocessing
	preprocessing: z.object({
		preserve_team_mentions: z.boolean().default(true),
		preserve_project_structure: z.boolean().default(true),
		normalize_progress_terms: z.boolean().default(true),
		extract_technical_context: z.boolean().default(true),
	}),
});

/**
 * Main workspace memory configuration schema
 */
export const WorkspaceMemoryConfigSchema = z.object({
	enabled: z.boolean().default(false),
	disable_default_memory: z.boolean().default(false),

	// Tool configurations
	tools: WorkspaceToolConfigSchema,

	// Behavior configurations
	behavior: WorkspaceBehaviorConfigSchema,

	// Vector store configuration
	vector_store: WorkspaceVectorStoreConfigSchema,

	// Embedding configuration
	embedding: WorkspaceEmbeddingConfigSchema,

	// Performance and monitoring
	performance: z.object({
		cache_enabled: z.boolean().default(true),
		cache_ttl_seconds: z.number().positive().default(300),
		batch_operations: z.boolean().default(true),
		async_storage: z.boolean().default(true),
		max_concurrent_operations: z.number().positive().default(3),
	}),

	// Error handling
	error_handling: z.object({
		retry_attempts: z.number().int().min(0).default(3),
		retry_delay_ms: z.number().positive().default(1000),
		fallback_to_heuristic: z.boolean().default(true),
		log_extraction_failures: z.boolean().default(true),
	}),
});

/**
 * Type inference for configuration objects
 */
export type WorkspaceToolConfig = z.infer<typeof WorkspaceToolConfigSchema>;
export type WorkspaceBehaviorConfig = z.infer<typeof WorkspaceBehaviorConfigSchema>;
export type WorkspaceVectorStoreConfig = z.infer<typeof WorkspaceVectorStoreConfigSchema>;
export type WorkspaceEmbeddingConfig = z.infer<typeof WorkspaceEmbeddingConfigSchema>;
export type WorkspaceMemoryConfig = z.infer<typeof WorkspaceMemoryConfigSchema>;

/**
 * Default workspace memory configuration
 */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceMemoryConfig = {
	enabled: false,
	disable_default_memory: false,

	tools: {
		search: {
			name: 'cipher_workspace_search',
			description:
				'Search workspace memory for team and project information including progress, bugs, and collaboration context.',
			enabled: true,
			similarity_threshold: 0.7,
			max_results: 10,
			timeout_ms: 15000,
		},
		store: {
			name: 'cipher_workspace_store',
			description:
				'Background tool that automatically stores team-related information including project progress, bugs, and collaboration context.',
			enabled: true,
			auto_extraction: true,
			confidence_threshold: 0.6,
			batch_processing: true,
			skip_patterns: ['search_results', 'retrieved_content', 'tool_output', 'system_message'],
		},
	},

	behavior: {
		search_triggers: {
			keywords: [
				'team',
				'project',
				'progress',
				'feature',
				'bug',
				'issue',
				'collaborate',
				'working on',
				'assigned to',
				'status',
				'milestone',
				'deadline',
				'repository',
				'branch',
			],
			patterns: [
				'who.*working.*on',
				'what.*status.*of',
				'progress.*on.*feature',
				'bugs.*in.*project',
				'team.*member.*assigned',
				'repository.*branch',
				'current.*milestone',
			],
			semantic_triggers: [
				'asking about team member activities',
				'inquiring about project status',
				'requesting progress updates',
				'looking for bug reports',
				'checking collaboration history',
			],
		},
		store_triggers: {
			keywords: [
				'completed',
				'working on',
				'implemented',
				'fixed',
				'bug',
				'issue',
				'feature',
				'milestone',
				'deployed',
				'released',
				'blocked',
				'reviewing',
				'testing',
				'merged',
				'committed',
			],
			patterns: [
				'.*completed.*feature',
				'.*working.*on.*task',
				'.*fixed.*bug',
				'.*implemented.*component',
				'.*deployed.*to.*environment',
				'.*merged.*pull.*request',
				'.*created.*branch',
				'.*assigned.*to.*team',
			],
			semantic_triggers: [
				'reporting progress on tasks',
				'documenting bug fixes',
				'sharing feature implementations',
				'updating project status',
				'recording team assignments',
			],
		},
		field_extraction: {
			team_member: {
				patterns: [
					'(?:worked on by|assigned to|developer|dev|team member)\\s+([a-zA-Z]+(?:\\s+[a-zA-Z]+)?)',
					'(@[a-zA-Z_]+)',
					'([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s+(?:is working on|completed|fixed|implemented)',
				],
				required: false,
			},
			project_context: {
				patterns: [
					'(?:project|app|application):\\s*([a-zA-Z0-9_-]+)',
					'(?:in|for|on)\\s+(?:the\\s+)?([a-zA-Z0-9_-]+)\\s+project',
					'(?:repo|repository):\\s*([a-zA-Z0-9_/-]+)',
					'(?:branch|git checkout)\\s+([a-zA-Z0-9_/-]+)',
				],
				required: false,
			},
			progress_status: {
				patterns: [
					'(?:working on|implementing|developing|building)\\s+([^.!?]+)',
					'(?:completed|done|finished|deployed|released)\\b',
					'(?:blocked|stuck|waiting|pending)\\b',
					'(?:reviewing|review|testing|qa)\\b',
				],
				required: false,
			},
			bug_tracking: {
				patterns: [
					'(?:bug|issue|error|problem):\\s*([^.!?]+)',
					'(?:fixed|resolved|closed)\\s+(?:bug|issue|error):\\s*([^.!?]+)',
					'(?:critical|high|medium|low)\\s+(?:priority|severity)',
				],
				required: false,
			},
		},
	},

	vector_store: {
		collection_name: 'workspace_memory',
		similarity_threshold: 0.7,
		max_results: 10,
		rerank: false,
		search_options: {
			include_team_context: true,
			include_project_context: true,
			include_progress_info: true,
			include_bug_reports: true,
			filter_by_domain: false,
			filter_by_team_member: false,
		},
	},

	embedding: {
		model: 'text-embedding-3-small',
		dimension: 1536,
		batch_size: 50,
		timeout_ms: 30000,
		preprocessing: {
			preserve_team_mentions: true,
			preserve_project_structure: true,
			normalize_progress_terms: true,
			extract_technical_context: true,
		},
	},

	performance: {
		cache_enabled: true,
		cache_ttl_seconds: 300,
		batch_operations: true,
		async_storage: true,
		max_concurrent_operations: 3,
	},

	error_handling: {
		retry_attempts: 3,
		retry_delay_ms: 1000,
		fallback_to_heuristic: true,
		log_extraction_failures: true,
	},
};

/**
 * Validation errors
 */
export class WorkspaceConfigValidationError extends Error {
	constructor(
		message: string,
		public readonly issues?: z.ZodIssue[]
	) {
		super(message);
		this.name = 'WorkspaceConfigValidationError';
	}
}

/**
 * Validate workspace memory configuration
 */
export function validateWorkspaceMemoryConfig(config: unknown): WorkspaceMemoryConfig {
	const result = WorkspaceMemoryConfigSchema.safeParse(config);

	if (!result.success) {
		throw new WorkspaceConfigValidationError(
			'Workspace memory configuration validation failed',
			result.error.issues
		);
	}

	return result.data;
}

/**
 * Load workspace memory configuration from environment variables
 */
export function loadWorkspaceConfigFromEnv(): WorkspaceMemoryConfig {
	const envConfig = {
		enabled: process.env.USE_WORKSPACE_MEMORY === 'true',
		disable_default_memory: process.env.DISABLE_DEFAULT_MEMORY === 'true',
		vector_store: {
			collection_name: process.env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory',
		},
	};

	// Merge with default config
	return validateWorkspaceMemoryConfig({
		...DEFAULT_WORKSPACE_CONFIG,
		...envConfig,
		vector_store: {
			...DEFAULT_WORKSPACE_CONFIG.vector_store,
			...envConfig.vector_store,
		},
	});
}
