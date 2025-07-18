import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { errorResponse, ERROR_CODES } from '../utils/response.js';
import { sanitizeInput, isValidSessionId } from '../utils/security.js';

/**
 * Middleware to check validation results and return error if validation failed
 */
export function handleValidationErrors(req: Request, res: Response, next: NextFunction): void {
	const errors = validationResult(req);

	if (!errors.isEmpty()) {
		errorResponse(
			res,
			ERROR_CODES.VALIDATION_ERROR,
			'Validation failed',
			400,
			errors.array(),
			req.requestId
		);
		return;
	}

	next();
}

/**
 * Sanitize text input middleware
 */
export function sanitizeTextInput(fields: string[]) {
	return (req: Request, res: Response, next: NextFunction): void => {
		for (const field of fields) {
			if (req.body[field] && typeof req.body[field] === 'string') {
				req.body[field] = sanitizeInput(req.body[field]);
			}
		}
		next();
	};
}

// Validation schemas for different endpoints

/**
 * Message processing validation
 */
export const validateMessageRequest = [
	body('message')
		.isString()
		.isLength({ min: 1, max: 50000 })
		.withMessage('Message must be a string between 1 and 50000 characters'),
	body('sessionId')
		.optional()
		.custom(value => {
			if (value && !isValidSessionId(value)) {
				throw new Error('Invalid session ID format');
			}
			return true;
		}),
	body('images').optional().isArray().withMessage('Images must be an array'),
	body('images.*').optional().isString().withMessage('Each image must be a base64 string'),
	sanitizeTextInput(['message']),
	handleValidationErrors,
];

/**
 * Session ID parameter validation
 */
export const validateSessionId = [
	param('sessionId').custom(value => {
		if (!isValidSessionId(value)) {
			throw new Error('Invalid session ID format');
		}
		return true;
	}),
	handleValidationErrors,
];

/**
 * Session creation validation
 */
export const validateCreateSession = [
	body('sessionId')
		.optional()
		.custom(value => {
			if (value && !isValidSessionId(value)) {
				throw new Error('Invalid session ID format');
			}
			return true;
		}),
	body('config').optional().isObject().withMessage('Config must be an object'),
	handleValidationErrors,
];

/**
 * MCP server configuration validation
 */
export const validateMcpServerConfig = [
	body('name')
		.isString()
		.isLength({ min: 1, max: 100 })
		.withMessage('Server name must be between 1 and 100 characters'),
	body('command').optional().isString().withMessage('Command must be a string'),
	body('args').optional().isArray().withMessage('Args must be an array'),
	body('env').optional().isObject().withMessage('Environment must be an object'),
	body('transport')
		.optional()
		.isIn(['stdio', 'sse', 'http'])
		.withMessage('Transport must be stdio, sse, or http'),
	body('connectionMode')
		.optional()
		.isIn(['strict', 'lenient'])
		.withMessage('Connection mode must be strict or lenient'),
	sanitizeTextInput(['name', 'command']),
	handleValidationErrors,
];

/**
 * MCP server ID validation
 */
export const validateMcpServerId = [
	param('serverId')
		.isString()
		.isLength({ min: 1, max: 100 })
		.withMessage('Server ID must be between 1 and 100 characters'),
	handleValidationErrors,
];

/**
 * Tool execution validation
 */
export const validateToolExecution = [
	param('serverId')
		.isString()
		.isLength({ min: 1, max: 100 })
		.withMessage('Server ID must be between 1 and 100 characters'),
	param('toolName')
		.isString()
		.isLength({ min: 1, max: 100 })
		.withMessage('Tool name must be between 1 and 100 characters'),
	body('arguments').optional().isObject().withMessage('Arguments must be an object'),
	handleValidationErrors,
];

/**
 * LLM configuration validation
 */
export const validateLlmConfig = [
	body('provider')
		.isString()
		.isIn(['openai', 'anthropic', 'openrouter', 'ollama', 'gemini'])
		.withMessage('Provider must be one of: openai, anthropic, openrouter, ollama, gemini'),
	body('model')
		.isString()
		.isLength({ min: 1, max: 100 })
		.withMessage('Model must be between 1 and 100 characters'),
	body('config').optional().isObject().withMessage('Config must be an object'),
	sanitizeTextInput(['provider', 'model']),
	handleValidationErrors,
];

/**
 * Query parameter validation
 */
export const validateListParams = [
	query('limit')
		.optional()
		.isInt({ min: 1, max: 100 })
		.withMessage('Limit must be between 1 and 100'),
	query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
	handleValidationErrors,
];
