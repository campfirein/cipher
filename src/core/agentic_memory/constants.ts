/**
 * A-MEM Constants
 *
 * Constants and default values for the Agentic Memory system
 */

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
	/** Default collection name for memories */
	COLLECTION_NAME: 'agentic_memories',

	/** Default collection name for evolution history */
	EVOLUTION_COLLECTION_NAME: 'agentic_memory_evolution',

	/** Default number of memories before triggering evolution */
	EVOLUTION_THRESHOLD: 100,

	/** Default maximum number of related memories to consider */
	MAX_RELATED_MEMORIES: 5,

	/** Default similarity threshold for relationships */
	SIMILARITY_THRESHOLD: 0.7,

	/** Default maximum search results */
	MAX_SEARCH_RESULTS: 10,

	/** Default auto-evolution setting */
	AUTO_EVOLUTION: true,

	/** Default memory category */
	DEFAULT_CATEGORY: 'Uncategorized',

	/** Default context */
	DEFAULT_CONTEXT: 'General',
} as const;

/**
 * Memory evolution types
 */
export const EVOLUTION_TYPES = {
	STRENGTHEN: 'strengthen',
	UPDATE_NEIGHBOR: 'update_neighbor',
	CONSOLIDATE: 'consolidate',
	LINK_CREATION: 'link_creation',
} as const;

/**
 * Memory relationship types
 */
export const RELATIONSHIP_TYPES = {
	SEMANTIC: 'semantic',
	TEMPORAL: 'temporal',
	CATEGORICAL: 'categorical',
	EXPLICIT: 'explicit',
} as const;

/**
 * System prompts for LLM analysis
 */
export const SYSTEM_PROMPTS = {
	CONTENT_ANALYSIS: `Generate a structured analysis of the following content by:
1. Identifying the most salient keywords (focus on nouns, verbs, and key concepts)
2. Extracting core themes and contextual elements
3. Creating relevant categorical tags

Format the response as a JSON object:
{
    "keywords": [
        // several specific, distinct keywords that capture key concepts and terminology
        // Order from most to least important
        // Don't include keywords that are the name of the speaker or time
        // At least three keywords, but don't be too redundant.
    ],
    "context": 
        // one sentence summarizing:
        // - Main topic/domain
        // - Key arguments/points
        // - Intended audience/purpose
    ,
    "tags": [
        // several broad categories/themes for classification
        // Include domain, format, and type tags
        // At least three tags, but don't be too redundant.
    ]
}

Content for analysis:`,

	MEMORY_EVOLUTION: `You are an AI memory evolution agent responsible for managing and evolving a knowledge base.
Analyze the new memory note according to keywords and context, also with their several nearest neighbors memory.
Make decisions about its evolution.

The new memory context:
{context}
content: {content}
keywords: {keywords}

The nearest neighbors memories:
{nearest_neighbors_memories}

Based on this information, determine:
1. Should this memory be evolved? Consider its relationships with other memories.
2. What specific actions should be taken (strengthen, update_neighbor)?
   2.1 If choose to strengthen the connection, which memory should it be connected to? Can you give the updated tags of this memory?
   2.2 If choose to update_neighbor, you can update the context and tags of these memories based on the understanding of these memories. If the context and the tags are not updated, the new context and tags should be the same as the original ones. Generate the new context and tags in the sequential order of the input neighbors.
Tags should be determined by the content of these characteristic of these memories, which can be used to retrieve them later and categorize them.
Note that the length of new_tags_neighborhood must equal the number of input neighbors, and the length of new_context_neighborhood must equal the number of input neighbors.
The number of neighbors is {neighbor_number}.
Return your decision in JSON format with the following structure:
{
    "should_evolve": True or False,
    "actions": ["strengthen", "update_neighbor"],
    "suggested_connections": ["neighbor_memory_ids"],
    "tags_to_update": ["tag_1",...,"tag_n"], 
    "new_context_neighborhood": ["new context",...,"new context"],
    "new_tags_neighborhood": [["tag_1",...,"tag_n"],...["tag_1",...,"tag_n"]],
}`,
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
	MEMORY_NOT_FOUND: 'Memory note not found',
	INVALID_MEMORY_ID: 'Invalid memory ID provided',
	CONTENT_ANALYSIS_FAILED: 'Failed to analyze memory content',
	EVOLUTION_FAILED: 'Memory evolution failed',
	VECTOR_STORE_ERROR: 'Vector store operation failed',
	LLM_SERVICE_ERROR: 'LLM service operation failed',
	EMBEDDING_SERVICE_ERROR: 'Embedding service operation failed',
	INVALID_CONFIGURATION: 'Invalid memory system configuration',
	SYSTEM_NOT_CONNECTED: 'Memory system is not connected',
	CONSOLIDATION_FAILED: 'Memory consolidation failed',
} as const;

