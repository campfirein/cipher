/**
 * Enhanced Prompt Manager
 *
 * New plugin-based prompt manager that replaces the legacy PromptManager.
 * Provides extensible, configurable, and high-performance system prompt generation.
 */

import {
	PromptProvider,
	ProviderContext,
	PromptGenerationResult,
	ProviderResult,
	SystemPromptConfig,
} from './interfaces.js';
import { SystemPromptConfigManager } from './config-manager.js';
import { providerRegistry } from './registry.js';
import { registerBuiltInGenerators } from './built-in-generators.js';

export interface EnhancedPromptManagerOptions {
	/** Configuration for the prompt manager */
	config?: SystemPromptConfig;
	/** Whether to automatically register built-in generators */
	registerBuiltInGenerators?: boolean;
	/** Custom context to merge with runtime context */
	defaultContext?: Partial<ProviderContext>;
}

export class EnhancedPromptManager {
	private configManager: SystemPromptConfigManager;
	private providers: Map<string, PromptProvider> = new Map();
	private dynamicAndFileProviderConfigs: Map<string, any> = new Map(); // Store configs for runtime
	private defaultContext: Partial<ProviderContext>;
	private initialized: boolean = false;
	private llmService: any = undefined; // Store reference to llmService

	constructor(options: EnhancedPromptManagerOptions = {}) {
		this.configManager = new SystemPromptConfigManager();
		this.defaultContext = options.defaultContext || {};

		if (options.config) {
			this.configManager.loadFromObject(options.config);
		}

		// Register built-in generators by default
		if (options.registerBuiltInGenerators !== false) {
			this.initializeBuiltInGenerators();
		}
	}

	/**
	 * Set the LLM service reference for use in provider context
	 */
	public setLLMService(llmService: any) {
		this.llmService = llmService;
	}

	/**
	 * Initialize the manager with configuration
	 */
	public async initialize(config?: SystemPromptConfig): Promise<void> {
		if (config) {
			this.configManager.loadFromObject(config);
		}

		if (!this.configManager.isLoaded()) {
			// Use default configuration if none provided
			const defaultConfig = SystemPromptConfigManager.createDefault();
			this.configManager.loadFromObject(defaultConfig);
		}

		// Create provider instances
		await this.createProviders();

		this.initialized = true;
	}

	/**
	 * Load configuration from file
	 */
	public async loadConfigFromFile(filePath: string): Promise<void> {
		await this.configManager.loadFromFile(filePath);

		if (this.initialized) {
			// Recreate providers with new configuration
			await this.destroyProviders();
			await this.createProviders();
		}
	}

	/**
	 * Generate complete system prompt
	 */
	public async generateSystemPrompt(
		runtimeContext: Partial<ProviderContext> = {}
	): Promise<PromptGenerationResult> {
		this.ensureInitialized();

		const startTime = Date.now();
		const context = this.buildContext(runtimeContext);
		const settings = this.configManager.getSettings();
		const enabledProviders = this.getEnabledProviders();

		// Support useCache flag in context
		const useCache = (runtimeContext as any).useCache === true;

		const providerResults: ProviderResult[] = [];
		const errors: Error[] = [];
		let success = true;

		// Generate content from all enabled providers, but track all providers in results
		const allProviders = Array.from(this.providers.values()).sort(
			(a, b) => b.priority - a.priority
		);

		const promises = allProviders.map(async (provider): Promise<void> => {
			if (!provider.enabled) {
				// Add result for disabled provider
				providerResults.push({
					providerId: provider.id,
					content: '',
					generationTimeMs: 0,
					success: false,
					error: new Error('Provider is disabled'),
				});
				return;
			}
			const providerStartTime = Date.now();

			try {
				// If useCache is true and provider supports getCachedContent, use it
				if (useCache && typeof (provider as any).getCachedContent === 'function') {
					const cached = (provider as any).getCachedContent();
					if (cached !== null && cached !== undefined) {
						providerResults.push({
							providerId: provider.id,
							content: cached,
							generationTimeMs: 0,
							success: true,
						});
						return;
					}
				}
				const content = await this.executeWithTimeout(
					() => provider.generateContent(context),
					settings.maxGenerationTime
				);

				providerResults.push({
					providerId: provider.id,
					content,
					generationTimeMs: Date.now() - providerStartTime,
					success: true,
				});
			} catch (error) {
				const err = error instanceof Error ? error : new Error('Unknown error');

				providerResults.push({
					providerId: provider.id,
					content: '',
					generationTimeMs: Date.now() - providerStartTime,
					success: false,
					error: err,
				});

				errors.push(err);

				if (settings.failOnProviderError) {
					success = false;
				}
			}
		});

		await Promise.all(promises);

		// Sort results by provider priority (to maintain order)
		providerResults.sort((a, b) => {
			const providerA = enabledProviders.find(p => p.id === a.providerId);
			const providerB = enabledProviders.find(p => p.id === b.providerId);
			return (providerB?.priority || 0) - (providerA?.priority || 0);
		});

		// Combine successful results
		const successfulResults = providerResults.filter(r => r.success && r.content.trim());
		const content = successfulResults.map(r => r.content).join(settings.contentSeparator);

		return {
			content,
			providerResults,
			generationTimeMs: Date.now() - startTime,
			success: success && successfulResults.length > 0,
			errors,
		};
	}

