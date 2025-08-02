/**
 * Lazy Extract and Operate Memory Tool
 *
 * Enhanced version of the extract_and_operate_memory tool that uses lazy loading
 * to defer expensive operations until they are actually needed.
 */

import { InternalTool, InternalToolContext } from '../tools/types.js';
import { logger } from '../../logger/index.js';
import {
	getEmbeddingManager,
	getVectorStoreManager,
	getLLMService,
	LazyAgentServices,
} from './enhanced-service-initializer.js';

// Import the original tool's functionality
import { extractAndOperateMemoryTool } from '../tools/definitions/memory/extract_and_operate_memory.js';
import { env } from '../../env.js';

/**
 * Lazy loading configuration for memory operations
 */
interface LazyMemoryOperationConfig {
	/**
	 * Enable lazy loading for memory operations
	 */
	enableLazyLoading?: boolean;

	/**
	 * Minimum facts threshold to trigger lazy loading
	 */
	lazyLoadingThreshold?: number;

	/**
	 * Enable lightweight processing for simple operations
	 */
	enableLightweightProcessing?: boolean;

	/**
	 * Timeout for lazy operations (ms)
	 */
	operationTimeout?: number;
}

/**
 * Get lazy memory operation configuration from environment
 */
function getLazyMemoryConfig(): LazyMemoryOperationConfig {
	return {
		enableLazyLoading: env.ENABLE_LAZY_LOADING === 'true',
		lazyLoadingThreshold: 3,
		enableLightweightProcessing: true,
		operationTimeout: 8000,
	};
}

/**
 * Enhanced extract and operate memory tool with lazy loading
 */
export const lazyExtractAndOperateMemoryTool: InternalTool = {
	name: 'lazy_extract_and_operate_memory',
	category: 'memory',
	internal: true,
	description: extractAndOperateMemoryTool.description + ' (with lazy loading optimizations)',
	version: '2.0.0',
	parameters: extractAndOperateMemoryTool.parameters,

	handler: async (args: any, context?: InternalToolContext) => {
		const startTime = Date.now();
		const lazyConfig = getLazyMemoryConfig();

		try {
			// Check if we should use lazy loading
			const shouldUseLazyLoading =
				lazyConfig.enableLazyLoading &&
				context?.services &&
				'lazyEmbeddingManager' in context.services;

			if (!shouldUseLazyLoading) {
				// Fall back to original tool
				logger.debug('LazyExtractAndOperate: Using standard processing');
				return await extractAndOperateMemoryTool.handler(args, context);
			}

			const lazyServices = context!.services as LazyAgentServices;

			// Check if this is a simple operation that can be processed without heavy services
			const interaction = args.interaction || '';
			const isSimpleOperation =
				interaction.length < 100 &&
				!interaction.includes('```') &&
				!interaction.includes('function') &&
				!interaction.includes('class');

			if (lazyConfig.enableLightweightProcessing && isSimpleOperation) {
				logger.debug('LazyExtractAndOperate: Using lightweight processing for simple operation');
				return processLightweight(args, startTime);
			}

			// For complex operations, load services lazily
			logger.debug('LazyExtractAndOperate: Loading services lazily for complex operation');

			// Load only the services we actually need
			const embeddingManager = await getEmbeddingManager(lazyServices);
			if (!embeddingManager) {
				logger.warn('LazyExtractAndOperate: No embedding manager available, skipping');
				return createEmptyResult(args, startTime);
			}

			// Create enhanced context with loaded services
			const vectorStoreManager = await getVectorStoreManager(lazyServices);
			const llmService = await getLLMService(lazyServices);

			const enhancedContext: InternalToolContext = {
				...context,
				services: {
					embeddingManager,
					vectorStoreManager: vectorStoreManager as any,
					llmService: llmService!,
					knowledgeGraphManager: lazyServices.knowledgeGraphManager,
				},
			};

			// Use the original tool with enhanced context
			const result = await extractAndOperateMemoryTool.handler(args, enhancedContext);

			const processingTime = Date.now() - startTime;
			logger.debug(`LazyExtractAndOperate: Completed lazy processing in ${processingTime}ms`);

			return result;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error('LazyExtractAndOperate: Error during lazy processing', {
				error: error instanceof Error ? error.message : String(error),
				processingTime: `${processingTime}ms`,
			});

			// Fall back to original tool on error
			try {
				return await extractAndOperateMemoryTool.handler(args, context);
			} catch (fallbackError) {
				logger.error('LazyExtractAndOperate: Fallback also failed', {
					fallbackError:
						fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
				});
				throw error; // Throw original error
			}
		}
	},
};

/**
 * Process simple operations without heavy services
 */
function processLightweight(args: any, startTime: number) {
	// const interaction = args.interaction || '';
	const processingTime = Date.now() - startTime;

	logger.debug(`LazyExtractAndOperate: Lightweight processing completed in ${processingTime}ms`);

	// Return a simple response for lightweight operations
	return {
		success: true,
		extracted_facts: [],
		memory_operations: [],
		processing_summary: {
			total_facts: 0,
			memory_operations: 0,
			processing_mode: 'lightweight',
			processing_time_ms: processingTime,
		},
		message: 'Processed with lightweight optimization - no significant technical content detected.',
	};
}

/**
 * Create empty result for operations that cannot be processed
 */
function createEmptyResult(args: any, startTime: number) {
	const processingTime = Date.now() - startTime;

	return {
		success: false,
		extracted_facts: [],
		memory_operations: [],
		processing_summary: {
			total_facts: 0,
			memory_operations: 0,
			processing_mode: 'skipped',
			processing_time_ms: processingTime,
		},
		message: 'Memory operations skipped - required services not available.',
	};
}
