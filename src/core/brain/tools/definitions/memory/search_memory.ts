

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
// Import payload migration utilities
import { KnowledgePayload } from './payloads.js';
import { env } from '../../../../env.js';

/**
 * Memory Search Tool Result Interface
 */
interface MemorySearchResult {
    success: boolean;
    query: string;
    results: Array<{
        id: string;
        text: string;
        tags: string[];
        timestamp: string;
        similarity: number;
        source: 'knowledge';
        memoryType: 'knowledge';
        version?: number;
        // Knowledge memory fields
        confidence?: number;
        reasoning?: string;
        event?: string;
        domain?: string;
        qualitySource?: string;
        code_pattern?: string;
        old_memory?: string;
        sourceSessionId?: string;
    }>;
    metadata: {
        totalResults: number;
        searchTime: number;
        embeddingTime: number;
        maxSimilarity: number;
        minSimilarity: number;
        averageSimilarity: number;
        knowledgeResults: number;
        reflectionResults: number; // Always 0 for knowledge-only search
        searchMode: 'knowledge';
        usedFallback?: boolean;
        queryRefinementApplied?: boolean;
    };
    timestamp: string;
}

/**
 * Memory Search Tool
 *
 * This tool enables semantic retrieval from the agent's knowledge memory system.
 * It searches over stored knowledge memories using vector similarity search
 * and returns relevant entries that can inform the current reasoning process.
 *
 * NOTE: This tool ONLY searches knowledge memory. For reflection memory, use cipher_search_reasoning_patterns.
 */
