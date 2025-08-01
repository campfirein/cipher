import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { logger } from '@core/logger/index.js';

export function createSearchRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /api/search/messages
	 * Search messages across sessions
	 */
	router.get('/messages', async (req: Request, res: Response) => {
		try {
			const { 
				query, 
				sessionId, 
				role, 
				limit = 50, 
				offset = 0 
			} = req.query;

			if (!query || typeof query !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Query parameter is required',
					400,
					undefined,
					req.requestId
				);
			}

			logger.info('Searching messages', {
				requestId: req.requestId,
				query,
				sessionId,
				role,
				limit,
				offset,
			});

			// Build search options
			const searchOptions: any = {
				limit: parseInt(limit as string, 10),
				offset: parseInt(offset as string, 10),
			};

			if (sessionId && typeof sessionId === 'string') {
				searchOptions.sessionId = sessionId;
			}

			if (role && typeof role === 'string') {
				searchOptions.role = role;
			}

			// Perform search using agent
			const results = await agent.searchMessages(query, searchOptions);

			successResponse(
				res,
				{
					results,
					query,
					options: searchOptions,
					total: results.length,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Message search failed', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Message search failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/search/sessions
	 * Search sessions containing query
	 */
	router.get('/sessions', async (req: Request, res: Response) => {
		try {
			const { query } = req.query;

			if (!query || typeof query !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Query parameter is required',
					400,
					undefined,
					req.requestId
				);
			}

			logger.info('Searching sessions', {
				requestId: req.requestId,
				query,
			});

			// Perform session search using agent
			const results = await agent.searchSessions(query);

			successResponse(
				res,
				{
					results,
					query,
					total: results.length,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Session search failed', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Session search failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	return router;
}