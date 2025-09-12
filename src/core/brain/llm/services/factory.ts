import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { LLMConfig } from '../config.js';
import { ILLMService } from './types.js';
import { env } from '../../../env.js';
import { logger } from '../../../logger/index.js';
import { LLMServices, LLMProviderType, ExtendedLLMConfig } from './service.js';
import { EventManager } from '../../../events/event-manager.js';

function extractApiKey(config: LLMConfig): string {
	const provider = config.provider.toLowerCase();

	// These providers don't require traditional API keys
	if (
		provider === 'ollama' ||
		provider === 'lmstudio' ||
		provider === 'aws' ||
		provider === 'azure'
	) {
		return 'not-required';
	}

	// Get API key from config (already expanded)
	let apiKey = config.apiKey || '';

	if (!apiKey) {
		const errorMsg = `Error: API key for ${provider} not found`;
		logger.error(errorMsg);
		logger.error(`Please set your ${provider} API key in the config file or .env file`);
		throw new Error(errorMsg);
	}
	logger.debug('Verified API key');
	return apiKey;
}

function getOpenAICompatibleBaseURL(llmConfig: LLMConfig): string {
	if (llmConfig.baseURL) {
		let baseUrl = llmConfig.baseURL.replace(/\/$/, '');

		// For Ollama, ensure /v1 suffix for OpenAI-compatible endpoint
		const provider = llmConfig.provider.toLowerCase();
		if (provider === 'ollama' && !baseUrl.endsWith('/v1') && !baseUrl.endsWith('/api')) {
			baseUrl = baseUrl + '/v1';
		}

		return baseUrl;
	}

	// Provider-specific defaults and environment fallbacks
	const provider = llmConfig.provider.toLowerCase();

	if (provider === 'openrouter') {
		return 'https://openrouter.ai/api/v1';
	}

	if (provider === 'ollama') {
		// Use environment variable if set, otherwise default to localhost:11434/v1
		let baseUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';

		// Ensure /v1 suffix for OpenAI-compatible endpoint
		if (!baseUrl.endsWith('/v1') && !baseUrl.endsWith('/api')) {
			baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
		}

		return baseUrl;
	}

	if (provider === 'lmstudio') {
		// Use environment variable if set, otherwise default to localhost:1234/v1
		return env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
	}

	if (provider === 'qwen') {
		return llmConfig.baseURL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
	}

	if (provider === 'vllm') {
		return llmConfig.baseURL || 'http://localhost:8000/v1';
	}

	// Check for environment variable as fallback for OpenAI
	if (provider === 'openai' && env.OPENAI_BASE_URL) {
		return env.OPENAI_BASE_URL.replace(/\/$/, '');
	}

	return '';
}

function mapProviderToUnifiedType(provider: string): LLMProviderType {
	const normalizedProvider = provider.toLowerCase();

	switch (normalizedProvider) {
		case 'aws':
			return 'aws';
		case 'azure':
			return 'azure';
		case 'gemini':
			return 'google';
		default:
			return normalizedProvider as LLMProviderType;
	}
}

function _createLLMService(
	config: LLMConfig,
	mcpManager: MCPManager,
	contextManager: ContextManager,
	unifiedToolManager?: UnifiedToolManager,
	eventManager?: EventManager
): ILLMService {
	// Extract and validate API key
	const apiKey = extractApiKey(config);
	const baseURL = getOpenAICompatibleBaseURL(config);
	const providerType = mapProviderToUnifiedType(config.provider);

	// Create unified configuration
	const unifiedConfig: ExtendedLLMConfig = {
		provider: providerType,
		model: config.model,
		apiKey: apiKey !== 'not-required' ? apiKey : undefined,
		baseURL: baseURL || undefined,
		maxIterations: config.maxIterations,
		streaming: false, // Can be made configurable
	};

	// Add provider-specific configurations
	switch (providerType) {
		case 'aws':
			unifiedConfig.region = config.aws?.region || process.env.AWS_DEFAULT_REGION || 'us-east-1';
			unifiedConfig.awsConfig = config.aws;
			unifiedConfig.inferenceProfileArn = config.aws?.inferenceProfileArn;
			break;

		case 'azure':
			unifiedConfig.endpoint = config.azure?.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
			unifiedConfig.deployment = config.azure?.deployment;
			unifiedConfig.apiVersion = config.azure?.apiVersion;
			unifiedConfig.resourceName = config.azure?.resourceName;
			break;

		case 'qwen':
			unifiedConfig.enableThinking = config.qwenOptions?.enableThinking;
			unifiedConfig.thinkingBudget = config.qwenOptions?.thinkingBudget;
			break;

		case 'openrouter':
			unifiedConfig.baseURL = 'https://openrouter.ai/api/v1';
			break;

		case 'ollama':
		case 'lmstudio':
		case 'vllm':
			// baseURL already set above
			break;
	}

	logger.debug(`Creating unified LLM service for provider: ${providerType}`, {
		model: config.model,
		hasApiKey: !!apiKey && apiKey !== 'not-required',
		baseURL: unifiedConfig.baseURL,
	});
	return new LLMServices(
		unifiedConfig,
		mcpManager,
		contextManager,
		unifiedToolManager,
		eventManager
	);
}

export function createLLMService(
	config: LLMConfig,
	mcpManager: MCPManager,
	contextManager: ContextManager,
	unifiedToolManager?: UnifiedToolManager,
	eventManager?: EventManager
): ILLMService {
	logger.info(`Creating LLM service for provider: ${config.provider}`, {
		model: config.model,
		hasUnifiedToolManager: !!unifiedToolManager,
		hasEventManager: !!eventManager,
	});

	const service = _createLLMService(
		config,
		mcpManager,
		contextManager,
		unifiedToolManager,
		eventManager
	);

	// Configure token-aware compression for the context manager
	configureCompressionForService(config, contextManager);

	logger.info(`Successfully created unified LLM service for ${config.provider}`, {
		model: config.model,
		provider: config.provider,
	});

	return service;
}

