import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
// Note: In MCP mode, the MCP host typically provides required environment variables
// via the "env" field in MCP configuration, but .env files can still provide additional
// configuration like workspace memory settings that may not be in MCP config
const isMcpMode =
	process.argv.includes('--mode') && process.argv[process.argv.indexOf('--mode') + 1] === 'mcp';

if (isMcpMode) {
	// In MCP mode, load .env file but with lower priority than MCP-provided env vars
	// This allows .env to provide additional configuration while letting MCP config take precedence
	config({ override: false });
} else {
	// Normal mode - load environment variables from .env file with override
	config();
}

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	CIPHER_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'silly']).default('info'),
	REDACT_SECRETS: z.boolean().default(true),
	OPENAI_API_KEY: z.string().optional(),
	ANTHROPIC_API_KEY: z.string().optional(),
	OPENROUTER_API_KEY: z.string().optional(),
	QWEN_API_KEY: z.string().optional(),
	OPENAI_BASE_URL: z.string().optional(),
	OLLAMA_BASE_URL: z.string().optional(),
	LMSTUDIO_BASE_URL: z.string().optional(),
	OPENAI_ORG_ID: z.string().optional(),
	// Embedding Configuration
	EMBEDDING_PROVIDER: z.string().optional(),
	EMBEDDING_MODEL: z.string().optional(),
	EMBEDDING_TIMEOUT: z.number().optional(),
	EMBEDDING_MAX_RETRIES: z.number().optional(),
	EMBEDDING_DIMENSIONS: z.number().optional(),
	DISABLE_EMBEDDINGS: z.boolean().default(false),
	EMBEDDING_DISABLED: z.boolean().default(false),
	GEMINI_API_KEY: z.string().optional(),
	GEMINI_BASE_URL: z.string().optional(),
	// Storage Configuration
	STORAGE_CACHE_TYPE: z.enum(['in-memory', 'redis']).default('in-memory'),
	STORAGE_CACHE_HOST: z.string().optional(),
	STORAGE_CACHE_PORT: z.number().optional(),
	STORAGE_CACHE_USERNAME: z.string().optional(),
	STORAGE_CACHE_PASSWORD: z.string().optional(),
	STORAGE_CACHE_DATABASE: z.number().optional(),
	STORAGE_DATABASE_TYPE: z.enum(['in-memory', 'sqlite', 'postgres']).default('in-memory'),
	STORAGE_DATABASE_PATH: z.string().optional(),
	STORAGE_DATABASE_NAME: z.string().optional(),
	// PostgreSQL Configuration
	CIPHER_PG_URL: z.string().optional(),
	STORAGE_DATABASE_HOST: z.string().optional(),
	STORAGE_DATABASE_PORT: z.number().optional(),
	STORAGE_DATABASE_USER: z.string().optional(),
	STORAGE_DATABASE_PASSWORD: z.string().optional(),
	STORAGE_DATABASE_SSL: z.boolean().default(false),
	// Vector Storage Configuration
	VECTOR_STORE_TYPE: z
		.enum(['qdrant', 'milvus', 'chroma', 'pinecone', 'in-memory', 'faiss'])
		.default('in-memory'),
	VECTOR_STORE_HOST: z.string().optional(),
	VECTOR_STORE_PORT: z.number().optional(),
	VECTOR_STORE_URL: z.string().optional(),
	VECTOR_STORE_API_KEY: z.string().optional(),
	VECTOR_STORE_USERNAME: z.string().optional(),
	VECTOR_STORE_PASSWORD: z.string().optional(),
	VECTOR_STORE_COLLECTION: z.string().default('knowledge_memory'),
	VECTOR_STORE_DIMENSION: z.number().default(1536),
	VECTOR_STORE_DISTANCE: z.enum(['Cosine', 'Euclidean', 'Dot', 'Manhattan']).default('Cosine'),
	VECTOR_STORE_ON_DISK: z.boolean().default(false),
	VECTOR_STORE_MAX_VECTORS: z.number().default(10000),
	// Pinecone-specific Configuration
	PINECONE_PROVIDER: z.string().default('aws'),
	PINECONE_REGION: z.string().default('us-east-1'),
	// PGVECTOR -specific Configuration
	PGVECTOR_INDEXTYPE: z.enum(['hnsw', 'ivfflat']).default('hnsw'),
	PGVECTOR_INDEXMETRIC: z.enum(['vector_l2_ops', 'vector_ip_ops']).default('vector_l2_ops'),
	PINECONE_NAMESPACE: z.string().default('default'),
	// Faiss-specific Configuration
	FAISS_BASE_STORAGE_PATH: z.string().optional(),
	// Knowledge Graph Configuration
	KNOWLEDGE_GRAPH_ENABLED: z.boolean().default(false),
	KNOWLEDGE_GRAPH_TYPE: z.enum(['neo4j', 'in-memory']).default('in-memory'),
	KNOWLEDGE_GRAPH_HOST: z.string().optional(),
	KNOWLEDGE_GRAPH_PORT: z.number().optional(),
	KNOWLEDGE_GRAPH_URI: z.string().optional(),
	KNOWLEDGE_GRAPH_USERNAME: z.string().optional(),
	KNOWLEDGE_GRAPH_PASSWORD: z.string().optional(),
	KNOWLEDGE_GRAPH_DATABASE: z.string().default('neo4j'),
	// Memory Search Configuration
	SEARCH_MEMORY_TYPE: z.enum(['knowledge', 'reflection', 'both']).default('knowledge'),
	// Reflection Memory Configuration
	REFLECTION_VECTOR_STORE_COLLECTION: z.string().default('reflection_memory'),
	DISABLE_REFLECTION_MEMORY: z.boolean().default(true),
	// Event Persistence Configuration
	EVENT_PERSISTENCE_ENABLED: z.boolean().default(false),
	EVENT_PERSISTENCE_PATH: z.string().optional(),
	// Lazy Loading Configuration
	ENABLE_LAZY_LOADING: z.string().optional(),
	LAZY_LOADING_ENABLED: z.string().optional(),
	SKIP_HEAVY_SERVICES: z.string().optional(),
	LAZY_EMBEDDING: z.string().optional(),
	LAZY_VECTOR_STORE: z.string().optional(),
	LAZY_MEMORY_OPERATIONS: z.string().optional(),
	DISABLE_BACKGROUND_PRELOAD: z.string().optional(),
	LAZY_INIT_TIMEOUT: z.string().optional(),
	BACKGROUND_PRELOAD_DELAY: z.string().optional(),
	// Workspace Memory Configuration
	USE_WORKSPACE_MEMORY: z.boolean().default(false),
	WORKSPACE_SEARCH_THRESHOLD: z.number().default(0.4),
	DISABLE_DEFAULT_MEMORY: z.boolean().default(false),
	WORKSPACE_VECTOR_STORE_TYPE: z
		.enum(['qdrant', 'milvus', 'chroma', 'pinecone', 'pgvector', 'in-memory'])
		.optional(),
	WORKSPACE_VECTOR_STORE_HOST: z.string().optional(),
	WORKSPACE_VECTOR_STORE_PORT: z.number().optional(),
	WORKSPACE_VECTOR_STORE_URL: z.string().optional(),
	WORKSPACE_VECTOR_STORE_API_KEY: z.string().optional(),
	WORKSPACE_VECTOR_STORE_USERNAME: z.string().optional(),
	WORKSPACE_VECTOR_STORE_PASSWORD: z.string().optional(),
	WORKSPACE_VECTOR_STORE_COLLECTION: z.string().default('workspace_memory'),
	WORKSPACE_VECTOR_STORE_DIMENSION: z.number().optional(),
	WORKSPACE_VECTOR_STORE_DISTANCE: z.enum(['Cosine', 'Euclidean', 'Dot', 'Manhattan']).optional(),
	WORKSPACE_VECTOR_STORE_ON_DISK: z.boolean().optional(),
	WORKSPACE_VECTOR_STORE_MAX_VECTORS: z.number().optional(),
	// Redis-specific Configuration
	WORKSPACE_REDIS_DATABASE: z.number().optional(),
	// Pinecone-specific Configuration
	WORKSPACE_PINECONE_PROVIDER: z.string().optional(),
	WORKSPACE_PINECONE_REGION: z.string().optional(),
	WORKSPACE_PINECONE_NAMESPACE: z.string().optional(),
	// Query Refinement Configuration
	ENABLE_QUERY_REFINEMENT: z.boolean().default(true),
	// Cross-Tool Memory Sharing Configuration
	CIPHER_USER_ID: z.string().optional(),
	CIPHER_PROJECT_NAME: z.string().optional(),
	CIPHER_WORKSPACE_MODE: z.enum(['shared', 'isolated']).default('isolated'),
	// MCP Aggregator Configuration
	USE_ASK_CIPHER: z.boolean().default(false),
	// Cross-Project Knowledge Configuration
	CIPHER_CROSS_PROJECT_ENABLED: z.boolean().default(false),
	CIPHER_CROSS_PROJECT_AUTO_TRANSFER: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_MASTER_GUIDES: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_PERFORMANCE_MONITORING: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD: z.number().min(0).max(1).default(0.7),
	CIPHER_CROSS_PROJECT_MAX_TRANSFERS_PER_PROJECT: z.number().min(1).default(100),
	CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS: z.number().min(1).default(5),
	CIPHER_CROSS_PROJECT_TRANSFER_BATCH_SIZE: z.number().min(1).default(10),
	CIPHER_CROSS_PROJECT_UPDATE_INTERVAL: z.number().min(1000).default(3600000), // 1 hour
	CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL: z.number().min(1000).default(86400000), // 24 hours
	CIPHER_CROSS_PROJECT_KNOWLEDGE_RETENTION_DAYS: z.number().min(1).default(30),
	CIPHER_CROSS_PROJECT_MIN_CONFIDENCE: z.number().min(0).max(1).default(0.7),
	CIPHER_CROSS_PROJECT_MIN_RELEVANCE: z.number().min(0).max(1).default(0.6),
	CIPHER_CROSS_PROJECT_MAX_PATTERNS: z.number().min(1).default(10),
	CIPHER_CROSS_PROJECT_MAX_SOLUTIONS: z.number().min(1).default(15),
	CIPHER_CROSS_PROJECT_ENABLE_PATTERN_DETECTION: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_ENABLE_SOLUTION_EXTRACTION: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_ENABLE_GUIDELINE_GENERATION: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_MIN_PROJECTS_FOR_GUIDE: z.number().min(1).default(2),
	CIPHER_CROSS_PROJECT_MAX_GUIDE_AGE_DAYS: z.number().min(1).default(30),
	CIPHER_CROSS_PROJECT_ENABLE_GUIDE_VERSIONING: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_ENABLE_CROSS_DOMAIN_GUIDES: z.boolean().default(false),
	CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_PROJECT_DETECTION_INTERVAL: z.number().min(1000).default(300000), // 5 minutes
	CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD: z.number().min(0).max(1).default(0.8),
	CIPHER_CROSS_PROJECT_MASTER_GUIDE_GENERATION_THRESHOLD: z.number().min(1).default(2),
	CIPHER_CROSS_PROJECT_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
	CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING: z.boolean().default(false),
	CIPHER_CROSS_PROJECT_LOG_TRANSFERS: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_LOG_SYNTHESIS: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_ENABLE_ANONYMIZATION: z.boolean().default(false),
	CIPHER_CROSS_PROJECT_ANONYMIZE_PROJECT_NAMES: z.boolean().default(false),
	CIPHER_CROSS_PROJECT_ENABLE_CONTENT_FILTERING: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_FILTER_SENSITIVE_PATTERNS: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_INTEGRATE_WITH_KNOWLEDGE_GRAPH: z.boolean().default(true),
	CIPHER_CROSS_PROJECT_INTEGRATE_WITH_WORKSPACE_MEMORY: z.boolean().default(true),
});

