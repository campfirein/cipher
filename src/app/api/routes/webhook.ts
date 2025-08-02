import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { logger } from '@core/logger/index.js';
import { randomUUID } from 'crypto';

// Simple in-memory webhook storage (in production, this should be persistent)
interface WebhookData {
	id: string;
	url: string;
	events: string[];
	active: boolean;
	createdAt: string;
	lastTriggered?: string;
}

const webhooks = new Map<string, WebhookData>();

export function createWebhookRoutes(_agent: MemAgent): Router {
	const router = Router();

	/**
	 * POST /api/webhooks
	 * Register webhook endpoint
	 */
	router.post('/', async (req: Request, res: Response) => {
		try {
			const { url, events = ['*'] } = req.body;

			if (!url || typeof url !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'URL parameter is required',
					400,
					undefined,
					req.requestId
				);
			}

			// Validate URL format
			try {
				new URL(url);
			} catch {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Invalid URL format',
					400,
					undefined,
					req.requestId
				);
			}

			// Generate unique webhook ID
			const webhookId = randomUUID();

			const webhookData: WebhookData = {
				id: webhookId,
				url,
				events: Array.isArray(events) ? events : ['*'],
				active: true,
				createdAt: new Date().toISOString(),
			};

			webhooks.set(webhookId, webhookData);

			logger.info('Webhook registered', {
				requestId: req.requestId,
				webhookId,
				url,
				events: webhookData.events,
			});

			successResponse(
				res,
				{
					webhook: webhookData,
					message: 'Webhook registered successfully',
				},
				201,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Webhook registration failed', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Webhook registration failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/webhooks
	 * List registered webhooks
	 */
	router.get('/', async (req: Request, res: Response) => {
		try {
			const webhookList = Array.from(webhooks.values());

			logger.info('Listing webhooks', {
				requestId: req.requestId,
				count: webhookList.length,
			});

			successResponse(
				res,
				{
					webhooks: webhookList,
					total: webhookList.length,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to list webhooks', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to list webhooks: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/webhooks/:webhookId
	 * Get specific webhook details
	 */
	router.get('/:webhookId', async (req: Request, res: Response) => {
		try {
			const { webhookId } = req.params;

			if (!webhookId) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Webhook ID is required',
					400,
					undefined,
					req.requestId
				);
			}

			const webhook = webhooks.get(webhookId);
			if (!webhook) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					`Webhook ${webhookId} not found`,
					404,
					undefined,
					req.requestId
				);
			}

			logger.info('Retrieved webhook details', {
				requestId: req.requestId,
				webhookId,
			});

			successResponse(
				res,
				{
					webhook,
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get webhook details', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get webhook details: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * DELETE /api/webhooks/:webhookId
	 * Remove webhook
	 */
	router.delete('/:webhookId', async (req: Request, res: Response) => {
		try {
			const { webhookId } = req.params;

			if (!webhookId) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Webhook ID is required',
					400,
					undefined,
					req.requestId
				);
			}

			const webhook = webhooks.get(webhookId);
			if (!webhook) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					`Webhook ${webhookId} not found`,
					404,
					undefined,
					req.requestId
				);
			}

			webhooks.delete(webhookId);

			logger.info('Webhook removed', {
				requestId: req.requestId,
				webhookId,
			});

			successResponse(
				res,
				{
					message: `Webhook ${webhookId} removed successfully`,
					webhookId,
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to remove webhook', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to remove webhook: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/webhooks/:webhookId/test
	 * Test webhook endpoint
	 */
	router.post('/:webhookId/test', async (req: Request, res: Response) => {
		try {
			const { webhookId } = req.params;

			if (!webhookId) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Webhook ID is required',
					400,
					undefined,
					req.requestId
				);
			}

			const webhook = webhooks.get(webhookId);
			if (!webhook) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					`Webhook ${webhookId} not found`,
					404,
					undefined,
					req.requestId
				);
			}

			// Perform test HTTP request to webhook URL
			const testPayload = {
				event: 'webhook_test',
				data: {
					message: 'This is a test webhook call from Cipher',
					timestamp: new Date().toISOString(),
					webhookId,
				},
				source: 'cipher-agent',
			};

			try {
				const response = await fetch(webhook.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'User-Agent': 'Cipher-Agent-Webhook/1.0',
					},
					body: JSON.stringify(testPayload),
				});

				// Update last triggered time
				webhook.lastTriggered = new Date().toISOString();
				webhooks.set(webhookId, webhook);

				logger.info('Webhook test completed', {
					requestId: req.requestId,
					webhookId,
					status: response.status,
					ok: response.ok,
				});

				successResponse(
					res,
					{
						message: 'Webhook test completed',
						webhookId,
						testResult: {
							status: response.status,
							ok: response.ok,
							url: webhook.url,
							timestamp: new Date().toISOString(),
						},
					},
					200,
					req.requestId
				);
			} catch (fetchError) {
				logger.error('Webhook test failed', {
					requestId: req.requestId,
					webhookId,
					error: fetchError instanceof Error ? fetchError.message : String(fetchError),
				});

				successResponse(
					res,
					{
						message: 'Webhook test completed with error',
						webhookId,
						testResult: {
							status: 0,
							ok: false,
							error: fetchError instanceof Error ? fetchError.message : String(fetchError),
							url: webhook.url,
							timestamp: new Date().toISOString(),
						},
					},
					200, // Still return 200 as the test was executed
					req.requestId
				);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to test webhook', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to test webhook: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	return router;
}
