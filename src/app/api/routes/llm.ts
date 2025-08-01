import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { validateLlmConfig } from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

export function createLlmRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /api/llm/current
	 * Get current LLM configuration
	 */
	router.get('/current', async (req: Request, res: Response) => {
		try {
			logger.info('Getting current LLM configuration', { requestId: req.requestId });

			const llmConfig = agent.getCurrentLLMConfig();

			// Redact sensitive information like API keys
			const sanitizedConfig = {
				...llmConfig,
				// Remove or mask sensitive fields
				apiKey: llmConfig.apiKey ? '***' : undefined,
				// Keep other configuration details
			};

			successResponse(
				res,
				{
					llmConfig: sanitizedConfig,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get current LLM configuration', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.LLM_ERROR,
				`Failed to get LLM configuration: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/llm/providers
	 * List available LLM providers and models
	 */
	router.get('/providers', async (req: Request, res: Response) => {
		try {
			logger.info('Getting available LLM providers', { requestId: req.requestId });

			// Define available providers and their common models
			// This could be enhanced to dynamically discover available models
			const providers = {
				openai: {
					name: 'OpenAI',
					models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
					requiresApiKey: true,
					description: 'OpenAI GPT models',
				},
				anthropic: {
					name: 'Anthropic',
					models: [
						'claude-3-5-sonnet-20241022',
						'claude-3-5-haiku-20241022',
						'claude-3-opus-20240229',
						'claude-3-sonnet-20240229',
						'claude-3-haiku-20240307',
					],
					requiresApiKey: true,
					description: 'Anthropic Claude models',
				},
				openrouter: {
					name: 'OpenRouter',
					models: [
						'openai/gpt-4o',
						'anthropic/claude-3.5-sonnet',
						'meta-llama/llama-3.1-405b-instruct',
						'google/gemini-pro-1.5',
					],
					requiresApiKey: true,
					description: 'OpenRouter unified API access',
				},
				ollama: {
					name: 'Ollama',
					models: [
						'llama3.1:latest',
						'llama3.1:8b',
						'llama3.1:70b',
						'codellama:latest',
						'mistral:latest',
						'mixtral:latest',
					],
					requiresApiKey: false,
					description: 'Local Ollama models',
					note: 'Requires Ollama server running locally',
				},
				lmstudio: {
					name: 'LM Studio',
					models: [
						'mistral-7b-instruct',
						'llama-3.1-8b-instruct',
						'codellama-7b-instruct',
						'deepseek-coder-6.7b-instruct',
					],
					requiresApiKey: false,
					description: 'Local LM Studio models',
					note: 'Requires LM Studio server running locally',
				},
			};

			successResponse(
				res,
				{
					providers,
					availableProviders: Object.keys(providers),
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get LLM providers', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.LLM_ERROR,
				`Failed to get LLM providers: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/llm/switch
	 * Switch LLM configuration
	 */
	router.post('/switch', validateLlmConfig, async (req: Request, res: Response) => {
		try {
			const { provider, model, config } = req.body;

			logger.info('Switching LLM configuration', {
				requestId: req.requestId,
				provider,
				model,
			});

			// Note: This is a placeholder implementation
			// The actual implementation would depend on how the MemAgent handles LLM switching
			// For now, we'll return a success response indicating the request was received

			// TODO: Implement actual LLM switching logic in MemAgent
			// This might involve:
			// 1. Validating the provider and model combination
			// 2. Checking if required API keys are available
			// 3. Testing the connection to the new LLM
			// 4. Updating the agent's configuration

			logger.warn('LLM switching not yet implemented in MemAgent', {
				requestId: req.requestId,
			});

			successResponse(
				res,
				{
					message: 'LLM switch request received (implementation pending)',
					requestedProvider: provider,
					requestedModel: model,
					requestedConfig: config,
					timestamp: new Date().toISOString(),
					status: 'pending',
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to switch LLM configuration', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.LLM_ERROR,
				`Failed to switch LLM: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/llm/status
	 * Get LLM connection status and health
	 */
	router.get('/status', async (req: Request, res: Response) => {
		try {
			logger.info('Getting LLM status', { requestId: req.requestId });

			const llmConfig = agent.getCurrentLLMConfig();

			// Basic status check - could be enhanced with actual health checks
			const status = {
				configured: Boolean(llmConfig.provider && llmConfig.model),
				provider: llmConfig.provider,
				model: llmConfig.model,
				healthy: true, // Placeholder - would need actual health check
				lastCheck: new Date().toISOString(),
			};

			successResponse(
				res,
				{
					status,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get LLM status', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.LLM_ERROR,
				`Failed to get LLM status: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	return router;
}
