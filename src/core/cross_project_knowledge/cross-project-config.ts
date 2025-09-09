/**
 * Cross-Project Knowledge Configuration Loader
 * 
 * Loads and validates environment variables for the cross-project knowledge system.
 * Provides type-safe configuration objects that can be used throughout the system.
 * 
 * Why this exists: Environment variables need to be loaded, validated, and mapped
 * to configuration objects. This centralizes that logic and provides type safety.
 */

import { env } from '../env.js';
import type {
	CrossProjectConfig,
	CrossProjectManagerConfig,
	MemoryIntegrationConfig,
	MasterGuideConfig,
} from './types.js';
import type { SynthesisOptions } from './knowledge-synthesizer.js';

/**
 * Loads cross-project knowledge configuration from environment variables
 * 
 * @returns Complete configuration object with all settings
 * 
 * Maps environment variables to configuration objects with proper
 * validation and sensible defaults for all settings.
 */
export function loadCrossProjectConfig(): {
	enabled: boolean;
	crossProjectConfig: CrossProjectConfig;
	crossProjectManagerConfig: CrossProjectManagerConfig;
	memoryIntegrationConfig: MemoryIntegrationConfig;
	masterGuideConfig: MasterGuideConfig;
	synthesisOptions: SynthesisOptions;
} {
	// Check if cross-project knowledge is enabled
	const enabled = env.CIPHER_CROSS_PROJECT_ENABLED;

	// Base cross-project configuration
	const crossProjectConfig: CrossProjectConfig = {
		enableAutoTransfer: env.CIPHER_CROSS_PROJECT_AUTO_TRANSFER,
		similarityThreshold: env.CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD,
		maxTransferPerProject: env.CIPHER_CROSS_PROJECT_MAX_TRANSFERS_PER_PROJECT,
		updateInterval: env.CIPHER_CROSS_PROJECT_UPDATE_INTERVAL,
		enableMasterGuide: env.CIPHER_CROSS_PROJECT_MASTER_GUIDES,
		masterGuideUpdateInterval: env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL,
		knowledgeRetentionDays: env.CIPHER_CROSS_PROJECT_KNOWLEDGE_RETENTION_DAYS,
	};

	// Cross-project manager configuration
	const crossProjectManagerConfig: CrossProjectManagerConfig = {
		...crossProjectConfig,
		enableAutoTransfer: env.CIPHER_CROSS_PROJECT_AUTO_TRANSFER,
		enableMasterGuide: env.CIPHER_CROSS_PROJECT_MASTER_GUIDES,
		enablePerformanceMonitoring: env.CIPHER_CROSS_PROJECT_PERFORMANCE_MONITORING,
		maxConcurrentTransfers: env.CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS,
		transferBatchSize: env.CIPHER_CROSS_PROJECT_TRANSFER_BATCH_SIZE,
	};

	// Memory integration configuration
	const memoryIntegrationConfig: MemoryIntegrationConfig = {
		...crossProjectConfig,
		enableAutoProjectDetection: env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION,
		enableAutoKnowledgeExtraction: env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION,
		enableAutoMasterGuideGeneration: env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION,
		projectDetectionInterval: env.CIPHER_CROSS_PROJECT_PROJECT_DETECTION_INTERVAL,
		knowledgeExtractionThreshold: env.CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD,
		masterGuideGenerationThreshold: env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_GENERATION_THRESHOLD,
	};

	// Master guide configuration
	const masterGuideConfig: MasterGuideConfig = {
		enableAutoGeneration: env.CIPHER_CROSS_PROJECT_MASTER_GUIDES,
		updateInterval: env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL,
		minProjectsForGuide: env.CIPHER_CROSS_PROJECT_MIN_PROJECTS_FOR_GUIDE,
		maxGuideAge: env.CIPHER_CROSS_PROJECT_MAX_GUIDE_AGE_DAYS,
		enableVersioning: env.CIPHER_CROSS_PROJECT_ENABLE_GUIDE_VERSIONING,
		enableCrossDomainGuides: env.CIPHER_CROSS_PROJECT_ENABLE_CROSS_DOMAIN_GUIDES,
	};

	// Knowledge synthesis options
	const synthesisOptions: SynthesisOptions = {
		minConfidence: env.CIPHER_CROSS_PROJECT_MIN_CONFIDENCE,
		minRelevance: env.CIPHER_CROSS_PROJECT_MIN_RELEVANCE,
		maxPatterns: env.CIPHER_CROSS_PROJECT_MAX_PATTERNS,
		maxSolutions: env.CIPHER_CROSS_PROJECT_MAX_SOLUTIONS,
		enablePatternDetection: env.CIPHER_CROSS_PROJECT_ENABLE_PATTERN_DETECTION,
		enableSolutionExtraction: env.CIPHER_CROSS_PROJECT_ENABLE_SOLUTION_EXTRACTION,
		enableGuidelineGeneration: env.CIPHER_CROSS_PROJECT_ENABLE_GUIDELINE_GENERATION,
	};

	return {
		enabled,
		crossProjectConfig,
		crossProjectManagerConfig,
		memoryIntegrationConfig,
		masterGuideConfig,
		synthesisOptions,
	};
}

