/**
 * Embedding System Constants
 *
 * Centralized constants for the embedding system including defaults,
 * supported models, timeouts, and other configuration values.
 *
 * @module embedding/constants
 */

/**
 * Supported embedding provider types
 */
export const PROVIDER_TYPES = {
	OPENAI: 'openai',
	GEMINI: 'gemini',
	OLLAMA: 'ollama',
	VOYAGE: 'voyage',
	QWEN: 'qwen',
	AWS_BEDROCK: 'aws-bedrock',
	LMSTUDIO: 'lmstudio',
} as const;

/**
 * OpenAI embedding models with their specifications
 */
export const OPENAI_MODELS = {
	/** Latest small embedding model (1536 dimensions) */
	TEXT_EMBEDDING_3_SMALL: 'text-embedding-3-small',
	/** Latest large embedding model (3072 dimensions) */
	TEXT_EMBEDDING_3_LARGE: 'text-embedding-3-large',
	/** Legacy Ada v2 model (1536 dimensions) */
	TEXT_EMBEDDING_ADA_002: 'text-embedding-ada-002',
} as const;

/**
 * Gemini embedding models with their specifications
 */
export const GEMINI_MODELS = {
	/** Latest Gemini embedding model (768, 1536, or 3072 dimensions) */
	TEXT_EMBEDDING_004: 'text-embedding-004',
	/** Gemini embedding model (768, 1536, or 3072 dimensions) */
	GEMINI_EMBEDDING_001: 'gemini-embedding-001',
	/** Previous Gemini embedding model (768 dimensions) */
	EMBEDDING_001: 'embedding-001',
} as const;

/**
 * Popular Ollama embedding models
 */
export const OLLAMA_MODELS = {
	/** Nomic Embed text model */
	NOMIC_EMBED_TEXT: 'nomic-embed-text',
	/** All-MiniLM model */
	ALL_MINILM: 'all-minilm',
	/** MXBAI Embed Large */
	MXBAI_EMBED_LARGE: 'mxbai-embed-large',
} as const;

/**
 * Voyage AI embedding models with their specifications
 */
export const VOYAGE_MODELS = {
	/** Latest Voyage 3 large model (1024 dimensions) */
	VOYAGE_3_LARGE: 'voyage-3-large',
	/** Standard Voyage 3 model (1024 dimensions) */
	VOYAGE_3: 'voyage-3',
	/** Previous Voyage 2 model (1024 dimensions) */
	VOYAGE_2: 'voyage-2',
} as const;

/**
 * Qwen (Alibaba Cloud) embedding models with their specifications
 */
export const QWEN_MODELS = {
	/** Qwen multilingual text embedding model (1024/768/512 dimensions) */
	TEXT_EMBEDDING_V3: 'text-embedding-v3',
} as const;

/**
 * AWS Bedrock embedding models with their specifications
 */
export const AWS_BEDROCK_MODELS = {
	/** Amazon Titan Text Embeddings V2 (1024/512/256 dimensions) */
	TITAN_EMBED_TEXT_V2: 'amazon.titan-embed-text-v2:0',
	/** Cohere Embed English V3 (1024 dimensions) */
	COHERE_EMBED_ENGLISH_V3: 'cohere.embed-english-v3',
} as const;

/**
 * LM Studio embedding models with their specifications
 */
export const LMSTUDIO_MODELS = {
	/** Nomic Embed Text v1.5 (768 dimensions) */
	NOMIC_EMBED_TEXT_V1_5: 'nomic-embed-text-v1.5',
	/** Alternative Nomic model name */
	TEXT_EMBEDDING_NOMIC_EMBED_TEXT_V1_5: 'text-embedding-nomic-embed-text-v1.5',
	/** BGE Large (1024 dimensions) */
	BGE_LARGE: 'bge-large',
	/** BGE Base (768 dimensions) */
	BGE_BASE: 'bge-base',
	/** BGE Small (384 dimensions) */
	BGE_SMALL: 'bge-small',
	/** All-MiniLM (384 dimensions) */
	ALL_MINILM: 'all-minilm',
} as const;

/**
 * Model dimension specifications
 */
