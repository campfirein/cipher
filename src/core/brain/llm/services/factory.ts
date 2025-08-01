import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { LLMConfig } from '../config.js';
import { ILLMService } from './types.js';
import { env } from '../../../env.js';
import { logger } from '../../../logger/index.js';
import { OpenAIService } from './openai.js';
import { AnthropicService } from './anthropic.js';
import { OpenRouterService } from './openrouter.js';
import { OllamaService } from './ollama.js';
import { QwenService, QwenOptions } from './qwen.js';
import { AwsService } from './aws.js';
import { AzureService } from './azure.js';
import { GeminiService } from './gemini.js';
import { LMStudioService } from './lmstudio.js';

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
		return llmConfig.baseURL.replace(/\/$/, '');
	}

	// Provider-specific defaults and environment fallbacks
	const provider = llmConfig.provider.toLowerCase();

	if (provider === 'openrouter') {
		return 'https://openrouter.ai/api/v1';
	}

	if (provider === 'ollama') {
		// Use environment variable if set, otherwise default to localhost:11434
		return env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
	}

	if (provider === 'lmstudio') {
		// Use environment variable if set, otherwise default to localhost:1234/v1
		return env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
	}

	// Check for environment variable as fallback for OpenAI
	if (provider === 'openai' && env.OPENAI_BASE_URL) {
		return env.OPENAI_BASE_URL.replace(/\/$/, '');
	}

	return '';
}

function _createLLMService(
	config: LLMConfig,
	mcpManager: MCPManager,
	contextManager: ContextManager,
	unifiedToolManager?: UnifiedToolManager
): ILLMService {
	// Extract and validate API key
	const apiKey = extractApiKey(config);

	switch (config.provider.toLowerCase()) {
		case 'openai': {
			const baseURL = getOpenAICompatibleBaseURL(config);
			// Use require for OpenAI SDK for compatibility
			// @ts-ignore

			const OpenAIClass = require('openai');
			const openai = new OpenAIClass({ apiKey, ...(baseURL ? { baseURL } : {}) });
			return new OpenAIService(
				openai,
				config.model,
				mcpManager,
				contextManager,
				config.maxIterations,
				unifiedToolManager
			);
		}
		case 'openrouter': {
			const baseURL = getOpenAICompatibleBaseURL(config);
			// Use require for OpenAI SDK for compatibility
			// @ts-ignore

			const OpenAIClass = require('openai');
			const openai = new OpenAIClass({
				apiKey,
				baseURL,
				defaultHeaders: {
					'HTTP-Referer': 'https://github.com/byterover/cipher',
					'X-Title': 'Cipher Memory Agent',
				},
			});
			return new OpenRouterService(
				openai,
				config.model,
				mcpManager,
				contextManager,
				config.maxIterations,
				unifiedToolManager
			);
		}
		case 'lmstudio': {
			const baseURL = getOpenAICompatibleBaseURL(config);
			// Use require for OpenAI SDK for compatibility
			// @ts-ignore

			const OpenAIClass = require('openai');
			const openai = new OpenAIClass({
				apiKey: 'lm-studio', // LM Studio uses "lm-studio" as the API key
				baseURL,
			});
			return new LMStudioService(
				openai,
				config.model,
				mcpManager,
				contextManager,
				config.maxIterations,
				unifiedToolManager
			);
		}
		case 'anthropic': {
			// Use require for Anthropic SDK for compatibility
			// @ts-ignore

			const AnthropicClass = require('@anthropic-ai/sdk');
			const anthropic = new AnthropicClass({ apiKey });
			return new AnthropicService(
				anthropic,
				config.model,
				mcpManager,
				contextManager,
				config.maxIterations,
				unifiedToolManager
			);
		}
		case 'ollama': {
			const baseURL = getOpenAICompatibleBaseURL(config);
			// Use require for OpenAI SDK for compatibility
			// @ts-ignore

			const OpenAIClass = require('openai');
			// Ollama uses OpenAI-compatible API but runs locally
			const openai = new OpenAIClass({
				apiKey: 'not-required', // Ollama doesn't require an API key
				baseURL,
			});
			return new OllamaService(
				openai,
				config.model,
				mcpManager,
				contextManager,
				config.maxIterations,
				unifiedToolManager
			);
		}
		case 'aws': {
			return new AwsService(
				config.model,
				mcpManager,
				contextManager,
				unifiedToolManager,
				config.maxIterations,
				config.aws
			);
		}
		case 'azure': {
			return new AzureService(
				config.model,
				mcpManager,
				contextManager,
				unifiedToolManager,
				config.maxIterations,
				config.azure
			);
		}
		case 'qwen': {
			// QwenService: OpenAI-compatible endpoint for Alibaba Cloud Qwen
			// Accepts Qwen-specific options via config.qwenOptions
			// Default endpoint: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
			const baseURL = config.baseURL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
			// Use require for OpenAI SDK for compatibility
			// @ts-ignore

			const OpenAIClass = require('openai');
			const openai = new OpenAIClass({ apiKey, baseURL });
			const qwenOptions: QwenOptions = {
				...(config.qwenOptions?.enableThinking !== undefined && {
					enableThinking: config.qwenOptions.enableThinking,
				}),
				...(config.qwenOptions?.thinkingBudget !== undefined && {
					thinkingBudget: config.qwenOptions.thinkingBudget,
				}),
				...(config.qwenOptions?.temperature !== undefined && {
					temperature: config.qwenOptions.temperature,
				}),
				...(config.qwenOptions?.top_p !== undefined && { top_p: config.qwenOptions.top_p }),
			};
			return new QwenService(
				openai,
				config.model,
				mcpManager,
				contextManager,
				config.maxIterations,
				qwenOptions,
				unifiedToolManager
			);
		}
		case 'gemini': {
			logger.debug('Creating Gemini service', { model: config.model, hasApiKey: !!apiKey });
			try {
				return new GeminiService(
					apiKey,
					config.model,
					mcpManager,
					contextManager,
					config.maxIterations,
					unifiedToolManager
				);
			} catch (error) {
				logger.error('Failed to create Gemini service', {
					error: error instanceof Error ? error.message : String(error),
					model: config.model,
				});
				throw error;
			}
		}
		default:
			throw new Error(`Unsupported LLM provider: ${config.provider}`);
	}
}

export function createLLMService(
	config: LLMConfig,
	mcpManager: MCPManager,
	contextManager: ContextManager,
	unifiedToolManager?: UnifiedToolManager
): ILLMService {
	const service = _createLLMService(config, mcpManager, contextManager, unifiedToolManager);
	// Configure token-aware compression for the context manager
	configureCompressionForService(config, contextManager);

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
		gemini: {
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
		ollama: {
			default: 8192, // Conservative default for local models
		},
		openrouter: {
			default: 8192, // Varies by model, conservative default
		},
	};

	const providerDefaults = defaults[provider];
	if (!providerDefaults) {
		return 8192; // Global fallback
	}

	return providerDefaults[model || 'default'] || providerDefaults.default || 8192;
}
