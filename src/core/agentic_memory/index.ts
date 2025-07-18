/**
 * Agentic Memory System
 *
 * A sophisticated memory system for LLM agents that enables dynamic memory organization,
 * evolution, and relationship building based on the A-MEM paper.
 *
 * @module agentic_memory
 */

import { AgenticMemorySystem } from './memory-system.js';
import { MemoryNote } from './memory-note.js';
import { ContentAnalyzer } from './content-analyzer.js';
import { EvolutionEngine } from './evolution-engine.js';
import {
	createAgenticMemorySystem,
	createAgenticMemorySystemFromEnv,
	createDefaultAgenticMemorySystem,
} from './factory.js';
import { AgenticMemoryConfigBuilder, isAgenticMemoryEnabled, isDebugMode } from './config.js';

// Core classes
export { AgenticMemorySystem } from './memory-system.js';
export { MemoryNote } from './memory-note.js';
export { ContentAnalyzer } from './content-analyzer.js';
export { EvolutionEngine } from './evolution-engine.js';

// Configuration
export {
	AgenticMemoryConfigBuilder,
	createDefaultAgenticMemoryConfig,
	createAgenticMemoryConfigFromEnv,
	validateAgenticMemoryConfig,
	isAgenticMemoryEnabled,
	isMemAgentMode,
	getMemoryCollectionName,
	getMemoryEvolutionCollectionName,
	getEvolutionThreshold,
	getMaxRelatedMemories,
	getAutoEvolution,
	isDebugMode,
	isAnalyticsEnabled,
	getPerformanceConfig,
} from './config.js';

// Factory functions
export {
	createAgenticMemorySystem,
	createAgenticMemorySystemFromEnv,
	createCustomAgenticMemorySystem,
	createDefaultAgenticMemorySystem,
	createTestAgenticMemorySystem,
	createHighPerformanceAgenticMemorySystem,
	createMinimalEvolutionAgenticMemorySystem,
	createValidatedAgenticMemorySystem,
	createMultipleAgenticMemorySystems,
	isAgenticMemoryFactory,
	validateRequiredServices,
	type AgenticMemoryFactory,
} from './factory.js';

// Types and interfaces
export type {
	MemoryNote as IMemoryNote,
	MemoryEvolution,
	AgenticMemoryConfig,
	ContentAnalysis,
	MemoryEvolutionDecision,
	MemorySearchResult,
	MemoryRelationship,
	MemoryAnalytics,
	ConsolidationResult,
	MemorySystemEvents,
	MemorySystemStatus,
} from './types.js';

// Errors
export {
	MemorySystemError,
	MemoryOperationError,
	MemoryEvolutionError,
	MemoryAnalysisError,
} from './types.js';

// Constants
export {
	DEFAULT_CONFIG,
	EVOLUTION_TYPES,
	RELATIONSHIP_TYPES,
	SYSTEM_PROMPTS,
	ERROR_MESSAGES,
	LOG_PREFIXES,
	METADATA_KEYS,
	TIME_FORMAT,
	SEARCH_CONFIG,
	EVOLUTION_CONFIG,
	PERFORMANCE_CONFIG,
	VALIDATION_RULES,
} from './constants.js';

// Re-export environment configuration
export { agenticMemoryEnv } from './config.js';

/**
 * Version information
 */
export const VERSION = '1.0.0';

/**
 * Feature flags
 */
export const FEATURES = {
	EVOLUTION_ENGINE: true,
	CONTENT_ANALYSIS: true,
	HYBRID_SEARCH: true,
	ANALYTICS: true,
	BATCH_PROCESSING: true,
	RELATIONSHIP_MANAGEMENT: true,
} as const;

/**
 * Quick start function for creating a basic agentic memory system
 *
 * @example
 * ```typescript
 * import { quickStart } from './agentic_memory';
 *
 * const memorySystem = await quickStart(vectorStore, llmService, embeddingService);
 *
 * // Add a memory
 * const memoryId = await memorySystem.addMemory("This is my first memory");
 *
 * // Search memories
 * const results = await memorySystem.searchMemories("first memory");
 * ```
 */
export async function quickStart(
	vectorStore: any,
	llmService: any,
	embeddingService: any
): Promise<AgenticMemorySystem> {
	const { system } = await createDefaultAgenticMemorySystem(
		vectorStore,
		llmService,
		embeddingService
	);
	return system;
}

/**
 * Utility function to check if agentic memory is properly configured
 */
export function checkConfiguration(): {
	isConfigured: boolean;
	missingComponents: string[];
	warnings: string[];
} {
	const missingComponents: string[] = [];
	const warnings: string[] = [];

	// Check if the system is enabled
	if (!isAgenticMemoryEnabled()) {
		missingComponents.push('AGENTIC_MEMORY_ENABLED is not set to true');
	}

	// Check for debug mode
	if (isDebugMode()) {
		warnings.push('Debug mode is enabled - this may impact performance');
	}

	return {
		isConfigured: missingComponents.length === 0,
		missingComponents,
		warnings,
	};
}

/**
 * Default export for convenience
 */
export default {
	AgenticMemorySystem,
	MemoryNote,
	ContentAnalyzer,
	EvolutionEngine,
	createAgenticMemorySystem,
	createAgenticMemorySystemFromEnv,
	AgenticMemoryConfigBuilder,
	quickStart,
	checkConfiguration,
	VERSION,
	FEATURES,
};
