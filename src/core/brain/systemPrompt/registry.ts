/**
 * Provider Registry
 *
 * Central registry for managing prompt provider generator functions.
 * Handles registration, creation, and type management for all provider types.
 */

import {
	ProviderRegistry,
	ProviderConfig,
	PromptProvider,
	ProviderGenerator,
	ProviderType,
} from './interfaces.js';
import { StaticPromptProvider } from './providers/static-provider.js';
import { DynamicPromptProvider } from './providers/dynamic-provider.js';
import { FilePromptProvider } from './providers/file-provider.js';

export class DefaultProviderRegistry implements ProviderRegistry {
	private generators: Map<string, ProviderGenerator> = new Map();

	constructor() {
		// Register built-in provider types
		this.registerBuiltInProviders();
	}

	/**
	 * Register a provider generator function
	 */
	public register(type: string, generator: ProviderGenerator): void {
		if (!type || typeof type !== 'string') {
			throw new Error('Provider type must be a non-empty string');
		}

		if (typeof generator !== 'function') {
			throw new Error('Generator must be a function');
		}

		this.generators.set(type, generator);
	}

	/**
	 * Create a provider instance
	 */
	public async create(config: ProviderConfig): Promise<PromptProvider> {
		if (!this.isRegistered(config.type)) {
			throw new Error(`Provider type '${config.type}' is not registered`);
		}

		const generator = this.generators.get(config.type)!;

		try {
			const provider = await generator(config);
			return provider;
		} catch (error) {
			throw new Error(
				`Failed to create provider '${config.name}': ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Get all registered provider types
	 */
	public getRegisteredTypes(): string[] {
		return Array.from(this.generators.keys());
	}

	/**
	 * Check if a provider type is registered
	 */
	public isRegistered(type: string): boolean {
		return this.generators.has(type);
	}

	/**
	 * Unregister a provider type
	 */
	public unregister(type: string): boolean {
		return this.generators.delete(type);
	}

	/**
	 * Clear all registered providers
	 */
	public clear(): void {
		this.generators.clear();
	}

	/**
	 * Register built-in provider types
	 */
	private registerBuiltInProviders(): void {
		// Static provider generator
		this.register(ProviderType.STATIC, async (config: ProviderConfig) => {
			const provider = new StaticPromptProvider(
				config.name,
				config.name,
				config.priority,
				config.enabled
			);

			if (config.config) {
				await provider.initialize(config.config);
			}

			return provider;
		});

		// Dynamic provider generator
		this.register(ProviderType.DYNAMIC, async (config: ProviderConfig) => {
			const provider = new DynamicPromptProvider(
				config.name,
				config.name,
				config.priority,
				config.enabled
			);

			if (config.config) {
				await provider.initialize(config.config);
			}

			return provider;
		});

		// File-based provider generator
		this.register(ProviderType.FILE_BASED, async (config: ProviderConfig) => {
			const provider = new FilePromptProvider(
				config.name,
				config.name,
				config.priority,
				config.enabled
			);

			if (config.config) {
				await provider.initialize(config.config);
			}

			return provider;
		});
	}
}

// Export a singleton instance for global use
export const providerRegistry = new DefaultProviderRegistry();
