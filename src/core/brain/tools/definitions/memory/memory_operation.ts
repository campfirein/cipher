/**
 * Memory Operation Tool
 *
 * Processes extracted knowledge and determines memory operations (ADD, UPDATE, DELETE, NONE)
 * by analyzing similarity with existing memories and using LLM-powered intelligent reasoning.
 * This tool integrates with embedding, vector storage, and LLM systems for sophisticated
 * memory management with contextual understanding.
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
// Import payload migration utilities
import { createKnowledgePayload } from './payloads.js';

/**
 * MEMORY OPERATIONAL TOOL
 */
export const MEMORY_OPERATION_TOOL = {
	type: 'function',
	function: {
		name: 'memory_operation',
		description:
			'Process extracted knowledge and determine memory operations (ADD, UPDATE, DELETE, NONE) using LLM-powered intelligent reasoning and similarity analysis with existing memories.',
		parameters: {
			type: 'object',
			properties: {
				memory: {
					type: 'array',
					description:
						'Updated memory entries with operations applied. Always preserve complete code blocks, command syntax, and implementation details within triple backticks.',
					items: {
						type: 'object',
						properties: {
							id: {
								type: 'string',
								description: 'Unique ID of the memory entry.',
							},
							text: {
								type: 'string',
								description:
									'Text of the memory entry including complete implementation code, command syntax, or technical details when present. Always preserve the complete pattern within triple backticks.',
							},
							event: {
								type: 'string',
								enum: ['ADD', 'UPDATE', 'DELETE', 'NONE'],
								description: 'Operation applied to the entry.',
							},
							tags: {
								type: 'array',
								items: { type: 'string' },
								description:
									"Keywords derived from the text (lowercase, singular nouns). Include technology-specific tags (e.g., 'react', 'python', 'docker').",
							},
							old_memory: {
								type: 'string',
								description:
									'Previous text, included only for UPDATE events. Ensure code patterns are properly preserved in the updated text.',
							},
							code_pattern: {
								type: 'string',
								description:
									'Optional. The extracted code pattern or command syntax if present, exactly as it appeared in the original content.',
							},
							confidence: {
								type: 'number',
								description: 'Confidence score for the operation decision (0.0 to 1.0).',
							},
							reasoning: {
								type: 'string',
								description: 'Explanation for why this operation was chosen.',
							},
						},
						required: ['id', 'text', 'event', 'tags'],
						additionalProperties: false,
					},
				},
			},
			required: ['memory'],
			additionalProperties: false,
		},
	},
};

/**
 * Interface for memory operation arguments
 */
export interface MemoryOperationArgs {
	extractedFacts: string[];
	existingMemories?: {
		id: string;
		text: string;
		metadata?: Record<string, any>;
	}[];
	context?: {
		sessionId?: string;
		userId?: string;
		projectId?: string;
		conversationTopic?: string;
		recentMessages?: string[];
		sessionMetadata?: Record<string, any>;
	};
	memoryMetadata?: Record<string, any>;
	options?: {
		similarityThreshold?: number;
		maxSimilarResults?: number;
		enableBatchProcessing?: boolean;
		useLLMDecisions?: boolean; // Enable LLM decision making
		confidenceThreshold?: number; // Minimum confidence for operations
		enableDeleteOperations?: boolean; // Enable DELETE operations
	};
}

/**
 * Interface for memory action result following UPDATE_FACT_TOOL_MEMORY pattern
 */
export interface MemoryAction {
	id: number;
	text: string;
	event: 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';
	tags: string[];
	old_memory?: string;
	code_pattern?: string;
	confidence: number; // Confidence score
	reasoning: string; // Decision reasoning
}

/**
 * Interface for memory operation result
 */
export interface MemoryOperationResult {
	success: boolean;
	totalFacts: number;
	processedFacts: number;
	skippedFacts: number;
	memory: MemoryAction[];
	statistics: {
		addOperations: number;
		updateOperations: number;
		deleteOperations: number;
		noneOperations: number;
		totalSimilarMemories: number;
		averageConfidence: number;
		llmDecisionsUsed: number; // Count of LLM-assisted decisions
		fallbackDecisionsUsed: number; // Count of fallback decisions
	};
	timestamp: string;
	processingTime: number;
	error?: string;
}

/**
 * Default configuration options
 */
const DEFAULT_OPTIONS = {
	similarityThreshold: 0.7,
	maxSimilarResults: 5,
	enableBatchProcessing: true,
	useLLMDecisions: true, // Enable LLM decisions by default
	confidenceThreshold: 0.4, // Lowered to allow fallback operations to proceed
	enableDeleteOperations: true, // Enable DELETE operations
} as const;

/**
 * Prompts for LLM decision making
 */
