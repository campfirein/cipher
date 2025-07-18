/**
 * A-MEM Types and Interfaces
 *
 * Core type definitions for the Agentic Memory system integrated with cipher.
 * Based on the A-MEM paper implementation with cipher-specific adaptations.
 */

import type { VectorStore } from '../vector_storage/backend/vector-store.js';
import type { ILLMService } from '../brain/llm/services/types.js';
import type { Embedder } from '../brain/embedding/types.js';

/**
 * Memory note represents a single unit of information in the agentic memory system
 */
export interface MemoryNote {
	/** Unique identifier for the memory note */
	id: string;

	/** Main content of the memory */
	content: string;

	/** Keywords extracted from the content */
	keywords: string[];

	/** Contextual description of the memory */
	context: string;

	/** Classification tags for the memory */
	tags: string[];

	/** Links to related memory notes */
	links: string[];

	/** Category classification */
	category: string;

	/** Creation timestamp in YYYYMMDDHHMM format */
	timestamp: string;

	/** Last accessed timestamp */
	lastAccessed: string;

	/** Number of times this memory has been retrieved */
	retrievalCount: number;

	/** History of memory evolution changes */
	evolutionHistory: MemoryEvolution[];

	/** Additional metadata */
	metadata: Record<string, any> | undefined;
}

/**
 * Memory evolution record tracking changes to a memory note
 */
export interface MemoryEvolution {
	/** Timestamp of the evolution */
	timestamp: string;

	/** Type of evolution performed */
	type: 'strengthen' | 'update_neighbor' | 'consolidate' | 'link_creation';

	/** Description of the changes made */
	description: string;

	/** Memory IDs involved in the evolution */
	involvedMemories: string[];

	/** Changes made to the memory */
	changes: {
		addedLinks?: string[];
		removedLinks?: string[];
		updatedTags?: string[];
		updatedContext?: string;
		updatedKeywords?: string[];
	};
}

/**
 * Configuration for the Agentic Memory System
 */
export interface AgenticMemoryConfig {
	/** Vector store manager for handling vector store operations */
	vectorStoreManager: any;

	/** Vector store instance for memory storage */
	vectorStore: VectorStore;

	/** LLM service for content analysis and evolution */
	llmService: ILLMService;

	/** Embedding service for vector generation */
	embeddingService: Embedder;

	/** Collection name for memory storage */
	collectionName: string;

	/** Collection name for evolution history */
	evolutionCollectionName: string;

	/** Number of memories to add before triggering evolution */
	evolutionThreshold: number;

	/** Maximum number of related memories to consider during evolution */
	maxRelatedMemories: number;

	/** Similarity threshold for memory relationships */
	similarityThreshold: number;

	/** Whether to enable automatic memory evolution */
	autoEvolution: boolean;

	/** Maximum number of memories to return in search results */
	maxSearchResults: number;
}

/**
 * Content analysis result from LLM
 */
export interface ContentAnalysis {
	/** Extracted keywords from the content */
	keywords: string[];

	/** Contextual description of the content */
	context: string;

	/** Classification tags */
	tags: string[];

	/** Confidence score for the analysis */
	confidence?: number;
}

/**
 * Memory evolution decision from LLM
 */
export interface MemoryEvolutionDecision {
	/** Whether the memory should evolve */
	shouldEvolve: boolean;

	/** Actions to take for evolution */
	actions: ('strengthen' | 'update_neighbor')[];

	/** Suggested memory connections */
	suggestedConnections: string[];

	/** Updated tags for the current memory */
	tagsToUpdate: string[];

	/** New context for neighbor memories */
	newContextNeighborhood: string[];

	/** New tags for neighbor memories */
	newTagsNeighborhood: string[][];
}

/**
 * Search result from agentic memory
 */
export interface MemorySearchResult {
	/** Memory note data */
	memory: MemoryNote;

	/** Similarity score */
	score: number;

	/** Whether this is a neighbor memory */
	isNeighbor: boolean;