/**
 * Log prefixes for consistent logging
 */
export const LOG_PREFIXES = {
	MEMORY_SYSTEM: '[AgenticMemory]',
	EVOLUTION_ENGINE: '[MemoryEvolution]',
	CONTENT_ANALYZER: '[ContentAnalyzer]',
	RELATIONSHIP_MANAGER: '[RelationshipManager]',
	CONSOLIDATION_MANAGER: '[ConsolidationManager]',
	MEMORY_STORAGE: '[MemoryStorage]',
} as const;

/**
 * Vector store metadata keys
 */
export const METADATA_KEYS = {
	ID: 'id',
	CONTENT: 'content',
	KEYWORDS: 'keywords',
	CONTEXT: 'context',
	TAGS: 'tags',
	LINKS: 'links',
	CATEGORY: 'category',
	TIMESTAMP: 'timestamp',
	LAST_ACCESSED: 'last_accessed',
	RETRIEVAL_COUNT: 'retrieval_count',
	EVOLUTION_HISTORY: 'evolution_history',
	METADATA: 'metadata',
} as const;

/**
 * Time format constants
 */
export const TIME_FORMAT = {
	TIMESTAMP_FORMAT: 'YYYYMMDDHHMM',
	ISO_FORMAT: 'YYYY-MM-DDTHH:mm:ss.sssZ',
} as const;

/**
 * Search configuration
 */
export const SEARCH_CONFIG = {
	/** Default number of results to return */
	DEFAULT_K: 5,

	/** Maximum number of results allowed */
	MAX_K: 100,

	/** Default similarity threshold */
	DEFAULT_SIMILARITY_THRESHOLD: 0.5,

	/** Weight for semantic similarity in hybrid search */
	SEMANTIC_WEIGHT: 0.6,

	/** Weight for keyword matching in hybrid search */
	KEYWORD_WEIGHT: 0.3,

	/** Weight for context relevance in hybrid search */
	CONTEXT_WEIGHT: 0.1,
} as const;

/**
 * Evolution configuration
 */
export const EVOLUTION_CONFIG = {
	/** Minimum number of related memories needed for evolution */
	MIN_RELATED_MEMORIES: 2,

	/** Maximum number of evolution attempts per memory */
	MAX_EVOLUTION_ATTEMPTS: 3,

	/** Cooldown period between evolutions (in minutes) */
	EVOLUTION_COOLDOWN: 30,

	/** Maximum number of links a memory can have */
	MAX_MEMORY_LINKS: 10,
} as const;

/**
 * Performance configuration
 */
export const PERFORMANCE_CONFIG = {
	/** Batch size for memory operations */
	BATCH_SIZE: 100,

	/** Timeout for LLM operations (in milliseconds) */
	LLM_TIMEOUT: 30000,

	/** Timeout for vector operations (in milliseconds) */
	VECTOR_TIMEOUT: 10000,

	/** Maximum retry attempts for failed operations */
	MAX_RETRIES: 3,

	/** Retry delay in milliseconds */
	RETRY_DELAY: 1000,
} as const;

/**
 * Validation rules
 */
export const VALIDATION_RULES = {
	/** Minimum content length */
	MIN_CONTENT_LENGTH: 10,

	/** Maximum content length */
	MAX_CONTENT_LENGTH: 50000,

	/** Maximum number of keywords */
	MAX_KEYWORDS: 20,

	/** Maximum number of tags */
	MAX_TAGS: 10,

	/** Maximum context length */
	MAX_CONTEXT_LENGTH: 1000,

	/** Maximum category length */
	MAX_CATEGORY_LENGTH: 100,
} as const;
