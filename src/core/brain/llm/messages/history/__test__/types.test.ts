import { describe, it, expect } from 'vitest';
import type { IConversationHistoryProvider } from '../types.js';

describe('IConversationHistoryProvider interface', () => {
	it('should define required methods', () => {
		const provider: IConversationHistoryProvider = {
			getHistory: async () => [],
			saveMessage: async () => {},
			clearHistory: async () => {},
		};
		expect(typeof provider.getHistory).toBe('function');
		expect(typeof provider.saveMessage).toBe('function');
		expect(typeof provider.clearHistory).toBe('function');
	});
});
