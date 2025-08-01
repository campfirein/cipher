import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { validateLlmConfig } from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

export function createLlmRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /api/llm/config
	 * Alias for /api/llm/current - Get current LLM configuration
	 */
	router.get('/config', async (req: Request, res: Response) => {
		return getCurrentLLMConfig(req, res, agent);
	});

	/**
	 * PUT /api/llm/config
	 * Update LLM configuration (alias for /switch)
	 */
	router.put('/config', validateLlmConfig, async (req: Request, res: Response) => {
		return switchLLMConfig(req, res, agent);
	});

	/**
	 * GET /api/llm/current
	 * Get current LLM configuration
	 */
	router.get('/current', async (req: Request, res: Response) => {
		return getCurrentLLMConfig(req, res, agent);
	});

	/**
	 * GET /api/llm/providers
	 * List available LLM providers and models
	 */
	router.get('/providers', async (req: Request, res: Response) => {
		try {
			logger.info('Getting available LLM providers', { requestId: req.requestId });

			// Define available providers and their common models
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
		return switchLLMConfig(req, res, agent);
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

/**
 * Handler for getting current LLM configuration
 */
async function getCurrentLLMConfig(req: Request, res: Response, agent: MemAgent): Promise<void> {
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
}

/**
 * Handler for switching LLM configuration
 */
async function switchLLMConfig(req: Request, res: Response, agent: MemAgent): Promise<void> {
	try {
		const { provider, model, config, sessionId } = req.body;

		logger.info('Switching LLM configuration', {
			requestId: req.requestId,
			provider,
			model,
			sessionId,
		});

		// Build LLM config object
		const llmConfig: any = {
			provider,
			model,
			...config,
		};

		// Call agent.switchLLM with the new configuration
		await agent.switchLLM(llmConfig, sessionId);

		// Get updated configuration to return
		const updatedConfig = agent.getCurrentLLMConfig();

		// Redact sensitive information
		const sanitizedConfig = {
			...updatedConfig,
			apiKey: updatedConfig.apiKey ? '***' : undefined,
		};

		successResponse(
			res,
			{
				message: 'LLM configuration updated successfully',
				llmConfig: sanitizedConfig,
				timestamp: new Date().toISOString(),
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
}