// Conversation history provider interface for persistent storage
import type { InternalMessage } from '../types.js';

export interface IConversationHistoryProvider {
	getHistory(sessionId: string, limit?: number): Promise<InternalMessage[]>;
	saveMessage(sessionId: string, message: InternalMessage): Promise<void>;
	clearHistory(sessionId: string): Promise<void>;
}