export const searchMemoryTool: InternalTool = {
    name: 'memory_search',
    category: 'memory',
    internal: true,
    agentAccessible: true, // Agent-accessible: searches knowledge memory only
    description:
        'Perform semantic search over stored knowledge memory entries to retrieve relevant knowledge that can inform current decision-making.',
    version: '1.0.0',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'The search query to find relevant knowledge memories. Use natural language to describe what you are looking for.',
                minLength: 1,
                maxLength: 1000,
            },
            top_k: {
                type: 'number',
                description: 'Maximum number of results to return (default: 5)',
                minimum: 1,
                maximum: 50,
                default: 5,
            },
            similarity_threshold: {
                type: 'number',
                description: 'Minimum similarity score for results (0.0 to 1.0, default: 0.3)',
                minimum: 0.0,
                maximum: 1.0,
                default: 0.3,
            },
            include_metadata: {
                type: 'boolean',
                description: 'Whether to include detailed metadata in results (default: true)',
                default: true,
            },
            enable_query_refinement: {
                type: 'boolean',
                description: 'Whether to apply query refinement for better search results (default: true)',
                default: true,
            },
        },
        required: ['query'],
    },
    handler: async (args: any, context?: InternalToolContext): Promise<MemorySearchResult> => {
        const startTime = Date.now();
        const callId = Math.random().toString(36).substring(7);

        console.log(`🔍 [${callId}] search_memory tool called with:`, {
            query: args.query?.substring(0, 100),
            top_k: args.top_k,
            similarity_threshold: args.similarity_threshold,
            sessionId: context?.sessionId,
            toolName: context?.toolName,
        });

        try {
            logger.debug('MemorySearch: Processing knowledge memory search request', {
                query: args.query?.substring(0, 100) || 'undefined',
                top_k: args.top_k || 5,
                similarity_threshold: args.similarity_threshold || 0.3,
                enable_query_refinement: args.enable_query_refinement !== false,
            });

            // Check if embeddings are disabled for this session
            if (context?.services?.embeddingManager?.getSessionState()?.isDisabled()) {
                const reason = context.services.embeddingManager.getSessionState().getDisabledReason();
                logger.debug(
                    'MemorySearch: Embeddings disabled for this session, returning empty results',
                    {
                        reason,
                    }
                );
                return {
                    success: true,
                    query: args.query || '',
                    results: [],
                    metadata: {
                        totalResults: 0,
                        searchTime: Date.now() - startTime,
                        embeddingTime: 0,
                        maxSimilarity: 0,
                        minSimilarity: 0,
                        averageSimilarity: 0,
                        knowledgeResults: 0,
                        reflectionResults: 0,
                        searchMode: 'knowledge',
                        usedFallback: true,
                        queryRefinementApplied: false,
                    },
                    timestamp: new Date().toISOString(),
                };
            }

            // Check if embedding manager indicates no available embeddings
            if (
                context?.services?.embeddingManager &&
                !context.services.embeddingManager.hasAvailableEmbeddings()
            ) {
                logger.debug('MemorySearch: No available embeddings, returning empty results');
                return {
                    success: true,
                    query: args.query || '',
                    results: [],
                    metadata: {
                        totalResults: 0,
                        searchTime: Date.now() - startTime,
                        embeddingTime: 0,
                        maxSimilarity: 0,
                        minSimilarity: 0,
                        averageSimilarity: 0,
                        knowledgeResults: 0,
                        reflectionResults: 0,
                        searchMode: 'knowledge',
                        usedFallback: true,
                        queryRefinementApplied: false,
                    },
                    timestamp: new Date().toISOString(),
                };
            }

            // Validate required parameters
            if (!args.query || typeof args.query !== 'string' || args.query.trim().length === 0) {
                throw new Error('Query is required and must be a non-empty string');
            }

            // Set defaults
            const originalQuery = args.query.trim();
            const topK = Math.max(1, Math.min(50, args.top_k || 5));
            const similarityThreshold = Math.max(0.0, Math.min(1.0, args.similarity_threshold || 0.3));
            const enableQueryRefinement = args.enable_query_refinement !== false && env.ENABLE_QUERY_REFINEMENT !== false;

            // Get required services from context
            if (!context?.services) {
                throw new Error('InternalToolContext.services is required for memory search');
            }

            const embeddingManager = context.services.embeddingManager;
            const vectorStoreManager = context.services.vectorStoreManager;

            if (!embeddingManager || !vectorStoreManager) {
                throw new Error('EmbeddingManager and VectorStoreManager are required in context.services');
            }

            const embedder = embeddingManager.getEmbedder('default');

            if (!embedder?.embed || typeof embedder.embed !== 'function' || !embedder.embedBatch || typeof embedder.embedBatch !== 'function') {
                throw new Error('Embedder is not properly initialized or missing embed() or embedBatch() method');
            }

            // Generate embedding for the search query
            const embeddingStartTime = Date.now();
            logger.debug('MemorySearch: Generating embedding for query', {
                originalQueryLength: originalQuery.length,
                originalQueryPreview: originalQuery.substring(0, 50),
            });

			let finalQuery: string[] = [originalQuery];
            let queryEmbeddings: number[][];
			// Rewrite query if enabled
			try {
				if (enableQueryRefinement) {
					const rewrittenQueries = await rewriteUserQuery(originalQuery, context.services.llmService);
					finalQuery = rewrittenQueries.queries;
				}
			logger.info('Embedding final query:', finalQuery);
			queryEmbeddings = await embedder.embedBatch(finalQuery);
            } catch (embedError) {
                logger.error('MemorySearch: Failed to generate embedding, disabling embeddings globally', {
                    error: embedError instanceof Error ? embedError.message : String(embedError),
                    provider: embedder.getConfig().type,
                });

                // Immediately disable embeddings globally on first failure
                if (context?.services?.embeddingManager && embedError instanceof Error) {
                    context.services.embeddingManager.handleRuntimeFailure(
                        embedError,
                        embedder.getConfig().type
                    );
                }

                // Return empty results since embeddings are now disabled
                return {
                    success: true,
                    query: args.query || '',
                    results: [],
                    metadata: {
                        totalResults: 0,
                        searchTime: Date.now() - startTime,
                        embeddingTime: 0,
                        maxSimilarity: 0,
                        minSimilarity: 0,
                        averageSimilarity: 0,
                        knowledgeResults: 0,
                        reflectionResults: 0,
                        searchMode: 'knowledge',
                        usedFallback: true,
                    },
                    timestamp: new Date().toISOString(),
                };
            }

            const embeddingTime = Date.now() - embeddingStartTime;

            logger.debug('MemorySearch: Embedding generated successfully', {
                embeddingTime: `${embeddingTime}ms`,
                embeddingDimensions: Array.isArray(queryEmbeddings[0]) ? queryEmbeddings[0].length : 'unknown',
            });
            // Search knowledge memory only
            const searchStartTime = Date.now();
            let allResults: any[] = [];
            let knowledgeResultCount = 0;
            // let reflectionResultCount = 0; // Always 0 for knowledge-only search
            let usedFallback = false;

            // Check if we have a DualCollectionVectorManager
            const isDualManager =
                vectorStoreManager.constructor.name === 'DualCollectionVectorManager' ||
                (typeof vectorStoreManager.getStore === 'function' &&
                    vectorStoreManager.getStore.length === 1); // getStore(type) signature

            let knowledgeStore = null;
            if (isDualManager) {
                logger.debug('MemorySearch: Using DualCollectionVectorManager for knowledge search', {
                    isDualManager: true,
                });

                try {
                    // Try dual manager API first for knowledge collection
                    knowledgeStore = (vectorStoreManager as any).getStore('knowledge');
                } catch {
                    // Fallback to default store
                    try {
                        knowledgeStore = vectorStoreManager.getStore();
                        usedFallback = true;
                    } catch (fallbackError) {
                        throw new Error(
                            `Knowledge collection failed and fallback to default store also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
                        );
                    }
                }
            } else {
                // Single collection manager - get default store
                logger.debug('MemorySearch: Using single collection manager for knowledge search', {
                    isDualManager: false,
                });

                knowledgeStore = vectorStoreManager.getStore();
            }

            if (!knowledgeStore) {
                throw new Error('Knowledge vector store not available');
            }
			// Retrieve knowledge for each query embedding
			for (const queryEmbedding of queryEmbeddings) {
				// Search knowledge collection
				const knowledgeResults = await knowledgeStore.search(queryEmbedding, topK * 2);
				
				// Mark results with source and add to allResults
				const markedResults = knowledgeResults.map((result: any) => ({
					...result,
					payload: {
						...result.payload,
						source: 'knowledge',
						memoryType: 'knowledge',
					},
				}));

				// Accumulate results instead of overwriting
				allResults.push(...markedResults);

				logger.debug('MemorySearch: Knowledge collection search completed for query embedding', {
					resultsFound: knowledgeResults.length,
					totalAccumulatedResults: allResults.length,
				});
			}

			const searchTime = Date.now() - searchStartTime;
			knowledgeResultCount = allResults.length;
			logger.info('Knowledge results:', allResults);
			logger.debug('MemorySearch: Knowledge search completed for all query embeddings', {
				searchTime: `${searchTime}ms`,
				totalResults: allResults.length,
				knowledgeResults: knowledgeResultCount,
			});

            // Filter, rank, and format knowledge memory results
            const filteredResults = allResults
                .filter(result => (result.score || 0) >= similarityThreshold)
                .sort((a, b) => (b.score || 0) - (a.score || 0)) // Sort by similarity score descending
                .slice(0, topK) // Take top K results overall
                .map(result => {
                    const rawPayload = result.payload || {};

                    // All data is V2 format after collection cleanup - no migration needed
                    const payload = rawPayload as KnowledgePayload;

                    // Return unified result format with V2 payload data
                    const baseResult = {
                        id: result.id || payload.id || 'unknown',
                        text: payload.text || 'No content available',
                        tags: payload.tags || [],
                        timestamp: payload.timestamp || new Date().toISOString(),
                        similarity: result.score || 0,
                        version: payload.version || 2, // All data is V2 after cleanup
                        source: 'knowledge' as const,
                        memoryType: 'knowledge' as const,
                    };

                    // Add knowledge-specific fields
                    const knowledgePayload = payload as KnowledgePayload;
                    return {
                        ...baseResult,
                        confidence: knowledgePayload.confidence || 0,
                        reasoning: knowledgePayload.reasoning || 'No reasoning available',
                        event: knowledgePayload.event,
                        ...(knowledgePayload.domain && { domain: knowledgePayload.domain }),
                        qualitySource: knowledgePayload.qualitySource,
                        ...(knowledgePayload.sourceSessionId && {
                            sourceSessionId: knowledgePayload.sourceSessionId,
                        }),
                        ...(knowledgePayload.code_pattern && { code_pattern: knowledgePayload.code_pattern }),
                        ...(knowledgePayload.old_memory && { old_memory: knowledgePayload.old_memory }),
                    };
                });

            // Calculate statistics for knowledge search results
            const totalResults = filteredResults.length;
            const similarities = filteredResults.map(r => r.similarity);
            const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
            const minSimilarity = similarities.length > 0 ? Math.min(...similarities) : 0;
            const averageSimilarity =
                similarities.length > 0 ? similarities.reduce((a, b) => a + b, 0) / similarities.length : 0;

            const totalTime = Date.now() - startTime;

            // Prepare result
            const result: MemorySearchResult = {
                success: true,
                query: originalQuery,
                results: filteredResults,
                metadata: {
                    totalResults,
                    searchTime: totalTime,
                    embeddingTime,
                    maxSimilarity,
                    minSimilarity,
                    averageSimilarity,
                    knowledgeResults: totalResults, // All results are knowledge results
                    reflectionResults: 0, // No reflection results in knowledge-only search
                    searchMode: 'knowledge',
                    usedFallback,
                },
                timestamp: new Date().toISOString(),
            };

            logger.debug('MemorySearch: Knowledge search completed successfully', {
                query: originalQuery.substring(0, 50),
                resultsFound: totalResults,
                knowledgeResults: totalResults,
                maxSimilarity: maxSimilarity.toFixed(3),
                averageSimilarity: averageSimilarity.toFixed(3),
                totalTime: `${totalTime}ms`,
                usedFallback,
            });
			// Return result to agent 
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const totalTime = Date.now() - startTime;

            logger.error('MemorySearch: Search failed', {
                error: errorMessage,
                query: args.query?.substring(0, 50) || 'undefined',
                processingTime: `${totalTime}ms`,
            });

            // Check if this is a runtime failure that should disable embeddings globally
            if (context?.services?.embeddingManager && error instanceof Error) {
                const embeddingManager = context.services.embeddingManager;
                if (embeddingManager && typeof embeddingManager.handleRuntimeFailure === 'function') {
                    const embedder = embeddingManager.getEmbedder('default');
                    const providerType = embedder?.getConfig()?.type || 'unknown';
                    embeddingManager.handleRuntimeFailure(error, providerType);
                }
            }

            return {
                success: false,
                query: args.query || 'undefined',
                results: [],
                metadata: {
                    totalResults: 0,
                    searchTime: totalTime,
                    embeddingTime: 0,
                    maxSimilarity: 0,
                    minSimilarity: 0,
                    averageSimilarity: 0,
                    knowledgeResults: 0,
                    reflectionResults: 0,
                    searchMode: 'knowledge',
                    usedFallback: true,
                },
                timestamp: new Date().toISOString(),
            };
        }
    },
};

/**
 * Step 1: Rewrite user query into sub-queries and disambiguate ambiguous terms
 * Uses LLM to generate more targeted queries for better retrieval
 * 
 * @param originalInput - The original user query to rewrite
 * @param llmService - The LLM service to use for rewriting
 * @returns An object containing the rewritten queries
*/
async function rewriteUserQuery(
    originalInput: string,
    llmService: any,
): Promise<{queries: string[]}> {
    // Add debugging to track function calls
    const callId = Math.random().toString(36).substring(7);
    // console.log(`🔄 [${callId}] rewriteUserQuery called with: "${originalInput}"`);
    
    try {
        const rewritePrompt = `
        You are a query decomposition and disambiguation expert. Break down this question into search queries for a knowledge base while handling ambiguous terms.

        QUESTION: "${originalInput}"

		TASK: Create 2-5 concise search queries that capture the core information needs of the question.

		GUIDELINES:
		- Focus on the main intent of the question.
		- Use natural, searchable language (4-15 words per query).
		- Only create disambiguation queries for clearly ambiguous terms.
		- Avoid over-decomposing the question into too many subqueries.
		- Prefer fewer, more precise queries over exhaustive coverage.
		- Each query should stand alone and be understandable without additional context.

		DISAMBIGUATION (Only if needed):
		- For truly ambiguous terms (homonyms, abbreviations, etc.), include 1-2 alternate queries with different meanings.
		- Do not force disambiguation where the meaning is already clear from context.

        OUTPUT FORMAT:
        Respond with ONLY the queries, one per line, using this exact format:
        Query 1: [first query]
        Query 2: [second query]
        [continue as needed...]

        Do not include any explanations, introductions, or other text. Only the queries.

        EXAMPLES:
        Question: "What profession does Nicholas Ray and Elia Kazan have in common?"
        Query 1: Nicholas Ray profession career
        Query 2: Elia Kazan profession career

        Question: "Most total goals in a premier league season?"
        Query 1: Most total goals in a premier league season by a team
        Query 2: Most total goals in a premier league season by a player

        Now decompose and disambiguate: "${originalInput}"
        `;
        const rewriteResponse = await llmService.directGenerate(rewritePrompt);
        
        // Parse the response to extract individual queries
        const queries = rewriteResponse
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                // Extract query content after "Query X:" prefix
                const match = line.match(/^Query\s*\d+:\s*(.+)$/i);
                return match ? match[1].trim() : null;
            })
            .filter(query => query !== null && query.length >= 3)
            .filter((query, index, array) => array.indexOf(query) === index); // Remove duplicates
        
		logger.info(`Parsed queries:`,{ 
								queries: queries,
								queryCount: queries.length,
							});
        // Ensure we have at least one query (fallback to original)
        if (queries.length === 0) {
            return {
                queries: [originalInput]
            };
        }

        return {
            queries: queries
        };

    } catch (error) {
        logger.warn('MemorySearch: Query rewriting failed', {
            originalInput: originalInput.substring(0, 100),
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            queries: [originalInput]
        };
    }
}