export const MODEL_DIMENSIONS = {
	[OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL]: 1536,
	[OPENAI_MODELS.TEXT_EMBEDDING_3_LARGE]: 3072,
	[OPENAI_MODELS.TEXT_EMBEDDING_ADA_002]: 1536,
	[GEMINI_MODELS.TEXT_EMBEDDING_004]: 768, // Default, configurable up to 3072
	[GEMINI_MODELS.GEMINI_EMBEDDING_001]: 768, // Default, configurable up to 3072
	[GEMINI_MODELS.EMBEDDING_001]: 768,
	[OLLAMA_MODELS.NOMIC_EMBED_TEXT]: 768,
	[OLLAMA_MODELS.ALL_MINILM]: 384,
	[OLLAMA_MODELS.MXBAI_EMBED_LARGE]: 1024,
	[VOYAGE_MODELS.VOYAGE_3_LARGE]: 1024,
	[VOYAGE_MODELS.VOYAGE_3]: 1024,
	[VOYAGE_MODELS.VOYAGE_2]: 1024,
	[QWEN_MODELS.TEXT_EMBEDDING_V3]: 1024, // Default, configurable to 768 or 512
	[AWS_BEDROCK_MODELS.TITAN_EMBED_TEXT_V2]: 1024, // Default, configurable to 512 or 256
	[AWS_BEDROCK_MODELS.COHERE_EMBED_ENGLISH_V3]: 1024,
	[LMSTUDIO_MODELS.NOMIC_EMBED_TEXT_V1_5]: 768,
	[LMSTUDIO_MODELS.TEXT_EMBEDDING_NOMIC_EMBED_TEXT_V1_5]: 768,
	[LMSTUDIO_MODELS.BGE_LARGE]: 1024,
	[LMSTUDIO_MODELS.BGE_BASE]: 768,
	[LMSTUDIO_MODELS.BGE_SMALL]: 384,
	// Note: ALL_MINILM already defined in OLLAMA_MODELS with same dimensions
} as const;

/**
 * Maximum input limits for different models
 */
export const MODEL_INPUT_LIMITS = {
	[OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL]: 8191, // tokens
	[OPENAI_MODELS.TEXT_EMBEDDING_3_LARGE]: 8191, // tokens
	[OPENAI_MODELS.TEXT_EMBEDDING_ADA_002]: 8191, // tokens
} as const;

/**
 * Default configuration values
 */
export const DEFAULTS = {
	/** Default OpenAI model */
	OPENAI_MODEL: OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL,

	/** Default Gemini model */
	GEMINI_MODEL: GEMINI_MODELS.GEMINI_EMBEDDING_001,

	/** Default Ollama model */
	OLLAMA_MODEL: OLLAMA_MODELS.NOMIC_EMBED_TEXT,

	/** Default LM Studio model */
	LMSTUDIO_MODEL: LMSTUDIO_MODELS.NOMIC_EMBED_TEXT_V1_5,

	/** Default request timeout in milliseconds */
	TIMEOUT: 30000, // 30 seconds

	/** Default maximum retry attempts */
	MAX_RETRIES: 3,

	/** Default batch size for batch operations */
	BATCH_SIZE: 100,

	/** Default OpenAI API base URL */
	OPENAI_BASE_URL: 'https://api.openai.com/v1',

	/** Default Gemini API base URL */
	GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',

	/** Default Ollama API base URL */
	OLLAMA_BASE_URL: 'http://localhost:11434/api',

	/** Default LM Studio API base URL */
	LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',

	/** Default embedding dimension */
	DIMENSION: MODEL_DIMENSIONS[OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL],
} as const;

/**
 * Rate limiting and retry configuration
 */
export const RETRY_CONFIG = {
	/** Initial retry delay in milliseconds */
	INITIAL_DELAY: 1000,

	/** Maximum retry delay in milliseconds */
	MAX_DELAY: 60000,

	/** Backoff multiplier for exponential backoff */
	BACKOFF_MULTIPLIER: 2,

	/** Jitter factor for randomizing retry delays */
	JITTER_FACTOR: 0.1,
} as const;

/**
 * Validation limits
 */