/**
 * Configure compression settings for the context manager based on LLM config
 */
async function configureCompressionForService(
	config: LLMConfig,
	contextManager: ContextManager
): Promise<void> {
	try {
		// Extract provider and model info
		const provider = config.provider.toLowerCase();
		const model = config.model;

		// Get context window size from defaults since it's not in config
		const contextWindow = getDefaultContextWindow(provider, model);

		// Configure compression asynchronously to avoid blocking service creation
		setImmediate(async () => {
			try {
				await contextManager.configureCompression(provider, model, contextWindow);
				logger.debug('Token-aware compression configured for LLM service', {
					provider,
					model,
					contextWindow,
				});
			} catch (error) {
				logger.warn('Failed to configure compression for LLM service', {
					error: (error as Error).message,
					provider,
					model,
				});
			}
		});
	} catch (error) {
		logger.error('Error in compression configuration', { error });
	}
}

/**
 * Get default context window size for provider/model combinations
 */
function getDefaultContextWindow(provider: string, model?: string): number {
	const defaults: Record<string, Record<string, number>> = {
		openai: {
			'gpt-3.5-turbo': 16385,
			'gpt-4': 8192,
			'gpt-4-32k': 32768,
			'gpt-4-turbo': 128000,
			'gpt-4o': 128000,
			'gpt-4o-mini': 128000,
			'o1-preview': 128000,
			'o1-mini': 128000,
			default: 8192,
		},
		anthropic: {
			'claude-3-opus': 200000,
			'claude-3-sonnet': 200000,
			'claude-3-haiku': 200000,
			'claude-3-5-sonnet': 200000,
			'claude-2.1': 200000,
			'claude-2.0': 100000,
			'claude-instant-1.2': 100000,
			default: 200000,
		},
		google: {
			'gemini-pro': 32760,
			'gemini-pro-vision': 16384,
			'gemini-ultra': 32760,
			'gemini-1.5-pro': 1000000,
			'gemini-1.5-flash': 1000000,
			'gemini-1.5-pro-latest': 2000000,
			'gemini-1.5-flash-latest': 1000000,
			'gemini-2.0-flash': 1000000,
			'gemini-2.0-flash-exp': 1000000,
			'gemini-2.5-pro': 2000000,
			'gemini-2.5-flash': 1000000,
			'gemini-2.5-flash-lite': 1000000,
			default: 1000000,
		},
		gemini: {
			// Alias for backward compatibility
			'gemini-pro': 32760,
			'gemini-pro-vision': 16384,
			'gemini-ultra': 32760,
			'gemini-1.5-pro': 1000000,
			'gemini-1.5-flash': 1000000,
			'gemini-1.5-pro-latest': 2000000,
			'gemini-1.5-flash-latest': 1000000,
			'gemini-2.0-flash': 1000000,
			'gemini-2.0-flash-exp': 1000000,
			'gemini-2.5-pro': 2000000,
			'gemini-2.5-flash': 1000000,
			'gemini-2.5-flash-lite': 1000000,
			default: 1000000,
		},
		groq: {
			'llama3-8b-8192': 8192,
			'llama3-70b-8192': 8192,
			'mixtral-8x7b-32768': 32768,
			'gemma-7b-it': 8192,
			'gemma2-9b-it': 8192,
			default: 8192,
		},
		aws: {
			// AWS Bedrock models
			'anthropic.claude-3-sonnet-20240229-v1:0': 200000,
			'anthropic.claude-3-opus-20240229-v1:0': 200000,
			'anthropic.claude-3-haiku-20240307-v1:0': 200000,
			'anthropic.claude-3-5-sonnet-20240620-v1:0': 200000,
			'anthropic.claude-v2:1': 200000,
			'anthropic.claude-v2': 100000,
			'anthropic.claude-instant-v1': 100000,
			'meta.llama2-13b-chat-v1': 4096,
			'meta.llama2-70b-chat-v1': 4096,
			'amazon.titan-text-express-v1': 8192,
			'amazon.titan-text-lite-v1': 4096,
			'ai21.j2-ultra-v1': 8192,
			'ai21.j2-mid-v1': 8192,
			'cohere.command-text-v14': 4096,
			'cohere.command-light-text-v14': 4096,
			default: 8192,
		},
		azure: {
			// Azure OpenAI uses same models as OpenAI
			'gpt-3.5-turbo': 16385,
			'gpt-4': 8192,
			'gpt-4-32k': 32768,
			'gpt-4-turbo': 128000,
			'gpt-4o': 128000,
			'gpt-4o-mini': 128000,
			default: 8192,
		},
		qwen: {
			'qwen-turbo': 6000,
			'qwen-plus': 30000,
			'qwen-max': 6000,
			'qwen-max-1201': 6000,
			'qwen-max-longcontext': 28000,
			'qwen2-72b-instruct': 32768,
			'qwen2-7b-instruct': 32768,
			'qwen2-1.5b-instruct': 32768,
			'qwen2-0.5b-instruct': 32768,
			default: 6000,
		},
		ollama: {
			default: 8192, // Conservative default for local models
		},
		openrouter: {
			default: 8192, // Varies by model, conservative default
		},
		lmstudio: {
			default: 8192, // Conservative default for local models
		},
		vllm: {
			default: 8192, // Conservative default for local models
		},
	};

	const providerDefaults = defaults[provider];
	if (!providerDefaults) {
		return 8192; // Global fallback
	}

	return providerDefaults[model || 'default'] || providerDefaults.default || 8192;
}