	/** Search relevance metadata */
	relevance: {
		/** Keyword match score */
		keywordMatch: number;

		/** Semantic similarity score */
		semanticSimilarity: number;

		/** Context relevance score */
		contextRelevance: number;
	};
}

/**
 * Memory relationship information
 */
export interface MemoryRelationship {
	/** Source memory ID */
	sourceId: string;

	/** Target memory ID */
	targetId: string;

	/** Relationship strength (0-1) */
	strength: number;

	/** Type of relationship */
	type: 'semantic' | 'temporal' | 'categorical' | 'explicit';

	/** When the relationship was established */
	createdAt: string;

	/** Additional relationship metadata */
	metadata?: Record<string, any>;
}

/**
 * Memory analytics and statistics
 */
export interface MemoryAnalytics {
	/** Total number of memories */
	totalMemories: number;

	/** Number of memory relationships */
	totalRelationships: number;

	/** Average memory retrieval count */
	avgRetrievalCount: number;

	/** Most frequently accessed memories */
	topMemories: MemoryNote[];

	/** Memory distribution by category */
	categoryDistribution: Record<string, number>;

	/** Memory distribution by tags */
	tagDistribution: Record<string, number>;

	/** Evolution statistics */
	evolutionStats: {
		totalEvolutions: number;
		evolutionsByType: Record<string, number>;
		lastEvolutionTimestamp: string;
	};
}

/**
 * Memory consolidation result
 */
export interface ConsolidationResult {
	/** Number of memories processed */
	processedCount: number;

	/** Number of new relationships created */
	newRelationships: number;

	/** Number of memories that evolved */
	evolvedCount: number;

	/** Processing time in milliseconds */
	processingTime: number;

	/** Any errors encountered during consolidation */
	errors: string[];
}

/**
 * Memory system events
 */
export interface MemorySystemEvents {
	/** Fired when a new memory is added */
	'memory:added': { memory: MemoryNote };

	/** Fired when a memory is updated */
	'memory:updated': { memory: MemoryNote; changes: Record<string, any> };

	/** Fired when a memory is deleted */
	'memory:deleted': { memoryId: string };

	/** Fired when memory evolution occurs */
	'memory:evolved': { memory: MemoryNote; evolution: MemoryEvolution };

	/** Fired when memory consolidation completes */
	'memory:consolidated': { result: ConsolidationResult };

	/** Fired when a memory relationship is created */
	'memory:relationship_created': { relationship: MemoryRelationship };
}

/**
 * Memory system status
 */
export interface MemorySystemStatus {
	/** Whether the system is connected and operational */
	connected: boolean;

	/** Current memory count */
	memoryCount: number;

	/** Evolution counter */
	evolutionCounter: number;

	/** Last evolution timestamp */
	lastEvolution: string | null;

	/** System health status */
	health: 'healthy' | 'degraded' | 'error';

	/** Any system errors */
	errors: string[];
}

/**
 * Base error class for memory system errors
 */
export class MemorySystemError extends Error {
	constructor(
		message: string,
		public code: string,
		public details?: any
	) {
		super(message);
		this.name = 'MemorySystemError';
	}
}

/**
 * Error thrown when memory operations fail
 */
export class MemoryOperationError extends MemorySystemError {
	constructor(
		message: string,
		public operation: string,
		details?: any
	) {
		super(message, 'MEMORY_OPERATION_ERROR', details);
		this.name = 'MemoryOperationError';
	}
}

/**
 * Error thrown when memory evolution fails
 */
export class MemoryEvolutionError extends MemorySystemError {
	constructor(
		message: string,
		public memoryId: string,
		details?: any
	) {
		super(message, 'MEMORY_EVOLUTION_ERROR', details);
		this.name = 'MemoryEvolutionError';
	}
}

/**
 * Error thrown when memory analysis fails
 */
export class MemoryAnalysisError extends MemorySystemError {
	constructor(
		message: string,
		public content: string,
		details?: any
	) {
		super(message, 'MEMORY_ANALYSIS_ERROR', details);
		this.name = 'MemoryAnalysisError';
	}
}
