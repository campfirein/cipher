import { LLMConfig, LLMConfigSchema } from '../config.js';
import { OpenAIMessageFormatter } from './formatters/openai.js';
import { AnthropicMessageFormatter } from './formatters/anthropic.js';
import { IMessageFormatter } from './formatters/types.js';
import { ContextManager } from './manager.js';
import { logger } from '../../../logger/index.js';
import { PromptManager } from '../../systemPrompt/manager.js';

function getFormatter(provider: string): IMessageFormatter {
	const normalizedProvider = provider.toLowerCase();

	// Create new formatter based on provider
	let formatter: IMessageFormatter;
	switch (normalizedProvider) {
		case 'openai':
			formatter = new OpenAIMessageFormatter();
			break;
		case 'anthropic':
			formatter = new AnthropicMessageFormatter();
			break;
		default:
			throw new Error(`Unsupported provider: ${provider}. Supported providers: openai, anthropic`);
	}

	return formatter;
}

/**
 * Creates a new ContextManager instance with the appropriate formatter for the specified LLM config
 * @param config - The LLM configuration
 * @returns A new ContextManager instance
 * @throws Error if the config is invalid or the provider is unsupported
 */
export function createContextManager(
	config: LLMConfig,
	promptManager: PromptManager
): ContextManager {
	// Validate config using schema
	try {
		LLMConfigSchema.parse(config);
	} catch (error) {
		logger.error('Invalid LLM configuration provided to createContextManager', {
			config,
			error: error instanceof Error ? error.message : String(error),
		});
		throw new Error(
			`Invalid LLM configuration: ${error instanceof Error ? error.message : String(error)}`
		);
	}

	const { provider, model } = config;

	try {
		// Get the appropriate formatter for the provider
		const formatter = getFormatter(provider);
		// Log successful creation
		logger.info('Created context manager', {
			provider: provider.toLowerCase(),
			model: model.toLowerCase(),
			formatterType: formatter.constructor.name,
		});

		// Create and return the ContextManager
		return new ContextManager(formatter, promptManager);
	} catch (error) {
		logger.error('Failed to create context manager', {
			provider,
			model,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export { getFormatter };
