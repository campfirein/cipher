import { LLMConfig, LLMConfigSchema } from '../config.js';
import { OpenAIMessageFormatter } from './formatters/openai.js';
import { AnthropicMessageFormatter } from './formatters/anthropic.js';
import { AzureMessageFormatter } from './formatters/azure.js';
import { IMessageFormatter } from './formatters/types.js';
import { ContextManager } from './manager.js';
import { logger } from '../../../logger/index.js';
import { EnhancedPromptManager } from '../../systemPrompt/enhanced-manager.js';
import { IConversationHistoryProvider } from './history/types.js';

function getFormatter(provider: string): IMessageFormatter {
	const normalizedProvider = provider.toLowerCase();
	let formatter: IMessageFormatter;
	switch (normalizedProvider) {
		case 'openai':
		case 'openrouter':
		case 'ollama':
		case 'lmstudio':
		case 'qwen':
		case 'gemini':
			formatter = new OpenAIMessageFormatter();
			break;
		case 'azure':
			formatter = new AzureMessageFormatter();
			break;
		case 'anthropic':
		case 'aws':
			formatter = new AnthropicMessageFormatter();
			break;
		default:
			throw new Error(
				`Unsupported provider: ${provider}. Supported providers: openai, anthropic, openrouter, ollama, lmstudio, qwen, aws, azure, gemini`
			);
	}
	return formatter;
}

/**
 * Creates a new ContextManager instance with the appropriate formatter for the specified LLM config
 * @param config - The LLM configuration
 * @param promptManager - The prompt manager
 * @param historyProvider - Optional conversation history provider
 * @param sessionId - Optional session ID for history isolation
 * @returns A new ContextManager instance
 * @throws Error if the config is invalid or the provider is unsupported
 */
export function createContextManager(
	config: LLMConfig,
	promptManager: EnhancedPromptManager,
	historyProvider?: IConversationHistoryProvider,
	sessionId?: string
): ContextManager {
	try {
		LLMConfigSchema.parse(config);
	} catch (error) {
		logger.error('Invalid LLM configuration provided to createContextManager', {
			config,
			error: error instanceof Error ? error.message : String(error),
			validationIssues: error instanceof Error && 'issues' in error ? error.issues : undefined,
		});
		throw new Error(
			`Invalid LLM configuration: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	const { provider, model } = config;
	try {
		const formatter = getFormatter(provider);
		logger.debug('Created context manager', {
			provider: provider.toLowerCase(),
			model: model.toLowerCase(),
			formatterType: formatter.constructor.name,
		});
		return new ContextManager(formatter, promptManager, historyProvider, sessionId);
	} catch (error) {
		logger.error('Failed to create context manager', {
			provider,
			model,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
