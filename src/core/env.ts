import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file - skip entirely in MCP mode
const isMcpMode =
	process.argv.includes('--mode') && process.argv[process.argv.indexOf('--mode') + 1] === 'mcp';

if (isMcpMode) {
	// In MCP mode, skip .env file loading entirely since all environment variables
	// are provided via the "env" field in the MCP configuration
	// No need to load .env files as MCP host provides all required environment variables
} else {
	// Normal mode - load environment variables from .env file
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
	STORAGE_CACHE_PASSWORD: z.string().optional(),
	STORAGE_CACHE_DATABASE: z.number().optional(),
	STORAGE_DATABASE_TYPE: z.enum(['in-memory', 'sqlite']).default('in-memory'),
	STORAGE_DATABASE_PATH: z.string().optional(),
	STORAGE_DATABASE_NAME: z.string().optional(),
	// Vector Storage Configuration
	VECTOR_STORE_TYPE: z.enum(['qdrant', 'milvus', 'in-memory']).default('in-memory'),
	VECTOR_STORE_HOST: z.string().optional(),
	VECTOR_STORE_PORT: z.number().optional(),
	VECTOR_STORE_URL: z.string().optional(),
	VECTOR_STORE_API_KEY: z.string().optional(),
	VECTOR_STORE_USERNAME: z.string().optional(),
	VECTOR_STORE_PASSWORD: z.string().optional(),
	VECTOR_STORE_COLLECTION: z.string().default('default'),
	VECTOR_STORE_DIMENSION: z.number().default(1536),
	VECTOR_STORE_DISTANCE: z.enum(['Cosine', 'Euclidean', 'Dot', 'Manhattan']).default('Cosine'),
	VECTOR_STORE_ON_DISK: z.boolean().default(false),
	VECTOR_STORE_MAX_VECTORS: z.number().default(10000),
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
	SEARCH_MEMORY_TYPE: z.enum(['knowledge', 'reflection', 'both']).default('both'),
	// Reflection Memory Configuration
	REFLECTION_VECTOR_STORE_COLLECTION: z.string().default('reflection_memory'),
	DISABLE_REFLECTION_MEMORY: z.boolean().default(false),
	// Normalization Configuration
	NORMALIZATION_ENABLED: z.boolean().optional().describe('Enable/Disable normalization').default(true),
	NORMALIZATION_TOLOWERCASE: z.boolean().optional().describe('Convert text to lowercase').default(true),
	NORMALIZATION_REMOVEPUNCTUATION: z.boolean().optional().describe('Remove punctuation').default(true),
	NORMALIZATION_WHITESPACE: z.boolean().optional().describe('Normalize whitespace').default(true),
	NORMALIZATION_STOPWORDS: z.boolean().optional().describe('Remove stopwords').default(false),
	NORMALIZATION_STEMMING: z.boolean().optional().describe('Stemming').default(false),
	NORMALIZATION_LEMMATIZATION: z.boolean().optional().describe('Lemmatization').default(false),
	NORMALIZATION_LANGUAGE: z.enum(['en']).default('en'),
	NORMALIZATION_PAST_DATA: z.boolean().optional().describe('Normalize past data').default(false),
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
				return process.env.VECTOR_STORE_COLLECTION || 'default';
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
				return process.env.SEARCH_MEMORY_TYPE || 'both';
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
		STORAGE_CACHE_PASSWORD: process.env.STORAGE_CACHE_PASSWORD,
		STORAGE_CACHE_DATABASE: process.env.STORAGE_CACHE_DATABASE
			? parseInt(process.env.STORAGE_CACHE_DATABASE, 10)
			: undefined,
		STORAGE_DATABASE_TYPE: process.env.STORAGE_DATABASE_TYPE || 'in-memory',
		STORAGE_DATABASE_PATH: process.env.STORAGE_DATABASE_PATH,
		STORAGE_DATABASE_NAME: process.env.STORAGE_DATABASE_NAME,
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
		VECTOR_STORE_COLLECTION: process.env.VECTOR_STORE_COLLECTION || 'default',
		VECTOR_STORE_DIMENSION: process.env.VECTOR_STORE_DIMENSION
			? parseInt(process.env.VECTOR_STORE_DIMENSION, 10)
			: 1536,
		VECTOR_STORE_DISTANCE: process.env.VECTOR_STORE_DISTANCE || 'Cosine',
		VECTOR_STORE_ON_DISK: process.env.VECTOR_STORE_ON_DISK === 'true',
		VECTOR_STORE_MAX_VECTORS: process.env.VECTOR_STORE_MAX_VECTORS
			? parseInt(process.env.VECTOR_STORE_MAX_VECTORS, 10)
			: 10000,
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
		SEARCH_MEMORY_TYPE: process.env.SEARCH_MEMORY_TYPE || 'both',
		// Reflection Memory Configuration
		REFLECTION_VECTOR_STORE_COLLECTION:
			process.env.REFLECTION_VECTOR_STORE_COLLECTION || 'reflection_memory',
		DISABLE_REFLECTION_MEMORY: process.env.DISABLE_REFLECTION_MEMORY === 'true',
		
		// Normalization Configuration
		NORMALIZATION_ENABLED: process.env.NORMALIZATION_ENABLED === 'true',
		NORMALIZATION_TOLOWERCASE: process.env.NORMALIZATION_TOLOWERCASE === 'true',
		NORMALIZATION_REMOVEPUNCTUATION: process.env.NORMALIZATION_REMOVEPUNCTUATION === 'true',
		NORMALIZATION_WHITESPACE: process.env.NORMALIZATION_WHITESPACE === 'true',
		NORMALIZATION_STOPWORDS: process.env.NORMALIZATION_STOPWORDS === 'true',
		NORMALIZATION_STEMMING: process.env.NORMALIZATION_STEMMING === 'true',
		NORMALIZATION_LEMMATIZATION: process.env.NORMALIZATION_LEMMATIZATION === 'true',
		NORMALIZATION_LANGUAGE: process.env.NORMALIZATION_LANGUAGE || 'en',
		NORMALIZATION_PAST_DATA: process.env.NORMALIZATION_PAST_DATA === 'true',
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