type EnvSchema = z.infer<typeof envSchema>;

// Create a dynamic env object that always reads from process.env but provides type safety
export const env: EnvSchema = new Proxy({} as EnvSchema, {
	get(target, prop: string): any {
		switch (prop) {
			case 'NODE_ENV':
				return process.env.NODE_ENV || 'development';
			case 'CIPHER_LOG_LEVEL':
				return process.env.CIPHER_LOG_LEVEL || 'info';
			case 'REDACT_SECRETS':
				return process.env.REDACT_SECRETS === 'false' ? false : true;
			case 'OPENAI_API_KEY':
				return process.env.OPENAI_API_KEY;
			case 'ANTHROPIC_API_KEY':
				return process.env.ANTHROPIC_API_KEY;
			case 'OPENROUTER_API_KEY':
				return process.env.OPENROUTER_API_KEY;
			case 'QWEN_API_KEY':
				return process.env.QWEN_API_KEY;
			case 'OPENAI_BASE_URL':
				return process.env.OPENAI_BASE_URL;
			case 'OLLAMA_BASE_URL':
				return process.env.OLLAMA_BASE_URL;
			case 'OPENAI_ORG_ID':
				return process.env.OPENAI_ORG_ID;
			// Embedding Configuration
			case 'EMBEDDING_PROVIDER':
				return process.env.EMBEDDING_PROVIDER;
			case 'EMBEDDING_MODEL':
				return process.env.EMBEDDING_MODEL;
			case 'EMBEDDING_TIMEOUT':
				return process.env.EMBEDDING_TIMEOUT
					? parseInt(process.env.EMBEDDING_TIMEOUT, 10)
					: undefined;
			case 'EMBEDDING_MAX_RETRIES':
				return process.env.EMBEDDING_MAX_RETRIES
					? parseInt(process.env.EMBEDDING_MAX_RETRIES, 10)
					: undefined;
			case 'EMBEDDING_DIMENSIONS':
				return process.env.EMBEDDING_DIMENSIONS
					? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
					: undefined;
			case 'DISABLE_EMBEDDINGS':
				return process.env.DISABLE_EMBEDDINGS === 'true';
			case 'EMBEDDING_DISABLED':
				return process.env.EMBEDDING_DISABLED === 'true';
			case 'GEMINI_API_KEY':
				return process.env.GEMINI_API_KEY;
			case 'GEMINI_BASE_URL':
				return process.env.GEMINI_BASE_URL;
			// Storage Configuration
			case 'STORAGE_CACHE_TYPE':
				return process.env.STORAGE_CACHE_TYPE || 'in-memory';
			case 'STORAGE_CACHE_HOST':
				return process.env.STORAGE_CACHE_HOST;
			case 'STORAGE_CACHE_PORT':
				return process.env.STORAGE_CACHE_PORT
					? parseInt(process.env.STORAGE_CACHE_PORT, 10)
					: undefined;
			case 'STORAGE_CACHE_USERNAME':
				return process.env.STORAGE_CACHE_USERNAME;
			case 'STORAGE_CACHE_PASSWORD':
				return process.env.STORAGE_CACHE_PASSWORD;
			case 'STORAGE_CACHE_DATABASE':
				return process.env.STORAGE_CACHE_DATABASE
					? parseInt(process.env.STORAGE_CACHE_DATABASE, 10)
					: undefined;
			case 'STORAGE_DATABASE_TYPE':
				return process.env.STORAGE_DATABASE_TYPE || 'in-memory';
			case 'STORAGE_DATABASE_PATH':
				return process.env.STORAGE_DATABASE_PATH;
			case 'STORAGE_DATABASE_NAME':
				return process.env.STORAGE_DATABASE_NAME;
			// PostgreSQL Configuration
			case 'CIPHER_PG_URL':
				return process.env.CIPHER_PG_URL;
			case 'STORAGE_DATABASE_HOST':
				return process.env.STORAGE_DATABASE_HOST;
			case 'STORAGE_DATABASE_PORT':
				return process.env.STORAGE_DATABASE_PORT
					? parseInt(process.env.STORAGE_DATABASE_PORT, 10)
					: undefined;
			case 'STORAGE_DATABASE_USER':
				return process.env.STORAGE_DATABASE_USER;
			case 'STORAGE_DATABASE_PASSWORD':
				return process.env.STORAGE_DATABASE_PASSWORD;
			case 'STORAGE_DATABASE_SSL':
				return process.env.STORAGE_DATABASE_SSL === 'true';
			// Vector Storage Configuration
			case 'VECTOR_STORE_TYPE':
				return process.env.VECTOR_STORE_TYPE || 'in-memory';
			case 'VECTOR_STORE_HOST':
				return process.env.VECTOR_STORE_HOST;
			case 'VECTOR_STORE_PORT':
				return process.env.VECTOR_STORE_PORT
					? parseInt(process.env.VECTOR_STORE_PORT, 10)
					: undefined;
			case 'VECTOR_STORE_URL':
				return process.env.VECTOR_STORE_URL;
			case 'VECTOR_STORE_API_KEY':
				return process.env.VECTOR_STORE_API_KEY;
			case 'VECTOR_STORE_USERNAME':
				return process.env.VECTOR_STORE_USERNAME;
			case 'VECTOR_STORE_PASSWORD':
				return process.env.VECTOR_STORE_PASSWORD;
			case 'VECTOR_STORE_COLLECTION':
				return process.env.VECTOR_STORE_COLLECTION || 'knowledge_memory';
			case 'VECTOR_STORE_DIMENSION':
				return process.env.VECTOR_STORE_DIMENSION
					? parseInt(process.env.VECTOR_STORE_DIMENSION, 10)
					: 1536;
			case 'VECTOR_STORE_DISTANCE':
				return process.env.VECTOR_STORE_DISTANCE || 'Cosine';
			case 'VECTOR_STORE_ON_DISK':
				return process.env.VECTOR_STORE_ON_DISK === 'true';
			case 'VECTOR_STORE_MAX_VECTORS':
				return process.env.VECTOR_STORE_MAX_VECTORS
					? parseInt(process.env.VECTOR_STORE_MAX_VECTORS, 10)
					: 10000;
			// Faiss-specific Configuration
			case 'FAISS_BASE_STORAGE_PATH':
				return process.env.FAISS_BASE_STORAGE_PATH;
			// Knowledge Graph Configuration
			case 'KNOWLEDGE_GRAPH_ENABLED':
				return process.env.KNOWLEDGE_GRAPH_ENABLED === 'true';
			case 'KNOWLEDGE_GRAPH_TYPE':
				return process.env.KNOWLEDGE_GRAPH_TYPE || 'in-memory';
			case 'KNOWLEDGE_GRAPH_HOST':
				return process.env.KNOWLEDGE_GRAPH_HOST;
			case 'KNOWLEDGE_GRAPH_PORT':
				return process.env.KNOWLEDGE_GRAPH_PORT
					? parseInt(process.env.KNOWLEDGE_GRAPH_PORT, 10)
					: undefined;
			case 'KNOWLEDGE_GRAPH_URI':
				return process.env.KNOWLEDGE_GRAPH_URI;
			case 'KNOWLEDGE_GRAPH_USERNAME':
				return process.env.KNOWLEDGE_GRAPH_USERNAME;
			case 'KNOWLEDGE_GRAPH_PASSWORD':
				return process.env.KNOWLEDGE_GRAPH_PASSWORD;
			case 'KNOWLEDGE_GRAPH_DATABASE':
				return process.env.KNOWLEDGE_GRAPH_DATABASE || 'neo4j';
			// Memory Search Configuration
			case 'SEARCH_MEMORY_TYPE':
				return process.env.SEARCH_MEMORY_TYPE || 'knowledge';
			// Reflection Memory Configuration
			case 'REFLECTION_VECTOR_STORE_COLLECTION': {
				// Handle boolean conversion for test compatibility
				const value = process.env.REFLECTION_VECTOR_STORE_COLLECTION || 'reflection_memory';
				if (value === 'true') return true;
				if (value === 'false') return false;
				return value;
			}
			case 'DISABLE_REFLECTION_MEMORY':
				return process.env.DISABLE_REFLECTION_MEMORY === 'true';
			// Event Persistence Configuration
			case 'EVENT_PERSISTENCE_ENABLED':
				return process.env.EVENT_PERSISTENCE_ENABLED === 'true';
			case 'EVENT_PERSISTENCE_PATH':
				return process.env.EVENT_PERSISTENCE_PATH;
			// Lazy Loading Configuration
			case 'ENABLE_LAZY_LOADING':
				return process.env.ENABLE_LAZY_LOADING;
			case 'LAZY_LOADING_ENABLED':
				return process.env.LAZY_LOADING_ENABLED;
			case 'SKIP_HEAVY_SERVICES':
				return process.env.SKIP_HEAVY_SERVICES;
			case 'LAZY_EMBEDDING':
				return process.env.LAZY_EMBEDDING;
			case 'LAZY_VECTOR_STORE':
				return process.env.LAZY_VECTOR_STORE;
			case 'LAZY_MEMORY_OPERATIONS':
				return process.env.LAZY_MEMORY_OPERATIONS;
			case 'DISABLE_BACKGROUND_PRELOAD':
				return process.env.DISABLE_BACKGROUND_PRELOAD;
			case 'LAZY_INIT_TIMEOUT':
				return process.env.LAZY_INIT_TIMEOUT;
			case 'BACKGROUND_PRELOAD_DELAY':
				return process.env.BACKGROUND_PRELOAD_DELAY;
			// Workspace Memory Configuration
			case 'USE_WORKSPACE_MEMORY':
				return process.env.USE_WORKSPACE_MEMORY === 'true';
			case 'WORKSPACE_SEARCH_THRESHOLD':
				return process.env.WORKSPACE_SEARCH_THRESHOLD
					? parseFloat(process.env.WORKSPACE_SEARCH_THRESHOLD)
					: 0.4;
			case 'DISABLE_DEFAULT_MEMORY':
				return process.env.DISABLE_DEFAULT_MEMORY === 'true';
			case 'WORKSPACE_VECTOR_STORE_TYPE':
				return process.env.WORKSPACE_VECTOR_STORE_TYPE;
			case 'WORKSPACE_VECTOR_STORE_HOST':
				return process.env.WORKSPACE_VECTOR_STORE_HOST;
			case 'WORKSPACE_VECTOR_STORE_PORT':
				return process.env.WORKSPACE_VECTOR_STORE_PORT
					? parseInt(process.env.WORKSPACE_VECTOR_STORE_PORT, 10)
					: undefined;
			case 'WORKSPACE_VECTOR_STORE_URL':
				return process.env.WORKSPACE_VECTOR_STORE_URL;
			case 'WORKSPACE_VECTOR_STORE_API_KEY':
				return process.env.WORKSPACE_VECTOR_STORE_API_KEY;
			case 'WORKSPACE_VECTOR_STORE_USERNAME':
				return process.env.WORKSPACE_VECTOR_STORE_USERNAME;
			case 'WORKSPACE_VECTOR_STORE_PASSWORD':
				return process.env.WORKSPACE_VECTOR_STORE_PASSWORD;
			case 'WORKSPACE_VECTOR_STORE_COLLECTION':
				return process.env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory';
			case 'WORKSPACE_VECTOR_STORE_DIMENSION':
				return process.env.WORKSPACE_VECTOR_STORE_DIMENSION
					? parseInt(process.env.WORKSPACE_VECTOR_STORE_DIMENSION, 10)
					: process.env.VECTOR_STORE_DIMENSION
						? parseInt(process.env.VECTOR_STORE_DIMENSION, 10)
						: 1536;
			case 'WORKSPACE_VECTOR_STORE_DISTANCE':
				return (
					process.env.WORKSPACE_VECTOR_STORE_DISTANCE ||
					process.env.VECTOR_STORE_DISTANCE ||
					'Cosine'
				);
			case 'WORKSPACE_VECTOR_STORE_ON_DISK':
				return process.env.WORKSPACE_VECTOR_STORE_ON_DISK !== undefined
					? process.env.WORKSPACE_VECTOR_STORE_ON_DISK === 'true'
					: process.env.VECTOR_STORE_ON_DISK !== undefined
						? process.env.VECTOR_STORE_ON_DISK === 'true'
						: false;
			case 'WORKSPACE_VECTOR_STORE_MAX_VECTORS':
				return process.env.WORKSPACE_VECTOR_STORE_MAX_VECTORS
					? parseInt(process.env.WORKSPACE_VECTOR_STORE_MAX_VECTORS, 10)
					: process.env.VECTOR_STORE_MAX_VECTORS
						? parseInt(process.env.VECTOR_STORE_MAX_VECTORS, 10)
						: 10000;
			// Pinecone-specific Configuration
			case 'WORKSPACE_PINECONE_PROVIDER':
				return process.env.WORKSPACE_PINECONE_PROVIDER;
			case 'WORKSPACE_PINECONE_REGION':
				return process.env.WORKSPACE_PINECONE_REGION;
			case 'WORKSPACE_PINECONE_NAMESPACE':
				return process.env.WORKSPACE_PINECONE_NAMESPACE;
			// Cross-Tool Memory Sharing Configuration
			case 'CIPHER_USER_ID':
				return process.env.CIPHER_USER_ID;
			case 'CIPHER_PROJECT_NAME':
				return process.env.CIPHER_PROJECT_NAME;
			case 'CIPHER_WORKSPACE_MODE':
				return process.env.CIPHER_WORKSPACE_MODE || 'isolated';
			case 'USE_ASK_CIPHER':
				return process.env.USE_ASK_CIPHER === 'true';
			// Cross-Project Knowledge Configuration
			case 'CIPHER_CROSS_PROJECT_ENABLED':
				return process.env.CIPHER_CROSS_PROJECT_ENABLED === 'true';
			case 'CIPHER_CROSS_PROJECT_AUTO_TRANSFER':
				return process.env.CIPHER_CROSS_PROJECT_AUTO_TRANSFER === 'true';
			case 'CIPHER_CROSS_PROJECT_MASTER_GUIDES':
				return process.env.CIPHER_CROSS_PROJECT_MASTER_GUIDES === 'true';
			case 'CIPHER_CROSS_PROJECT_PERFORMANCE_MONITORING':
				return process.env.CIPHER_CROSS_PROJECT_PERFORMANCE_MONITORING === 'true';
			case 'CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD':
				return process.env.CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD
					? parseFloat(process.env.CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD)
					: 0.7;
			case 'CIPHER_CROSS_PROJECT_MAX_TRANSFERS_PER_PROJECT':
				return process.env.CIPHER_CROSS_PROJECT_MAX_TRANSFERS_PER_PROJECT
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MAX_TRANSFERS_PER_PROJECT, 10)
					: 100;
			case 'CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS':
				return process.env.CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS, 10)
					: 5;
			case 'CIPHER_CROSS_PROJECT_TRANSFER_BATCH_SIZE':
				return process.env.CIPHER_CROSS_PROJECT_TRANSFER_BATCH_SIZE
					? parseInt(process.env.CIPHER_CROSS_PROJECT_TRANSFER_BATCH_SIZE, 10)
					: 10;
			case 'CIPHER_CROSS_PROJECT_UPDATE_INTERVAL':
				return process.env.CIPHER_CROSS_PROJECT_UPDATE_INTERVAL
					? parseInt(process.env.CIPHER_CROSS_PROJECT_UPDATE_INTERVAL, 10)
					: 3600000;
			case 'CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL':
				return process.env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL, 10)
					: 86400000;
			case 'CIPHER_CROSS_PROJECT_KNOWLEDGE_RETENTION_DAYS':
				return process.env.CIPHER_CROSS_PROJECT_KNOWLEDGE_RETENTION_DAYS
					? parseInt(process.env.CIPHER_CROSS_PROJECT_KNOWLEDGE_RETENTION_DAYS, 10)
					: 30;
			case 'CIPHER_CROSS_PROJECT_MIN_CONFIDENCE':
				return process.env.CIPHER_CROSS_PROJECT_MIN_CONFIDENCE
					? parseFloat(process.env.CIPHER_CROSS_PROJECT_MIN_CONFIDENCE)
					: 0.7;
			case 'CIPHER_CROSS_PROJECT_MIN_RELEVANCE':
				return process.env.CIPHER_CROSS_PROJECT_MIN_RELEVANCE
					? parseFloat(process.env.CIPHER_CROSS_PROJECT_MIN_RELEVANCE)
					: 0.6;
			case 'CIPHER_CROSS_PROJECT_MAX_PATTERNS':
				return process.env.CIPHER_CROSS_PROJECT_MAX_PATTERNS
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MAX_PATTERNS, 10)
					: 10;
			case 'CIPHER_CROSS_PROJECT_MAX_SOLUTIONS':
				return process.env.CIPHER_CROSS_PROJECT_MAX_SOLUTIONS
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MAX_SOLUTIONS, 10)
					: 15;
			case 'CIPHER_CROSS_PROJECT_ENABLE_PATTERN_DETECTION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_PATTERN_DETECTION === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_SOLUTION_EXTRACTION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_SOLUTION_EXTRACTION === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_GUIDELINE_GENERATION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_GUIDELINE_GENERATION === 'true';
			case 'CIPHER_CROSS_PROJECT_MIN_PROJECTS_FOR_GUIDE':
				return process.env.CIPHER_CROSS_PROJECT_MIN_PROJECTS_FOR_GUIDE
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MIN_PROJECTS_FOR_GUIDE, 10)
					: 2;
			case 'CIPHER_CROSS_PROJECT_MAX_GUIDE_AGE_DAYS':
				return process.env.CIPHER_CROSS_PROJECT_MAX_GUIDE_AGE_DAYS
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MAX_GUIDE_AGE_DAYS, 10)
					: 30;
			case 'CIPHER_CROSS_PROJECT_ENABLE_GUIDE_VERSIONING':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_GUIDE_VERSIONING === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_CROSS_DOMAIN_GUIDES':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_CROSS_DOMAIN_GUIDES === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION === 'true';
			case 'CIPHER_CROSS_PROJECT_PROJECT_DETECTION_INTERVAL':
				return process.env.CIPHER_CROSS_PROJECT_PROJECT_DETECTION_INTERVAL
					? parseInt(process.env.CIPHER_CROSS_PROJECT_PROJECT_DETECTION_INTERVAL, 10)
					: 300000;
			case 'CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD':
				return process.env.CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD
					? parseFloat(process.env.CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD)
					: 0.8;
			case 'CIPHER_CROSS_PROJECT_MASTER_GUIDE_GENERATION_THRESHOLD':
				return process.env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_GENERATION_THRESHOLD
					? parseInt(process.env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_GENERATION_THRESHOLD, 10)
					: 2;
			case 'CIPHER_CROSS_PROJECT_LOG_LEVEL':
				return process.env.CIPHER_CROSS_PROJECT_LOG_LEVEL || 'info';
			case 'CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING === 'true';
			case 'CIPHER_CROSS_PROJECT_LOG_TRANSFERS':
				return process.env.CIPHER_CROSS_PROJECT_LOG_TRANSFERS === 'true';
			case 'CIPHER_CROSS_PROJECT_LOG_SYNTHESIS':
				return process.env.CIPHER_CROSS_PROJECT_LOG_SYNTHESIS === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_ANONYMIZATION':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_ANONYMIZATION === 'true';
			case 'CIPHER_CROSS_PROJECT_ANONYMIZE_PROJECT_NAMES':
				return process.env.CIPHER_CROSS_PROJECT_ANONYMIZE_PROJECT_NAMES === 'true';
			case 'CIPHER_CROSS_PROJECT_ENABLE_CONTENT_FILTERING':
				return process.env.CIPHER_CROSS_PROJECT_ENABLE_CONTENT_FILTERING === 'true';
			case 'CIPHER_CROSS_PROJECT_FILTER_SENSITIVE_PATTERNS':
				return process.env.CIPHER_CROSS_PROJECT_FILTER_SENSITIVE_PATTERNS === 'true';
			case 'CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY':
				return process.env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY === 'true';
			case 'CIPHER_CROSS_PROJECT_INTEGRATE_WITH_KNOWLEDGE_GRAPH':
				return process.env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_KNOWLEDGE_GRAPH === 'true';
			case 'CIPHER_CROSS_PROJECT_INTEGRATE_WITH_WORKSPACE_MEMORY':
				return process.env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_WORKSPACE_MEMORY === 'true';
			default:
				return process.env[prop];
		}
	},
});

