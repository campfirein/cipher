/**
 * Safe Embedding Operations
 *
 * Provides safe wrappers for embedding operations that gracefully handle
 * failures and provide meaningful error messages for fallback scenarios.
 */

import { logger } from '../../logger/index.js';
import { LOG_PREFIXES } from './constants.js';

export interface SafeOperationResult<T> {
	success: boolean;
	data?: T | undefined;
	error?: string;
	fallbackActivated: boolean;
}

/**
 * Safe wrapper for embedding operations that may fail
 */
export async function safeEmbeddingOperation<T>(
	operation: () => Promise<T>,
	operationName: string,
	fallbackValue?: T
): Promise<SafeOperationResult<T>> {
	try {
		const result = await operation();
		return {
			success: true,
			data: result,
			fallbackActivated: false,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Check if this is a fallback scenario (embedding temporarily unavailable)
		const isFallbackScenario =
			errorMessage.includes('temporarily unavailable') ||
			errorMessage.includes('chat-only mode') ||
			errorMessage.includes('Circuit breaker OPEN') ||
			errorMessage.includes('embeddings disabled');

		if (isFallbackScenario) {
			logger.debug(`${LOG_PREFIXES.FALLBACK} ${operationName} skipped due to embedding fallback`, {
				reason: errorMessage,
				fallbackValue: fallbackValue !== undefined,
			});

			return {
				success: fallbackValue !== undefined,
				data: fallbackValue,
				error: errorMessage,
				fallbackActivated: true,
			};
		}

		// This is a real error, not a fallback scenario
		logger.error(`${LOG_PREFIXES.FALLBACK} ${operationName} failed with error`, {
			error: errorMessage,
		});

		return {
			success: false,
			error: errorMessage,
			fallbackActivated: false,
		};
	}
}

/**
 * Safe wrapper for vector store operations
 */
export async function safeVectorStoreOperation<T>(
	operation: () => Promise<T>,
	operationName: string,
	_fallbackMessage?: string
): Promise<SafeOperationResult<T>> {
	return safeEmbeddingOperation(operation, `Vector store ${operationName}`, undefined);
}

/**
 * Safe wrapper for memory operations with user-friendly fallback messages
 */
export async function safeMemoryOperation<T>(
	operation: () => Promise<T>,
	operationName: string,
	userFriendlyFallback: string
): Promise<SafeOperationResult<T>> {
	const result = await safeEmbeddingOperation(operation, operationName);

	if (result.fallbackActivated) {
		// Override with user-friendly message
		return {
			...result,
			error: userFriendlyFallback,
		};
	}

	return result;
}

/**
 * Check if an error indicates embedding fallback mode
 */
export function isEmbeddingFallbackError(error: any): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes('temporarily unavailable') ||
		message.includes('chat-only mode') ||
		message.includes('Circuit breaker OPEN') ||
		message.includes('embeddings disabled') ||
		message.includes('embedding-dependent tools will be disabled')
	);
}

/**
 * Get user-friendly error message for embedding fallback
 */
export function getFriendlyFallbackMessage(operationType: string): string {
	const messages = {
		search:
			'Memory search is temporarily unavailable. The system is operating in chat-only mode. Your conversation history is still maintained.',
		store:
			'Memory storage is temporarily unavailable. The system is operating in chat-only mode. Your current conversation will continue normally.',
		reasoning:
			'Reasoning pattern analysis is temporarily unavailable. The system is operating in chat-only mode with basic conversation capabilities.',
		knowledge:
			'Knowledge graph operations are temporarily unavailable. The system is operating in chat-only mode.',
		default:
			'This feature is temporarily unavailable due to embedding service issues. The system is operating in chat-only mode.',
	};

	return messages[operationType as keyof typeof messages] || messages.default;
}

/**
 * Log embedding status for debugging
 */
export function logEmbeddingStatus(embeddingManager?: any): void {
	if (!embeddingManager) {
		logger.debug(
			`${LOG_PREFIXES.FALLBACK} No embedding manager available - operating in chat-only mode`
		);
		return;
	}

	try {
		const hasAvailable = embeddingManager.hasAvailableEmbeddings?.();
		const status = embeddingManager.getEmbeddingStatus?.();

		logger.debug(`${LOG_PREFIXES.FALLBACK} Embedding status check`, {
			hasAvailableEmbeddings: hasAvailable,
			embeddingStatus: status,
		});
	} catch (error) {
		logger.debug(`${LOG_PREFIXES.FALLBACK} Could not get embedding status`, {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
