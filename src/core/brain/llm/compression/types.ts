import { z } from 'zod';
import { InternalMessage } from '../messages/types.js';

/**
 * Configuration schema for compression settings
 */
export const CompressionConfigSchema = z.object({
	strategy: z.enum(['middle-removal', 'oldest-removal', 'hybrid']),
	maxTokens: z.number().positive(),
	warningThreshold: z.number().min(0).max(1).default(0.8),
	compressionThreshold: z.number().min(0).max(1).default(0.9),
	preserveStart: z.number().min(1).default(4),
	preserveEnd: z.number().min(1).default(5),
	minMessagesToKeep: z.number().min(1).default(4),
});

export type CompressionConfig = z.infer<typeof CompressionConfigSchema>;

/**
 * Enhanced message interface with compression metadata
 */
export interface EnhancedInternalMessage extends InternalMessage {
	priority?: 'critical' | 'high' | 'normal' | 'low';
	preserveInCompression?: boolean;
	tokenCount?: number;
	timestamp?: number;
	messageId?: string;
}

/**
 * Compression result interface
 */
export interface CompressionResult {
	compressedMessages: EnhancedInternalMessage[];
	removedMessages: EnhancedInternalMessage[];
	originalTokenCount: number;
	compressedTokenCount: number;
	compressionRatio: number;
	strategy: string;
	timestamp: number;
}

/**
 * Compression statistics for monitoring
 */
export interface CompressionStats {
	totalCompressions: number;
	averageCompressionRatio: number;
	messagesRemoved: number;
	tokensRemoved: number;
	lastCompressionTime: number;
}

/**
 * Compression strategy interface
 */
export interface ICompressionStrategy {
	readonly name: string;
	readonly config: CompressionConfig;

	/**
	 * Compress messages according to strategy
	 */
	compress(
		messages: EnhancedInternalMessage[],
		currentTokenCount: number,
		targetTokenCount: number
	): Promise<CompressionResult>;

	/**
	 * Check if compression is needed
	 */
	shouldCompress(currentTokenCount: number): boolean;

	/**
	 * Get compression level (0-1) based on current usage
	 */
	getCompressionLevel(currentTokenCount: number): number;

	/**
	 * Validate that the compression preserves essential messages
	 */
	validateCompression(result: CompressionResult): boolean;
}

/**
 * Message priority levels
 */
export enum MessagePriority {
	CRITICAL = 'critical',
	HIGH = 'high',
	NORMAL = 'normal',
	LOW = 'low',
}

/**
 * Compression levels based on token usage
 */
export enum CompressionLevel {
	NONE = 0,
	WARNING = 1,
	SOFT = 2,
	HARD = 3,
	EMERGENCY = 4,
}

/**
 * Compression event types for monitoring
 */
export interface CompressionEvent {
	type: 'compression_started' | 'compression_completed' | 'compression_failed';
	timestamp: number;
	strategy: string;
	beforeTokens: number;
	afterTokens?: number;
	messagesRemoved?: number;
	error?: string;
}
