let vi: any;
try {
	vi = require('vitest').vi;
} catch {
	vi = { fn: (impl: any) => impl };
}
import type { InternalMessage } from '../../types.js';

export function makeFakeMessage(
	i = 0,
	role: 'user' | 'assistant' | 'system' | 'tool' = 'user'
): InternalMessage {
	return { role, content: `msg${i}` };
}

export function makeFakeMessages(
	count = 10,
	role: 'user' | 'assistant' | 'system' | 'tool' = 'user'
): InternalMessage[] {
	return Array.from({ length: count }, (_, i) => makeFakeMessage(i, role));
}

export function makeFakeSessionId(i = 0): string {
	return `session-${i}`;
}

export function makeMockHistoryProvider(): any {
	return {
		getHistory: vi.fn(async () => []),
		saveMessage: vi.fn(async () => {}),
		clearHistory: vi.fn(async () => {}),
	};
}
