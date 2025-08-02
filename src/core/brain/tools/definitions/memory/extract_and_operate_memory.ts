import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
// import { SessionEmbeddingState } from '../../../embedding/manager.js';
// Import helpers from memory_operation
import {
	parseLLMDecision,
	MEMORY_OPERATION_PROMPTS,
	extractTechnicalTags,
} from './memory_operation.js';
// Import payload migration utilities
import { createKnowledgePayload } from './payloads.js';

/**
 * Determines if a piece of content is significant enough to be extracted as knowledge
 * Focuses on programming knowledge, concepts, technical details, and implementation information
 * while filtering out personal information, trivial content, and non-technical interactions
 */
function isSignificantKnowledge(content: string): boolean {
	if (!content || content.trim().length === 0) {
		return false;
	}

	const text = content.toLowerCase().trim();

	// Skip trivial tool results and non-technical content
	const skipPatterns = [
		// Personal information and identity
		/\b(my name|user['']?s? name|find my name|search.*name|who am i|what['']?s my name)\b/i,
		/\b(personal|profile|identity|username|login|password|email|address|phone)\b/i,

		// Trivial search queries without technical context
		/^(user:|assistant:)?\s*(search|find|look|what|where|who|when|why|how)\s+(is|are|was|were|do|does|did|can|could|should|would|will|my|the|a|an)\b/i,

		// Simple greetings and social interactions
		/^(user:|assistant:)?\s*(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|please|sorry|excuse me|bye|goodbye)\b/i,

		// Tool results with no meaningful content
		/^(cipher_memory_search|memory_search):\s*(found|completed|no results|error)/i,

		// Generic status messages
		/^(task completed|operation successful|processing|loading|waiting|done|finished|ready)\b/i,

		// Simple yes/no or acknowledgment responses
		/^(user:|assistant:)?\s*(yes|no|ok|okay|sure|fine|great|good|right|correct|wrong|true|false)\s*[.!?]?\s*$/i,
	];

	// Check if content matches skip patterns
	for (const pattern of skipPatterns) {
		if (pattern.test(text)) {
			return false;
		}
	}

	// Prioritize technical and programming content
	const technicalPatterns = [
		// Programming concepts and patterns
		/\b(function|method|class|interface|module|library|framework|algorithm|data structure|design pattern)\b/i,
		/\b(variable|constant|parameter|argument|return|async|await|promise|callback|closure|scope)\b/i,
		/\b(loop|iteration|recursion|condition|exception|error handling|debugging|testing|optimization)\b/i,

		// Code elements and syntax
		/\b(import|export|require|include|package|dependency|api|endpoint|request|response)\b/i,
		/\b(database|query|sql|nosql|schema|table|index|transaction|orm|migration)\b/i,
		/\b(git|version control|commit|merge|branch|pull request|repository|deployment)\b/i,

		// Technical implementations
		/\b(implements?|extends?|inherits?|overrides?|polymorphism|encapsulation|abstraction)\b/i,
		/\b(sort|search|filter|map|reduce|transform|parse|serialize|encrypt|decrypt)\b/i,
		/\b(authentication|authorization|security|validation|sanitization|middleware)\b/i,

		// Code blocks and technical syntax
		/```[\s\S]*```/,
		/`[^`]+`/,
		/\$[a-zA-Z_][a-zA-Z0-9_]*/, // Shell variables
		/\b(npm|yarn|pip|composer|cargo|go get|mvn|gradle)\b/i,

		// File and system operations
		/\b(file|directory|path|config|environment|server|client|host|port|url|http|https|ssl|tls)\b/i,
		/\b(dockerfile|docker|container|kubernetes|cloud|aws|azure|gcp|ci\/cd|pipeline)\b/i,

		// Programming languages and technologies
		/\b(javascript|typescript|python|java|c\+\+|c#|rust|go|php|ruby|swift|kotlin|scala|r)\b/i,
		/\b(react|vue|angular|node|express|django|flask|spring|rails|laravel|fastapi)\b/i,
		/\b(html|css|scss|sass|less|bootstrap|tailwind|webpack|vite|rollup|babel|eslint)\b/i,

		// Error messages and stack traces with technical context
		/\b(error|exception|traceback|stack trace|compilation|syntax error|runtime error|type error)\b/i,

		// Technical explanations and problem-solving
		/\b(solution|approach|implementation|technique|strategy|pattern|best practice|optimization)\b/i,
		/\b(performance|scalability|maintainability|refactoring|code review|documentation)\b/i,
	];

	// Check if content contains technical patterns
	for (const pattern of technicalPatterns) {
		if (pattern.test(text)) {
			return true;
		}
	}

	// Check for code-like patterns (contains special characters typical in code)
	const codePatterns = [
		/[{}[\]()]/, // Brackets and parentheses
		/[=><!&|]/, // Operators
		/[;:,]/, // Punctuation common in code
		/\w+\.\w+/, // Dot notation
		/\w+\(\)/, // Function calls
		/\/\*[\s\S]*?\*\/|\/\/.*$/m, // Comments
	];

	let codePatternMatches = 0;
	for (const pattern of codePatterns) {
		if (pattern.test(text)) {
			codePatternMatches++;
		}
	}

	// If multiple code patterns match, consider it significant
	if (codePatternMatches >= 2) {
		return true;
	}

	// Check for technical words density
	const technicalWords = [
		'api',
		'sdk',
		'cli',
		'gui',
		'ui',
		'ux',
		'ide',
		'editor',
		'compiler',
		'interpreter',
		'runtime',
		'virtual',
		'machine',
		'container',
		'image',
		'build',
		'deploy',
		'release',
		'version',
		'update',
		'patch',
		'bug',
		'feature',
		'enhancement',
		'issue',
		'ticket',
		'workflow',
		'process',
		'pipeline',
		'automation',
		'script',
		'batch',
		'cron',
		'job',
		'service',
		'microservice',
		'monolith',
		'architecture',
		'pattern',
		'design',
		'system',
		'network',
		'protocol',
		'tcp',
		'udp',
		'http',
		'https',
		'ssl',
		'tls',
		'dns',
		'cdn',
		'cache',
		'redis',
		'memcached',
		'session',
		'cookie',
		'token',
		'jwt',
		'oauth',
		'auth',
		'encrypt',
		'decrypt',
		'hash',
		'salt',
		'key',
		'certificate',
		'public',
		'private',
		'binary',
		'ascii',
		'unicode',
		'utf8',
		'base64',
		'hex',
		'decimal',
		'octal',
		'buffer',
	];

	const words = text.split(/\s+/);
	const technicalWordCount = words.filter(word =>
		technicalWords.includes(word.replace(/[^\w]/g, ''))
	).length;

	// If more than 10% of words are technical, consider it significant
	const technicalDensity = technicalWordCount / words.length;
	if (technicalDensity > 0.1 && words.length > 5) {
		return true;
	}

	// Check minimum length and complexity
	if (text.length < 20) {
		return false;
	}

	// Check for programming-specific patterns that indicate technical content
	const programmingKeywords =
		/\b(code|coding|program|programming|develop|development|software|hardware|tech|technical|digital|computer|computing|algorithm|logic|syntax|semantic|compile|runtime|execute|debug|test|deploy|implement|configure|setup|install|upgrade|migrate|scale|optimize|refactor)\b/i;

	if (programmingKeywords.test(text)) {
		return true;
	}

	// Default to false for non-technical content
	return false;
}

/**
 * Determines if a message is a retrieved result from search tools or knowledge graph
 * Skips extraction for these to avoid polluting knowledge memory with retrieved content
 */
function isRetrievedResult(content: string): boolean {
	if (!content || typeof content !== 'string') return false;
	const text = content.toLowerCase();

	// Heuristics: look for typical result markers or tool result prefixes
	const retrievedPatterns = [
		/^(cipher_memory_search|memory_search|cipher_search_reasoning_patterns|search_reasoning_patterns|search_graph|query_graph|enhanced_search):/i,
		/^(retrieved|result|results|found|matches|nodes|edges|search completed|query executed|suggestions?):/i,
		/^(knowledge results|reflection results|reasoning patterns|graph nodes|graph edges):/i,
		/^(reasoning trace|evaluation|step count|quality score|issue count):/i,
		/^(search results|retrieved knowledge|retrieved reasoning|retrieved entities):/i,
		/^(graph search|kg search|knowledge graph result|kg result):/i,
		/^(observation:|action:|thought:|conclusion:|reflection:)/i, // Reflection memory patterns
		/^(id:|timestamp:|similarity:|source:|memorytype:)/i,
		/^(message: 'query executed'|message: 'search completed')/i,
		/^(success: true|success: false)/i,
		/^(totalresults:|searchtime:|embeddingtime:)/i,
		/^(nodes:|edges:|related:|totalcount:|executiontime:)/i,
	];
	for (const pattern of retrievedPatterns) {
		if (pattern.test(text)) return true;
	}
	return false;
}

/**
 * Generate a safe memory ID from index
 * Ensures ID is positive and avoids conflicts
 */
function generateSafeMemoryId(index: number): number {
	// Use timestamp + index to ensure uniqueness and avoid conflicts
	const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
	return timestamp * 1000 + (index % 1000); // Combine timestamp with index
}

/**
 * Infer domain from tags for enhanced categorization
 */
function inferDomainFromTags(tags: string[]): string | undefined {
	const domainMapping: Record<string, string> = {
		javascript: 'frontend',
		typescript: 'frontend',
		react: 'frontend',
		vue: 'frontend',
		angular: 'frontend',
		html: 'frontend',
		css: 'frontend',
		node: 'backend',
		express: 'backend',
		api: 'backend',
		database: 'backend',
		sql: 'backend',
		docker: 'devops',
		kubernetes: 'devops',
		deployment: 'devops',
		ci: 'devops',
		cd: 'devops',
		git: 'version-control',
		github: 'version-control',
		testing: 'quality-assurance',
		debug: 'quality-assurance',
	};

	for (const tag of tags) {
		if (domainMapping[tag.toLowerCase()]) {
			return domainMapping[tag.toLowerCase()];
		}
	}

	return undefined;
}

/**
 * Extract and Operate Memory Tool
 *
 * This tool extracts knowledge facts from raw interaction(s) and immediately processes them
 * to determine memory operations (ADD, UPDATE, DELETE, NONE) in a single atomic step.
 * This guarantees the sequential relationship between extraction and operation.
 */
export const extractAndOperateMemoryTool: InternalTool = {
	name: 'extract_and_operate_memory',
	category: 'memory',
	internal: true,
	agentAccessible: false, // Internal-only: programmatically called after each interaction
	description:
		'Extract knowledge facts from raw interaction(s) and immediately process them to determine memory operations (ADD, UPDATE, DELETE, NONE) in a single atomic step. This guarantees extraction always precedes operation.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			interaction: {
				oneOf: [
					{
						type: 'string',
						description:
							'A single user interaction or conversation text to extract knowledge from.',
					},
					{
						type: 'array',
						items: {
							type: 'string',
						},
						description:
							'Multiple user interactions or conversation texts to extract knowledge from.',
					},
				],
				description: 'Raw user interaction(s) or conversation text(s) to extract knowledge from.',
			},
			existingMemories: {
				type: 'array',
				description: 'Array of existing memory entries to compare against for similarity analysis.',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'Unique identifier of the existing memory' },
						text: { type: 'string', description: 'Content of the existing memory' },
						metadata: { type: 'object', description: 'Optional metadata for the memory' },
					},
					required: ['id', 'text'],
				},
			},
			context: {
				type: 'object',
				description: 'Optional context information for memory operations',
				properties: {
					sessionId: { type: 'string', description: 'Current session identifier' },
					userId: { type: 'string', description: 'User identifier for personalized memory' },
					projectId: { type: 'string', description: 'Project identifier for scoped memory' },
					conversationTopic: { type: 'string', description: 'Current conversation topic or theme' },
					recentMessages: {
						type: 'array',
						items: { type: 'string' },
						description: 'Recent conversation messages for context',
					},
					sessionMetadata: { type: 'object', description: 'Additional session metadata' },
				},
				additionalProperties: false,
			},
			options: {
				type: 'object',
				description: 'Configuration options for memory operations',
				properties: {
					similarityThreshold: {
						type: 'number',
						description: 'Similarity threshold for memory matching (0.0 to 1.0)',
						minimum: 0.0,
						maximum: 1.0,
					},
					maxSimilarResults: {
						type: 'number',
						description: 'Maximum number of similar memories to retrieve',
						minimum: 1,
						maximum: 20,
					},
					enableBatchProcessing: {
						type: 'boolean',
						description: 'Whether to process multiple knowledge items in batch',
					},
					useLLMDecisions: {
						type: 'boolean',
						description: 'Whether to use LLM-powered decision making',
					},
					confidenceThreshold: {
						type: 'number',
						description: 'Minimum confidence threshold for operations (0.0 to 1.0)',
						minimum: 0.0,
						maximum: 1.0,
					},
					enableDeleteOperations: {
						type: 'boolean',
						description: 'Whether to enable DELETE operations',
					},
				},
				additionalProperties: false,
			},
			memoryMetadata: {
				type: 'object',
				description:
					'Custom metadata to attach to created memories (projectId, userId, teamId, etc.)',
				additionalProperties: true,
				properties: {
					projectId: { type: 'string', description: 'Project identifier for scoped memory' },
					userId: { type: 'string', description: 'User identifier for personalized memory' },
					teamId: { type: 'string', description: 'Team identifier for team-scoped memory' },
					environment: { type: 'string', description: 'Environment (dev, staging, prod)' },
					source: { type: 'string', description: 'Source of the memory (cli, api, web)' },
				},
			},
		},
		required: ['interaction'],
	},
	handler: async (args: any, context?: InternalToolContext) => {
		try {
			// Check if embeddings are disabled for this session
			const sessionState = context?.services?.embeddingManager?.getSessionState?.();
			if (sessionState?.isDisabled()) {
				const reason = sessionState.getDisabledReason();
				logger.debug(
					'ExtractAndOperateMemory: Embeddings disabled for this session, skipping memory operations',
					{ reason }
				);
				return {
					success: true,
					mode: 'chat-only',
					message: `Memory operations disabled: ${reason}`,
					extractedFacts: 0,
					memoryActions: 0,
					skipped: true,
				};
			}

			// Check if embedding manager indicates no available embeddings
			if (
				context?.services?.embeddingManager &&
				!context.services.embeddingManager.hasAvailableEmbeddings()
			) {
				logger.debug(
					'ExtractAndOperateMemory: No available embeddings, skipping memory operations'
				);
				return {
					success: true,
					mode: 'chat-only',
					message: 'No available embeddings - operating in chat-only mode',
					extractedFacts: 0,
					memoryActions: 0,
					skipped: true,
				};
			}

			// Check if any resilient embedders are disabled
			const embeddingStatus = context?.services?.embeddingManager?.getEmbeddingStatus();
			if (embeddingStatus) {
				const disabledEmbedders = Object.values(embeddingStatus).filter(
					(status: any) => status.status === 'DISABLED'
				);
				if (disabledEmbedders.length > 0) {
					logger.debug(
						'ExtractAndOperateMemory: Some embedders are disabled, skipping memory operations'
					);
					return {
						success: true,
						mode: 'chat-only',
						message: 'Embedders are disabled - operating in chat-only mode',
						extractedFacts: 0,
						memoryActions: 0,
						skipped: true,
					};
				}
			}

			// Step 1: Extract facts from interaction(s)
			let knowledgeArray: string[];
			if (!args.interaction) {
				throw new Error('No interaction(s) provided for extraction');
			}
			if (typeof args.interaction === 'string') {
				knowledgeArray = [args.interaction];
			} else if (Array.isArray(args.interaction)) {
				knowledgeArray = args.interaction;
			} else {
				throw new Error('Interaction must be a string or array of strings');
			}

			// Filter out empty or invalid facts
			const validFacts = knowledgeArray
				.filter(fact => fact && typeof fact === 'string' && fact.trim().length > 0)
				.map(fact => fact.trim());

			// Apply significance filtering to extract only programming knowledge and concepts
			const significantFacts = validFacts.filter(fact => {
				if (isRetrievedResult(fact)) {
					logger.debug('ExtractAndOperateMemory: Skipping retrieved result', {
						factPreview: fact.substring(0, 100) + (fact.length > 100 ? '...' : ''),
						reason: 'Fact is a retrieved result from search tool or knowledge graph',
					});
					return false;
				}
				const isSignificant = isSignificantKnowledge(fact);
				if (!isSignificant) {
					logger.debug('ExtractAndOperateMemory: Skipping non-significant fact', {
						factPreview: fact.substring(0, 100) + (fact.length > 100 ? '...' : ''),
						reason: 'Does not contain significant programming knowledge or concepts',
					});
				}
				return isSignificant;
			});

			if (significantFacts.length === 0) {
				logger.debug('ExtractAndOperateMemory: No significant facts found after filtering', {
					originalFacts: validFacts.length,
					filteredFacts: significantFacts.length,
					interactionLength: args.interaction.length,
				});
				return {
					success: true,
					extraction: {
						extracted: 0,
						skipped: knowledgeArray.length,
						facts: [],
					},
					memory: [],
					summary: [],
					timestamp: new Date().toISOString(),
				};
			}

			// Extraction stats
			const extractionStats = {
				extracted: significantFacts.length,
				skipped: knowledgeArray.length - significantFacts.length,
				facts: significantFacts.map((fact, i) => ({
					id: `fact_${Math.floor(Date.now() / 1000)}_${i}`,
					preview: fact.substring(0, 100) + (fact.length > 100 ? '...' : ''),
					metadata: {
						hasCodeBlock: fact.includes('```'),
						hasCommand: fact.includes('$') || fact.includes('npm') || fact.includes('git'),
						length: fact.length,
					},
				})),
			};

			// Step 2: Enhanced error handling for service dependencies
			if (!context?.services) {
				logger.warn(
					'ExtractAndOperateMemory: No services context available, using basic processing'
				);
				// Return basic processing without vector operations
				const basicMemoryActions = significantFacts.map((fact, i) => ({
					id: generateSafeMemoryId(i),
					text: fact,
					event: 'ADD' as const,
					tags: extractTechnicalTags(fact),
					confidence: 0.7,
					reasoning: 'Basic processing without vector services',
				}));

				return {
					success: true,
					extraction: extractionStats,
					memory: basicMemoryActions,
					summary: basicMemoryActions.map(action => ({
						factPreview: action.text.substring(0, 80),
						action: action.event,
						confidence: action.confidence,
						reason: action.reasoning,
						targetId: action.id,
					})),
					timestamp: new Date().toISOString(),
				};
			}

			const embeddingManager = context.services.embeddingManager;
			const vectorStoreManager = context.services.vectorStoreManager;
			const llmService = context.services.llmService;

			if (!embeddingManager || !vectorStoreManager) {
				logger.warn(
					'ExtractAndOperateMemory: Missing embedding or vector services, falling back to basic processing'
				);
				const basicMemoryActions = significantFacts.map((fact, i) => ({
					id: generateSafeMemoryId(i),
					text: fact,
					event: 'ADD' as const,
					tags: extractTechnicalTags(fact),
					confidence: 0.6,
					reasoning: 'Fallback processing due to missing services',
				}));

				return {
					success: true,
					extraction: extractionStats,
					memory: basicMemoryActions,
					summary: basicMemoryActions.map(action => ({
						factPreview: action.text.substring(0, 80),
						action: action.event,
						confidence: action.confidence,
						reason: action.reasoning,
						targetId: action.id,
					})),
					timestamp: new Date().toISOString(),
				};
			}

			const embedder = embeddingManager.getEmbedder('default');
			// Get knowledge store explicitly (uses VECTOR_STORE_COLLECTION env var)
			let vectorStore;
			try {
				logger.debug('ExtractAndOperateMemory: Using knowledge collection');
				vectorStore =
					(vectorStoreManager as any).getStore('knowledge') || vectorStoreManager.getStore();
			} catch (error) {
				logger.debug('ExtractAndOperateMemory: Falling back to default store', {
					error: error instanceof Error ? error.message : String(error),
				});
				vectorStore = vectorStoreManager.getStore();
			}

			if (!embedder || !vectorStore) {
				logger.warn(
					'ExtractAndOperateMemory: Embedder or vector store not available, using basic processing'
				);
				const basicMemoryActions = significantFacts.map((fact, i) => ({
					id: generateSafeMemoryId(i),
					text: fact,
					event: 'ADD' as const,
					tags: extractTechnicalTags(fact),
					confidence: 0.6,
					reasoning: 'Basic processing - embedder/vector store unavailable',
				}));

				return {
					success: true,
					extraction: extractionStats,
					memory: basicMemoryActions,
					summary: basicMemoryActions.map(action => ({
						factPreview: action.text.substring(0, 80),
						action: action.event,
						confidence: action.confidence,
						reason: action.reasoning,
						targetId: action.id,
					})),
					timestamp: new Date().toISOString(),
				};
			}

			if (!embedder.embed || typeof embedder.embed !== 'function') {
				throw new Error('Embedder is not properly initialized or missing embed() method');
			}

			const options = {
				similarityThreshold: args.options?.similarityThreshold ?? 0.8,
				maxSimilarResults: args.options?.maxSimilarResults ?? 5,
				useLLMDecisions: args.options?.useLLMDecisions ?? false,
			};

			const memoryActions = [];
			const memorySummaries = [];

			for (let i = 0; i < significantFacts.length; i++) {
				const fact = significantFacts[i];

				if (!fact) {
					logger.warn(`ExtractAndOperateMemory: Skipping undefined fact at index ${i}`);
					continue;
				}

				logger.debug(
					`ExtractAndOperateMemory: Processing fact ${i + 1}/${significantFacts.length}`,
					{
						factPreview: fact.substring(0, 80) + (fact.length > 80 ? '...' : ''),
						factLength: fact.length,
					}
				);

				try {
					// Embed the fact with error handling
					let embedding;
					try {
						embedding = await embedder.embed(fact);
					} catch (embedError) {
						logger.error(
							`ExtractAndOperateMemory: Failed to embed fact ${i + 1}, disabling embeddings for session`,
							{
								error: embedError instanceof Error ? embedError.message : String(embedError),
								factPreview: fact.substring(0, 50),
								provider: embedder.getConfig().type,
							}
						);

						// Disable embeddings for this session on failure
						if (context?.services?.embeddingManager && embedError instanceof Error) {
							context.services.embeddingManager.handleRuntimeFailure(
								embedError,
								embedder.getConfig().type
							);
						}

						// Return immediately with chat-only mode since embeddings are now disabled
						return {
							success: true,
							mode: 'chat-only',
							message: `Embeddings disabled due to failure: ${embedError instanceof Error ? embedError.message : String(embedError)}`,
							extractedFacts: significantFacts.length,
							memoryActions: 0,
							skipped: true,
							error: embedError instanceof Error ? embedError.message : String(embedError),
						};
					}

					// Perform similarity search with error handling
					let similar = [];
					try {
						similar = await vectorStore.search(embedding, options.maxSimilarResults);
					} catch (searchError) {
						logger.warn(
							`ExtractAndOperateMemory: Failed to search similar memories for fact ${i + 1}`,
							{
								error: searchError instanceof Error ? searchError.message : String(searchError),
								factPreview: fact.substring(0, 50),
							}
						);
						// Continue with empty similar array
					}

					logger.debug(`ExtractAndOperateMemory: Similarity search completed for fact ${i + 1}`, {
						similarMemoriesFound: similar.length,
						topSimilarity: similar.length > 0 ? similar[0]?.score?.toFixed(3) : 'N/A',
						similarities: similar.slice(0, 3).map((s: any) => ({
							id: s.id,
							score: s.score?.toFixed(3),
							preview: (s.payload?.text || '').substring(0, 50) + '...',
						})),
					});

					// LLM-based decision making with enhanced error handling
					let action = 'ADD';
					let targetId = null;
					let reason = '';
					let confidence = 0;
					let usedLLM = false;

					if (options.useLLMDecisions && llmService) {
						try {
							// Format similar memories for prompt
							const similarMemoriesStr = similar
								.map(
									(mem: any, idx: any) =>
										`  ${idx + 1}. ID: ${mem.id} (similarity: ${mem.score?.toFixed(2) ?? 'N/A'})\n     Content: ${(mem.payload?.text || '').substring(0, 200)}`
								)
								.join('\n');

							// Use the DECISION_PROMPT from memory_operation
							const DECISION_PROMPT = MEMORY_OPERATION_PROMPTS.DECISION_PROMPT;
							const llmInput = DECISION_PROMPT.replace('{fact}', fact)
								.replace('{similarMemories}', similarMemoriesStr || 'No similar memories found.')
								.replace('{context}', '');

							// Use directGenerate with timeout and error handling
							let llmResponse;
							try {
								llmResponse = await Promise.race([
									llmService.directGenerate(llmInput),
									new Promise((_, reject) =>
										setTimeout(() => reject(new Error('LLM decision timeout')), 30000)
									),
								]);
							} catch (llmError) {
								throw new Error(
									`LLM call failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`
								);
							}

							const decision = parseLLMDecision(String(llmResponse));
							if (decision && ['ADD', 'UPDATE', 'DELETE', 'NONE'].includes(decision.operation)) {
								action = decision.operation;
								confidence = Math.max(0, Math.min(1, decision.confidence ?? 0.7));
								reason = decision.reasoning || 'LLM decision';
								targetId = decision.targetMemoryId || null;
								usedLLM = true;

								logger.debug(`ExtractAndOperateMemory: LLM decision for fact ${i + 1}`, {
									factPreview: fact.substring(0, 80) + (fact.length > 80 ? '...' : ''),
									decision: action,
									confidence: confidence.toFixed(2),
									reasoning: reason,
									targetMemoryId: targetId,
									decisionMethod: 'LLM',
								});
							} else {
								throw new Error('LLM decision missing required fields or invalid operation');
							}
						} catch (llmError) {
							logger.warn(
								`ExtractAndOperateMemory: LLM decision failed for fact ${i + 1}, using heuristic fallback`,
								{
									factPreview: fact.substring(0, 80),
									error: llmError instanceof Error ? llmError.message : String(llmError),
								}
							);
							usedLLM = false;
						}
					}

					// Heuristic fallback with improved logic
					if (!usedLLM) {
						const mostSimilar = similar.length > 0 ? similar[0] : null;
						confidence = mostSimilar?.score ?? 0;

						if (!mostSimilar || confidence < options.similarityThreshold) {
							action = 'ADD';
							reason = 'No highly similar memory found; adding as new.';
						} else {
							if (fact === mostSimilar.payload?.text) {
								action = 'NONE';
								reason = 'Fact is redundant; already present.';
								targetId = mostSimilar.id;
							} else if (fact.length > (mostSimilar.payload?.text?.length ?? 0)) {
								action = 'UPDATE';
								targetId = mostSimilar.id;
								reason = 'Fact is more complete/correct; updating existing memory.';
							} else if (
								fact.includes('not') &&
								mostSimilar.payload?.text &&
								!mostSimilar.payload.text.includes('not')
							) {
								action = 'DELETE';
								targetId = mostSimilar.id;
								reason = 'Fact contradicts existing memory; deleting old memory.';
							} else {
								action = 'NONE';
								reason = 'Fact is similar but not more complete; ignoring.';
								targetId = mostSimilar.id;
							}
						}

						logger.debug(`ExtractAndOperateMemory: Heuristic decision for fact ${i + 1}`, {
							factPreview: fact.substring(0, 80) + (fact.length > 80 ? '...' : ''),
							decision: action,
							confidence: confidence.toFixed(3),
							reasoning: reason,
							targetMemoryId: targetId,
							decisionMethod: 'Heuristic',
							topSimilarityScore: mostSimilar?.score?.toFixed(3) || 'N/A',
							similarityThreshold: options.similarityThreshold.toFixed(2),
						});
					}

					memoryActions.push({
						id:
							action === 'ADD'
								? generateSafeMemoryId(i)
								: targetId && !isNaN(Number(targetId)) && Number(targetId) > 0
									? Number(targetId)
									: generateSafeMemoryId(i),
						text: fact,
						event: action,
						tags: extractTechnicalTags(fact),
						confidence,
						reasoning: reason,
					});

					memorySummaries.push({
						factPreview: fact.substring(0, 80),
						action,
						confidence,
						reason,
						targetId,
					});
				} catch (factError) {
					logger.error(`ExtractAndOperateMemory: Failed to process fact ${i + 1}`, {
						error: factError instanceof Error ? factError.message : String(factError),
						factPreview: fact.substring(0, 50),
					});

					// Add fallback action for failed fact
					memoryActions.push({
						id: generateSafeMemoryId(i),
						text: fact,
						event: 'ADD',
						tags: extractTechnicalTags(fact),
						confidence: 0.4,
						reasoning: `Fallback due to processing error: ${factError instanceof Error ? factError.message : String(factError)}`,
					});
				}
			}

			// Step 3: Enhanced persistence with better error handling
			logger.debug('ExtractAndOperateMemory: Starting memory persistence operations', {
				totalActions: memoryActions.length,
				persistableActions: memoryActions.filter(a => ['ADD', 'UPDATE', 'DELETE'].includes(a.event))
					.length,
				skippableActions: memoryActions.filter(a => a.event === 'NONE').length,
			});

			let persistedCount = 0;
			for (const action of memoryActions) {
				if (['ADD', 'UPDATE', 'DELETE'].includes(action.event)) {
					if (!action.text) {
						logger.warn(`ExtractAndOperateMemory: Skipping action with undefined text`, {
							memoryId: action.id,
							event: action.event,
						});
						continue;
					}

					try {
						const embedding = await embedder.embed(action.text);

						// Determine quality source based on how the decision was made
						let qualitySource: 'similarity' | 'llm' | 'heuristic' = 'heuristic';
						if (action.reasoning.includes('LLM')) {
							qualitySource = 'llm';
						} else if (action.reasoning.includes('similarity')) {
							qualitySource = 'similarity';
						}

						// Create V2 payload with enhanced metadata
						const domain = inferDomainFromTags(action.tags);
						const options: any = {
							qualitySource,
						};

						if (context?.sessionId) {
							options.sourceSessionId = context.sessionId;
						}
						if (domain) {
							options.domain = domain;
						}
						if ('code_pattern' in action && action.code_pattern) {
							options.code_pattern = action.code_pattern;
						}
						if ('old_memory' in action && action.old_memory) {
							options.old_memory = action.old_memory;
						}

						const payload = createKnowledgePayload(
							action.id,
							action.text,
							action.tags,
							action.confidence,
							action.reasoning,
							action.event as 'ADD' | 'UPDATE' | 'DELETE' | 'NONE',
							options
						);

						if (action.event === 'ADD') {
							await vectorStore.insert([embedding], [action.id], [payload]);
							logger.debug(`ExtractAndOperateMemory: ${action.event} operation completed`, {
								memoryId: action.id,
								textPreview: action.text.substring(0, 60) + (action.text.length > 60 ? '...' : ''),
								tags: action.tags,
								confidence: action.confidence.toFixed(3),
							});
						} else if (action.event === 'UPDATE') {
							await vectorStore.update(action.id, embedding, payload);
							logger.debug(`ExtractAndOperateMemory: ${action.event} operation completed`, {
								memoryId: action.id,
								textPreview: action.text.substring(0, 60) + (action.text.length > 60 ? '...' : ''),
								tags: action.tags,
								confidence: action.confidence.toFixed(3),
							});
						} else if (action.event === 'DELETE') {
							await vectorStore.delete(action.id);
							logger.debug(`ExtractAndOperateMemory: ${action.event} operation completed`, {
								memoryId: action.id,
								reasoning: action.reasoning,
							});
						}
						persistedCount++;
					} catch (persistError) {
						logger.error(
							`ExtractAndOperateMemory: ${action.event} operation failed, continuing with others`,
							{
								memoryId: action.id,
								textPreview: action.text.substring(0, 60) + (action.text.length > 60 ? '...' : ''),
								error: persistError instanceof Error ? persistError.message : String(persistError),
							}
						);

						// Check if this is a runtime failure that should disable embeddings globally
						if (context?.services?.embeddingManager && persistError instanceof Error) {
							context.services.embeddingManager.handleRuntimeFailure(
								persistError,
								embedder.getConfig().type
							);
						}

						// Continue with other actions even if one fails
					}
				}
			}

			logger.debug('ExtractAndOperateMemory: Memory persistence completed', {
				totalProcessed: memoryActions.length,
				successfullyPersisted: persistedCount,
				actionsSummary: {
					ADD: memoryActions.filter(a => a.event === 'ADD').length,
					UPDATE: memoryActions.filter(a => a.event === 'UPDATE').length,
					DELETE: memoryActions.filter(a => a.event === 'DELETE').length,
					NONE: memoryActions.filter(a => a.event === 'NONE').length,
				},
			});

			// Return successful result even if some operations failed
			return {
				success: true,
				extraction: extractionStats,
				memory: memoryActions,
				summary: memorySummaries,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('ExtractAndOperateMemory: Critical failure in extract and operate', {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
			});

			return {
				success: false,
				error: errorMessage,
				extraction: {
					extracted: 0,
					skipped: Array.isArray(args.interaction) ? args.interaction.length : 1,
					facts: [],
				},
				memory: [],
				summary: [],
				timestamp: new Date().toISOString(),
			};
		}
	},
};
