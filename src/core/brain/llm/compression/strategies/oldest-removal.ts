import {
	ICompressionStrategy,
	CompressionConfig,
	CompressionResult,
	EnhancedInternalMessage,
	CompressionLevel,
} from '../types.js';
import {
	assignMessagePriorities,
	getPreservableMessages,
	getRemovableMessages,
	sortMessagesByRemovalPriority,
	calculateTotalTokens,
	createCompressionResult,
	validateCompressionResult,
	logCompressionOperation,
	ensureMessageIds,
} from '../utils.js';
import { logger } from '../../../../logger/index.js';

/**
 * Oldest Removal Strategy
 * Removes oldest messages first while preserving minimum message count
 * Best for long conversations where recent context is most important
 */
export class OldestRemovalStrategy implements ICompressionStrategy {
	public readonly name = 'oldest-removal';
	public readonly config: CompressionConfig;

	constructor(config: CompressionConfig) {
		this.config = config;
		logger.debug('OldestRemovalStrategy initialized', config);
	}

	async compress(
		messages: EnhancedInternalMessage[],
		currentTokenCount: number,
		targetTokenCount: number
	): Promise<CompressionResult> {
		const startTime = Date.now();
		const originalMessages = [...messages];

		let processedMessages = ensureMessageIds(messages);
		processedMessages = assignMessagePriorities(processedMessages);

		logger.debug('Starting oldest removal compression', {
			messageCount: processedMessages.length,
			currentTokens: currentTokenCount,
			targetTokens: targetTokenCount,
			tokensToRemove: currentTokenCount - targetTokenCount,
		});

		// Use configuration values instead of hardcoded ones
		const minMessagesToKeep = this.config.minMessagesToKeep;
		const preserveStart = Math.min(this.config.preserveStart, processedMessages.length);
		const preserveEnd = Math.min(this.config.preserveEnd, processedMessages.length);

		const preservableMessages = getPreservableMessages(processedMessages);
		const removableMessages = getRemovableMessages(processedMessages);

		if (removableMessages.length === 0) {
			logger.warn('No removable messages found for compression');
			return createCompressionResult(originalMessages, processedMessages, [], this.name);
		}

		// Sort messages by timestamp (oldest first) for removal priority
		const sortedForRemoval = sortMessagesByRemovalPriority(removableMessages).sort(
			(a, b) => (a.timestamp || 0) - (b.timestamp || 0)
		);

		logger.debug('Oldest removal strategy analysis', {
			totalRemovable: removableMessages.length,
			preserveStart,
			preserveEnd,
			sortedForRemovalCount: sortedForRemoval.length,
		});

		// Start with all preservable messages + all removable messages
		let compressedMessages = [...preservableMessages, ...sortedForRemoval];
		let removedMessages: EnhancedInternalMessage[] = [];

		// Remove oldest messages until we reach target or minimum
		while (
			calculateTotalTokens(compressedMessages) > targetTokenCount &&
			compressedMessages.length > minMessagesToKeep
		) {
			// Find the oldest removable message still in compressed set
			let oldestIndex = -1;
			let oldestTimestamp = Infinity;

			for (let i = 0; i < compressedMessages.length; i++) {
				const message = compressedMessages[i];
				if (!message) continue;
				// Skip preservable messages
				if (preservableMessages.includes(message)) continue;

				const timestamp = message.timestamp || 0;
				if (timestamp < oldestTimestamp) {
					oldestTimestamp = timestamp;
					oldestIndex = i;
				}
			}

			// If we found an oldest message, remove it
			if (oldestIndex >= 0) {
				const removedMessage = compressedMessages.splice(oldestIndex, 1)[0];
				if (removedMessage) {
					removedMessages.push(removedMessage);
					logger.debug('Removed oldest message', {
						messageId: removedMessage.messageId,
						timestamp: removedMessage.timestamp,
						priority: removedMessage.priority,
						remainingMessages: compressedMessages.length,
						currentTokens: calculateTotalTokens(compressedMessages),
					});
				}
			} else {
				// No more removable messages found
				break;
			}
		}

		// Sort final messages to maintain original conversation order
		compressedMessages = compressedMessages.sort((a, b) => {
			const aIndex = processedMessages.indexOf(a);
			const bIndex = processedMessages.indexOf(b);
			return aIndex - bIndex;
		});

		logger.debug('Compression summary before validate', {
			messagesRemaining: compressedMessages.length,
			minMessagesToKeep,
			messagesRemoved: removedMessages.length,
			finalTokenCount: calculateTotalTokens(compressedMessages),
		});

		const result = createCompressionResult(
			originalMessages,
			compressedMessages,
			removedMessages,
			this.name
		);

		if (!validateCompressionResult(result, minMessagesToKeep)) {
			logger.warn('Oldest removal compression validation failed, returning original messages');
			return createCompressionResult(originalMessages, originalMessages, [], this.name);
		}

		const duration = Date.now() - startTime;
		logCompressionOperation('oldest removal completed', result, { duration });

		return result;
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

	getStrategyStats(): any {
		return {
			name: this.name,
			preserveStart: this.config.preserveStart,
			preserveEnd: this.config.preserveEnd,
			minMessagesToKeep: this.config.minMessagesToKeep,
			compressionType: 'oldest-removal',
			bestFor: 'long conversations where recent context is most important',
		};
	}
}
