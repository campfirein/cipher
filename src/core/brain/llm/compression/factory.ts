import { ICompressionStrategy, CompressionConfigSchema } from './types.js';
import { MiddleRemovalStrategy } from './strategies/middle-removal.js';
import { OldestRemovalStrategy } from './strategies/oldest-removal.js';
import { HybridStrategy } from './strategies/hybrid.js';
import { logger } from '../../../logger/index.js';
import { z } from 'zod';

export type CompressionFactoryConfig = z.infer<typeof CompressionConfigSchema>;

/**
 * Create a compression strategy instance based on configuration
 */
export function createCompressionStrategy(config: CompressionFactoryConfig): ICompressionStrategy {
	const validatedConfig = CompressionConfigSchema.parse(config);

	logger.debug('Creating compression strategy', {
		strategy: validatedConfig.strategy,
		maxTokens: validatedConfig.maxTokens,
	});

	switch (validatedConfig.strategy) {
		case 'middle-removal':
			return new MiddleRemovalStrategy(validatedConfig);
		case 'oldest-removal':
			return new OldestRemovalStrategy(validatedConfig);
		case 'hybrid':
			return new HybridStrategy(validatedConfig);
		default:
			logger.warn('Unknown compression strategy, falling back to middle-removal', {
				strategy: validatedConfig.strategy,
			});
			return new MiddleRemovalStrategy(validatedConfig);
	}
}

/**
 * Get recommended compression config for a provider/model
 */
export function getCompressionConfigForProvider(
	provider: string,
	model?: string,
	contextWindow?: number
): CompressionFactoryConfig {
	const baseConfig: CompressionFactoryConfig = {
		strategy: 'hybrid',
		maxTokens: contextWindow || 8192,
		warningThreshold: 0.8,
		compressionThreshold: 0.9,
		preserveStart: 4,
		preserveEnd: 5,
		minMessagesToKeep: 4,
	};

	// Provider-specific optimizations
	switch (provider) {
		case 'openai':
			if (model?.startsWith('gpt-4')) {
				return {
					...baseConfig,
					strategy: 'hybrid',
					preserveStart: 6,
					preserveEnd: 6,
					warningThreshold: 0.85,
				};
			}
			if (model?.startsWith('o1-')) {
				return {
					...baseConfig,
					strategy: 'middle-removal',
					preserveStart: 8,
					preserveEnd: 8,
					warningThreshold: 0.9,
					compressionThreshold: 0.95,
				};
			}
			break;

		case 'anthropic':
			return {
				...baseConfig,
				strategy: 'oldest-removal',
				preserveStart: 5,
				preserveEnd: 7,
				warningThreshold: 0.85,
				compressionThreshold: 0.92,
			};

		case 'lmstudio':
		case 'ollama':
			// Local models typically have smaller context windows
			return {
				...baseConfig,
				strategy: 'hybrid',
				warningThreshold: 0.7,
				compressionThreshold: 0.8,
				preserveStart: 3,
				preserveEnd: 4,
				minMessagesToKeep: 3,
			};

		case 'google':
			if (model?.includes('1.5')) {
				// Large context models need less aggressive compression
				return {
					...baseConfig,
					strategy: 'middle-removal',
					warningThreshold: 0.9,
					compressionThreshold: 0.95,
					preserveStart: 10,
					preserveEnd: 10,
				};
			}
			break;
	}

	return baseConfig;
}

/**
 * Create adaptive compression config that adjusts based on usage patterns
 */
export function createAdaptiveCompressionConfig(
	baseConfig: CompressionFactoryConfig,
	usageHistory: {
		avgMessageLength: number;
		compressionFrequency: number;
		conversationLength: number;
	}
): CompressionFactoryConfig {
	const adaptedConfig = { ...baseConfig };

	// Adjust thresholds based on compression frequency
	if (usageHistory.compressionFrequency > 0.3) {
		// Frequent compression - be more aggressive
		adaptedConfig.warningThreshold *= 0.9;
		adaptedConfig.compressionThreshold *= 0.95;
	} else if (usageHistory.compressionFrequency < 0.1) {
		// Rare compression - be more conservative
		adaptedConfig.warningThreshold *= 1.1;
		adaptedConfig.compressionThreshold *= 1.05;
	}

	// Adjust preservation based on conversation length
	if (usageHistory.conversationLength > 50) {
		// Long conversations - preserve more context
		adaptedConfig.preserveStart = Math.min(adaptedConfig.preserveStart + 2, 10);
		adaptedConfig.preserveEnd = Math.min(adaptedConfig.preserveEnd + 2, 10);
	}

	// Adjust strategy based on message characteristics
	if (usageHistory.avgMessageLength > 1000) {
		// Long messages - prefer middle removal to maintain flow
		adaptedConfig.strategy = 'middle-removal';
	} else if (usageHistory.avgMessageLength < 100) {
		// Short messages - oldest removal might be better
		adaptedConfig.strategy = 'oldest-removal';
	}

	// Ensure values stay within valid ranges
	adaptedConfig.warningThreshold = Math.max(0.5, Math.min(0.95, adaptedConfig.warningThreshold));
	adaptedConfig.compressionThreshold = Math.max(
		0.6,
		Math.min(0.98, adaptedConfig.compressionThreshold)
	);

	logger.debug('Created adaptive compression config', {
		original: baseConfig,
		adapted: adaptedConfig,
		usageHistory,
	});

	return adaptedConfig;
}
