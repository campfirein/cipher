/**
 * Core interfaces for the System Prompt Plugin Architecture
 *
 * This module defines the foundational interfaces and types for the
 * extensible system prompt management system.
 */

/**
 * Context information passed to prompt providers for dynamic content generation
 */
export interface ProviderContext {
	/** Current timestamp */
	timestamp: Date;
	/** User ID or identifier if available */
	userId?: string;
	/** Session identifier */
	sessionId?: string;
	/** Current memory state or relevant memory chunks */
	memoryContext?: Record<string, any>;
	/** Additional runtime context data */
	metadata?: Record<string, any>;
}

/**
 * Configuration options for prompt providers
 */
export interface ProviderConfig {
	/** Provider name/identifier */
	name: string;
	/** Provider type */
	type: ProviderType;
	/** Execution priority (higher numbers execute first) */
	priority: number;
	/** Whether this provider is enabled */
	enabled: boolean;
	/** Provider-specific configuration */
	config?: Record<string, any>;
}

/**
 * Types of prompt providers supported by the system
 */
export enum ProviderType {
	/** Static content that doesn't change */
	STATIC = 'static',
	/** Dynamic content generated at runtime */
	DYNAMIC = 'dynamic',
	/** Content loaded from external files */
	FILE_BASED = 'file-based',
}

/**
 * Main interface for all prompt providers
 */
export interface PromptProvider {
	/** Unique identifier for this provider */
	readonly id: string;

	/** Human-readable name */
	readonly name: string;

	/** Provider type */
	readonly type: ProviderType;

	/** Execution priority */
	readonly priority: number;

	/** Whether this provider is currently enabled */
	enabled: boolean;

	/**
	 * Generate prompt content
	 * @param context Runtime context for dynamic content generation
	 * @returns Promise resolving to the generated prompt content
	 */
	generateContent(context: ProviderContext): Promise<string>;

	/**
	 * Validate provider configuration
	 * @param config Configuration to validate
	 * @returns True if configuration is valid
	 */
	validateConfig(config: Record<string, any>): boolean;

	/**
	 * Initialize the provider with configuration
	 * @param config Provider configuration
	 */
	initialize(config: Record<string, any>): Promise<void>;

	/**
	 * Clean up resources when provider is destroyed
	 */
	destroy(): Promise<void>;
}

/**
 * Registry for managing prompt provider generator functions
 */
export interface ProviderRegistry {
	/**
	 * Register a provider generator function
	 * @param type Provider type
	 * @param generator Function that creates provider instances
	 */
	register(type: string, generator: ProviderGenerator): void;

	/**
	 * Create a provider instance
	 * @param config Provider configuration
	 * @returns Created provider instance
	 */
	create(config: ProviderConfig): Promise<PromptProvider>;

	/**
	 * Get all registered provider types
	 */
	getRegisteredTypes(): string[];

	/**
	 * Check if a provider type is registered
	 * @param type Provider type to check
	 */
	isRegistered(type: string): boolean;
}

/**
 * Function type for creating provider instances
 */
export type ProviderGenerator = (config: ProviderConfig) => Promise<PromptProvider>;

/**
 * Configuration for the entire prompt management system
 */
export interface SystemPromptConfig {
	/** List of provider configurations */
	providers: ProviderConfig[];

	/** Global settings */
	settings: {
		/** Maximum time to wait for all providers (ms) */
		maxGenerationTime: number;
		/** Whether to fail if any provider fails */
		failOnProviderError: boolean;
		/** Separator between provider outputs */
		contentSeparator: string;
	};
}

/**
 * Result from generating system prompt content
 */
export interface PromptGenerationResult {
	/** The complete generated prompt */
	content: string;

	/** Individual provider results */
	providerResults: ProviderResult[];

	/** Total generation time in milliseconds */
	generationTimeMs: number;

	/** Whether generation was successful */
	success: boolean;

	/** Any errors that occurred */
	errors: Error[];
}

/**
 * Result from a single provider
 */
export interface ProviderResult {
	/** Provider ID */
	providerId: string;

	/** Generated content */
	content: string;

	/** Generation time for this provider */
	generationTimeMs: number;

	/** Whether this provider succeeded */
	success: boolean;

	/** Error if provider failed */
	error?: Error;
}