const MEMORY_OPERATION_PROMPTS = {
	SYSTEM_PROMPT: `You are an intelligent memory management system for a programming-focused AI agent. Your task is to analyze extracted knowledge facts and determine the best memory operations (ADD, UPDATE, DELETE, NONE) based on similarity with existing memories and contextual understanding.

IMPORTANT: Only process facts that contain significant programming knowledge, concepts, technical details, code patterns, or implementation information. Skip personal information, trivial conversations, or non-technical content.

Consider these factors:
1. Technical relevance and programming value
2. Content similarity and semantic overlap  
3. Information recency and relevance
4. Knowledge quality and completeness
5. Conversation context and technical needs
6. Implementation details and code patterns

Rules:
- ADD: For new, unique programming knowledge that doesn't duplicate existing memories
- UPDATE: For enhanced or corrected versions of existing technical knowledge
- DELETE: For outdated, incorrect, or contradictory technical information that should be removed
- NONE: For duplicates, information already well-represented, or non-significant content

Always preserve code blocks, commands, technical patterns, and implementation details exactly as provided. Focus on extracting meaningful programming concepts, algorithms, design patterns, best practices, and technical solutions.`,

	DECISION_PROMPT: `Analyze the following knowledge fact and determine the appropriate memory operation. Follow these steps:

1. Compare the fact to the provided similar memories (using semantic similarity, not just keywords).
2. If the fact is new and not present in any similar memory (similarity below threshold), choose ADD.
3. If the fact is more complete or correct than a similar memory, choose UPDATE and specify the targetMemoryId.
4. If the fact is redundant or already present, choose NONE.
5. If the fact contradicts an existing memory, choose DELETE and specify the targetMemoryId.
6. Always provide a confidence score (0.0 to 1.0) and clear reasoning.

**Examples:**

Example 1 (ADD):
KNOWLEDGE FACT:
"The 'merge_sort' function in Python recursively splits the array and merges sorted halves."
SIMILAR EXISTING MEMORIES:
No similar memories found.
CONVERSATION CONTEXT:
No specific context provided.

JSON RESPONSE:
{
  "operation": "ADD",
  "confidence": 0.95,
  "reasoning": "This is a new technical fact about merge sort not present in the memory base.",
  "targetMemoryId": null
}

Example 2 (UPDATE):
KNOWLEDGE FACT:
"The 'bubble_sort' function in Python sorts the array in-place and includes an optimization to stop early if no swaps are made."
SIMILAR EXISTING MEMORIES:
1. ID: 12345 (similarity: 0.91)
   Content: The 'bubble_sort' function in Python sorts the array in-place.
CONVERSATION CONTEXT:
No specific context provided.

JSON RESPONSE:
{
  "operation": "UPDATE",
  "confidence": 0.9,
  "reasoning": "The new fact adds an optimization detail not present in the existing memory.",
  "targetMemoryId": 12345
}

Example 3 (NONE):
KNOWLEDGE FACT:
"The 'quick_sort' function sorts an array in-place using a pivot."
SIMILAR EXISTING MEMORIES:
1. ID: 67890 (similarity: 0.95)
   Content: The 'quick_sort' function sorts an array in-place using a pivot.
CONVERSATION CONTEXT:
No specific context provided.

JSON RESPONSE:
{
  "operation": "NONE",
  "confidence": 0.98,
  "reasoning": "The fact is already present in the memory base.",
  "targetMemoryId": 67890
}

Example 4 (DELETE):
KNOWLEDGE FACT:
"The 'selection_sort' function in Python is NOT a stable sorting algorithm."
SIMILAR EXISTING MEMORIES:
1. ID: 54321 (similarity: 0.92)
   Content: The 'selection_sort' function in Python is a stable sorting algorithm.
CONVERSATION CONTEXT:
No specific context provided.

JSON RESPONSE:
{
  "operation": "DELETE",
  "confidence": 0.93,
  "reasoning": "The new fact contradicts the existing memory, which incorrectly states that selection sort is stable.",
  "targetMemoryId": 54321
}

---
KNOWLEDGE FACT:
{fact}

SIMILAR EXISTING MEMORIES:
{similarMemories}

CONVERSATION CONTEXT:
{context}

For this knowledge fact, respond ONLY with a single JSON object in the following format (do not include any explanation or text outside the JSON):
{
  "operation": "ADD|UPDATE|DELETE|NONE",
  "confidence": 0.0-1.0,
  "reasoning": "Clear explanation of the decision",
  "targetMemoryId": "id-if-updating-or-deleting-or-none"
}`,
};

/**
 * Memory operation tool for intelligent memory management
 */
