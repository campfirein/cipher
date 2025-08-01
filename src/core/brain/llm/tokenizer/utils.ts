import { TokenCount } from './types.js';
import { InternalMessage } from '../messages/types.js';
import { logger } from '../../../logger/index.js';

/**
 * Extract text content from various message content formats
 */
export function extractTextFromMessage(message: InternalMessage): string {
	if (typeof message.content === 'string') {
		return message.content;
	}

	if (Array.isArray(message.content)) {
		return message.content
			.filter(part => part.type === 'text')
			.map(part => part.text)
			.join(' ');
	}

	return '';
}

/**
 * Calculate approximate token count using character-based estimation
 * Uses the common approximation of 4 characters per token for English text
 */
export function estimateTokensFromText(text: string): number {
	if (!text) return 0;

	// More sophisticated estimation that accounts for:
	// - Average English word length
	// - Punctuation and whitespace
	// - Code vs natural language patterns

	const words = text.split(/\s+/).filter(word => word.length > 0);
	const avgCharsPerToken = 4;

	// Adjust for different content types
	let adjustment = 1.0;

	// Code-like content (lots of symbols, shorter words)
	if (text.includes('{') && text.includes('}') && text.includes(';')) {
		adjustment = 0.8; // Code tends to have more tokens per character
	}

	// Very short words (common in code/structured data)
	const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / (words.length || 1);
	if (avgWordLength < 3) {
		adjustment = 0.7;
	}

	return Math.ceil((text.length / avgCharsPerToken) * adjustment);
}

/**
 * Combine multiple token counts
 */
export function combineTokenCounts(counts: TokenCount[]): TokenCount {
	if (counts.length === 0) {
		return {
			total: 0,
			characters: 0,
			estimated: true,
			provider: 'unknown',
			model: 'unknown',
		};
	}

	const combined: TokenCount = counts.reduce(
		(acc, count) => ({
			total: acc.total + count.total,
			characters: acc.characters + count.characters,
			estimated: acc.estimated || count.estimated,
			provider: acc.provider || count.provider,
			model: acc.model || count.model,
		}),
		{
			total: 0,
			characters: 0,
			estimated: false,
			provider: '',
			model: '',
		}
	);

	return combined;
}

/**
 * Format token count for logging
 */
export function formatTokenCount(count: TokenCount): string {
	const estimated = count.estimated ? ' (estimated)' : '';
	const model = count.model ? ` [${count.model}]` : '';
	return `${count.total} tokens${estimated}${model}`;
}

/**
 * Calculate token density (tokens per character) for calibration
 */
export function calculateTokenDensity(text: string, actualTokens: number): number {
	if (!text || actualTokens <= 0) return 0.25; // Default density
	return actualTokens / text.length;
}

/**
 * Validate token count result
 */
export function validateTokenCount(count: TokenCount): boolean {
	return (
		typeof count.total === 'number' &&
		count.total >= 0 &&
		typeof count.characters === 'number' &&
		count.characters >= 0 &&
		typeof count.estimated === 'boolean' &&
		typeof count.provider === 'string' &&
		count.provider.length > 0
	);
}

/**
 * Create a basic token count for fallback scenarios
 */
export function createFallbackTokenCount(
	text: string,
	provider: string,
	model: string = 'unknown'
): TokenCount {
	const estimated = estimateTokensFromText(text);
	return {
		total: estimated,
		characters: text.length,
		estimated: true,
		provider,
		model,
	};
}

/**
 * Log token counting operation
 */
export function logTokenCount(operation: string, count: TokenCount, context?: any): void {
	logger.info(`Token counting: ${operation}`, {
		...count,
		formatted: formatTokenCount(count),
		...context,
	});
}
