import { EnhancedInternalMessage, CompressionResult, MessagePriority } from './types.js';
import { extractTextFromMessage } from '../tokenizer/utils.js';
import { logger } from '../../../logger/index.js';

/**
 * Calculate token count for a message (uses cached value if available)
 */
export function getMessageTokenCount(message: EnhancedInternalMessage): number {
	if (message.tokenCount !== undefined) {
		return message.tokenCount;
	}

	// Fallback to character-based estimation
	const text = extractTextFromMessage(message);

	const approxToken = Math.ceil(text.length / 4); // 4 chars per token approximation
	if (approxToken > 10000) {
		console.warn('Token estimation unusually high:', {
			textLength: text.length,
			approxToken,
			message,
		});
	}
	return approxToken;
}

/**
 * Calculate total token count for an array of messages
 */
export function calculateTotalTokens(messages: EnhancedInternalMessage[]): number {
	return messages.reduce((total, message) => total + getMessageTokenCount(message), 0);
}

/**
 * Assign priorities to messages based on role and content
 */
export function assignMessagePriorities(
	messages: EnhancedInternalMessage[]
): EnhancedInternalMessage[] {
	return messages.map((message, index) => {
		if (message.priority !== undefined) {
			return message;
		}

		let priority: MessagePriority = MessagePriority.NORMAL;
		const tokenCount = getMessageTokenCount(message);
		const textContent = typeof message.content === 'string' ? message.content : '';

		if (message.role === 'system') {
			priority = MessagePriority.CRITICAL;
		} else if (message.role === 'tool') {
			priority = MessagePriority.HIGH;
		} else if (index < 2 || index >= messages.length - 2) {
			priority = MessagePriority.HIGH;
		} else if (tokenCount > 800) {
			priority = MessagePriority.HIGH;
		} else if (tokenCount < 20 && !textContent.includes('?')) {
			priority = MessagePriority.LOW;
		} else if (
			(message as any).function_call ||
			(message as any).tool_calls ||
			(message as any).name
		) {
			priority = MessagePriority.HIGH;
		}

		return {
			...message,
			priority,
			timestamp: message.timestamp || Date.now(),
		};
	});
}

/**
 * Filter messages that should be preserved during compression
 */
export function getPreservableMessages(
	messages: EnhancedInternalMessage[]
): EnhancedInternalMessage[] {
	return messages.filter(
		message =>
			message.preserveInCompression === true ||
			message.priority === MessagePriority.CRITICAL ||
			message.role === 'system'
	);
}

/**
 * Filter messages that can be removed during compression
 */
export function getRemovableMessages(
	messages: EnhancedInternalMessage[]
): EnhancedInternalMessage[] {
	const removable = [];
	const debugInfo = [];
	for (const message of messages) {
		if (
			message.preserveInCompression !== true &&
			message.priority !== MessagePriority.CRITICAL &&
			message.role !== 'system'
		) {
			removable.push(message);
			debugInfo.push({
				messageId: message.messageId,
				role: message.role,
				priority: message.priority,
				preserveInCompression: message.preserveInCompression,
				removable: true,
			});
		} else {
			let reason = '';
			if (message.preserveInCompression === true) reason += 'preserveInCompression=true; ';
			if (message.priority === MessagePriority.CRITICAL) reason += 'priority=CRITICAL; ';
			if (message.role === 'system') reason += 'role=system; ';
			debugInfo.push({
				messageId: message.messageId,
				role: message.role,
				priority: message.priority,
				preserveInCompression: message.preserveInCompression,
				removable: false,
				reason,
			});
		}
	}
	logger.debug('Removable message debug info:', debugInfo);
	return removable;
}

/**
 * Sort messages by priority (for removal order)
 */
