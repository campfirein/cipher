import { IConversationHistoryProvider } from './types.js';
import { InternalMessage } from '../types.js';
import { StorageManager } from '../../../../storage/manager.js';
import { logger } from '../../../../logger/index.js';

const MESSAGE_LIMIT = 1000;
const STORAGE_KEY_PREFIX = 'messages:';
const LOG_TRUNCATE_LENGTH = 100;

/**
 * Truncate content for safe debug logging.
 * Redacts objects/arrays and truncates long strings.
 */
function truncateContent(content: any): string {
	if (typeof content === 'string') {
		return content.length > LOG_TRUNCATE_LENGTH
			? content.slice(0, LOG_TRUNCATE_LENGTH) + '...'
			: content;
	}
	if (Array.isArray(content)) {
		return '[Array content]';
	}
	if (content && typeof content === 'object') {
		// Redact known sensitive fields
		const redacted = { ...content };
		for (const key of Object.keys(redacted)) {
			if (/key|token|secret|password|auth/i.test(key)) {
				redacted[key] = '***REDACTED***';
			}
		}
		return '[Object content]';
	}
	return String(content);
}

/**
 * Database-backed conversation history provider (stateless, sessionId always required).
 * Compatible with any StorageManager backend.
 */
export class DatabaseHistoryProvider implements IConversationHistoryProvider {
	private storageManager: StorageManager;

	constructor(storageManager: StorageManager) {
		this.storageManager = storageManager;
		// Runtime check for backend compatibility
		const backends = this.storageManager.getBackends();
		if (
			!backends ||
			typeof backends.database?.get !== 'function' ||
			typeof backends.database?.set !== 'function'
		) {
			throw new Error(
				'DatabaseHistoryProvider: StorageManager database backend is not compatible.'
			);
		}
	}

	private getKey(sessionId: string): string {
		return `${STORAGE_KEY_PREFIX}${sessionId}`;
	}

	/**
	 * Retrieve up to the most recent `limit` messages for a session, in chronological order (oldest to newest).
	 */
	async getHistory(sessionId: string, limit: number = MESSAGE_LIMIT): Promise<InternalMessage[]> {
		const key = this.getKey(sessionId);
		try {
			const backends = this.storageManager.getBackends();
			const messages: InternalMessage[] = (await backends?.database.get(key)) || [];
			// Always return oldest to newest, up to limit
			return messages.slice(-limit);
		} catch (err) {
			logger.error(
				`DatabaseHistoryProvider.getHistory failed for session ${sessionId}: ${(err as Error).message}`
			);
			return [];
		}
	}

	/**
	 * Save a message to the session's history, enforcing message limit and order.
	 */
	async saveMessage(sessionId: string, message: InternalMessage): Promise<void> {
		const key = this.getKey(sessionId);
		try {
			const backends = this.storageManager.getBackends();
			const messages: InternalMessage[] = (await backends?.database.get(key)) || [];
			messages.push(message); // Append (chronological)
			// Enforce message limit (keep only the most recent MESSAGE_LIMIT)
			const trimmed = messages.slice(-MESSAGE_LIMIT);
			await backends?.database.set(key, trimmed);
			logger.debug(`Saved message to session ${sessionId}: ${truncateContent(message.content)}`);
		} catch (err) {
			logger.error(
				`DatabaseHistoryProvider.saveMessage failed for session ${sessionId}: ${(err as Error).message}`
			);
		}
	}

	/**
	 * Clear all conversation history for a session.
	 */
	async clearHistory(sessionId: string): Promise<void> {
		const key = this.getKey(sessionId);
		try {
			const backends = this.storageManager.getBackends();
			await backends?.database.delete(key);
			logger.info(`Cleared conversation history for session ${sessionId}`);
		} catch (err) {
			logger.error(
				`DatabaseHistoryProvider.clearHistory failed for session ${sessionId}: ${(err as Error).message}`
			);
		}
	}
}
