/**
 * Base abstract class for all prompt providers
 *
 * This provides common functionality and enforces the interface contract
 * for all prompt provider implementations.
 */

import { PromptProvider, ProviderType, ProviderContext } from '../interfaces.js';

export abstract class BasePromptProvider implements PromptProvider {
	public readonly id: string;
	public readonly name: string;
	public readonly type: ProviderType;
	public readonly priority: number;
	public enabled: boolean;

	protected config: Record<string, any> = {};
	protected initialized: boolean = false;

	constructor(
		id: string,
		name: string,
		type: ProviderType,
		priority: number,
		enabled: boolean = true
	) {
		this.id = id;
		this.name = name;
		this.type = type;
		this.priority = priority;
		this.enabled = enabled;
	}

	/**
	 * Abstract method that must be implemented by concrete providers
	 */
	public abstract generateContent(context: ProviderContext): Promise<string>;

	/**
	 * Default validation - can be overridden by concrete providers
	 */
	public validateConfig(config: Record<string, any>): boolean {
		// Basic validation - check if config is an object
		return typeof config === 'object' && config !== null;
	}

	/**
	 * Initialize the provider with configuration
	 */
	public async initialize(config: Record<string, any>): Promise<void> {
		if (!this.validateConfig(config)) {
			throw new Error(`Invalid configuration for provider ${this.id}`);
		}

		this.config = { ...config };
		this.initialized = true;
	}

	/**
	 * Default cleanup - can be overridden by concrete providers
	 */
	public async destroy(): Promise<void> {
		this.config = {};
		this.initialized = false;
	}

	/**
	 * Check if provider is initialized
	 */
	protected ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error(`Provider ${this.id} is not initialized`);
		}
	}

	/**
	 * Check if provider is enabled and initialized
	 */
	protected canGenerate(): boolean {
		return this.enabled && this.initialized;
	}
}
