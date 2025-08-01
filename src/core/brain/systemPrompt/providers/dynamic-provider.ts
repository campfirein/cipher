/**
 * Dynamic Prompt Provider
 *
 * Provides content that is generated at runtime based on context.
 * Useful for time-sensitive information, user-specific data, or contextual instructions.
 */

import { ProviderType, ProviderContext } from '../interfaces.js';
import { BasePromptProvider } from './base-provider.js';

export type DynamicContentGenerator = (
	context: ProviderContext,
	config: Record<string, any>
) => Promise<string>;

export interface DynamicProviderConfig {
	/** The generator function name or identifier */
	generator: string;
	/** Configuration passed to the generator function */
	generatorConfig?: Record<string, any>;
	/** Template to wrap the generated content */
	template?: string;
}

export class DynamicPromptProvider extends BasePromptProvider {
	private generatorName: string = '';
	private generatorConfig: Record<string, any> = {};
	private template: string = '';
	private generatorFunction: DynamicContentGenerator | undefined;

	// Cached content for this provider
	private cachedContent: string | null = null;

	// Static registry of generator functions
	private static generators: Map<string, DynamicContentGenerator> = new Map();

	constructor(id: string, name: string, priority: number, enabled: boolean = true) {
		super(id, name, ProviderType.DYNAMIC, priority, enabled);
	}

	/**
	 * Register a dynamic content generator function
	 */
	public static registerGenerator(name: string, generator: DynamicContentGenerator): void {
		DynamicPromptProvider.generators.set(name, generator);
	}

	/**
	 * Get all registered generator names
	 */
	public static getRegisteredGenerators(): string[] {
		return Array.from(DynamicPromptProvider.generators.keys());
	}

	/**
	 * Check if a generator is registered
	 */
	public static isGeneratorRegistered(name: string): boolean {
		return DynamicPromptProvider.generators.has(name);
	}

	public override validateConfig(config: Record<string, any>): boolean {
		if (!super.validateConfig(config)) {
			return false;
		}

		const typedConfig = config as DynamicProviderConfig;

		// Generator name is required and must be a string
		if (typeof typedConfig.generator !== 'string' || !typedConfig.generator.trim()) {
			return false;
		}

		// Generator must be registered
		if (!DynamicPromptProvider.isGeneratorRegistered(typedConfig.generator)) {
			return false;
		}

		// GeneratorConfig is optional but must be an object if provided
		if (typedConfig.generatorConfig !== undefined) {
			if (typeof typedConfig.generatorConfig !== 'object' || typedConfig.generatorConfig === null) {
				return false;
			}
		}

		// Template is optional but must be a string if provided
		if (typedConfig.template !== undefined) {
			if (typeof typedConfig.template !== 'string') {
				return false;
			}
		}

		return true;
	}

	public override async initialize(config: Record<string, any>): Promise<void> {
		await super.initialize(config);

		const typedConfig = config as DynamicProviderConfig;
		this.generatorName = typedConfig.generator;
		this.generatorConfig = typedConfig.generatorConfig || {};
		this.template = typedConfig.template || '{{content}}';

		// Get the generator function
		const generatorFunction = DynamicPromptProvider.generators.get(this.generatorName);

		if (!generatorFunction) {
			throw new Error(`Generator function '${this.generatorName}' not found`);
		}

		this.generatorFunction = generatorFunction;
	}

	public async generateContent(context: ProviderContext): Promise<string> {
		this.ensureInitialized();

		if (!this.canGenerate() || !this.generatorFunction) {
			return '';
		}

		// If cached content is set, return it
		if (this.cachedContent !== null) {
			return this.cachedContent;
		}
		try {
			// Generate dynamic content
			const dynamicContent = await this.generatorFunction(context, this.generatorConfig);

			// Apply template if provided
			const result = this.template.replace('{{content}}', dynamicContent);

			// Optionally cache here (but for now, only set via setCachedContent)
			return result;
		} catch (error) {
			throw new Error(
				`Failed to generate dynamic content: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Set the cached content for this provider
	 */
	public setCachedContent(content: string) {
		this.cachedContent = content;
	}

	/**
	 * Get the cached content for this provider
	 */
	public getCachedContent(): string | null {
		return this.cachedContent;
	}

	/**
	 * Clear the cached content (for cache invalidation)
	 */
	public clearCachedContent() {
		this.cachedContent = null;
	}

	public override async destroy(): Promise<void> {
		await super.destroy();
		this.generatorName = '';
		this.generatorConfig = {};
		this.template = '';
		this.generatorFunction = undefined;
		this.cachedContent = null;
	}
}
