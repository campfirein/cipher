import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { createWorkspacePayload, extractWorkspaceInfo } from './workspace-payloads.js';
import { env } from '../../../../env.js';

/**
 * Determines if a piece of content is significant for workspace memory
 * Focuses on team collaboration, project progress, and work context
 */
function isWorkspaceSignificantContent(content: string): boolean {
	if (!content || content.trim().length === 0) {
		return false;
	}

	const text = content.toLowerCase().trim();

	// Skip patterns that are not workspace-relevant
	const skipPatterns = [
		// Personal information and identity queries
		/\b(my name|user['']?s? name|find my name|search.*name|who am i|what['']?s my name)\b/i,
		/\b(personal|profile|identity|username|login|password|email|address|phone)\b/i,

		// Tool results and system messages
		/^(cipher_.*|workspace_search|workspace_store):\s*(found|completed|no results|error)/i,
		/^(retrieved|result|results|found|matches|search completed|query executed):/i,

		// Simple greetings and social interactions
		/^(user:|assistant:)?\s*(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|please|sorry|excuse me|bye|goodbye)\b/i,

		// Generic status messages without context
		/^(task completed|operation successful|processing|loading|waiting|done|finished|ready)\b/i,

		// Simple yes/no responses
		/^(user:|assistant:)?\s*(yes|no|ok|okay|sure|fine|great|good|right|correct|wrong|true|false)\s*[.!?]?\s*$/i,
	];

	// Check if content matches skip patterns
	for (const pattern of skipPatterns) {
		if (pattern.test(text)) {
			return false;
		}
	}

	// Prioritize workspace and team collaboration content
	const workspacePatterns = [
		// Team and collaboration
		/\b(team|teammate|colleague|collaborat|pair programm|code review|pull request|merge request)\b/i,
		/\b(assigned to|working with|helping|mentoring|onboarding|standup|meeting|discussion)\b/i,
		/\b(project manager|tech lead|senior|junior|intern|developer|engineer|designer|qa)\b/i,

		// Project and work progress
		/\b(project|milestone|deadline|sprint|iteration|epic|story|task|ticket|issue|feature)\b/i,
		/\b(progress|status|update|completion|percentage|completed|finished|deployed|released)\b/i,
		/\b(blocked|blocker|impediment|waiting|pending|reviewing|testing|in progress)\b/i,
		/\b(priority|urgent|critical|high|medium|low|backlog|todo|done|wip)\b/i,

		// Bug tracking and issues
		/\b(bug|error|issue|problem|defect|crash|failure|exception|fix|patch|hotfix)\b/i,
		/\b(severity|critical|high|medium|low|reported|reproduced|investigated|resolved)\b/i,

		// Repository and version control
		/\b(repository|repo|branch|commit|push|pull|merge|git|github|gitlab|bitbucket)\b/i,
		/\b(main|master|develop|feature|hotfix|bugfix|release|version|tag)\b/i,

		// Deployment and environment
		/\b(deploy|deployment|environment|staging|production|dev|test|ci|cd|pipeline)\b/i,
		/\b(build|compile|test|integration|e2e|unit|smoke|regression)\b/i,

		// Technical domains and architecture
		/\b(frontend|backend|fullstack|devops|infrastructure|database|api|microservice)\b/i,
		/\b(architecture|design|pattern|framework|library|component|module|service)\b/i,

		// Work context mentions
		/@[a-zA-Z_]+/, // @username mentions
		/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is working on|completed|fixed|implemented|assigned)/i,
	];

	// Check if content contains workspace patterns
	for (const pattern of workspacePatterns) {
		if (pattern.test(text)) {
			return true;
		}
	}

	// Check for percentage completion patterns
	if (/\d+%/.test(text) && /\b(complete|done|progress|finish)\b/i.test(text)) {
		return true;
	}

	// Check for date/time patterns with work context
	if (
		/\b(today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|weekend)\b/i.test(text) &&
		/\b(deadline|due|meeting|standup|demo|release|deploy)\b/i.test(text)
	) {
		return true;
	}

	// Check minimum length and complexity for workspace context
	if (text.length < 15) {
		return false;
	}

	// Check for work-related keywords density
	const workKeywords = [
		'work',
		'task',
		'project',
		'team',
		'feature',
		'bug',
		'fix',
		'implement',
		'develop',
		'build',
		'deploy',
		'test',
		'review',
		'merge',
		'commit',
		'branch',
		'issue',
		'ticket',
		'milestone',
		'deadline',
		'progress',
		'status',
		'complete',
		'done',
		'blocked',
		'priority',
		'assign',
		'collaborate',
		'pair',
		'help',
		'support',
		'discuss',
		'meeting',
		'standup',
	];

	const words = text.split(/\s+/);
	const workKeywordCount = words.filter(word =>
		workKeywords.includes(word.replace(/[^\w]/g, '').toLowerCase())
	).length;

	// If more than 15% of words are work-related, consider it significant
	const workDensity = workKeywordCount / words.length;
	if (workDensity > 0.15 && words.length > 5) {
		return true;
	}

	return false;
}