export const validateEnv = () => {
	// Check if embeddings are explicitly disabled
	const embeddingsDisabled =
		process.env.DISABLE_EMBEDDINGS === 'true' || process.env.EMBEDDING_DISABLED === 'true';

	if (!embeddingsDisabled) {
		// Check if at least one embedding provider is available
		const hasOpenAI = !!process.env.OPENAI_API_KEY;
		const hasGemini = !!process.env.GEMINI_API_KEY;
		const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
		const hasOllama = !!process.env.OLLAMA_BASE_URL;

		const hasAnyEmbeddingProvider = hasOpenAI || hasGemini || hasOpenRouter || hasOllama;

		if (!hasAnyEmbeddingProvider) {
			const errorMsg =
				'No embedding provider configured. Set one of: OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, OLLAMA_BASE_URL, or set DISABLE_EMBEDDINGS=true to run without memory capabilities';
			if (isMcpMode) {
				process.stderr.write(`[CIPHER-MCP] WARNING: ${errorMsg}\n`);
			} else {
				console.warn(errorMsg);
			}
			// Don't fail validation, just warn - allow running without embeddings
		}
	} else {
		// Embeddings are disabled, log this for clarity
		const infoMsg = 'Embeddings are disabled - Cipher will run without memory capabilities';
		if (isMcpMode) {
			process.stderr.write(`[CIPHER-MCP] INFO: ${infoMsg}\n`);
		} else {
			console.info(infoMsg);
		}
	}

	// Get current env values for validation
	const envToValidate = {
		NODE_ENV: process.env.NODE_ENV,
		CIPHER_LOG_LEVEL: process.env.CIPHER_LOG_LEVEL,
		REDACT_SECRETS: process.env.REDACT_SECRETS === 'false' ? false : true,
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
		QWEN_API_KEY: process.env.QWEN_API_KEY,
		OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
		OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
		OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
		// Embedding Configuration
		EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
		EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
		EMBEDDING_TIMEOUT: process.env.EMBEDDING_TIMEOUT
			? parseInt(process.env.EMBEDDING_TIMEOUT, 10)
			: undefined,
		EMBEDDING_MAX_RETRIES: process.env.EMBEDDING_MAX_RETRIES
			? parseInt(process.env.EMBEDDING_MAX_RETRIES, 10)
			: undefined,
		EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS
			? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
			: undefined,
		DISABLE_EMBEDDINGS: process.env.DISABLE_EMBEDDINGS === 'true',
		EMBEDDING_DISABLED: process.env.EMBEDDING_DISABLED === 'true',
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
		GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
		// Storage Configuration
		STORAGE_CACHE_TYPE: process.env.STORAGE_CACHE_TYPE || 'in-memory',
		STORAGE_CACHE_HOST: process.env.STORAGE_CACHE_HOST,
		STORAGE_CACHE_PORT: process.env.STORAGE_CACHE_PORT
			? parseInt(process.env.STORAGE_CACHE_PORT, 10)
			: undefined,
		STORAGE_CACHE_USERNAME: process.env.STORAGE_CACHE_USERNAME,
		STORAGE_CACHE_PASSWORD: process.env.STORAGE_CACHE_PASSWORD,
		STORAGE_CACHE_DATABASE: process.env.STORAGE_CACHE_DATABASE
			? parseInt(process.env.STORAGE_CACHE_DATABASE, 10)
			: undefined,
		STORAGE_DATABASE_TYPE: process.env.STORAGE_DATABASE_TYPE || 'in-memory',
		STORAGE_DATABASE_PATH: process.env.STORAGE_DATABASE_PATH,
		STORAGE_DATABASE_NAME: process.env.STORAGE_DATABASE_NAME,
		// PostgreSQL Configuration
		CIPHER_PG_URL: process.env.CIPHER_PG_URL,
		STORAGE_DATABASE_HOST: process.env.STORAGE_DATABASE_HOST,
		STORAGE_DATABASE_PORT: process.env.STORAGE_DATABASE_PORT
			? parseInt(process.env.STORAGE_DATABASE_PORT, 10)
			: undefined,
		STORAGE_DATABASE_USER: process.env.STORAGE_DATABASE_USER,
		STORAGE_DATABASE_PASSWORD: process.env.STORAGE_DATABASE_PASSWORD,
		STORAGE_DATABASE_SSL: process.env.STORAGE_DATABASE_SSL === 'true',
		// Vector Storage Configuration
		VECTOR_STORE_TYPE: process.env.VECTOR_STORE_TYPE || 'in-memory',
		VECTOR_STORE_HOST: process.env.VECTOR_STORE_HOST,
		VECTOR_STORE_PORT: process.env.VECTOR_STORE_PORT
			? parseInt(process.env.VECTOR_STORE_PORT, 10)
			: undefined,
		VECTOR_STORE_URL: process.env.VECTOR_STORE_URL,
		VECTOR_STORE_API_KEY: process.env.VECTOR_STORE_API_KEY,
		VECTOR_STORE_USERNAME: process.env.VECTOR_STORE_USERNAME,
		VECTOR_STORE_PASSWORD: process.env.VECTOR_STORE_PASSWORD,
		VECTOR_STORE_COLLECTION: process.env.VECTOR_STORE_COLLECTION || 'knowledge_memory',
		VECTOR_STORE_DIMENSION: process.env.VECTOR_STORE_DIMENSION
			? parseInt(process.env.VECTOR_STORE_DIMENSION, 10)
			: 1536,
		VECTOR_STORE_DISTANCE: process.env.VECTOR_STORE_DISTANCE || 'Cosine',
		VECTOR_STORE_ON_DISK: process.env.VECTOR_STORE_ON_DISK === 'true',
		VECTOR_STORE_MAX_VECTORS: process.env.VECTOR_STORE_MAX_VECTORS
			? parseInt(process.env.VECTOR_STORE_MAX_VECTORS, 10)
			: 10000,
		// Faiss-specific Configuration
		FAISS_BASE_STORAGE_PATH: process.env.FAISS_BASE_STORAGE_PATH,
		// Knowledge Graph Configuration
		KNOWLEDGE_GRAPH_ENABLED: process.env.KNOWLEDGE_GRAPH_ENABLED === 'true',
		KNOWLEDGE_GRAPH_TYPE: process.env.KNOWLEDGE_GRAPH_TYPE || 'in-memory',
		KNOWLEDGE_GRAPH_HOST: process.env.KNOWLEDGE_GRAPH_HOST,
		KNOWLEDGE_GRAPH_PORT: process.env.KNOWLEDGE_GRAPH_PORT
			? parseInt(process.env.KNOWLEDGE_GRAPH_PORT, 10)
			: undefined,
		KNOWLEDGE_GRAPH_URI: process.env.KNOWLEDGE_GRAPH_URI,
		KNOWLEDGE_GRAPH_USERNAME: process.env.KNOWLEDGE_GRAPH_USERNAME,
		KNOWLEDGE_GRAPH_PASSWORD: process.env.KNOWLEDGE_GRAPH_PASSWORD,
		KNOWLEDGE_GRAPH_DATABASE: process.env.KNOWLEDGE_GRAPH_DATABASE || 'neo4j',
		// Memory Search Configuration
		SEARCH_MEMORY_TYPE: process.env.SEARCH_MEMORY_TYPE || 'knowledge',
		// Reflection Memory Configuration
		REFLECTION_VECTOR_STORE_COLLECTION:
			process.env.REFLECTION_VECTOR_STORE_COLLECTION || 'reflection_memory',
		DISABLE_REFLECTION_MEMORY: process.env.DISABLE_REFLECTION_MEMORY === 'true',
		// Workspace Memory Configuration
		USE_WORKSPACE_MEMORY: process.env.USE_WORKSPACE_MEMORY === 'true',
		WORKSPACE_SEARCH_THRESHOLD: process.env.WORKSPACE_SEARCH_THRESHOLD
			? parseFloat(process.env.WORKSPACE_SEARCH_THRESHOLD)
			: 0.4,
		DISABLE_DEFAULT_MEMORY: process.env.DISABLE_DEFAULT_MEMORY === 'true',
		WORKSPACE_VECTOR_STORE_TYPE: process.env.WORKSPACE_VECTOR_STORE_TYPE,
		WORKSPACE_VECTOR_STORE_HOST: process.env.WORKSPACE_VECTOR_STORE_HOST,
		WORKSPACE_VECTOR_STORE_PORT: process.env.WORKSPACE_VECTOR_STORE_PORT
			? parseInt(process.env.WORKSPACE_VECTOR_STORE_PORT, 10)
			: undefined,
		WORKSPACE_VECTOR_STORE_URL: process.env.WORKSPACE_VECTOR_STORE_URL,
		WORKSPACE_VECTOR_STORE_API_KEY: process.env.WORKSPACE_VECTOR_STORE_API_KEY,
		WORKSPACE_VECTOR_STORE_USERNAME: process.env.WORKSPACE_VECTOR_STORE_USERNAME,
		WORKSPACE_VECTOR_STORE_PASSWORD: process.env.WORKSPACE_VECTOR_STORE_PASSWORD,
		WORKSPACE_VECTOR_STORE_COLLECTION:
			process.env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory',
		WORKSPACE_VECTOR_STORE_DIMENSION: process.env.WORKSPACE_VECTOR_STORE_DIMENSION
			? parseInt(process.env.WORKSPACE_VECTOR_STORE_DIMENSION, 10)
			: 1536,
		WORKSPACE_VECTOR_STORE_DISTANCE: process.env.WORKSPACE_VECTOR_STORE_DISTANCE || 'Cosine',
		WORKSPACE_VECTOR_STORE_ON_DISK: process.env.WORKSPACE_VECTOR_STORE_ON_DISK === 'true',
		WORKSPACE_VECTOR_STORE_MAX_VECTORS: process.env.WORKSPACE_VECTOR_STORE_MAX_VECTORS
			? parseInt(process.env.WORKSPACE_VECTOR_STORE_MAX_VECTORS, 10)
			: 10000,
		// Cross-Tool Memory Sharing Configuration
		CIPHER_USER_ID: process.env.CIPHER_USER_ID,
		CIPHER_PROJECT_NAME: process.env.CIPHER_PROJECT_NAME,
		CIPHER_WORKSPACE_MODE: process.env.CIPHER_WORKSPACE_MODE || 'isolated',
	};

	const result = envSchema.safeParse(envToValidate);
	if (!result.success) {
		// Note: logger might not be available during early initialization
		const errorMsg = `Environment validation failed: ${JSON.stringify(result.error.issues)}`;
		if (isMcpMode) {
			process.stderr.write(`[CIPHER-MCP] ERROR: ${errorMsg}\n`);
		} else {
			console.error('Environment validation failed:', result.error.issues);
		}
		return false;
	}
	return result.success;
};
