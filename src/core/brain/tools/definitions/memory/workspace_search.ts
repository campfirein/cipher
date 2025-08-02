import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { WorkspacePayload } from './workspace-payloads.js';
import { env } from '../../../../env.js';

/**
 * Workspace Search Result Interface
 */
interface WorkspaceSearchResult {
	success: boolean;
	query: string;
	results: Array<{
		id: string;
		text: string;
		tags: string[];
		timestamp: string;
		similarity: number;
		source: 'workspace';
		memoryType: 'workspace';
		version?: number;
		// Workspace-specific fields
		teamMember?: string;
		currentProgress?: {
			feature: string;
			status: 'in-progress' | 'completed' | 'blocked' | 'reviewing';
			completion?: number;
		};
		bugsEncountered?: Array<{
			description: string;
			severity: 'low' | 'medium' | 'high' | 'critical';
			status: 'open' | 'in-progress' | 'fixed';
		}>;
		workContext?: {
			project?: string;
			repository?: string;
			branch?: string;
		};
		confidence?: number;
		event?: string;
		domain?: string;
		qualitySource?: string;
		sourceSessionId?: string;
	}>;
	metadata: {
		totalResults: number;
		searchTime: number;
		embeddingTime: number;
		maxSimilarity: number;
		minSimilarity: number;
		averageSimilarity: number;
		workspaceResults: number;
		searchMode: 'workspace';
		usedFallback?: boolean;
		filters?: {
			domain?: string;
			teamMember?: string;
			project?: string;
		};
	};
	timestamp: string;
}

/**
 * Workspace Search Tool
 *
 * This tool enables semantic retrieval from the workspace memory system.
 * It searches over stored workspace memories including team progress, project information,
 * bug reports, and collaboration context using vector similarity search.
 */