/**
 * Determines if a message is a retrieved result from workspace search or other tools
 */
function isRetrievedWorkspaceResult(content: string): boolean {
	if (!content || typeof content !== 'string') return false;
	const text = content.toLowerCase();

	const retrievedPatterns = [
		/^(cipher_workspace_search|workspace_search|cipher_workspace_store|workspace_store):/i,
		/^(workspace results|team results|project results|collaboration results):/i,
		/^(team member|current progress|bugs encountered|work context):/i,
		/^(retrieved workspace|workspace search|team search|project search):/i,
		/^(observation:|action:|thought:|conclusion:|reflection:)/i,
		/^(id:|timestamp:|similarity:|source:|memorytype:)/i,
		/^(message: 'workspace query executed'|message: 'workspace search completed')/i,
		/^(workspaceresults:|teamresults:|projectresults:)/i,
	];

	for (const pattern of retrievedPatterns) {
		if (pattern.test(text)) return true;
	}
	return false;
}

/**
 * Generate a safe workspace memory ID from index
 */
function generateSafeWorkspaceId(index: number): number {
	const timestamp = Math.floor(Date.now() / 1000);
	return timestamp * 1000 + (index % 1000) + 500000; // Offset to avoid conflicts with other memory types
}

/**
 * Extract workspace-relevant tags from content
 */
function extractWorkspaceTags(content: string): string[] {
	const tags = new Set<string>();
	const text = content.toLowerCase();

	// Domain tags
	const domainPatterns = [
		{
			pattern: /\b(?:frontend|front-end|ui|ux|react|vue|angular|html|css|javascript|typescript)\b/i,
			tag: 'frontend',
		},
		{
			pattern: /\b(?:backend|back-end|server|api|database|sql|node|express|django|flask)\b/i,
			tag: 'backend',
		},
		{
			pattern: /\b(?:devops|deployment|docker|kubernetes|ci|cd|pipeline|infrastructure)\b/i,
			tag: 'devops',
		},
		{ pattern: /\b(?:testing|qa|quality|unit test|integration test|e2e)\b/i, tag: 'testing' },
		{ pattern: /\b(?:design|ux|ui|mockup|wireframe|prototype)\b/i, tag: 'design' },
	];

	for (const domainPattern of domainPatterns) {
		if (domainPattern.pattern.test(text)) {
			tags.add(domainPattern.tag);
		}
	}

	// Status tags
	const statusPatterns = [
		{ pattern: /\b(?:completed|done|finished|deployed|released)\b/i, tag: 'completed' },
		{ pattern: /\b(?:blocked|stuck|waiting|pending)\b/i, tag: 'blocked' },
		{ pattern: /\b(?:reviewing|review|testing|qa)\b/i, tag: 'reviewing' },
		{ pattern: /\b(?:in progress|ongoing|working|developing)\b/i, tag: 'in-progress' },
	];

	for (const statusPattern of statusPatterns) {
		if (statusPattern.pattern.test(text)) {
			tags.add(statusPattern.tag);
		}
	}

	// Type tags
	const typePatterns = [
		{ pattern: /\b(?:bug|error|issue|problem|defect)\b/i, tag: 'bug' },
		{ pattern: /\b(?:feature|enhancement|improvement)\b/i, tag: 'feature' },
		{ pattern: /\b(?:task|ticket|story|epic)\b/i, tag: 'task' },
		{ pattern: /\b(?:team|collaboration|pair|meeting)\b/i, tag: 'collaboration' },
		{ pattern: /\b(?:project|milestone|deadline|release)\b/i, tag: 'project' },
	];

	for (const typePattern of typePatterns) {
		if (typePattern.pattern.test(text)) {
			tags.add(typePattern.tag);
		}
	}

	// Always add workspace tag
	tags.add('workspace');

	return Array.from(tags);
}

