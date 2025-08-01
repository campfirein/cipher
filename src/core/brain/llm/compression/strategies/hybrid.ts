import {
	ICompressionStrategy,
	CompressionConfig,
	CompressionResult,
	EnhancedInternalMessage,
	CompressionLevel,
} from '../types.js';
import {
	assignMessagePriorities,
	calculateTotalTokens,
	validateCompressionResult,
	logCompressionOperation,
	ensureMessageIds,
	calculateCompressionEfficiency,
} from '../utils.js';
import { MiddleRemovalStrategy } from './middle-removal.js';
import { OldestRemovalStrategy } from './oldest-removal.js';
import { logger } from '../../../../logger/index.js';

/**
 * Hybrid Strategy
 * Intelligently combines middle-removal and oldest-removal strategies
 * Chooses the best approach based on conversation characteristics
 */
export class HybridStrategy implements ICompressionStrategy {
	public readonly name = 'hybrid';
	public readonly config: CompressionConfig;

	private middleRemovalStrategy: MiddleRemovalStrategy;
	private oldestRemovalStrategy: OldestRemovalStrategy;

	constructor(config: CompressionConfig) {
		this.config = config;
		this.middleRemovalStrategy = new MiddleRemovalStrategy(config);
		this.oldestRemovalStrategy = new OldestRemovalStrategy(config);

		logger.debug('HybridStrategy initialized', config);
	}

	async compress(
		messages: EnhancedInternalMessage[],
		currentTokenCount: number,
		targetTokenCount: number
	): Promise<CompressionResult> {
		const startTime = Date.now();

		// Ensure messages have IDs and priorities
		let processedMessages = ensureMessageIds(messages);
		processedMessages = assignMessagePriorities(processedMessages);

		logger.debug('Starting hybrid compression', {
			messageCount: processedMessages.length,
			currentTokens: currentTokenCount,
			targetTokens: targetTokenCount,
			tokensToRemove: currentTokenCount - targetTokenCount,
		});

		// Analyze conversation characteristics to choose strategy
		const conversationAnalysis = this.analyzeConversation(
			processedMessages,
			currentTokenCount,
			targetTokenCount
		);

		logger.debug('Conversation analysis for hybrid strategy', conversationAnalysis);

		let result: CompressionResult;

		if (conversationAnalysis.recommendedStrategy === 'middle-removal') {
			logger.debug('Hybrid strategy choosing middle-removal');
			result = await this.middleRemovalStrategy.compress(
				messages,
				currentTokenCount,
				targetTokenCount
			);
		} else if (conversationAnalysis.recommendedStrategy === 'oldest-removal') {
			logger.debug('Hybrid strategy choosing oldest-removal');
			result = await this.oldestRemovalStrategy.compress(
				messages,
				currentTokenCount,
				targetTokenCount
			);
		} else {
			// Adaptive approach: try both and choose the better result
			logger.debug('Hybrid strategy using adaptive approach');
			result = await this.adaptiveCompress(messages, currentTokenCount, targetTokenCount);
		}

		// Update result to reflect hybrid strategy
		result.strategy = this.name;

		const duration = Date.now() - startTime;
		logCompressionOperation('hybrid compression completed', result, {
			duration,
			analysis: conversationAnalysis,
			chosenStrategy: conversationAnalysis.recommendedStrategy || 'adaptive',
		});

		return result;
	}

	private async adaptiveCompress(
		messages: EnhancedInternalMessage[],
		currentTokenCount: number,
		targetTokenCount: number
	): Promise<CompressionResult> {
		// Try both strategies and compare results
		const middleResult = await this.middleRemovalStrategy.compress(
			messages,
			currentTokenCount,
			targetTokenCount
		);
		const oldestResult = await this.oldestRemovalStrategy.compress(
			messages,
			currentTokenCount,
			targetTokenCount
		);

		// Calculate efficiency scores for both results
		const middleEfficiency = calculateCompressionEfficiency(middleResult);
		const oldestEfficiency = calculateCompressionEfficiency(oldestResult);

		logger.debug('Comparing compression strategies', {
			middleEfficiency,
			oldestEfficiency,
			middleTokens: middleResult.compressedTokenCount,
			oldestTokens: oldestResult.compressedTokenCount,
		});

		// Choose the more efficient strategy
		if (middleEfficiency >= oldestEfficiency) {
			return middleResult;
		} else {
			return oldestResult;
		}
	}

