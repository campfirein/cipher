import { InternalMessage } from '../types.js';

/**
 * Interface for conversation history providers (database-backed, in-memory, etc.)
 */
export interface IConversationHistoryProvider {
	/**
	 * Retrieve conversation history for a session, ordered chronologically (oldest first).
	 * @param sessionId - The session identifier
	 * @param limit - Optional maximum number of messages to return (default: 1000)
	 * @returns Promise resolving to an array of InternalMessage objects
	 */
	getHistory(sessionId: string, limit?: number): Promise<InternalMessage[]>;

	/**
	 * Save a message to the conversation history for a session.
	 * @param sessionId - The session identifier
	 * @param message - The message to save
	 */
	saveMessage(sessionId: string, message: InternalMessage): Promise<void>;

	/**
	 * Clear all conversation history for a session.
	 * @param sessionId - The session identifier
	 */
	clearHistory(sessionId: string): Promise<void>;
}