/**
 * Workspace Store Tool
 *
 * Background tool that automatically stores team-related information including
 * project progress, bugs, collaboration context, and workspace activities.
 * This tool has skipping mechanisms similar to cipher_extract_and_operate_memory.
 */
export const workspaceStoreTool: InternalTool = {
	name: 'workspace_store',
	category: 'memory',
	internal: true,
	agentAccessible: false, // Internal-only: programmatically called after each interaction
	description:
		'Background tool that automatically stores team-related information including project progress, bugs, and collaboration context.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			interaction: {
				oneOf: [
					{
						type: 'string',
						description:
							'A single user interaction or conversation text to extract workspace information from.',
					},
					{
						type: 'array',
						items: { type: 'string' },
						description:
							'Multiple user interactions or conversation texts to extract workspace information from.',
					},
				],
				description:
					'Raw user interaction(s) or conversation text(s) to extract workspace information from.',
			},
			context: {
				type: 'object',
				description: 'Optional context information for workspace operations',
				properties: {
					sessionId: { type: 'string', description: 'Current session identifier' },
					teamId: { type: 'string', description: 'Team identifier' },
					projectId: {
						type: 'string',
						description: 'Project identifier for scoped workspace memory',
					},
					userId: { type: 'string', description: 'User identifier' },
					conversationTopic: { type: 'string', description: 'Current conversation topic or theme' },
					workEnvironment: { type: 'string', description: 'Work environment (dev, staging, prod)' },
				},
				additionalProperties: false,
			},
			options: {
				type: 'object',
				description: 'Configuration options for workspace memory operations',
				properties: {
					similarityThreshold: {
						type: 'number',
						description: 'Similarity threshold for workspace memory matching (0.0 to 1.0)',
						minimum: 0.0,
						maximum: 1.0,
						default: 0.8,
					},
					confidenceThreshold: {
						type: 'number',
						description: 'Minimum confidence threshold for operations (0.0 to 1.0)',
						minimum: 0.0,
						maximum: 1.0,
						default: 0.6,
					},
					enableBatchProcessing: {
						type: 'boolean',
						description: 'Whether to process multiple workspace items in batch',
						default: true,
					},
					autoExtractWorkspaceInfo: {
						type: 'boolean',
						description: 'Whether to automatically extract workspace context',
						default: true,
					},
				},
				additionalProperties: false,
			},
		},
		required: ['interaction'],
	},
	handler: async (args: any, context?: InternalToolContext) => {
		try {
			// Check if workspace memory is enabled
			if (!env.USE_WORKSPACE_MEMORY) {
				logger.debug('WorkspaceStore: Workspace memory is disabled, skipping workspace operations');
				return {
					success: true,
					mode: 'disabled',
					message: 'Workspace memory is disabled',
					extractedFacts: 0,
					workspaceActions: 0,
					skipped: true,
				};
			}

			// Check if embeddings are disabled for this session
			const sessionState = context?.services?.embeddingManager?.getSessionState?.();
			if (sessionState?.isDisabled()) {
				const reason = sessionState.getDisabledReason();
				logger.debug(
					'WorkspaceStore: Embeddings disabled for this session, skipping workspace operations',
					{ reason }
				);
				return {
					success: true,
					mode: 'chat-only',
					message: `Workspace operations disabled: ${reason}`,
					extractedFacts: 0,
					workspaceActions: 0,
					skipped: true,
				};
			}

			// Check if embedding manager indicates no available embeddings
			if (
				context?.services?.embeddingManager &&
				!context.services.embeddingManager.hasAvailableEmbeddings()
			) {
				logger.debug('WorkspaceStore: No available embeddings, skipping workspace operations');
				return {
					success: true,
					mode: 'chat-only',
					message: 'No available embeddings - operating in chat-only mode',
					extractedFacts: 0,
					workspaceActions: 0,
					skipped: true,
				};
			}

			// Step 1: Extract workspace information from interaction(s)
			let workspaceContentArray: string[];
			if (!args.interaction) {
				throw new Error('No interaction(s) provided for workspace extraction');
			}
			if (typeof args.interaction === 'string') {
				workspaceContentArray = [args.interaction];
			} else if (Array.isArray(args.interaction)) {
				workspaceContentArray = args.interaction;
			} else {
				throw new Error('Interaction must be a string or array of strings');
			}

			// Filter out empty or invalid content
			const validContent = workspaceContentArray
				.filter(content => content && typeof content === 'string' && content.trim().length > 0)
				.map(content => content.trim());

			// Apply significance filtering to extract only workspace-relevant content
			const significantContent = validContent.filter(content => {
				if (isRetrievedWorkspaceResult(content)) {
					logger.debug('WorkspaceStore: Skipping retrieved workspace result', {
						contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
						reason: 'Content is a retrieved result from workspace search tool',
					});
					return false;
				}
				const isSignificant = isWorkspaceSignificantContent(content);
				if (!isSignificant) {
					logger.debug('WorkspaceStore: Skipping non-workspace-significant content', {
						contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
						reason: 'Does not contain significant workspace or team collaboration information',
					});
				}
				return isSignificant;
			});

			if (significantContent.length === 0) {
				logger.debug('WorkspaceStore: No significant workspace content found after filtering', {
					originalContent: validContent.length,
					filteredContent: significantContent.length,
					interactionLength: args.interaction.length,
				});
				return {
					success: true,
					extraction: {
						extracted: 0,
						skipped: workspaceContentArray.length,
						content: [],
					},
					workspace: [],
					summary: [],
					timestamp: new Date().toISOString(),
				};
			}

			// Extraction stats
			const extractionStats = {
				extracted: significantContent.length,
				skipped: workspaceContentArray.length - significantContent.length,
				content: significantContent.map((content, i) => ({
					id: `workspace_content_${Math.floor(Date.now() / 1000)}_${i}`,
					preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
					metadata: {
						hasTeamMention:
							/@[a-zA-Z_]+/.test(content) || /\b(team|colleague|developer)\b/i.test(content),
						hasProgress: /\b(progress|complete|done|finish|\d+%)\b/i.test(content),
						hasBugInfo: /\b(bug|error|issue|fix|resolve)\b/i.test(content),
						hasProjectInfo: /\b(project|milestone|deadline|feature)\b/i.test(content),
						length: content.length,
					},
				})),
			};

			// Step 2: Enhanced error handling for service dependencies
			if (!context?.services) {
				logger.warn('WorkspaceStore: No services context available, using basic processing');
				// Return basic processing without vector operations
				const basicWorkspaceActions = significantContent.map((content, i) => ({
					id: generateSafeWorkspaceId(i),
					text: content,
					event: 'ADD' as const,
					tags: extractWorkspaceTags(content),
					confidence: 0.6,
					reasoning: 'Basic processing without vector services',
				}));

				return {
					success: true,
					extraction: extractionStats,
					workspace: basicWorkspaceActions,
					summary: basicWorkspaceActions.map(action => ({
						contentPreview: action.text.substring(0, 80),
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

			if (!embeddingManager || !vectorStoreManager) {
				logger.warn(
					'WorkspaceStore: Missing embedding or vector services, falling back to basic processing'
				);
				const basicWorkspaceActions = significantContent.map((content, i) => ({
					id: generateSafeWorkspaceId(i),
					text: content,
					event: 'ADD' as const,
					tags: extractWorkspaceTags(content),
					confidence: 0.5,
					reasoning: 'Fallback processing due to missing services',
				}));

				return {
					success: true,
					extraction: extractionStats,
					workspace: basicWorkspaceActions,
					summary: basicWorkspaceActions.map(action => ({
						contentPreview: action.text.substring(0, 80),
						action: action.event,
						confidence: action.confidence,
						reason: action.reasoning,
						targetId: action.id,
					})),
					timestamp: new Date().toISOString(),
				};
			}

			const embedder = embeddingManager.getEmbedder('default');

			// Get workspace store - try to get workspace-specific store, fall back to default
			const workspaceCollectionName = env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory';
			let workspaceStore;
			try {
				logger.debug('WorkspaceStore: Using workspace collection', {
					collectionName: workspaceCollectionName,
					hasWorkspaceSpecificType: !!env.WORKSPACE_VECTOR_STORE_TYPE,
					hasWorkspaceSpecificHost: !!(
						env.WORKSPACE_VECTOR_STORE_HOST || env.WORKSPACE_VECTOR_STORE_URL
					),
				});

				// Try to get workspace-specific store through various methods
				workspaceStore =
					(vectorStoreManager as any).getStore('workspace') ||
					(vectorStoreManager as any).getNamedStore?.(workspaceCollectionName) ||
					vectorStoreManager.getStore();
			} catch (error) {
				logger.debug('WorkspaceStore: Falling back to default store', {
					error: error instanceof Error ? error.message : String(error),
				});
				workspaceStore = vectorStoreManager.getStore();
			}

			if (!embedder || !workspaceStore) {
				logger.warn(
					'WorkspaceStore: Embedder or workspace store not available, using basic processing'
				);
				const basicWorkspaceActions = significantContent.map((content, i) => ({
					id: generateSafeWorkspaceId(i),
					text: content,
					event: 'ADD' as const,
					tags: extractWorkspaceTags(content),
					confidence: 0.5,
					reasoning: 'Basic processing - embedder/workspace store unavailable',
				}));

				return {
					success: true,
					extraction: extractionStats,
					workspace: basicWorkspaceActions,
					summary: basicWorkspaceActions.map(action => ({
						contentPreview: action.text.substring(0, 80),
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
				confidenceThreshold: args.options?.confidenceThreshold ?? 0.6,
				autoExtractWorkspaceInfo: args.options?.autoExtractWorkspaceInfo ?? true,
			};

			const workspaceActions = [];
			const workspaceSummaries = [];

			for (let i = 0; i < significantContent.length; i++) {
				const content = significantContent[i];

				if (!content) {
					logger.warn(`WorkspaceStore: Skipping undefined content at index ${i}`);
					continue;
				}

				logger.debug(`WorkspaceStore: Processing content ${i + 1}/${significantContent.length}`, {
					contentPreview: content.substring(0, 80) + (content.length > 80 ? '...' : ''),
					contentLength: content.length,
				});

				try {
					// Embed the content with error handling
					let embedding;
					try {
						embedding = await embedder.embed(content);
					} catch (embedError) {
						logger.error(
							`WorkspaceStore: Failed to embed content ${i + 1}, disabling embeddings for session`,
							{
								error: embedError instanceof Error ? embedError.message : String(embedError),
								contentPreview: content.substring(0, 50),
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
							extractedFacts: significantContent.length,
							workspaceActions: 0,
							skipped: true,
							error: embedError instanceof Error ? embedError.message : String(embedError),
						};
					}

					// Perform similarity search to check for existing workspace memories
					let similar = [];
					try {
						similar = await workspaceStore.search(embedding, 5);
					} catch (searchError) {
						logger.warn(
							`WorkspaceStore: Failed to search similar workspace memories for content ${i + 1}`,
							{
								error: searchError instanceof Error ? searchError.message : String(searchError),
								contentPreview: content.substring(0, 50),
							}
						);
						// Continue with empty similar array
					}

					logger.debug(`WorkspaceStore: Similarity search completed for content ${i + 1}`, {
						similarMemoriesFound: similar.length,
						topSimilarity: similar.length > 0 ? similar[0]?.score?.toFixed(3) : 'N/A',
					});

					// Determine action based on similarity
					let action = 'ADD';
					let targetId = null;
					let reason = '';
					let confidence = options.confidenceThreshold;

					const mostSimilar = similar.length > 0 ? similar[0] : null;
					const similarity = mostSimilar?.score ?? 0;

					if (!mostSimilar || similarity < options.similarityThreshold) {
						action = 'ADD';
						reason = 'No highly similar workspace memory found; adding as new.';
						confidence = Math.max(options.confidenceThreshold, similarity);
					} else {
						if (content === mostSimilar.payload?.text) {
							action = 'NONE';
							reason = 'Content is redundant; already present in workspace memory.';
							targetId = mostSimilar.id;
							confidence = similarity;
						} else if (content.length > (mostSimilar.payload?.text?.length ?? 0)) {
							action = 'UPDATE';
							targetId = mostSimilar.id;
							reason =
								'Content provides more complete workspace information; updating existing memory.';
							confidence = similarity;
						} else {
							action = 'NONE';
							reason = 'Content is similar but not more complete; ignoring.';
							targetId = mostSimilar.id;
							confidence = similarity;
						}
					}

					// Extract workspace-specific information if enabled
					let workspaceInfo = {};
					if (options.autoExtractWorkspaceInfo) {
						workspaceInfo = extractWorkspaceInfo(content);
					}

					workspaceActions.push({
						id:
							action === 'ADD'
								? generateSafeWorkspaceId(i)
								: targetId && !isNaN(Number(targetId)) && Number(targetId) > 0
									? Number(targetId)
									: generateSafeWorkspaceId(i),
						text: content,
						event: action,
						tags: extractWorkspaceTags(content),
						confidence,
						reasoning: reason,
						workspaceInfo,
					});

					workspaceSummaries.push({
						contentPreview: content.substring(0, 80),
						action,
						confidence,
						reason,
						targetId,
						workspaceInfo: Object.keys(workspaceInfo).length > 0 ? workspaceInfo : undefined,
					});

					logger.debug(`WorkspaceStore: Decision for content ${i + 1}`, {
						contentPreview: content.substring(0, 80) + (content.length > 80 ? '...' : ''),
						decision: action,
						confidence: confidence.toFixed(3),
						reasoning: reason,
						targetMemoryId: targetId,
						decisionMethod: 'Heuristic',
						topSimilarityScore: mostSimilar?.score?.toFixed(3) || 'N/A',
						similarityThreshold: options.similarityThreshold.toFixed(2),
						extractedWorkspaceInfo: Object.keys(workspaceInfo).length,
					});
				} catch (contentError) {
					logger.error(`WorkspaceStore: Failed to process content ${i + 1}`, {
						error: contentError instanceof Error ? contentError.message : String(contentError),
						contentPreview: content.substring(0, 50),
					});

					// Add fallback action for failed content
					workspaceActions.push({
						id: generateSafeWorkspaceId(i),
						text: content,
						event: 'ADD',
						tags: extractWorkspaceTags(content),
						confidence: 0.4,
						reasoning: `Fallback due to processing error: ${contentError instanceof Error ? contentError.message : String(contentError)}`,
						workspaceInfo: {},
					});
				}
			}

			// Step 3: Enhanced persistence with better error handling
			logger.debug('WorkspaceStore: Starting workspace memory persistence operations', {
				totalActions: workspaceActions.length,
				persistableActions: workspaceActions.filter(a =>
					['ADD', 'UPDATE', 'DELETE'].includes(a.event)
				).length,
				skippableActions: workspaceActions.filter(a => a.event === 'NONE').length,
			});

			let persistedCount = 0;
			for (const action of workspaceActions) {
				if (['ADD', 'UPDATE', 'DELETE'].includes(action.event)) {
					if (!action.text) {
						logger.warn(`WorkspaceStore: Skipping action with undefined text`, {
							workspaceId: action.id,
							event: action.event,
						});
						continue;
					}

					try {
						const embedding = await embedder.embed(action.text);

						// Create workspace payload with extracted information
						const qualitySource: 'similarity' | 'llm' | 'heuristic' = 'heuristic';
						const options: any = {
							qualitySource,
							...action.workspaceInfo,
						};

						if (context?.sessionId) {
							options.sourceSessionId = context.sessionId;
						}

						const payload = createWorkspacePayload(
							action.id,
							action.text,
							action.tags,
							action.confidence,
							action.event as 'ADD' | 'UPDATE' | 'DELETE' | 'NONE',
							options
						);

						if (action.event === 'ADD') {
							await workspaceStore.insert([embedding], [action.id], [payload]);
							logger.debug(`WorkspaceStore: ${action.event} operation completed`, {
								workspaceId: action.id,
								textPreview: action.text.substring(0, 60) + (action.text.length > 60 ? '...' : ''),
								tags: action.tags,
								confidence: action.confidence.toFixed(3),
								workspaceInfo: Object.keys(action.workspaceInfo || {}).length,
							});
						} else if (action.event === 'UPDATE') {
							await workspaceStore.update(action.id, embedding, payload);
							logger.debug(`WorkspaceStore: ${action.event} operation completed`, {
								workspaceId: action.id,
								textPreview: action.text.substring(0, 60) + (action.text.length > 60 ? '...' : ''),
								tags: action.tags,
								confidence: action.confidence.toFixed(3),
								workspaceInfo: Object.keys(action.workspaceInfo || {}).length,
							});
						} else if (action.event === 'DELETE') {
							await workspaceStore.delete(action.id);
							logger.debug(`WorkspaceStore: ${action.event} operation completed`, {
								workspaceId: action.id,
								reasoning: action.reasoning,
							});
						}
						persistedCount++;
					} catch (persistError) {
						logger.error(
							`WorkspaceStore: ${action.event} operation failed, continuing with others`,
							{
								workspaceId: action.id,
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

			logger.debug('WorkspaceStore: Workspace memory persistence completed', {
				totalProcessed: workspaceActions.length,
				successfullyPersisted: persistedCount,
				actionsSummary: {
					ADD: workspaceActions.filter(a => a.event === 'ADD').length,
					UPDATE: workspaceActions.filter(a => a.event === 'UPDATE').length,
					DELETE: workspaceActions.filter(a => a.event === 'DELETE').length,
					NONE: workspaceActions.filter(a => a.event === 'NONE').length,
				},
			});

			// Return successful result even if some operations failed
			return {
				success: true,
				extraction: extractionStats,
				workspace: workspaceActions,
				summary: workspaceSummaries,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('WorkspaceStore: Critical failure in workspace store', {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
			});

			return {
				success: false,
				error: errorMessage,
				extraction: {
					extracted: 0,
					skipped: Array.isArray(args.interaction) ? args.interaction.length : 1,
					content: [],
				},
				workspace: [],
				summary: [],
				timestamp: new Date().toISOString(),
			};
		}
	},
};
