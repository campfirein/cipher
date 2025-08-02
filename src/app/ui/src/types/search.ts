/**
 * Search Types for Cipher WebUI
 * Based on Saiki WebUI architecture
 */

export interface SearchResult {
	sessionId: string;
	messageIndex: number;
	message: {
		role: 'user' | 'assistant' | 'system' | 'tool';
		content: string;
	};
	matchedText: string;
	context: string;
	score: number;
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	hasMore: boolean;
	query: string;
}

export interface SessionSearchResult {
	sessionId: string;
	matchCount: number;
	firstMatch: {
		messageIndex: number;
		context: string;
	};
	metadata: {
		messageCount: number;
		createdAt: number;
		lastActivity: number;
	};
}

export interface SessionSearchResponse {
	results: SessionSearchResult[];
	total: number;
	hasMore: boolean;
	query: string;
}

export type SearchMode = 'messages' | 'sessions';

export interface SearchOptions {
	sessionId?: string;
	role?: 'user' | 'assistant' | 'system' | 'tool';
	limit?: number;
	offset?: number;
}
