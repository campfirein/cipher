/**
 * Static Prompt Provider
 *
 * Provides static content that doesn't change based on runtime context.
 * Useful for fixed instructions, disclaimers, or constant prompt segments.
 */

import { ProviderType, ProviderContext } from '../interfaces.js';
import { BasePromptProvider } from './base-provider.js';

export interface StaticProviderConfig {
	/** The static content to provide */
	content: string;
	/** Optional template variables to replace in content */
	variables?: Record<string, string>;
}

export class StaticPromptProvider extends BasePromptProvider {
	private content: string = '';
	private variables: Record<string, string> = {};

	constructor(id: string, name: string, priority: number, enabled: boolean = true) {
		super(id, name, ProviderType.STATIC, priority, enabled);
	}

	public override validateConfig(config: Record<string, any>): boolean {
		if (!super.validateConfig(config)) {
			return false;
		}

		const typedConfig = config as StaticProviderConfig;

		// Content is required and must be a string
		if (typeof typedConfig.content !== 'string') {
			return false;
		}

		// Variables are optional but must be a record if provided
		if (typedConfig.variables !== undefined) {
			if (typeof typedConfig.variables !== 'object' || typedConfig.variables === null) {
				return false;
			}

			// Check that all variable values are strings
			for (const [key, value] of Object.entries(typedConfig.variables)) {
				if (typeof key !== 'string' || typeof value !== 'string') {
					return false;
				}
			}
		}

		return true;
	}

	public override async initialize(config: Record<string, any>): Promise<void> {
		await super.initialize(config);

		const typedConfig = config as StaticProviderConfig;
		this.content = typedConfig.content;
		this.variables = typedConfig.variables || {};
	}

	public async generateContent(_context: ProviderContext): Promise<string> {
		this.ensureInitialized();

		if (!this.canGenerate()) {
			return '';
		}

		// Replace template variables if any exist
		let result = this.content;

		for (const [key, value] of Object.entries(this.variables)) {
			const placeholder = `{{${key}}}`;
			result = result.replace(new RegExp(placeholder, 'g'), value);
		}

		return result;
	}

	public override async destroy(): Promise<void> {
		await super.destroy();
		this.content = '';
		this.variables = {};
	}
}
