import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { LLMConfig } from '../config.js';
import { ILLMService } from './types.js';
import { env } from '../../../env.js';
import OpenAI from 'openai';
import { logger } from '../../../logger/index.js';
import Anthropic from '@anthropic-ai/sdk';
import { OpenAIService } from './openai.js';
import { AnthropicService } from './anthropic.js';
import { OpenRouterService } from './openrouter.js';
import { OllamaService } from './ollama.js';
import { AwsService } from './aws.js';
import { AzureService } from './azure.js';

function extractApiKey(config: LLMConfig): string {
	const provider = config.provider.toLowerCase();

	// These providers don't require traditional API keys
	if (provider === 'ollama' || provider === 'aws' || provider === 'azure') {
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
			// This will correctly handle both cases:
			// 1. When baseURL is set, it will be included in the options
			// 2. When baseURL is undefined/null/empty, the spread operator won't add the baseURL property
			const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
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
			// OpenRouter uses OpenAI-compatible API but with specific headers
			const openai = new OpenAI({
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
		case 'anthropic': {
			const anthropic = new Anthropic({ apiKey });
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
			// Ollama uses OpenAI-compatible API but runs locally
			const openai = new OpenAI({
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
	return _createLLMService(config, mcpManager, contextManager, unifiedToolManager);
}