export const workspaceSearchTool: InternalTool = {
	name: 'workspace_search',
	category: 'memory',
	internal: true,
	agentAccessible: true, // Agent-accessible: searches workspace memory only
	description:
		'Search workspace memory for team and project information including progress, bugs, and collaboration context.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'The search query to find relevant workspace memories. Use natural language to describe team activities, project progress, or collaboration context.',
				minLength: 1,
				maxLength: 1000,
			},
			top_k: {
				type: 'number',
				description: 'Maximum number of results to return (default: 10)',
				minimum: 1,
				maximum: 50,
				default: 10,
			},
			similarity_threshold: {
				type: 'number',
				description: `Minimum similarity score for results (0.0 to 1.0, default: ${env.WORKSPACE_SEARCH_THRESHOLD})`,
				minimum: 0.0,
				maximum: 1.0,
				default: env.WORKSPACE_SEARCH_THRESHOLD,
			},
			filters: {
				type: 'object',
				description: 'Optional filters to narrow search results',
				properties: {
					domain: {
						type: 'string',
						description: 'Filter by domain (frontend, backend, devops, quality-assurance, design)',
						enum: ['frontend', 'backend', 'devops', 'quality-assurance', 'design'],
					},
					team_member: {
						type: 'string',
						description: 'Filter by team member name or identifier',
					},
					project: {
						type: 'string',
						description: 'Filter by project name or identifier',
					},
					status: {
						type: 'string',
						description: 'Filter by progress status',
						enum: ['in-progress', 'completed', 'blocked', 'reviewing'],
					},
				},
				additionalProperties: false,
			},
			include_metadata: {
				type: 'boolean',
				description: 'Whether to include detailed metadata in results (default: true)',
				default: true,
			},
		},
		required: ['query'],
	},
	handler: async (args: any, context?: InternalToolContext): Promise<WorkspaceSearchResult> => {
		const startTime = Date.now();

		try {
			// Check if workspace memory is enabled
			if (!env.USE_WORKSPACE_MEMORY) {
				logger.debug('WorkspaceSearch: Workspace memory is disabled, returning empty results');
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
						workspaceResults: 0,
						searchMode: 'workspace',
						usedFallback: true,
					},
					timestamp: new Date().toISOString(),
				};
			}

			logger.debug('WorkspaceSearch: Processing workspace memory search request', {
				query: args.query?.substring(0, 100) || 'undefined',
				top_k: args.top_k || 10,
				similarity_threshold: args.similarity_threshold || env.WORKSPACE_SEARCH_THRESHOLD,
				filters: args.filters,
			});

			// Check if embeddings are disabled for this session
			if (context?.services?.embeddingManager?.getSessionState()?.isDisabled()) {
				const reason = context.services.embeddingManager.getSessionState().getDisabledReason();
				logger.debug(
					'WorkspaceSearch: Embeddings disabled for this session, returning empty results',
					{ reason }
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
						workspaceResults: 0,
						searchMode: 'workspace',
						usedFallback: true,
					},
					timestamp: new Date().toISOString(),
				};
			}

			// Check if embedding manager indicates no available embeddings
			if (
				context?.services?.embeddingManager &&
				!context.services.embeddingManager.hasAvailableEmbeddings()
			) {
				logger.debug('WorkspaceSearch: No available embeddings, returning empty results');
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
						workspaceResults: 0,
						searchMode: 'workspace',
						usedFallback: true,
					},
					timestamp: new Date().toISOString(),
				};
			}

			// Validate required parameters
			if (!args.query || typeof args.query !== 'string' || args.query.trim().length === 0) {
				throw new Error('Query is required and must be a non-empty string');
			}

			// Set defaults
			const query = args.query.trim();
			const topK = Math.max(1, Math.min(50, args.top_k || 10));
			const similarityThreshold = Math.max(
				0.0,
				Math.min(1.0, args.similarity_threshold || env.WORKSPACE_SEARCH_THRESHOLD)
			);
			const filters = args.filters || {};

			// Get required services from context
			if (!context?.services) {
				throw new Error('InternalToolContext.services is required for workspace search');
			}

			const embeddingManager = context.services.embeddingManager;
			const vectorStoreManager = context.services.vectorStoreManager;

			if (!embeddingManager || !vectorStoreManager) {
				throw new Error('EmbeddingManager and VectorStoreManager are required in context.services');
			}

			const embedder = embeddingManager.getEmbedder('default');

			if (!embedder?.embed || typeof embedder.embed !== 'function') {
				throw new Error('Embedder is not properly initialized or missing embed() method');
			}

			// Generate embedding for the search query
			const embeddingStartTime = Date.now();
			logger.debug('WorkspaceSearch: Generating embedding for query', {
				queryLength: query.length,
				queryPreview: query.substring(0, 50),
			});

			let queryEmbedding;
			try {
				queryEmbedding = await embedder?.embed(query);
			} catch (embedError) {
				logger.error(
					'WorkspaceSearch: Failed to generate embedding, disabling embeddings globally',
					{
						error: embedError instanceof Error ? embedError.message : String(embedError),
						provider: embedder.getConfig().type,
					}
				);

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
						workspaceResults: 0,
						searchMode: 'workspace',
						usedFallback: true,
					},
					timestamp: new Date().toISOString(),
				};
			}

			const embeddingTime = Date.now() - embeddingStartTime;

			logger.debug('WorkspaceSearch: Embedding generated successfully', {
				embeddingTime: `${embeddingTime}ms`,
				embeddingDimensions: Array.isArray(queryEmbedding) ? queryEmbedding.length : 'unknown',
			});

			// Search workspace memory
			const searchStartTime = Date.now();
			let workspaceResults: any[] = [];
			let usedFallback = false;

			// Get workspace store
			const workspaceCollectionName = env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory';
			let workspaceStore = null;

			// Detect vector store manager type and get workspace store
			const managerName = vectorStoreManager.constructor.name;
			logger.debug('WorkspaceSearch: Detecting vector manager type', {
				managerName,
				collectionName: workspaceCollectionName,
				hasGetStore: typeof vectorStoreManager.getStore === 'function',
			});

			// Try workspace collection access methods in order of preference
			try {
				// Method 1: Try workspace-specific getter (MultiCollectionVectorManager)
				if (managerName === 'MultiCollectionVectorManager' || managerName.includes('Multi')) {
					logger.debug('WorkspaceSearch: Using MultiCollectionVectorManager for workspace search');
					workspaceStore = (vectorStoreManager as any).getStore('workspace');
				}
				// Method 2: Try dual collection manager (DualCollectionVectorManager)
				else if (managerName === 'DualCollectionVectorManager' || managerName.includes('Dual')) {
					logger.debug(
						'WorkspaceSearch: Using DualCollectionVectorManager - trying workspace store'
					);
					try {
						workspaceStore = (vectorStoreManager as any).getStore('workspace');
					} catch {
						// DualCollectionVectorManager doesn't have workspace, fall back
						logger.debug(
							'WorkspaceSearch: DualCollectionVectorManager has no workspace - using knowledge store'
						);
						workspaceStore = (vectorStoreManager as any).getStore('knowledge');
						usedFallback = true;
					}
				}
				// Method 3: Single collection manager or named store
				else {
					logger.debug('WorkspaceSearch: Using single collection manager');
					workspaceStore =
						(vectorStoreManager as any).getNamedStore?.(workspaceCollectionName) ||
						vectorStoreManager.getStore();
					if (!(vectorStoreManager as any).getNamedStore) {
						usedFallback = true;
					}
				}
			} catch (error) {
				// Final fallback to default store
				logger.debug('WorkspaceSearch: All workspace access methods failed, using default store', {
					error: error instanceof Error ? error.message : String(error),
				});
				workspaceStore = vectorStoreManager.getStore();
				usedFallback = true;
			}

			if (!workspaceStore) {
				throw new Error('Workspace vector store not available');
			}

			// Search workspace collection
			workspaceResults = await workspaceStore.search(queryEmbedding, topK * 2);

			// Mark results with source
			const allResults = workspaceResults.map((result: any) => ({
				...result,
				payload: {
					...result.payload,
					source: 'workspace',
					memoryType: 'workspace',
				},
			}));

			logger.debug('WorkspaceSearch: Workspace collection search completed', {
				resultsFound: workspaceResults.length,
			});

			const searchTime = Date.now() - searchStartTime;

			logger.debug('WorkspaceSearch: Workspace search completed', {
				searchTime: `${searchTime}ms`,
				totalResults: allResults.length,
				workspaceResults: workspaceResults.length,
			});

			// Filter, rank, and format workspace memory results
			let filteredResults = allResults
				.filter(result => (result.score || 0) >= similarityThreshold)
				.sort((a, b) => (b.score || 0) - (a.score || 0)); // Sort by similarity score descending

			// Apply additional filters
			if (filters.domain) {
				filteredResults = filteredResults.filter(
					result => result.payload?.domain === filters.domain
				);
			}

			if (filters.team_member) {
				filteredResults = filteredResults.filter(result =>
					result.payload?.teamMember?.toLowerCase().includes(filters.team_member.toLowerCase())
				);
			}

			if (filters.project) {
				filteredResults = filteredResults.filter(result =>
					result.payload?.workContext?.project
						?.toLowerCase()
						.includes(filters.project.toLowerCase())
				);
			}

			if (filters.status) {
				filteredResults = filteredResults.filter(
					result => result.payload?.currentProgress?.status === filters.status
				);
			}

			// Take top K results overall and format
			const finalResults = filteredResults.slice(0, topK).map(result => {
				const rawPayload = result.payload || {};
				const payload = rawPayload as WorkspacePayload;

				// Return unified result format with workspace payload data
				const baseResult = {
					id: result.id || payload.id || 'unknown',
					text: payload.text || 'No content available',
					tags: payload.tags || [],
					timestamp: payload.timestamp || new Date().toISOString(),
					similarity: result.score || 0,
					version: payload.version || 2,
					source: 'workspace' as const,
					memoryType: 'workspace' as const,
				};

				// Add workspace-specific fields
				return {
					...baseResult,
					...(payload.teamMember && { teamMember: payload.teamMember }),
					...(payload.currentProgress && { currentProgress: payload.currentProgress }),
					...(payload.bugsEncountered && { bugsEncountered: payload.bugsEncountered }),
					...(payload.workContext && { workContext: payload.workContext }),
					confidence: payload.confidence || 0,
					event: payload.event,
					...(payload.domain && { domain: payload.domain }),
					qualitySource: payload.qualitySource,
					...(payload.sourceSessionId && { sourceSessionId: payload.sourceSessionId }),
				};
			});

			// Calculate statistics
			const totalResults = finalResults.length;
			const similarities = finalResults.map(r => r.similarity);
			const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
			const minSimilarity = similarities.length > 0 ? Math.min(...similarities) : 0;
			const averageSimilarity =
				similarities.length > 0 ? similarities.reduce((a, b) => a + b, 0) / similarities.length : 0;

			const totalTime = Date.now() - startTime;

			// Prepare result
			const result: WorkspaceSearchResult = {
				success: true,
				query: query,
				results: finalResults,
				metadata: {
					totalResults,
					searchTime: totalTime,
					embeddingTime,
					maxSimilarity,
					minSimilarity,
					averageSimilarity,
					workspaceResults: totalResults,
					searchMode: 'workspace',
					usedFallback,
					...(Object.keys(filters).length > 0 && { filters }),
				},
				timestamp: new Date().toISOString(),
			};

			logger.debug('WorkspaceSearch: Workspace search completed successfully', {
				query: query.substring(0, 50),
				resultsFound: totalResults,
				workspaceResults: totalResults,
				maxSimilarity: maxSimilarity.toFixed(3),
				averageSimilarity: averageSimilarity.toFixed(3),
				totalTime: `${totalTime}ms`,
				usedFallback,
				appliedFilters: Object.keys(filters),
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const totalTime = Date.now() - startTime;

			logger.error('WorkspaceSearch: Search failed', {
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
					workspaceResults: 0,
					searchMode: 'workspace',
					usedFallback: true,
				},
				timestamp: new Date().toISOString(),
			};
		}
	},
};