export function sortMessagesByRemovalPriority(
	messages: EnhancedInternalMessage[]
): EnhancedInternalMessage[] {
	return [...messages].sort((a, b) => {
		// First sort by priority (low priority removed first)
		const priorityOrder = {
			[MessagePriority.LOW]: 0,
			[MessagePriority.NORMAL]: 1,
			[MessagePriority.HIGH]: 2,
			[MessagePriority.CRITICAL]: 3,
		};

		const aPriority = priorityOrder[a.priority || MessagePriority.NORMAL];
		const bPriority = priorityOrder[b.priority || MessagePriority.NORMAL];

		if (aPriority !== bPriority) {
			return aPriority - bPriority;
		}

		// Then sort by timestamp (older messages removed first)
		const aTime = a.timestamp || 0;
		const bTime = b.timestamp || 0;

		return aTime - bTime;
	});
}

/**
 * Create compression result object
 */
export function createCompressionResult(
	originalMessages: EnhancedInternalMessage[],
	compressedMessages: EnhancedInternalMessage[],
	removedMessages: EnhancedInternalMessage[],
	strategy: string
): CompressionResult {
	const originalTokenCount = calculateTotalTokens(originalMessages);
	const compressedTokenCount = calculateTotalTokens(compressedMessages);

	let compressionRatio = 1;
	if (originalTokenCount > 0) {
		compressionRatio = compressedTokenCount / originalTokenCount;
		if (compressionRatio > 1) {
			compressionRatio = 1; // Clamp to 1 if logic error
		}
	}

	return {
		compressedMessages,
		removedMessages,
		originalTokenCount,
		compressedTokenCount,
		compressionRatio,
		strategy,
		timestamp: Date.now(),
	};
}

/**
 * Validate compression result to ensure quality
 */
export function validateCompressionResult(
	result: CompressionResult,
	minMessagesToKeep: number
): boolean {
	// Check minimum message count
	if (result.compressedMessages.length < minMessagesToKeep) {
		logger.warn('Compression removed too many messages', {
			remaining: result.compressedMessages.length,
			minimum: minMessagesToKeep,
		});
		return false;
	}

	// Must preserve system messages
	const allMessages = result.compressedMessages.concat(result.removedMessages);
	const systemMessages = result.compressedMessages.filter(m => m.role === 'system');
	const originalSystemMessages = allMessages.filter(m => m.role === 'system');

	if (systemMessages.length !== originalSystemMessages.length) {
		logger.warn('Compression removed system messages');
		return false;
	}

	// Must preserve critical messages
	const criticalMessages = result.compressedMessages.filter(
		m => m.priority === MessagePriority.CRITICAL
	);
	const originalCriticalMessages = allMessages.filter(m => m.priority === MessagePriority.CRITICAL);

	if (criticalMessages.length !== originalCriticalMessages.length) {
		logger.warn('Compression removed critical messages');
		return false;
	}

	// Should achieve some compression
	if (result.compressionRatio >= 1) {
		logger.warn('Compression achieved no token reduction', {
			ratio: result.compressionRatio,
		});
		return false;
	}

	return true;
}

/**
 * Add message IDs if not present
 */
export function ensureMessageIds(messages: EnhancedInternalMessage[]): EnhancedInternalMessage[] {
	return messages.map((message, index) => ({
		...message,
		messageId: message.messageId || `msg_${Date.now()}_${index}`,
	}));
}

/**
 * Log compression operation
 */
export function logCompressionOperation(
	operation: string,
	result: CompressionResult,
	context?: any
): void {
	logger.debug(`Compression: ${operation}`, {
		strategy: result.strategy,
		originalTokens: result.originalTokenCount,
		compressedTokens: result.compressedTokenCount,
		ratio: result.compressionRatio,
		messagesRemoved: result.removedMessages.length,
		messagesRemaining: result.compressedMessages.length,
		...context,
	});
}

/**
 * Calculate compression efficiency score
 */
export function calculateCompressionEfficiency(result: CompressionResult): number {
	// Efficiency considers both token reduction and message preservation
	const tokenReduction = 1 - result.compressionRatio;
	const messagePreservation =
		result.compressedMessages.length /
		(result.compressedMessages.length + result.removedMessages.length);

	// Weighted score (60% token reduction, 40% message preservation)
	return tokenReduction * 0.6 + messagePreservation * 0.4;
}