	private analyzeConversation(
		messages: EnhancedInternalMessage[],
		currentTokenCount: number,
		targetTokenCount: number
	): ConversationAnalysis {
		const totalMessages = messages.length;
		const avgMessageLength = currentTokenCount / totalMessages;
		const compressionRatio = targetTokenCount / currentTokenCount;

		// Analyze message distribution
		const recentMessages = messages.slice(-5);
		const recentTokens = calculateTotalTokens(recentMessages);
		const recentRatio = recentTokens / currentTokenCount;

		// Analyze conversation patterns
		const hasLongMessages = messages.some(m => (m.tokenCount || 0) > 300);
		const hasSystemMessages = messages.some(m => m.role === 'system');
		const hasToolMessages = messages.some(m => m.role === 'tool');

		// Determine compression severity
		const compressionSeverity = this.getCompressionSeverity(compressionRatio);

		let recommendedStrategy: string | null = null;
		let confidence = 0;

		// Decision logic based on conversation characteristics
		if (compressionSeverity === 'light' && totalMessages < 20) {
			// Light compression on short conversations - prefer middle removal
			recommendedStrategy = 'middle-removal';
			confidence = 0.8;
		} else if (compressionSeverity === 'heavy' && totalMessages > 30) {
			// Heavy compression on long conversations - prefer oldest removal
			recommendedStrategy = 'oldest-removal';
			confidence = 0.9;
		} else if (recentRatio > 0.4) {
			// Recent messages are token-heavy - prefer middle removal to preserve recent context
			recommendedStrategy = 'middle-removal';
			confidence = 0.7;
		} else if (hasLongMessages && compressionSeverity !== 'light') {
			// Has long messages and significant compression needed - oldest removal might be better
			recommendedStrategy = 'oldest-removal';
			confidence = 0.6;
		} else if (hasToolMessages || hasSystemMessages) {
			// Has important message types - be more conservative with middle removal
			recommendedStrategy = 'middle-removal';
			confidence = 0.7;
		}

		// If confidence is low, use adaptive approach
		if (confidence < 0.6) {
			recommendedStrategy = null; // Will trigger adaptive approach
		}

		return {
			totalMessages,
			avgMessageLength,
			compressionRatio,
			recentRatio,
			compressionSeverity,
			hasLongMessages,
			hasSystemMessages,
			hasToolMessages,
			recommendedStrategy,
			confidence,
		};
	}

	private getCompressionSeverity(compressionRatio: number): 'light' | 'moderate' | 'heavy' {
		if (compressionRatio > 0.8) return 'light';
		if (compressionRatio > 0.6) return 'moderate';
		return 'heavy';
	}

	shouldCompress(currentTokenCount: number): boolean {
		const threshold = this.config.maxTokens * this.config.compressionThreshold;
		return currentTokenCount >= threshold;
	}

	getCompressionLevel(currentTokenCount: number): number {
		const warningThreshold = this.config.maxTokens * this.config.warningThreshold;
		const compressionThreshold = this.config.maxTokens * this.config.compressionThreshold;

		if (currentTokenCount < warningThreshold) {
			return CompressionLevel.NONE;
		} else if (currentTokenCount < compressionThreshold) {
			return CompressionLevel.WARNING;
		} else if (currentTokenCount < this.config.maxTokens * 0.95) {
			return CompressionLevel.SOFT;
		} else if (currentTokenCount < this.config.maxTokens) {
			return CompressionLevel.HARD;
		} else {
			return CompressionLevel.EMERGENCY;
		}
	}

	validateCompression(result: CompressionResult): boolean {
		return validateCompressionResult(result, this.config.minMessagesToKeep);
	}

	/**
	 * Get strategy-specific statistics
	 */
	getStrategyStats(): any {
		return {
			name: this.name,
			compressionType: 'hybrid',
			strategies: ['middle-removal', 'oldest-removal'],
			bestFor: 'adaptive compression based on conversation characteristics',
			decisionFactors: [
				'conversation length',
				'compression severity',
				'recent context weight',
				'message types',
				'token distribution',
			],
		};
	}
}

/**
 * Analysis result for conversation characteristics
 */
interface ConversationAnalysis {
	totalMessages: number;
	avgMessageLength: number;
	compressionRatio: number;
	recentRatio: number;
	compressionSeverity: 'light' | 'moderate' | 'heavy';
	hasLongMessages: boolean;
	hasSystemMessages: boolean;
	hasToolMessages: boolean;
	recommendedStrategy: string | null;
	confidence: number;
}
