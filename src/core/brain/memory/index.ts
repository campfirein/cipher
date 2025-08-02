/**
 * Memory System with Lazy Loading Optimizations
 *
 * Memory-related functionality for the Cipher agent with performance optimizations.
 * Phase 3: Memory operations lazy loading - properly integrated into the application.
 */

// Export lazy loading service wrappers
export {
	LazyEmbeddingManager,
	LazyVectorStoreManager,
	LazyLLMService,
	getDefaultLazyConfig,
	type LazyServiceConfig,
	type LazyAgentServices,
} from './lazy-service-wrapper.js';

// Export enhanced service initializer
export {
	createEnhancedAgentServices,
	shouldEnableLazyLoading,
	getEmbeddingManager,
	getVectorStoreManager,
	getLLMService,
	type EnhancedServiceOptions,
} from './enhanced-service-initializer.js';

// Export lazy memory tool
export { lazyExtractAndOperateMemoryTool } from './lazy-extract-and-operate.js';
