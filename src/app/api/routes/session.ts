import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import {
	validateSessionId,
	validateCreateSession,
	validateListParams,
} from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

export function createSessionRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /api/sessions
	 * List all active sessions with metadata
	 */
	router.get('/', validateListParams, async (req: Request, res: Response) => {
		try {
			logger.info('Listing sessions', { requestId: req.requestId });

			const sessionIds = await agent.listSessions();
			const sessions = [];

			for (const sessionId of sessionIds) {
				const metadata = await agent.getSessionMetadata(sessionId);
				if (metadata) {
					sessions.push(metadata);
				}
			}

			successResponse(
				res,
				{
					sessions,
					count: sessions.length,
					currentSession: agent.getCurrentSessionId(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to list sessions', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to list sessions: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/sessions
	 * Create a new session
	 */
	router.post('/', validateCreateSession, async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.body;

			logger.info('Creating new session', {
				requestId: req.requestId,
				sessionId: sessionId || 'auto-generated',
			});

			const session = await agent.createSession(sessionId);

			successResponse(
				res,
				{
					session: {
						id: session.id,
						// Only include serializable session properties
						createdAt: new Date().toISOString(),
					},
					created: true,
					timestamp: new Date().toISOString(),
				},
				201,
				req.requestId
			);
		} catch (error) {
			// Safely extract error message to avoid circular reference issues
			let errorMsg: string;
			try {
				errorMsg = error instanceof Error ? error.message : String(error);
			} catch (stringifyError) {
				errorMsg = 'Unknown error occurred during session creation';
			}

			logger.error('Failed to create session', {
				requestId: req.requestId,
				error: errorMsg,
			});

			// Check if error is due to duplicate session ID
			if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					`Session creation failed: ${errorMsg}`,
					400,
					undefined,
					req.requestId
				);
			} else {
				errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					`Failed to create session: ${errorMsg}`,
					500,
					undefined,
					req.requestId
				);
			}
		}
	});

	/**
	 * GET /api/sessions/current
	 * Get current working session
	 */
	router.get('/current', async (req: Request, res: Response) => {
		try {
			const currentSessionId = agent.getCurrentSessionId();
			const metadata = await agent.getSessionMetadata(currentSessionId);

			if (!metadata) {
				errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					'Current session not found',
					404,
					undefined,
					req.requestId
				);
				return;
			}

			successResponse(
				res,
				{
					sessionId: currentSessionId,
					metadata,
					isCurrent: true,
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get current session', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get current session: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/sessions/:sessionId
	 * Get session details
	 */
	router.get('/:sessionId', validateSessionId, async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.params;

			if (!sessionId) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Session ID is required',
					400,
					undefined,
					req.requestId
				);
				return;
			}

			logger.info('Getting session details', {
				requestId: req.requestId,
				sessionId,
			});

			const session = await agent.getSession(sessionId);
			if (!session) {
				errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session ${sessionId} not found`,
					404,
					undefined,
					req.requestId
				);
				return;
			}

			const metadata = await agent.getSessionMetadata(sessionId);

			successResponse(
				res,
				{
					sessionId,
					metadata,
					isCurrent: sessionId === agent.getCurrentSessionId(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get session details', {
				requestId: req.requestId,
				sessionId: req.params.sessionId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get session details: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/sessions/:sessionId/load
	 * Load session as current
	 */
	router.post('/:sessionId/load', validateSessionId, async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.params;

			if (!sessionId) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Session ID is required',
					400,
					undefined,
					req.requestId
				);
				return;
			}

			logger.info('Loading session', {
				requestId: req.requestId,
				sessionId,
			});

			const session = await agent.loadSession(sessionId);

			successResponse(
				res,
				{
					sessionId: session.id,
					loaded: true,
					currentSession: agent.getCurrentSessionId(),
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to load session', {
				requestId: req.requestId,
				sessionId: req.params.sessionId,
				error: errorMsg,
			});

			if (errorMsg.includes('not found')) {
				errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session ${req.params.sessionId} not found`,
					404,
					undefined,
					req.requestId
				);
			} else {
				errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					`Failed to load session: ${errorMsg}`,
					500,
					undefined,
					req.requestId
				);
			}
		}
	});

	/**
	 * GET /api/sessions/:sessionId/history
	 * Get session conversation history
	 */
	router.get('/:sessionId/history', validateSessionId, async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.params;

			if (!sessionId) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Session ID is required',
					400,
					undefined,
					req.requestId
				);
				return;
			}

			logger.info('Getting session history', {
				requestId: req.requestId,
				sessionId,
			});

			const session = await agent.getSession(sessionId);
			if (!session) {
				errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session ${sessionId} not found`,
					404,
					undefined,
					req.requestId
				);
				return;
			}

			const history = await agent.getSessionHistory(sessionId);

			successResponse(
				res,
				{
					sessionId,
					history,
					count: history.length,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get session history', {
				requestId: req.requestId,
				sessionId: req.params.sessionId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get session history: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * DELETE /api/sessions/:sessionId
	 * Delete session
	 */
	router.delete('/:sessionId', validateSessionId, async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.params;

			if (!sessionId) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Session ID is required',
					400,
					undefined,
					req.requestId
				);
				return;
			}

			logger.info('Deleting session', {
				requestId: req.requestId,
				sessionId,
			});

			const success = await agent.removeSession(sessionId);

			if (!success) {
				errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session ${sessionId} not found`,
					404,
					undefined,
					req.requestId
				);
				return;
			}

			successResponse(
				res,
				{
					sessionId,
					deleted: true,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to delete session', {
				requestId: req.requestId,
				sessionId: req.params.sessionId,
				error: errorMsg,
			});

			if (errorMsg.includes('Cannot remove the currently active session')) {
				errorResponse(
					res,
					ERROR_CODES.BAD_REQUEST,
					'Cannot delete the currently active session. Switch to another session first.',
					400,
					undefined,
					req.requestId
				);
			} else {
				errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					`Failed to delete session: ${errorMsg}`,
					500,
					undefined,
					req.requestId
				);
			}
		}
	});

	return router;
}