export const memoryOperationTool: InternalTool = {
	name: 'memory_operation',
	category: 'memory',
	internal: true,
	description:
		'Process extracted knowledge and determine memory operations (ADD, UPDATE, DELETE, NONE) using LLM-powered intelligent reasoning and similarity analysis with existing memories.',
	version: '2.0.0', // version
	parameters: {
		type: 'object',
		properties: {
			extractedFacts: {
				type: 'array',
				description:
					'Array of knowledge facts already extracted from interactions, containing technical details, code patterns, or implementation information.',
				items: {
					type: 'string',
				},
			},
			existingMemories: {
				type: 'array',
				description: 'Array of existing memory entries to compare against for similarity analysis.',
				items: {
					type: 'object',
					properties: {
						id: {
							type: 'string',
							description: 'Unique identifier of the existing memory',
						},
						text: {
							type: 'string',
							description: 'Content of the existing memory',
						},
						metadata: {
							type: 'object',
							description: 'Optional metadata for the memory',
						},
					},
					required: ['id', 'text'],
				},
			},
			context: {
				type: 'object',
				description: 'Optional context information for memory operations',
				properties: {
					sessionId: {
						type: 'string',
						description: 'Current session identifier',
					},
					userId: {
						type: 'string',
						description: 'User identifier for personalized memory',
					},
					projectId: {
						type: 'string',
						description: 'Project identifier for scoped memory',
					},
					conversationTopic: {
						type: 'string',
						description: 'Current conversation topic or theme',
					},
					recentMessages: {
						type: 'array',
						items: { type: 'string' },
						description: 'Recent conversation messages for context',
					},
					sessionMetadata: {
						type: 'object',
						description: 'Additional session metadata',
					},
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
		},
		required: ['extractedFacts'],
	},
	handler: async (
		args: MemoryOperationArgs,
		context?: InternalToolContext
	): Promise<MemoryOperationResult> => {
		const startTime = Date.now();

		try {
			logger.info('MemoryOperation: Processing memory operation request', {
				factCount: args.extractedFacts?.length || 0,
				existingMemoryCount: args.existingMemories?.length || 0,
				hasContext: !!args.context,
				hasOptions: !!args.options,
			});

			// Phase 1: Basic parameter validation
			const validationResult = validateMemoryOperationArgs(args);
			if (!validationResult.isValid) {
				throw new Error(`Invalid arguments: ${validationResult.errors.join(', ')}`);
			}

			// Merge with default options
			const options = { ...DEFAULT_OPTIONS, ...args.options };

			logger.debug('MemoryOperation: Using configuration options', {
				similarityThreshold: options.similarityThreshold,
				maxSimilarResults: options.maxSimilarResults,
				enableBatchProcessing: options.enableBatchProcessing,
				useLLMDecisions: options.useLLMDecisions,
				confidenceThreshold: options.confidenceThreshold,
				enableDeleteOperations: options.enableDeleteOperations,
			});

			// Filter valid facts
			const validFacts = args.extractedFacts
				.filter(fact => fact && typeof fact === 'string' && fact.trim().length > 0)
				.map(fact => fact.trim());

			if (validFacts.length === 0) {
				throw new Error('No valid facts found after filtering');
			}

			// Phase 2: Get available services
			const memoryActions: MemoryAction[] = [];
			let totalSimilarMemories = 0;
			let confidenceSum = 0;
			let llmDecisionsUsed = 0;
			let fallbackDecisionsUsed = 0;

			// Try to get services from context
			const embeddingManager = context?.services?.embeddingManager;
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const llmService = context?.services?.llmService; // LLM service access

			let embedder: any = null;
			let vectorStore: any = null;

			// Initialize embedding and vector services
			if (embeddingManager && vectorStoreManager) {
				try {
					embedder = embeddingManager.getEmbedder('default');
					vectorStore = vectorStoreManager.getStore();

					if (embedder && vectorStore) {
						logger.debug('MemoryOperation: Using embedding and vector storage services');
					} else {
						logger.warn(
							'MemoryOperation: Services available but not initialized, using basic analysis'
						);
					}
				} catch (error) {
					logger.debug('MemoryOperation: Failed to access embedding/vector services', {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				logger.debug(
					'MemoryOperation: No embedding/vector services available in context, using basic analysis'
				);
			}

			// Check LLM service availability
			if (options.useLLMDecisions && llmService) {
				logger.debug('MemoryOperation: LLM service available for decision making');
			} else if (options.useLLMDecisions) {
				logger.warn(
					'MemoryOperation: LLM decisions requested but service not available, falling back to similarity-based decisions'
				);
			}

			// Process each fact individually or in batch
			for (let i = 0; i < validFacts.length; i++) {
				const fact = validFacts[i];
				const codePattern = extractCodePattern(fact || '');
				const tags = extractTechnicalTags(fact || '');

				let memoryAction: MemoryAction;
				let similarMemories: any[] = [];

				if (embedder && vectorStore) {
					try {
						// Generate embedding for the fact
						logger.debug('MemoryOperation: Generating embedding for fact', {
							factIndex: i,
							factLength: (fact || '').length,
						});

						let embedding;
						try {
							embedding = await embedder.embed(fact || '');
						} catch (embedError) {
							logger.error(
								'MemoryOperation: Failed to generate embedding, disabling embeddings globally',
								{
									error: embedError instanceof Error ? embedError.message : String(embedError),
									factIndex: i,
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

							// Fallback to ADD operation since embeddings are now disabled
							memoryAction = {
								id: generateMemoryId(i),
								text: fact || '',
								event: 'ADD',
								tags,
								confidence: 0.6,
								reasoning: `Fallback to ADD due to embedding failure - embeddings disabled globally`,
								...(codePattern && { code_pattern: codePattern }),
							};
							fallbackDecisionsUsed++;
							continue;
						}

						// Search for similar memories
						const searchResults = await vectorStore.search(embedding, options.maxSimilarResults);

						// Apply similarity threshold filtering
						similarMemories = searchResults.filter(
							(result: any) => (result.score || 0) >= options.similarityThreshold
						);

						totalSimilarMemories += similarMemories.length;

						logger.debug('MemoryOperation: Found similar memories', {
							factIndex: i,
							totalResults: searchResults.length,
							filteredResults: similarMemories.length,
							threshold: options.similarityThreshold,
						});

						// Use LLM decision making if available and enabled
						if (options.useLLMDecisions && llmService) {
							try {
								memoryAction = await llmDetermineMemoryOperation(
									fact || '',
									similarMemories,
									args.context,
									options,
									llmService,
									i,
									codePattern,
									tags
								);
								llmDecisionsUsed++;

								logger.debug('MemoryOperation: Used LLM decision making', {
									factIndex: i,
									operation: memoryAction.event,
									confidence: memoryAction.confidence,
								});
							} catch (error) {
								logger.warn(
									'MemoryOperation: LLM decision failed, falling back to similarity analysis',
									{
										factIndex: i,
										error: error instanceof Error ? error.message : String(error),
									}
								);

								// Fallback to similarity-based decision
								memoryAction = await determineMemoryOperation(
									fact || '',
									similarMemories,
									options.similarityThreshold,
									i,
									codePattern,
									tags
								);
								fallbackDecisionsUsed++;
							}
						} else {
							// Use similarity-based decision making
							memoryAction = await determineMemoryOperation(
								fact || '',
								similarMemories,
								options.similarityThreshold,
								i,
								codePattern,
								tags
							);
							fallbackDecisionsUsed++;
						}
					} catch (error) {
						logger.warn('MemoryOperation: Error during similarity analysis, falling back to ADD', {
							factIndex: i,
							error: error instanceof Error ? error.message : String(error),
						});

						// Fallback to ADD operation with higher confidence
						memoryAction = {
							id: generateMemoryId(i),
							text: fact || '',
							event: 'ADD',
							tags,
							confidence: 0.6, // Increased from 0.5 to exceed threshold
							reasoning: `Fallback to ADD due to analysis error (${error instanceof Error ? error.message : String(error)})`,
							...(codePattern && { code_pattern: codePattern }),
						};
						fallbackDecisionsUsed++;
					}
				} else {
					// No embedding/vector storage available - basic analysis
					const isNew = !args.existingMemories?.some(
						mem => calculateTextSimilarity(fact || '', mem.text) > options.similarityThreshold
					);

					memoryAction = {
						id: generateMemoryId(i),
						text: fact || '',
						event: isNew ? 'ADD' : 'NONE',
						tags,
						confidence: isNew ? 0.7 : 0.5, // Higher confidence for new memories
						reasoning: isNew
							? 'No similar memories found in basic analysis'
							: 'Similar memory detected in basic analysis',
						...(codePattern && { code_pattern: codePattern }),
					};
					fallbackDecisionsUsed++;
				}

				// Apply confidence threshold
				if (
					memoryAction.confidence < options.confidenceThreshold &&
					memoryAction.event !== 'NONE'
				) {
					logger.debug('MemoryOperation: Operation confidence below threshold, changing to NONE', {
						factIndex: i,
						operation: memoryAction.event,
						confidence: memoryAction.confidence,
						threshold: options.confidenceThreshold,
					});

					memoryAction.event = 'NONE';
					memoryAction.reasoning += ` (Low confidence: ${memoryAction.confidence.toFixed(2)})`;
				}

				memoryActions.push(memoryAction);
				confidenceSum += memoryAction.confidence;
			}

			const processingTime = Date.now() - startTime;
			const averageConfidence = memoryActions.length > 0 ? confidenceSum / memoryActions.length : 0;

			const result: MemoryOperationResult = {
				success: true,
				totalFacts: args.extractedFacts.length,
				processedFacts: validFacts.length,
				skippedFacts: args.extractedFacts.length - validFacts.length,
				memory: memoryActions,
				statistics: {
					addOperations: memoryActions.filter(a => a.event === 'ADD').length,
					updateOperations: memoryActions.filter(a => a.event === 'UPDATE').length,
					deleteOperations: memoryActions.filter(a => a.event === 'DELETE').length,
					noneOperations: memoryActions.filter(a => a.event === 'NONE').length,
					totalSimilarMemories,
					averageConfidence,
					llmDecisionsUsed,
					fallbackDecisionsUsed,
				},
				timestamp: new Date().toISOString(),
				processingTime,
			};

			logger.info('MemoryOperation: Successfully processed memory operations', {
				totalFacts: result.totalFacts,
				processedFacts: result.processedFacts,
				memoryActions: result.memory.length,
				llmDecisionsUsed: result.statistics.llmDecisionsUsed,
				fallbackDecisionsUsed: result.statistics.fallbackDecisionsUsed,
				averageConfidence: result.statistics.averageConfidence.toFixed(2),
				processingTime: `${processingTime}ms`,
			});

			// Persist memory actions to vector store if available
			if (vectorStore && embedder) {
				try {
					await persistMemoryActions(memoryActions, vectorStore, embedder);
					logger.info('MemoryOperation: Successfully persisted memories to vector store', {
						persistedCount: memoryActions.filter(a => a.event === 'ADD' || a.event === 'UPDATE')
							.length,
					});
				} catch (error) {
					logger.warn('MemoryOperation: Failed to persist memories to vector store', {
						error: error instanceof Error ? error.message : String(error),
					});
					// Don't fail the entire operation if persistence fails
				}
			} else {
				logger.debug(
					'MemoryOperation: Vector store or embedder not available, skipping persistence'
				);
			}

			return result;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			logger.error('MemoryOperation: Failed to process memory operations', {
				error: errorMessage,
				factCount: args.extractedFacts?.length || 0,
				processingTime: `${processingTime}ms`,
			});

			return {
				success: false,
				totalFacts: args.extractedFacts?.length || 0,
				processedFacts: 0,
				skippedFacts: args.extractedFacts?.length || 0,
				memory: [],
				statistics: {
					addOperations: 0,
					updateOperations: 0,
					deleteOperations: 0,
					noneOperations: 0,
					totalSimilarMemories: 0,
					averageConfidence: 0,
					llmDecisionsUsed: 0,
					fallbackDecisionsUsed: 0,
				},
				timestamp: new Date().toISOString(),
				processingTime,
				error: errorMessage,
			};
		}
	},
};

/**
 * LLM-powered memory operation determination
 */
async function llmDetermineMemoryOperation(
	fact: string,
	similarMemories: any[],
	context: MemoryOperationArgs['context'],
	options: Required<MemoryOperationArgs['options']>,
	llmService: any,
	index: number,
	codePattern?: string,
	tags: string[] = []
): Promise<MemoryAction> {
	const factId = generateMemoryId(index);

	try {
		// Prepare context for LLM
		const contextStr = formatContextForLLM(context);
		const similarMemoriesStr = formatSimilarMemoriesForLLM(similarMemories);

		// Create decision prompt
		const prompt = MEMORY_OPERATION_PROMPTS.DECISION_PROMPT.replace('{fact}', fact)
			.replace('{similarMemories}', similarMemoriesStr)
			.replace('{context}', contextStr);

		logger.debug('MemoryOperation: Requesting LLM decision', {
			factIndex: index,
			factLength: (fact || '').length,
			similarMemoriesCount: similarMemories.length,
		});

		// Get LLM response using directGenerate to bypass conversation context
		const response = await llmService.directGenerate(prompt);

		// Parse LLM response
		const decision = parseLLMDecision(response);

		// Validate and apply decision
		if (!decision || !isValidOperation(decision.operation)) {
			throw new Error(`Invalid LLM decision: ${JSON.stringify(decision)}`);
		}

		// Create memory action based on LLM decision
		const memoryAction: MemoryAction = {
			id: decision.targetMemoryId || factId,
			text: fact || '',
			event: decision.operation as 'ADD' | 'UPDATE' | 'DELETE' | 'NONE',
			tags,
			confidence: Math.max(0, Math.min(1, decision.confidence || 0.7)),
			reasoning: decision.reasoning || 'LLM decision',
			...(codePattern && { code_pattern: codePattern }),
		};

		// Add old_memory for UPDATE operations
		if (memoryAction.event === 'UPDATE' && decision.targetMemoryId) {
			const targetMemory = similarMemories.find(
				mem => mem.id === decision.targetMemoryId || mem.payload?.id === decision.targetMemoryId
			);
			if (targetMemory) {
				memoryAction.old_memory = targetMemory.payload?.data || targetMemory.text || '';
			}
		}

		// Validate that the final ID is a valid integer
		if (
			typeof memoryAction.id !== 'number' ||
			!Number.isInteger(memoryAction.id) ||
			memoryAction.id <= 0
		) {
			logger.warn('MemoryOperation: Invalid memory ID detected, using fallback', {
				invalidId: memoryAction.id,
				factIndex: index,
				factPreview: fact.substring(0, 80),
			});
			memoryAction.id = factId; // Use the safe generated ID as fallback
		}

		logger.debug('MemoryOperation: LLM decision applied', {
			factIndex: index,
			operation: memoryAction.event,
			confidence: memoryAction.confidence,
			memoryId: memoryAction.id,
			reasoning: memoryAction.reasoning.substring(0, 100),
		});

		return memoryAction;
	} catch (error) {
		logger.warn('MemoryOperation: LLM decision failed', {
			factIndex: index,
			error: error instanceof Error ? error.message : String(error),
		});

		// Re-throw to trigger fallback
		throw error;
	}
}

/**
 * Format context information for LLM prompt
 */
function formatContextForLLM(context?: MemoryOperationArgs['context']): string {
	if (!context) {
		return 'No specific context provided.';
	}

	const parts: string[] = [];

	if (context.conversationTopic) {
		parts.push(`Topic: ${context.conversationTopic}`);
	}

	if (context.recentMessages && context.recentMessages.length > 0) {
		parts.push(`Recent messages: ${context.recentMessages.slice(-3).join(', ')}`);
	}

	if (context.sessionMetadata) {
		const metadata = Object.entries(context.sessionMetadata)
			.map(([key, value]) => `${key}: ${value}`)
			.join(', ');
		parts.push(`Session info: ${metadata}`);
	}

	return parts.length > 0 ? parts.join('\n') : 'General context.';
}

/**
 * Format similar memories for LLM prompt
 */
function formatSimilarMemoriesForLLM(similarMemories: any[]): string {
	if (!similarMemories || similarMemories.length === 0) {
		return 'No similar memories found.';
	}

	return similarMemories
		.slice(0, 3) // Limit to top 3 for prompt efficiency
		.map((memory, index) => {
			const score = memory.score ? ` (similarity: ${memory.score.toFixed(2)})` : '';
			const text = memory.payload?.data || memory.text || 'No content';
			const id = memory.id || memory.payload?.id || `memory-${index}`;

			return `${index + 1}. ID: ${id}${score}\n   Content: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`;
		})
		.join('\n\n');
}

/**
 * Parse LLM decision response with enhanced error handling and proper ID conversion
 */
function parseLLMDecision(response: string): any {
	try {
		if (!response || typeof response !== 'string') {
			logger.debug('MemoryOperation: Empty or invalid LLM response', {
				responseType: typeof response,
			});
			return null;
		}

		// Clean and normalize the response
		const cleanResponse = response.trim();

		// Helper function to safely convert ID to integer
		const safeConvertId = (id: any): number | null => {
			if (id === null || id === undefined) return null;
			const numId = parseInt(String(id), 10);
			return !isNaN(numId) && Number.isInteger(numId) && numId > 0 ? numId : null;
		};

		// Try to extract the first JSON object from the response
		const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				const decision = JSON.parse(jsonMatch[0]);
				if (decision && decision.operation && typeof decision.confidence === 'number') {
					// Normalize the decision object with proper ID conversion
					return {
						operation: decision.operation,
						confidence: Math.max(0, Math.min(1, decision.confidence)),
						reasoning: decision.reasoning || decision.reason || 'LLM decision',
						targetMemoryId: safeConvertId(
							decision.targetMemoryId || decision.target_id || decision.id
						),
					};
				}
			} catch (parseError) {
				logger.debug('MemoryOperation: Failed to parse JSON match', {
					jsonMatch: jsonMatch[0].substring(0, 100),
					error: parseError instanceof Error ? parseError.message : String(parseError),
				});
			}
		}

		// Fallback: try to find any substring that parses as JSON
		for (let start = 0; start < cleanResponse.length; start++) {
			for (let end = cleanResponse.length; end > start + 10; end--) {
				const substr = cleanResponse.slice(start, end);
				if (substr[0] !== '{' || substr[substr.length - 1] !== '}') continue;
				try {
					const obj = JSON.parse(substr);
					if (obj && obj.operation && typeof obj.confidence === 'number') {
						return {
							operation: obj.operation,
							confidence: Math.max(0, Math.min(1, obj.confidence)),
							reasoning: obj.reasoning || obj.reason || 'LLM decision',
							targetMemoryId: safeConvertId(obj.targetMemoryId || obj.target_id || obj.id),
						};
					}
				} catch {
					// Not valid JSON, continue
				}
			}
		}

		// Advanced fallback: try to extract decision components using regex
		const operationMatch = cleanResponse.match(/(?:operation|action)['"]?\s*:\s*['"]?(\w+)['"]?/i);
		const confidenceMatch = cleanResponse.match(/confidence['"]?\s*:\s*([0-9.]+)/i);
		const reasoningMatch = cleanResponse.match(
			/(?:reasoning|reason)['"]?\s*:\s*['"]([^'"]+)['"]?/i
		);

		if (operationMatch && confidenceMatch) {
			const operation = operationMatch[1]?.toUpperCase() || '';
			const confidence = parseFloat(confidenceMatch[1] || '0');

			if (['ADD', 'UPDATE', 'DELETE', 'NONE'].includes(operation) && !isNaN(confidence)) {
				logger.debug('MemoryOperation: Extracted decision using regex fallback', {
					operation,
					confidence,
					response: cleanResponse.substring(0, 200),
				});

				return {
					operation,
					confidence: Math.max(0, Math.min(1, confidence)),
					reasoning: reasoningMatch ? reasoningMatch[1] : 'Parsed from LLM response',
					targetMemoryId: null,
				};
			}
		}

		// Final fallback: look for operation keywords in the response
		const responseUpper = cleanResponse.toUpperCase();
		let detectedOperation = null;

		if (
			responseUpper.includes('ADD') ||
			responseUpper.includes('CREATE') ||
			responseUpper.includes('NEW')
		) {
			detectedOperation = 'ADD';
		} else if (
			responseUpper.includes('UPDATE') ||
			responseUpper.includes('MODIFY') ||
			responseUpper.includes('CHANGE')
		) {
			detectedOperation = 'UPDATE';
		} else if (responseUpper.includes('DELETE') || responseUpper.includes('REMOVE')) {
			detectedOperation = 'DELETE';
		} else if (
			responseUpper.includes('NONE') ||
			responseUpper.includes('SKIP') ||
			responseUpper.includes('IGNORE')
		) {
			detectedOperation = 'NONE';
		}

		if (detectedOperation) {
			logger.debug('MemoryOperation: Detected operation using keyword fallback', {
				operation: detectedOperation,
				response: cleanResponse.substring(0, 200),
			});

			return {
				operation: detectedOperation,
				confidence: 0.6, // Default confidence for keyword detection
				reasoning: 'Detected from LLM response keywords',
				targetMemoryId: null,
			};
		}

		// If all attempts fail, log the raw response and return null
		logger.debug('MemoryOperation: Failed to parse LLM decision using all methods', {
			response: cleanResponse.substring(0, 500),
			responseLength: cleanResponse.length,
		});

		return null;
	} catch (error) {
		logger.warn('MemoryOperation: Error parsing LLM decision', {
			error: error instanceof Error ? error.message : String(error),
			responsePreview: typeof response === 'string' ? response.substring(0, 100) : 'non-string',
		});
		return null;
	}
}

/**
 * Validate operation type
 */
function isValidOperation(operation: string): boolean {
	return ['ADD', 'UPDATE', 'DELETE', 'NONE'].includes(operation);
}

/**
 * Validation result interface
 */
interface ValidationResult {
	isValid: boolean;
	errors: string[];
}

/**
 * Validate memory operation arguments
 */
function validateMemoryOperationArgs(args: MemoryOperationArgs): ValidationResult {
	const errors: string[] = [];

	// Check required fields
	if (!args.extractedFacts) {
		errors.push('extractedFacts is required');
	} else if (!Array.isArray(args.extractedFacts)) {
		errors.push('extractedFacts must be an array');
	} else if (args.extractedFacts.length === 0) {
		errors.push('extractedFacts array cannot be empty');
	}

	// Validate existing memories if provided
	if (args.existingMemories) {
		if (!Array.isArray(args.existingMemories)) {
			errors.push('existingMemories must be an array');
		} else {
			args.existingMemories.forEach((memory, index) => {
				if (!memory.id || typeof memory.id !== 'string') {
					errors.push(`existingMemories[${index}].id must be a non-empty string`);
				}
				if (!memory.text || typeof memory.text !== 'string') {
					errors.push(`existingMemories[${index}].text must be a non-empty string`);
				}
			});
		}
	}

	// Validate context if provided
	if (args.context) {
		if (typeof args.context !== 'object') {
			errors.push('context must be an object');
		} else {
			if (args.context.sessionId && typeof args.context.sessionId !== 'string') {
				errors.push('context.sessionId must be a string');
			}
			if (args.context.userId && typeof args.context.userId !== 'string') {
				errors.push('context.userId must be a string');
			}
			if (args.context.projectId && typeof args.context.projectId !== 'string') {
				errors.push('context.projectId must be a string');
			}
		}
	}

	// Validate options if provided
	if (args.options) {
		if (typeof args.options !== 'object') {
			errors.push('options must be an object');
		} else {
			if (args.options.similarityThreshold !== undefined) {
				if (typeof args.options.similarityThreshold !== 'number') {
					errors.push('options.similarityThreshold must be a number');
				} else if (args.options.similarityThreshold < 0 || args.options.similarityThreshold > 1) {
					errors.push('options.similarityThreshold must be between 0.0 and 1.0');
				}
			}
			if (args.options.maxSimilarResults !== undefined) {
				if (typeof args.options.maxSimilarResults !== 'number') {
					errors.push('options.maxSimilarResults must be a number');
				} else if (args.options.maxSimilarResults < 1 || args.options.maxSimilarResults > 20) {
					errors.push('options.maxSimilarResults must be between 1 and 20');
				}
			}
			if (
				args.options.enableBatchProcessing !== undefined &&
				typeof args.options.enableBatchProcessing !== 'boolean'
			) {
				errors.push('options.enableBatchProcessing must be a boolean');
			}
			// Additional validation
			if (
				args.options.useLLMDecisions !== undefined &&
				typeof args.options.useLLMDecisions !== 'boolean'
			) {
				errors.push('options.useLLMDecisions must be a boolean');
			}
			if (args.options.confidenceThreshold !== undefined) {
				if (typeof args.options.confidenceThreshold !== 'number') {
					errors.push('options.confidenceThreshold must be a number');
				} else if (args.options.confidenceThreshold < 0 || args.options.confidenceThreshold > 1) {
					errors.push('options.confidenceThreshold must be between 0.0 and 1.0');
				}
			}
			if (
				args.options.enableDeleteOperations !== undefined &&
				typeof args.options.enableDeleteOperations !== 'boolean'
			) {
				errors.push('options.enableDeleteOperations must be a boolean');
			}
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Extract code pattern from fact content
 */
function extractCodePattern(fact: string): string | undefined {
	// Extract code blocks (```...```)
	const codeBlockMatch = fact.match(/```[\s\S]*?```/);
	if (codeBlockMatch) {
		return codeBlockMatch[0];
	}

	// Extract inline code (`...`)
	const inlineCodeMatch = fact.match(/`[^`]+`/);
	if (inlineCodeMatch) {
		return inlineCodeMatch[0];
	}

	// Extract command patterns (starting with $ or npm/git/etc)
	const commandPatterns = [
		/\$\s+[^\n]+/,
		/(npm|yarn|pnpm)\s+[^\n]+/,
		/(git)\s+[^\n]+/,
		/(docker)\s+[^\n]+/,
		/(curl|wget)\s+[^\n]+/,
	];

	for (const pattern of commandPatterns) {
		const match = fact.match(pattern);
		if (match) {
			return match[0];
		}
	}

	return undefined;
}

/**
 * Extract technical tags from fact content
 */
function extractTechnicalTags(fact: string): string[] {
	const tags: string[] = [];

	// Programming languages
	const languages = [
		'javascript',
		'typescript',
		'python',
		'java',
		'rust',
		'go',
		'php',
		'ruby',
		'swift',
		'kotlin',
	];
	languages.forEach(lang => {
		if (fact.toLowerCase().includes(lang)) {
			tags.push(lang);
		}
	});

	// Frameworks and libraries
	const frameworks = [
		'react',
		'vue',
		'angular',
		'svelte',
		'nextjs',
		'express',
		'fastify',
		'django',
		'flask',
	];
	frameworks.forEach(framework => {
		if (fact.toLowerCase().includes(framework)) {
			tags.push(framework);
		}
	});

	// Tools and technologies
	const tools = [
		'docker',
		'kubernetes',
		'git',
		'npm',
		'yarn',
		'webpack',
		'vite',
		'eslint',
		'prettier',
	];
	tools.forEach(tool => {
		if (fact.toLowerCase().includes(tool)) {
			tags.push(tool);
		}
	});

	// Content type tags
	if (fact.includes('```')) {
		tags.push('code-block');
	}
	if (
		fact.includes('function') ||
		fact.includes('class') ||
		fact.includes('const') ||
		fact.includes('let') ||
		fact.includes('var')
	) {
		tags.push('programming');
	}
	if (
		fact.includes('/') ||
		fact.includes('\\') ||
		fact.includes('.js') ||
		fact.includes('.ts') ||
		fact.includes('.py')
	) {
		tags.push('file-path');
	}
	if (
		fact.includes('error') ||
		fact.includes('exception') ||
		fact.includes('failed') ||
		fact.includes('bug')
	) {
		tags.push('error-handling');
	}
	if (fact.includes('config') || fact.includes('setting') || fact.includes('option')) {
		tags.push('configuration');
	}
	if (
		fact.includes('api') ||
		fact.includes('endpoint') ||
		fact.includes('request') ||
		fact.includes('response')
	) {
		tags.push('api');
	}

	// Add general tag if no specific patterns found
	if (tags.length === 0) {
		tags.push('general-knowledge');
	}

	// Remove duplicates and return lowercase singular nouns
	return Array.from(new Set(tags)).map(tag => tag.toLowerCase());
}

/**
 * Generate unique memory ID (integer)
 * Uses range 1-333333 to avoid conflicts with other memory systems
 */
function generateMemoryId(index: number): number {
	// Use timestamp-based approach to avoid conflicts
	// Range: 1-333333 for knowledge memory entries
	const now = Date.now();
	const randomSuffix = Math.floor(Math.random() * 1000); // 0-999
	let vectorId = 1 + (((now % 300000) * 1000 + randomSuffix + index) % 333333);

	// Ensure it's a positive integer
	if (vectorId <= 0) {
		vectorId = Math.floor(Math.random() * 333333) + 1;
	}

	return vectorId;
}

/**
 * Determine memory operation based on similarity analysis (fallback method)
 */
async function determineMemoryOperation(
	fact: string,
	similarMemories: any[],
	threshold: number,
	index: number,
	codePattern?: string,
	tags: string[] = []
): Promise<MemoryAction> {
	const factId = generateMemoryId(index);

	// If no similar memories found, ADD the new fact
	if (similarMemories.length === 0) {
		return {
			id: factId,
			text: fact,
			event: 'ADD',
			tags,
			confidence: 0.8,
			reasoning: 'No similar memories found - adding as new knowledge',
			...(codePattern && { code_pattern: codePattern }),
		};
	}

	// Find the most similar memory
	const mostSimilar = similarMemories[0];
	const similarity = mostSimilar.score || 0;

	// High similarity (>0.9) - consider as duplicate, return NONE
	if (similarity > 0.9) {
		return {
			id: factId,
			text: fact,
			event: 'NONE',
			tags,
			confidence: 0.9,
			reasoning: `High similarity (${similarity.toFixed(2)}) with existing memory - no action needed`,
			...(codePattern && { code_pattern: codePattern }),
		};
	}

	// Medium-high similarity (0.7-0.9) - consider updating existing memory
	if (similarity > threshold && similarity <= 0.9) {
		return {
			id: factId,
			text: fact,
			event: 'UPDATE',
			tags,
			confidence: 0.75,
			reasoning: `Medium similarity (${similarity.toFixed(2)}) - updating existing memory`,
			old_memory: mostSimilar.payload?.data || mostSimilar.text || '',
			...(codePattern && { code_pattern: codePattern }),
		};
	}

	// Low similarity - ADD as new memory
	return {
		id: factId,
		text: fact,
		event: 'ADD',
		tags,
		confidence: 0.7,
		reasoning: `Low similarity (${similarity.toFixed(2)}) - adding as new knowledge`,
		...(codePattern && { code_pattern: codePattern }),
	};
}

/**
 * Calculate text similarity using simple token-based approach
 * This is a fallback when embeddings are not available
 */
function calculateTextSimilarity(text1: string, text2: string): number {
	const words1 = new Set(text1.toLowerCase().split(/\s+/));
	const words2 = new Set(text2.toLowerCase().split(/\s+/));

	const intersection = new Set(Array.from(words1).filter(word => words2.has(word)));
	const union = new Set(Array.from(words1).concat(Array.from(words2)));

	return intersection.size / union.size;
}

/**
 * Persist memory actions to vector store
 */
async function persistMemoryActions(
	memoryActions: MemoryAction[],
	vectorStore: any,
	embedder: any
): Promise<void> {
	const actionsToProcess = memoryActions.filter(
		action => action.event === 'ADD' || action.event === 'UPDATE'
	);

	if (actionsToProcess.length === 0) {
		logger.debug('MemoryOperation: No actions require persistence');
		return;
	}

	logger.info('MemoryOperation: Persisting memory actions', {
		totalActions: actionsToProcess.length,
		addActions: actionsToProcess.filter(a => a.event === 'ADD').length,
		updateActions: actionsToProcess.filter(a => a.event === 'UPDATE').length,
	});

	// Process each action
	for (const action of actionsToProcess) {
		try {
			// Generate embedding for the memory text
			let embedding;
			try {
				embedding = await embedder.embed(action.text || '');
			} catch (embedError) {
				logger.error(
					'MemoryOperation: Failed to generate embedding for persistence, disabling embeddings globally',
					{
						error: embedError instanceof Error ? embedError.message : String(embedError),
						actionId: action.id,
						provider: embedder.getConfig().type,
					}
				);

				// Immediately disable embeddings globally on first failure
				// Note: We don't have context here, so we'll just log the error
				// The global disable will be handled by the calling function
				logger.error(
					'MemoryOperation: Cannot disable embeddings globally from persistMemoryActions - error logged'
				);

				// Skip this action and continue with others
				continue;
			}

			// Determine quality source for V2 payload
			let qualitySource: 'similarity' | 'llm' | 'heuristic' = 'heuristic';
			if (action.reasoning?.includes('LLM')) {
				qualitySource = 'llm';
			} else if (action.reasoning?.includes('similarity')) {
				qualitySource = 'similarity';
			}

			// Create V2 payload with enhanced metadata
			const payload = createKnowledgePayload(
				action.id,
				action.text || '',
				action.tags,
				action.confidence,
				action.reasoning,
				action.event,
				{
					qualitySource,
					...(action.code_pattern && { code_pattern: action.code_pattern }),
					...(action.old_memory && { old_memory: action.old_memory }),
				}
			);

			if (action.event === 'ADD') {
				// Insert new memory
				await vectorStore.insert([embedding], [action.id], [payload]);
				logger.debug('MemoryOperation: Added memory to vector store', {
					id: action.id,
					textLength: (action.text || '').length,
				});
			} else if (action.event === 'UPDATE') {
				// Update existing memory
				await vectorStore.update(action.id, embedding, payload);
				logger.debug('MemoryOperation: Updated memory in vector store', {
					id: action.id,
					textLength: (action.text || '').length,
				});
			}
		} catch (error) {
			logger.error('MemoryOperation: Failed to persist memory action', {
				actionId: action.id,
				event: action.event,
				error: error instanceof Error ? error.message : String(error),
			});
			// Continue with other actions even if one fails
		}
	}
}

export { parseLLMDecision, MEMORY_OPERATION_PROMPTS, extractTechnicalTags };
