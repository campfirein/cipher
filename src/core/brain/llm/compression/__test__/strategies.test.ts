import { describe, it, expect, beforeEach } from 'vitest';
import { MiddleRemovalStrategy } from '../strategies/middle-removal.js';
import { OldestRemovalStrategy } from '../strategies/oldest-removal.js';
import { HybridStrategy } from '../strategies/hybrid.js';
import { EnhancedInternalMessage, CompressionConfig, CompressionLevel } from '../types.js';

describe('Compression Strategies', () => {
	const baseConfig: CompressionConfig = {
		strategy: 'middle-removal',
		maxTokens: 1000,
		warningThreshold: 0.8,
		compressionThreshold: 0.9,
		preserveStart: 2,
		preserveEnd: 2,
		minMessagesToKeep: 4,
	};

	const createTestMessages = (count: number): EnhancedInternalMessage[] => {
		return Array.from({ length: count }, (_, i) => ({
			role: i === 0 ? 'system' : i % 2 === 1 ? 'user' : 'assistant',
			content: `Message ${i} content with some text to test token counting`,
			messageId: `msg_${i}`,
			timestamp: Date.now() - (count - i) * 1000,
			tokenCount: 50, // Approximate token count
			priority: i === 0 ? 'critical' : 'normal',
		}));
	};

	describe('MiddleRemovalStrategy', () => {
		let strategy: MiddleRemovalStrategy;

		beforeEach(() => {
			strategy = new MiddleRemovalStrategy(baseConfig);
		});

		it('should preserve start and end messages', async () => {
			const messages = createTestMessages(10);
			const currentTokens = 500;
			const targetTokens = 300;

			const result = await strategy.compress(messages, currentTokens, targetTokens);

			expect(result.compressedMessages.length).toBeGreaterThanOrEqual(baseConfig.minMessagesToKeep);
			expect(result.compressedMessages.length).toBeLessThan(messages.length);

			// Should preserve system message (critical priority)
			const systemMessages = result.compressedMessages.filter(m => m.role === 'system');
			expect(systemMessages.length).toBe(1);

			// Should preserve some start and end messages
			expect(result.compressedMessages.length).toBeGreaterThan(2);
		});

		it('should not compress if target is already met', async () => {
			const messages = createTestMessages(5);
			const currentTokens = 200;
			const targetTokens = 300;

			const result = await strategy.compress(messages, currentTokens, targetTokens);

			expect(result.compressedMessages.length).toBe(messages.length);
			expect(result.removedMessages.length).toBe(0);
		});

		it('should respect minimum messages to keep', async () => {
			const messages = createTestMessages(6); // Create more than minMessagesToKeep
			const currentTokens = 500;
			const targetTokens = 50; // Very aggressive target

			const result = await strategy.compress(messages, currentTokens, targetTokens);

			// Should keep at least minMessagesToKeep (4) messages
			expect(result.compressedMessages.length).toBeGreaterThanOrEqual(baseConfig.minMessagesToKeep);
		});
	});

	describe('OldestRemovalStrategy', () => {
		let strategy: OldestRemovalStrategy;

		beforeEach(() => {
			strategy = new OldestRemovalStrategy({ ...baseConfig, strategy: 'oldest-removal' });
		});

		it('should remove oldest messages first', async () => {
			const messages = createTestMessages(8);
			const currentTokens = 400;
			const targetTokens = 250;

			const result = await strategy.compress(messages, currentTokens, targetTokens);

			expect(result.compressedMessages.length).toBeLessThan(messages.length);
			expect(result.removedMessages.length).toBeGreaterThan(0);

			// Should preserve system message
			const systemMessages = result.compressedMessages.filter(m => m.role === 'system');
			expect(systemMessages.length).toBe(1);

			// Removed messages should be older than kept messages (excluding system)
			const keptTimestamps = result.compressedMessages
				.filter(m => m.role !== 'system')
				.map(m => m.timestamp || 0);
			const removedTimestamps = result.removedMessages.map(m => m.timestamp || 0);

			if (removedTimestamps.length > 0 && keptTimestamps.length > 0) {
				const oldestKept = Math.min(...keptTimestamps);
				const newestRemoved = Math.max(...removedTimestamps);
				expect(newestRemoved).toBeLessThanOrEqual(oldestKept);
			}
		});
	});

	describe('HybridStrategy', () => {
		let strategy: HybridStrategy;

		beforeEach(() => {
			strategy = new HybridStrategy({ ...baseConfig, strategy: 'hybrid' });
		});

		it('should choose appropriate strategy based on conversation characteristics', async () => {
			const messages = createTestMessages(6);
			const currentTokens = 350;
			const targetTokens = 200;

			const result = await strategy.compress(messages, currentTokens, targetTokens);

			expect(result.compressedMessages.length).toBeLessThan(messages.length);
			expect(result.strategy).toBe('hybrid');
			expect(result.compressionRatio).toBeLessThan(1);
		});

		it('should handle adaptive compression when no clear strategy emerges', async () => {
			// Create a balanced conversation that doesn't strongly favor either strategy
			const messages = createTestMessages(10);
			const currentTokens = 500;
			const targetTokens = 300;

			const result = await strategy.compress(messages, currentTokens, targetTokens);

			expect(result).toBeDefined();
			expect(result.strategy).toBe('hybrid');
			expect(result.compressedMessages.length).toBeGreaterThanOrEqual(baseConfig.minMessagesToKeep);
		});
	});

	describe('Compression Level Detection', () => {
		let strategy: MiddleRemovalStrategy;

		beforeEach(() => {
			strategy = new MiddleRemovalStrategy(baseConfig);
		});

		it('should detect NONE level for low token usage', () => {
			const level = strategy.getCompressionLevel(700); // 70% of 1000
			expect(level).toBe(CompressionLevel.NONE);
		});

		it('should detect WARNING level for medium token usage', () => {
			const level = strategy.getCompressionLevel(850); // 85% of 1000
			expect(level).toBe(CompressionLevel.WARNING);
		});

		it('should detect SOFT level for high token usage', () => {
			const level = strategy.getCompressionLevel(920); // 92% of 1000
			expect(level).toBe(CompressionLevel.SOFT);
		});

		it('should detect HARD level for very high token usage', () => {
			const level = strategy.getCompressionLevel(970); // 97% of 1000
			expect(level).toBe(CompressionLevel.HARD);
		});

		it('should detect EMERGENCY level for exceeded limits', () => {
			const level = strategy.getCompressionLevel(1100); // 110% of 1000
			expect(level).toBe(CompressionLevel.EMERGENCY);
		});
	});

	describe('shouldCompress', () => {
		let strategy: MiddleRemovalStrategy;

		beforeEach(() => {
			strategy = new MiddleRemovalStrategy(baseConfig);
		});

		it('should not compress below threshold', () => {
			expect(strategy.shouldCompress(800)).toBe(false); // 80% < 90% threshold
		});

		it('should compress at or above threshold', () => {
			expect(strategy.shouldCompress(900)).toBe(true); // 90% >= 90% threshold
			expect(strategy.shouldCompress(1100)).toBe(true); // 110% >= 90% threshold
		});
	});
});
