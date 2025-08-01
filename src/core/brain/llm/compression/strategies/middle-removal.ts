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
	calculateTotalTokens,
	createCompressionResult,
	validateCompressionResult,
	logCompressionOperation,
	ensureMessageIds,
} from '../utils.js';
import { logger } from '../../../../logger/index.js';

/**
 * Middle Removal Strategy
 * Preserves conversation start and end, removes messages from the middle
 * Best for maintaining conversation flow and recent context
 */
export class MiddleRemovalStrategy implements ICompressionStrategy {
	public readonly name = 'middle-removal';
	public readonly config: CompressionConfig;

	constructor(config: CompressionConfig) {
		this.config = config;
		logger.debug('MiddleRemovalStrategy initialized', config);
	}

	async compress(
		messages: EnhancedInternalMessage[],
		currentTokenCount: number,
		targetTokenCount: number
	): Promise<CompressionResult> {
		const startTime = Date.now();

		const originalMessages = [...messages];
		// Ensure messages have IDs and priorities
		let processedMessages = ensureMessageIds(messages);
		processedMessages = assignMessagePriorities(processedMessages);

		logger.debug('Starting middle removal compression', {
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

		// Sort removable messages by their original position
		const sortedRemovable = removableMessages.sort((a, b) => {
			const aIndex = processedMessages.indexOf(a);
			const bIndex = processedMessages.indexOf(b);
			return aIndex - bIndex;
		});

		// Identify start, middle, and end sections
		const startMessages = sortedRemovable.slice(0, preserveStart);
		const endMessages = sortedRemovable.slice(-preserveEnd);
		const middleMessages = sortedRemovable.slice(
			preserveStart,
			sortedRemovable.length - preserveEnd
		);

		// Start with all preservable messages and the start/end messages we want to keep
		let compressedMessages = [...preservableMessages, ...startMessages, ...endMessages];
		let removedMessages: EnhancedInternalMessage[] = [];
		let currentTokens = calculateTotalTokens(compressedMessages);

		// Remove middle messages until we reach target or run out of removable messages
		for (const message of middleMessages) {
			// Check if removing this message would violate minimum message count
			if (compressedMessages.length <= minMessagesToKeep) {
				break;
			}

			// Check if we've already reached our target
			if (currentTokens <= targetTokenCount) {
				break;
			}

			// Actually remove the message from compressedMessages
			const messageIndex = compressedMessages.findIndex(m => m.messageId === message.messageId);
			if (messageIndex !== -1) {
				compressedMessages.splice(messageIndex, 1);
			}

			// Add to removed messages and update token count
			removedMessages.push(message);
			currentTokens = calculateTotalTokens(compressedMessages);

			logger.debug('Removed middle message', {
				messageId: message.messageId,
				tokensAfterRemoval: currentTokens,
				targetTokens: targetTokenCount,
				messagesRemaining: compressedMessages.length,
			});
		}

		// Ensure we maintain minimum message count
		if (compressedMessages.length < minMessagesToKeep) {
			const restoreCount = minMessagesToKeep - compressedMessages.length;
			const toRestore = removedMessages.slice(-restoreCount);

			compressedMessages.push(...toRestore);
			removedMessages = removedMessages.slice(0, -restoreCount);

			logger.warn('Restored messages to meet minMessagesToKeep', {
				restoreCount,
				minMessagesToKeep,
				messagesRestored: toRestore.map(m => m.messageId),
			});
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
			logger.warn('Middle removal compression validation failed, returning original messages');
			return createCompressionResult(originalMessages, originalMessages, [], this.name);
		}

		const duration = Date.now() - startTime;
		logCompressionOperation('middle removal completed', result, { duration });

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

	/**
	 * Get strategy-specific statistics
	 */
	getStrategyStats(): any {
		return {
			name: this.name,
			preserveStart: this.config.preserveStart,
			preserveEnd: this.config.preserveEnd,
			compressionType: 'middle-removal',
			bestFor: 'maintaining conversation flow and recent context',
		};
	}
}