/**
 * Gets logging configuration for cross-project knowledge system
 * 
 * @returns Logging configuration object
 */
export function getCrossProjectLoggingConfig(): {
	level: 'error' | 'warn' | 'info' | 'debug';
	enableDetailedLogging: boolean;
	logTransfers: boolean;
	logSynthesis: boolean;
} {
	return {
		level: env.CIPHER_CROSS_PROJECT_LOG_LEVEL,
		enableDetailedLogging: env.CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING,
		logTransfers: env.CIPHER_CROSS_PROJECT_LOG_TRANSFERS,
		logSynthesis: env.CIPHER_CROSS_PROJECT_LOG_SYNTHESIS,
	};
}

/**
 * Gets privacy and security configuration for cross-project knowledge system
 * 
 * @returns Privacy and security configuration object
 */
export function getCrossProjectPrivacyConfig(): {
	enableAnonymization: boolean;
	anonymizeProjectNames: boolean;
	enableContentFiltering: boolean;
	filterSensitivePatterns: boolean;
} {
	return {
		enableAnonymization: env.CIPHER_CROSS_PROJECT_ENABLE_ANONYMIZATION,
		anonymizeProjectNames: env.CIPHER_CROSS_PROJECT_ANONYMIZE_PROJECT_NAMES,
		enableContentFiltering: env.CIPHER_CROSS_PROJECT_ENABLE_CONTENT_FILTERING,
		filterSensitivePatterns: env.CIPHER_CROSS_PROJECT_FILTER_SENSITIVE_PATTERNS,
	};
}

/**
 * Gets integration configuration for cross-project knowledge system
 * 
 * @returns Integration configuration object
 */
export function getCrossProjectIntegrationConfig(): {
	integrateWithMemory: boolean;
	integrateWithKnowledgeGraph: boolean;
	integrateWithWorkspaceMemory: boolean;
} {
	return {
		integrateWithMemory: env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY,
		integrateWithKnowledgeGraph: env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_KNOWLEDGE_GRAPH,
		integrateWithWorkspaceMemory: env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_WORKSPACE_MEMORY,
	};
}

/**
 * Validates cross-project knowledge configuration
 * 
 * @param config - Configuration to validate
 * @returns True if configuration is valid, false otherwise
 */
export function validateCrossProjectConfig(config: ReturnType<typeof loadCrossProjectConfig>): boolean {
	// Check if cross-project knowledge is enabled
	if (!config.enabled) {
		return true; // Valid to have it disabled
	}

	// Validate numeric ranges
	const { crossProjectConfig, synthesisOptions } = config;

	// Validate similarity threshold
	if (crossProjectConfig.similarityThreshold < 0 || crossProjectConfig.similarityThreshold > 1) {
		console.error('CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD must be between 0 and 1');
		return false;
	}

	// Validate confidence threshold
	if (synthesisOptions.minConfidence < 0 || synthesisOptions.minConfidence > 1) {
		console.error('CIPHER_CROSS_PROJECT_MIN_CONFIDENCE must be between 0 and 1');
		return false;
	}

	// Validate relevance threshold
	if (synthesisOptions.minRelevance < 0 || synthesisOptions.minRelevance > 1) {
		console.error('CIPHER_CROSS_PROJECT_MIN_RELEVANCE must be between 0 and 1');
		return false;
	}

	// Validate extraction threshold
	if (config.memoryIntegrationConfig.knowledgeExtractionThreshold < 0 || 
		config.memoryIntegrationConfig.knowledgeExtractionThreshold > 1) {
		console.error('CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD must be between 0 and 1');
		return false;
	}

	// Validate positive numbers
	if (crossProjectConfig.maxTransferPerProject <= 0) {
		console.error('CIPHER_CROSS_PROJECT_MAX_TRANSFERS_PER_PROJECT must be greater than 0');
		return false;
	}

	if (config.crossProjectManagerConfig.maxConcurrentTransfers <= 0) {
		console.error('CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS must be greater than 0');
		return false;
	}

	if (synthesisOptions.maxPatterns <= 0) {
		console.error('CIPHER_CROSS_PROJECT_MAX_PATTERNS must be greater than 0');
		return false;
	}

	if (synthesisOptions.maxSolutions <= 0) {
		console.error('CIPHER_CROSS_PROJECT_MAX_SOLUTIONS must be greater than 0');
		return false;
	}

	return true;
}