export const VALIDATION_LIMITS = {
	/** Maximum text length for single embedding */
	MAX_TEXT_LENGTH: 32768, // characters

	/** Maximum number of texts in batch operation */
	MAX_BATCH_SIZE: 2048,

	/** Minimum text length (empty strings not allowed) */
	MIN_TEXT_LENGTH: 1,
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
	PROVIDER_NOT_SUPPORTED: (provider: string) => `Embedding provider '${provider}' is not supported`,

	MODEL_NOT_SUPPORTED: (model: string, provider: string) =>
		`Model '${model}' is not supported by provider '${provider}'`,

	API_KEY_REQUIRED: (provider: string) => `API key is required for provider '${provider}'`,

	CONNECTION_FAILED: (provider: string) => `Failed to connect to ${provider} embedding service`,

	TEXT_TOO_LONG: (length: number, max: number) =>
		`Text length ${length} exceeds maximum of ${max} characters`,

	BATCH_TOO_LARGE: (size: number, max: number) =>
		`Batch size ${size} exceeds maximum of ${max} items`,

	EMPTY_TEXT: 'Text cannot be empty',

	DIMENSION_MISMATCH: (expected: number, actual: number) =>
		`Expected embedding dimension ${expected}, but got ${actual}`,

	RATE_LIMIT_EXCEEDED: 'Rate limit exceeded for embedding provider',

	QUOTA_EXCEEDED: 'API quota exceeded for embedding provider',

	INVALID_API_KEY: (provider: string) => `Invalid API key for provider '${provider}'`,

	REQUEST_TIMEOUT: (timeout: number) => `Request timed out after ${timeout}ms`,
} as const;

/**
 * Log prefixes for different operations
 */
export const LOG_PREFIXES = {
	EMBEDDING: '[EMBEDDING]',
	OPENAI: '[EMBEDDING:OPENAI]',
	GEMINI: '[EMBEDDING:GEMINI]',
	OLLAMA: '[EMBEDDING:OLLAMA]',
	VOYAGE: '[EMBEDDING:VOYAGE]',
	QWEN: '[EMBEDDING:QWEN]',
	AWS_BEDROCK: '[EMBEDDING:AWS-BEDROCK]',
	LMSTUDIO: '[EMBEDDING:LMSTUDIO]',
	FACTORY: '[EMBEDDING:FACTORY]',
	MANAGER: '[EMBEDDING:MANAGER]',
	HEALTH: '[EMBEDDING:HEALTH]',
	BATCH: '[EMBEDDING:BATCH]',
	CIRCUIT_BREAKER: '[EMBEDDING:CIRCUIT-BREAKER]',
	FALLBACK: '[EMBEDDING:FALLBACK]',
} as const;

/**
 * Environment variable names
 */
export const ENV_VARS = {
	// OpenAI
	OPENAI_API_KEY: 'OPENAI_API_KEY',
	OPENAI_ORG_ID: 'OPENAI_ORG_ID',
	OPENAI_BASE_URL: 'OPENAI_BASE_URL',
	// Gemini
	GEMINI_API_KEY: 'GEMINI_API_KEY',
	GEMINI_BASE_URL: 'GEMINI_BASE_URL',
	// Ollama
	OLLAMA_BASE_URL: 'OLLAMA_BASE_URL',
	// LM Studio
	LMSTUDIO_BASE_URL: 'LMSTUDIO_BASE_URL',
	// General embedding config
	EMBEDDING_PROVIDER: 'EMBEDDING_PROVIDER',
	EMBEDDING_MODEL: 'EMBEDDING_MODEL',
	EMBEDDING_TIMEOUT: 'EMBEDDING_TIMEOUT',
	EMBEDDING_MAX_RETRIES: 'EMBEDDING_MAX_RETRIES',
	EMBEDDING_DIMENSIONS: 'EMBEDDING_DIMENSIONS',
	// Optional embedding configuration
	DISABLE_EMBEDDINGS: 'DISABLE_EMBEDDINGS',
	EMBEDDING_DISABLED: 'EMBEDDING_DISABLED',
} as const;

/**
 * HTTP status codes for API responses
 */
export const HTTP_STATUS = {
	OK: 200,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	TOO_MANY_REQUESTS: 429,
	INTERNAL_SERVER_ERROR: 500,
	SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Content types for API requests
 */
export const CONTENT_TYPES = {
	JSON: 'application/json',
} as const;