	/**
	 * Get current configuration
	 */
	public getConfig(): SystemPromptConfig {
		return this.configManager.getConfig();
	}

	/**
	 * Get all providers (enabled and disabled)
	 */
	public getProviders(): PromptProvider[] {
		return Array.from(this.providers.values());
	}

	/**
	 * Get enabled providers sorted by priority
	 */
	public getEnabledProviders(): PromptProvider[] {
		return Array.from(this.providers.values())
			.filter(provider => provider.enabled)
			.sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Get a specific provider by ID
	 */
	public getProvider(id: string): PromptProvider | undefined {
		return this.providers.get(id);
	}

	/**
	 * Enable or disable a provider
	 */
	public setProviderEnabled(id: string, enabled: boolean): void {
		const provider = this.providers.get(id);
		if (provider) {
			provider.enabled = enabled;
		}
	}

	/**
	 * Check if manager is initialized
	 */
	public isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Get performance statistics
	 */
	public async getPerformanceStats(): Promise<{
		totalProviders: number;
		enabledProviders: number;
		averageGenerationTime: number;
		lastGenerationResult?: PromptGenerationResult;
	}> {
		const providers = this.getProviders();
		const enabledProviders = this.getEnabledProviders();

		// Generate a test prompt to measure performance
		const testResult = await this.generateSystemPrompt({
			timestamp: new Date(),
			sessionId: 'perf-test',
		});

		return {
			totalProviders: providers.length,
			enabledProviders: enabledProviders.length,
			averageGenerationTime: Math.max(testResult.generationTimeMs, 1), // Ensure at least 1ms
			lastGenerationResult: testResult,
		};
	}

	/**
	 * Destroy the manager and clean up resources
	 */
	public async destroy(): Promise<void> {
		await this.destroyProviders();
		this.initialized = false;
	}

	/**
	 * Initialize built-in generators
	 */
	private async initializeBuiltInGenerators(): Promise<void> {
		await registerBuiltInGenerators();
	}

	/**
	 * Create provider instances from configuration
	 * Only instantiate static providers at startup.
	 * Store dynamic and file-based provider configs for runtime activation.
	 */
	private async createProviders(): Promise<void> {
		const providerConfigs = this.configManager.getProviders();
		for (const config of providerConfigs) {
			if (config.type === 'static' && config.enabled) {
				try {
					const provider = await providerRegistry.create(config);
					this.providers.set(provider.id, provider);
				} catch (error) {
					console.warn(`Failed to create provider '${config.name}':`, error);
				}
			} else if (config.type === 'dynamic' || config.type === 'file-based') {
				// Store for runtime activation
				this.dynamicAndFileProviderConfigs.set(config.name, config);
			}
		}
	}

	/**
	 * Add or update a dynamic or file-based provider at runtime.
	 * If a provider with the same name exists, replace it.
	 * Triggers prompt rebuild.
	 */
	public async addOrUpdateProvider(config: any): Promise<void> {
		if (config.type === 'static') {
			throw new Error('Static providers cannot be added/updated at runtime.');
		}
		// Remove existing provider if present
		if (this.providers.has(config.name)) {
			await this.removeProvider(config.name);
		}
		// Create and add the new provider
		try {
			const provider = await providerRegistry.create(config);
			this.providers.set(provider.id, provider);
			this.dynamicAndFileProviderConfigs.set(config.name, config);
			// Trigger prompt rebuild (could be a callback or event in real system)
		} catch (error) {
			console.warn(`Failed to add/update provider '${config.name}':`, error);
		}
	}

	/**
	 * Remove a dynamic or file-based provider at runtime.
	 * Triggers prompt rebuild.
	 */
	public async removeProvider(name: string): Promise<void> {
		const provider = this.providers.get(name);
		if (provider) {
			await provider.destroy();
			this.providers.delete(name);
			this.dynamicAndFileProviderConfigs.delete(name);
			// Trigger prompt rebuild (could be a callback or event in real system)
		}
	}

	/**
	 * List all providers and their status.
	 */
	public listProviders(): { id: string; type: string; enabled: boolean }[] {
		return Array.from(this.providers.values()).map(p => ({
			id: p.id,
			type: p.type,
			enabled: p.enabled,
		}));
	}

	/**
	 * Destroy all provider instances
	 */
	private async destroyProviders(): Promise<void> {
		const destroyPromises = Array.from(this.providers.values()).map(async provider => {
			try {
				await provider.destroy();
			} catch (error) {
				console.warn(`Failed to destroy provider '${provider.id}':`, error);
			}
		});

		await Promise.all(destroyPromises);
		this.providers.clear();
	}

	/**
	 * Build context by merging default and runtime context
	 */
	private buildContext(runtimeContext: Partial<ProviderContext>): ProviderContext {
		// Merge llmService into metadata
		const base: ProviderContext = {
			timestamp: new Date(),
			...this.defaultContext,
			...runtimeContext,
		};
		// Always inject llmService into metadata
		return {
			...base,
			metadata: {
				...(base.metadata || {}),
				llmService: this.llmService,
			},
		};
	}

	/**
	 * Execute a function with timeout
	 */
	private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Operation timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			fn()
				.then(resolve)
				.catch(reject)
				.finally(() => clearTimeout(timeout));
		});
	}

	/**
	 * Ensure manager is initialized
	 */
	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error('EnhancedPromptManager is not initialized. Call initialize() first.');
		}
	}
}
