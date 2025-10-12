/**
 * LLM Reflection Memory Tools (Phase 2)
 *
 * These tools enable the agent to extract, evaluate, and store reasoning patterns
 * for continuous learning and improvement. They work with the existing vector storage
 * infrastructure to build a reflection memory system.
 *
 * Phase 2: Basic reasoning extraction, evaluation, and storage
 * Phase 3: Advanced pattern recognition and reasoning recommendations
 */

import { z } from 'zod';
import { logger } from '../../logger/index.js';
import type { InternalTool, InternalToolContext } from './types.js';
import { rewriteUserQuery } from './definitions/memory/search_memory.js';
import { env } from '../../env.js';

/**
 * Core Types and Schemas
 */

// Reasoning step without confidence and timestamp (as per new requirements)
export const ReasoningStepSchema = z.object({
	type: z.enum(['thought', 'action', 'observation', 'decision', 'conclusion', 'reflection']),
	content: z.string().min(1),
});

export const ReasoningTraceSchema = z.object({
	id: z.string(),
	steps: z.array(ReasoningStepSchema),
	// FIX (2025-01-29): Made metadata optional to align with tool definition
	// The tool definition (line 611) already marks metadata as not required,
	// but the Zod schema was still requiring it, causing validation failures
	// This change allows reasoning evaluation to work without metadata
	metadata: z.object({
		extractedAt: z.string(),
		conversationLength: z.number(),
		stepCount: z.number(),
		hasExplicitMarkup: z.boolean(),
		sessionId: z.string().optional(),
		taskContext: z
			.object({
				goal: z.string().optional(),
				input: z.string().optional(),
				taskType: z.string().optional(),
				domain: z.string().optional(),
				complexity: z.enum(['low', 'medium', 'high']).optional(),
			})
			.optional(),
		extractionOptions: z
			.object({
				extractExplicit: z.boolean().optional(),
				extractImplicit: z.boolean().optional(),
				includeMetadata: z.boolean().optional(),
			})
			.optional(),
	}).optional(), // FIX: Added .optional() to make entire metadata object optional
});

export const ReasoningEvaluationSchema = z.object({
	qualityScore: z.number().min(0).max(1),
	issues: z.array(
		z.object({
			type: z.string(),
			description: z.string(),
			severity: z.enum(['low', 'medium', 'high']).optional(),
		})
	),
	suggestions: z.array(z.string()),
	shouldStore: z.boolean(),
	metrics: z
		.object({
			efficiency: z.number().min(0).max(1),
			clarity: z.number().min(0).max(1),
			completeness: z.number().min(0).max(1),
		})
		.optional(),
});

export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;
export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;
export type ReasoningEvaluation = z.infer<typeof ReasoningEvaluationSchema>;

// Input schemas for tools
export const extractReasoningInputSchema = z.object({
	userInput: z.string().min(1),
	reasoningContent: z.string().optional(), // Made optional since we only extract from userInput
	options: z
		.object({
			extractExplicit: z.boolean().default(true),
			extractImplicit: z.boolean().default(true),
			includeMetadata: z.boolean().default(true),
		})
		.optional()
		.default({}),
});

export const evaluateReasoningInputSchema = z.object({
	trace: ReasoningTraceSchema,
	options: z
		.object({
			checkEfficiency: z.boolean().default(true),
			detectLoops: z.boolean().default(true),
			generateSuggestions: z.boolean().default(true),
		})
		.optional()
		.default({}),
});

export const searchReasoningInputSchema = z.object({
	query: z.string().min(1),
	options: z
		.object({
			maxResults: z.number().min(1).max(50).default(10),
			minQualityScore: z.number().min(0).max(1).default(0.3),
			includeEvaluations: z.boolean().default(true),
			enable_query_refinement: z.boolean().default(false),
		})
		.optional()
		.default({}),
});

/**
 * Utility Functions
 */

function generateTraceId(): string {
	return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function detectReasoningLoops(steps: ReasoningStep[]): boolean {
	const contentSet = new Set();
	for (const step of steps) {
		if (contentSet.has(step.content)) {
			return true;
		}
		contentSet.add(step.content);
	}
	return false;
}

/**
 * Core Processing Functions
 */

async function extractReasoningFromContent(
	userInput: string,
	reasoningContent: string, // Keep parameter for backward compatibility but only use userInput
	options: { extractExplicit?: boolean; extractImplicit?: boolean; includeMetadata?: boolean }
): Promise<ReasoningStep[]> {
	const steps: ReasoningStep[] = [];

	// Only analyze user input since the tool is only called when user input contains reasoning
	const lines = userInput
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);

	// Extract explicit markup patterns
	if (options.extractExplicit !== false) {
		for (const line of lines) {
			// Enhanced patterns to match both direct format and comment format
			const thoughtMatch = line.match(/^(?:#\s*)?Thought:\s*(.+)$/i);
			if (thoughtMatch && thoughtMatch[1]) {
				steps.push({
					type: 'thought',
					content: thoughtMatch[1],
				});
				continue;
			}

			const actionMatch = line.match(/^(?:#\s*)?Action:\s*(.+)$/i);
			if (actionMatch && actionMatch[1]) {
				steps.push({
					type: 'action',
					content: actionMatch[1],
				});
				continue;
			}

			const observationMatch = line.match(/^(?:#\s*)?Observation:\s*(.+)$/i);
			if (observationMatch && observationMatch[1]) {
				steps.push({
					type: 'observation',
					content: observationMatch[1],
				});
				continue;
			}

			const resultMatch = line.match(/^(?:#\s*)?Result:\s*(.+)$/i);
			if (resultMatch && resultMatch[1]) {
				steps.push({
					type: 'conclusion',
					content: resultMatch[1],
				});
				continue;
			}

			const conclusionMatch = line.match(/^(?:#\s*)?Conclusion:\s*(.+)$/i);
			if (conclusionMatch && conclusionMatch[1]) {
				steps.push({
					type: 'conclusion',
					content: conclusionMatch[1],
				});
				continue;
			}
		}
	}

	// Extract implicit reasoning patterns
	if (options.extractImplicit !== false && steps.length === 0) {
		// Look for reasoning patterns in natural language
		const reasoningKeywords = [
			'think',
			'consider',
			'analyze',
			'approach',
			'strategy',
			'implement',
			'solve',
			'problem',
			'solution',
			'method',
			'algorithm',
			'optimize',
		];

		for (const line of lines) {
			if (line.length < 10) continue; // Skip very short lines

			const hasReasoningKeywords = reasoningKeywords.some(keyword =>
				line.toLowerCase().includes(keyword)
			);

			if (hasReasoningKeywords) {
				// Determine step type based on content
				let stepType: ReasoningStep['type'] = 'thought';
				if (line.toLowerCase().includes('implement') || line.toLowerCase().includes('write')) {
					stepType = 'action';
				} else if (line.toLowerCase().includes('result') || line.toLowerCase().includes('works')) {
					stepType = 'observation';
				}

				steps.push({
					type: stepType,
					content: line,
				});
			}
		}
	}

	return steps;
}

/**
 * Extract task context from user input and reasoning content
 */
async function extractTaskContextFromContent(
	userInput: string,
	_reasoningContent: string // Keep parameter for backward compatibility but only use userInput
): Promise<{
	goal?: string;
	input?: string;
	taskType?: string;
	domain?: string;
	complexity?: 'low' | 'medium' | 'high';
}> {
	// Only analyze user input since the tool is only called when user input contains reasoning
	const content = userInput;

	// Extract goal from user input
	let goal: string | undefined;
	if (userInput.toLowerCase().includes('write') || userInput.toLowerCase().includes('create')) {
		goal = 'Create or write code/solution';
	} else if (userInput.toLowerCase().includes('fix') || userInput.toLowerCase().includes('debug')) {
		goal = 'Fix or debug issue';
	} else if (
		userInput.toLowerCase().includes('explain') ||
		userInput.toLowerCase().includes('understand')
	) {
		goal = 'Explain or understand concept';
	}

	// Determine task type
	let taskType: string | undefined;
	if (content.toLowerCase().includes('function') || content.toLowerCase().includes('code')) {
		taskType = 'code_generation';
	} else if (
		content.toLowerCase().includes('analyze') ||
		content.toLowerCase().includes('review')
	) {
		taskType = 'analysis';
	} else if (content.toLowerCase().includes('solve') || content.toLowerCase().includes('problem')) {
		taskType = 'problem_solving';
	}

	// Determine domain
	let domain: string | undefined;
	if (
		content.toLowerCase().includes('javascript') ||
		content.toLowerCase().includes('typescript')
	) {
		domain = 'javascript';
	} else if (content.toLowerCase().includes('python')) {
		domain = 'python';
	} else if (
		content.toLowerCase().includes('react') ||
		content.toLowerCase().includes('component')
	) {
		domain = 'frontend';
	} else if (content.toLowerCase().includes('server') || content.toLowerCase().includes('api')) {
		domain = 'backend';
	}

	// Determine complexity
	let complexity: 'low' | 'medium' | 'high' | undefined;
	const wordCount = content.split(' ').length;
	if (wordCount < 50) {
		complexity = 'low';
	} else if (wordCount < 200) {
		complexity = 'medium';
	} else {
		complexity = 'high';
	}

	return {
		...(goal && { goal }),
		...(userInput && { input: userInput }),
		...(taskType && { taskType }),
		...(domain && { domain }),
		...(complexity && { complexity }),
	};
}

async function evaluateReasoningQuality(
	trace: ReasoningTrace,
	options: { checkEfficiency?: boolean; detectLoops?: boolean; generateSuggestions?: boolean }
): Promise<ReasoningEvaluation> {
	const issues: Array<{ type: string; description: string; severity?: 'low' | 'medium' | 'high' }> =
		[];
	const suggestions: string[] = [];

	// Basic quality checks
	if (trace.steps.length === 0) {
		issues.push({
			type: 'empty_trace',
			description: 'Reasoning trace contains no steps',
			severity: 'high',
		});
	}

	// Enhanced redundancy detection
	if (options.detectLoops !== false) {
		// Check for exact content loops
		if (detectReasoningLoops(trace.steps)) {
			issues.push({
				type: 'reasoning_loop',
				description: 'Detected repetitive reasoning patterns',
				severity: 'medium',
			});
			suggestions.push('Avoid repetitive reasoning steps');
		}

		// Check for semantic redundancy (similar content in different steps)
		const semanticRedundancy = detectSemanticRedundancy(trace.steps);
		if (semanticRedundancy > 0.5) {
			issues.push({
				type: 'semantic_redundancy',
				description: 'Multiple steps contain very similar content',
				severity: 'medium',
			});
			suggestions.push('Consolidate similar reasoning steps for clarity');
		}

		// Check for trivial steps (very short or generic content)
		const trivialSteps = trace.steps.filter(
			step => step.content.length < 20 || /^(ok|yes|no|done|good)$/i.test(step.content.trim())
		);
		if (trivialSteps.length > trace.steps.length * 0.3) {
			issues.push({
				type: 'trivial_content',
				description: 'Too many trivial or very short reasoning steps',
				severity: 'low',
			});
			suggestions.push('Focus on substantial reasoning steps that add value');
		}
	}

	// Check step diversity
	const stepTypes = new Set(trace.steps.map(s => s.type));
	if (stepTypes.size === 1 && trace.steps.length > 3) {
		issues.push({
			type: 'low_diversity',
			description: 'All reasoning steps are of the same type',
			severity: 'low',
		});
		suggestions.push(
			'Include different types of reasoning steps (thoughts, actions, observations)'
		);
	}

	// Calculate quality score based on issues and step count
	let qualityScore = 1.0;
	qualityScore -= issues.filter(i => i.severity === 'high').length * 0.3;
	qualityScore -= issues.filter(i => i.severity === 'medium').length * 0.2;
	qualityScore -= issues.filter(i => i.severity === 'low').length * 0.1;
	qualityScore = Math.max(0, Math.min(1, qualityScore));

	// Enhanced storage decision - more lenient for learning
	const shouldStore =
		qualityScore >= 0.4 && // Lowered threshold from 0.6 to 0.4 (more inclusive)
		issues.filter(i => i.severity === 'high').length === 0; // No high-severity issues

	return {
		qualityScore,
		issues,
		suggestions,
		shouldStore,
		metrics: {
			efficiency: Math.min(1, trace.steps.length / 10), // Prefer concise reasoning
			clarity: stepTypes.size / Math.min(4, trace.steps.length), // Prefer diverse step types
			completeness: Math.min(1, trace.steps.length / 5), // Prefer adequate detail
		},
	};
}

/**
 * Detect semantic redundancy between reasoning steps
 */
function detectSemanticRedundancy(steps: ReasoningStep[]): number {
	if (steps.length < 2) return 0;

	let redundantPairs = 0;
	let totalPairs = 0;

	for (let i = 0; i < steps.length; i++) {
		for (let j = i + 1; j < steps.length; j++) {
			const similarity = calculateQuerySimilarity(steps[i]?.content || '', steps[j]?.content || '');
			if (similarity > 0.7) {
				// High similarity threshold
				redundantPairs++;
			}
			totalPairs++;
		}
	}

	return totalPairs > 0 ? redundantPairs / totalPairs : 0;
}

/**
 * Tool 1: Extract Reasoning Steps
 *
 * Analyzes user input and reasoning content to extract reasoning patterns,
 * thought chains, and decision points for future optimization.
 * ONLY accessible for reasoning models.
 */
export const extractReasoningSteps: InternalTool = {
	name: 'extract_reasoning_steps',
	category: 'memory',
	internal: true,
	agentAccessible: false, // Internal-only: programmatically called when reasoning content is detected
	description:
		'Extract reasoning steps from user input only. Analyzes both explicit thought markup and implicit reasoning patterns to create structured reasoning traces. Only called when user input contains reasoning content.',
	version: '1.1.0',
	parameters: {
		type: 'object',
		properties: {
			userInput: {
				type: 'string',
				description: 'The original user input or request containing reasoning steps',
			},
			reasoningContent: {
				type: 'string',
				description:
					'[DEPRECATED] The reasoning content parameter - kept for backward compatibility but not used',
			},
			options: {
				type: 'object',
				description: 'Optional configuration for extraction behavior',
				properties: {
					extractExplicit: {
						type: 'boolean',
						description: 'Whether to extract explicit reasoning markup (Thought:, Action:, etc.)',
						default: true,
					},
					extractImplicit: {
						type: 'boolean',
						description: 'Whether to extract implicit reasoning patterns from natural language',
						default: true,
					},
					includeMetadata: {
						type: 'boolean',
						description: 'Whether to include timing and context metadata',
						default: true,
					},
				},
			},
		},
		required: ['userInput'],
	},
	handler: async (args: any, context?: InternalToolContext) => {
		logger.debug('Starting reasoning extraction from user input only', {
			userInputLength: args.userInput?.length || 0,
			options: args.options,
		});

		try {
			// Parse and validate input
			const input = extractReasoningInputSchema.parse(args);

			// Extract reasoning steps
			const steps = await extractReasoningFromContent(
				input.userInput,
				input.reasoningContent || '', // Pass empty string if reasoningContent is not provided
				input.options || {}
			);

			// Extract task context from user input and reasoning content
			const taskContext = await extractTaskContextFromContent(
				input.userInput,
				input.reasoningContent || '' // Pass empty string if reasoningContent is not provided
			);

			// Create reasoning trace
			const trace: ReasoningTrace = {
				id: generateTraceId(),
				steps,
				metadata: {
					extractedAt: new Date().toISOString(),
					conversationLength: input.userInput.length, // Only count user input length
					stepCount: steps.length,
					hasExplicitMarkup: steps.length > 0 && steps.some(s => s.content.includes(':')),
					sessionId: context?.sessionId,
					// Include extracted task context
					taskContext,
					...(input.options?.includeMetadata && {
						extractionOptions: input.options,
					}),
				},
			};

			logger.debug('Successfully extracted reasoning steps', {
				traceId: trace.id,
				stepCount: steps.length,
			});

			return {
				success: true,
				result: { trace },
				metadata: {
					toolName: 'extract_reasoning_steps',
					traceId: trace.id,
					stepCount: steps.length,
				},
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to extract reasoning steps', { error: errorMessage });

			return {
				success: false,
				result: { error: `Extraction failed: ${errorMessage}` },
				metadata: { toolName: 'extract_reasoning_steps', error: errorMessage },
			};
		}
	},
};

/**
 * Tool 2: Evaluate Reasoning Quality
 *
 * Analyzes extracted reasoning for efficiency, redundancy,
 * and correctness. Provides suggestions for improvement.
 * ONLY accessible for reasoning models.
 */
export const evaluateReasoning: InternalTool = {
	name: 'evaluate_reasoning',
	category: 'memory',
	internal: true,
	agentAccessible: false, // Internal-only: programmatically called when reasoning content is detected
	description:
		'Evaluate the quality and efficiency of extracted reasoning. Analyzes reasoning patterns for issues, calculates quality metrics, and generates improvement suggestions.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			trace: {
				type: 'object',
				description: 'The reasoning trace to evaluate (from extract_reasoning_steps)',
				properties: {
					id: { type: 'string' },
					steps: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								type: {
									type: 'string',
									enum: [
										'thought',
										'action',
										'observation',
										'decision',
										'conclusion',
										'reflection',
									],
								},
								content: { type: 'string' },
							},
							required: ['type', 'content'],
						},
					},
					metadata: { type: 'object' },
				},
				required: ['id', 'steps'],
			},
			options: {
				type: 'object',
				description: 'Optional evaluation configuration',
				properties: {
					checkEfficiency: {
						type: 'boolean',
						description: 'Whether to analyze reasoning efficiency',
						default: true,
					},
					detectLoops: {
						type: 'boolean',
						description: 'Whether to detect reasoning loops and redundancy',
						default: true,
					},
					generateSuggestions: {
						type: 'boolean',
						description: 'Whether to generate improvement suggestions',
						default: true,
					},
				},
			},
		},
		required: ['trace'],
	},
	handler: async (args: any, _context?: InternalToolContext) => {
		logger.debug('Starting reasoning evaluation', {
			traceId: args.trace?.id,
			stepCount: args.trace?.steps?.length || 0,
			options: args.options,
		});

		try {
			// Parse and validate input
			const input = evaluateReasoningInputSchema.parse(args);

			// Evaluate reasoning quality
			const evaluation = await evaluateReasoningQuality(input.trace, input.options || {});

			logger.debug('Successfully evaluated reasoning', {
				traceId: input.trace.id,
				qualityScore: evaluation.qualityScore,
				issueCount: evaluation.issues.length,
				suggestionCount: evaluation.suggestions.length,
				shouldStore: evaluation.shouldStore,
			});

			return {
				success: true,
				result: { evaluation },
				metadata: {
					toolName: 'evaluate_reasoning',
					traceId: input.trace.id,
					qualityScore: evaluation.qualityScore,
				},
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to evaluate reasoning', { error: errorMessage });

			return {
				success: false,
				result: { error: `Evaluation failed: ${errorMessage}` },
				metadata: { toolName: 'evaluate_reasoning', error: errorMessage },
			};
		}
	},
};

/**
 * Tool 3: Search Reasoning Patterns
 *
 * Searches stored reflection memory for relevant reasoning patterns
 * that can inform current decision making.
 * ALWAYS accessible regardless of model choice.
 */
export const searchReasoningPatterns: InternalTool = {
	name: 'search_reasoning_patterns',
	category: 'memory',
	internal: true,
	agentAccessible: true, // Agent-accessible: one of two search tools available to agent
	description:
		'Search reflection memory for relevant reasoning patterns. Finds similar reasoning traces and evaluations that can inform current decision-making. Automatically deduplicates similar queries and batches searches for efficiency.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Search query describing the type of reasoning pattern needed',
			},
			context: {
				type: 'object',
				description: 'Optional context to filter results',
				properties: {
					taskType: {
						type: 'string',
						description: 'Type of task (e.g., code_generation, analysis, problem_solving)',
					},
					domain: {
						type: 'string',
						description: 'Problem domain (e.g., javascript, python, frontend, backend)',
					},
					complexity: {
						type: 'string',
						enum: ['low', 'medium', 'high'],
						description: 'Task complexity level',
					},
				},
			},
			options: {
				type: 'object',
				description: 'Search configuration options',
				properties: {
					maxResults: {
						type: 'number',
						description: 'Maximum number of results to return',
						minimum: 1,
						maximum: 50,
						default: 10,
					},
					minQualityScore: {
						type: 'number',
						description: 'Minimum quality score for results',
						minimum: 0,
						maximum: 1,
						default: 0.3,
					},
					includeEvaluations: {
						type: 'boolean',
						description: 'Whether to include quality evaluations in results',
						default: true,
					},
					deduplicateQueries: {
						type: 'boolean',
						description: 'Whether to deduplicate similar queries within the same session',
						default: true,
					},
					enable_query_refinement: {
						type: 'boolean',
						description:
							'Whether to apply query refinement for better search results (default: false)',
						default: false,
					},
				},
			},
		},
		required: ['query'],
	},
	handler: async (args: any, _context?: InternalToolContext) => {
		logger.debug('Starting reasoning pattern search', {
			query: args.query,
			context: args.context,
			options: args.options,
		});

		try {
			// Parse and validate input
			const input = searchReasoningInputSchema.parse(args);

			// Query deduplication to reduce redundant searches
			const shouldDeduplicate = true; // Default behavior, can be made configurable later
			if (shouldDeduplicate && _context?.sessionId) {
				const queryKey = `search_patterns_${_context.sessionId}`;
				const recentQueries = (global as any)[queryKey] || [];

				// Check if a very similar query was made recently (within last 5 minutes)
				const now = Date.now();
				const similarQuery = recentQueries.find(
					(q: any) =>
						now - q.timestamp < 300000 && // 5 minutes
						calculateQuerySimilarity(q.query, input.query) > 0.8
				);

				if (similarQuery) {
					logger.debug('ReasoningPatternSearch: Skipping duplicate query', {
						originalQuery: input.query,
						similarQuery: similarQuery.query,
						timeSinceLastQuery: now - similarQuery.timestamp,
					});

					return {
						success: true,
						result: {
							patterns: [],
							metadata: {
								searchTime: 0,
								totalResults: 0,
								deduplicatedQuery: true,
								originalQuery: similarQuery.query,
							},
						},
					};
				}

				// Store current query
				recentQueries.push({ query: input.query, timestamp: now });
				// Keep only last 10 queries
				if (recentQueries.length > 10) {
					recentQueries.shift();
				}
				(global as any)[queryKey] = recentQueries;
			}

			// Use real vector store if available
			let patterns = [];
			let usedMock = false;
			let fallback = false;

			// Apply input refinement if enabled
			let finalQueries: string[] = [input.query];
			const enableQueryRefinement =
				input.options?.enable_query_refinement === true || env.ENABLE_QUERY_REFINEMENT === true;

			if (enableQueryRefinement && _context?.services?.llmService) {
				try {
					const rewrittenQueries = await rewriteUserQuery(
						input.query,
						_context.services.llmService
					);
					finalQueries = rewrittenQueries.queries;
					logger.debug('ReasoningPatternSearch: Applied query refinement', {
						originalQuery: input.query,
						refinedQueries: finalQueries,
						queryCount: finalQueries.length,
					});
				} catch (refinementError) {
					logger.warn('ReasoningPatternSearch: Query refinement failed, using original query', {
						error:
							refinementError instanceof Error ? refinementError.message : String(refinementError),
					});
					// Keep original query if refinement fails
					finalQueries = [input.query];
				}
			}

			if (
				_context &&
				_context.services &&
				_context.services.vectorStoreManager &&
				_context.services.embeddingManager
			) {
				try {
					// Get embedder for generating query embeddings
					const embedder = _context.services.embeddingManager.getEmbedder('default');
					if (!embedder?.embed || typeof embedder.embed !== 'function') {
						logger.debug('ReasoningPatternSearch: Embedder not available, using fallback');
						fallback = true;
					} else {
						// Generate embedding for the search query
						logger.debug('ReasoningPatternSearch: Generating embedding for query', {
							queryLength: input.query.length,
							queryPreview: input.query.substring(0, 50),
							refinedQueryCount: finalQueries.length,
						});

						let queryEmbeddings: number[][];
						try {
							queryEmbeddings = await embedder.embedBatch(finalQueries);
						} catch (embedError) {
							logger.error(
								'ReasoningPatternSearch: Failed to generate embedding, disabling embeddings globally',
								{
									error: embedError instanceof Error ? embedError.message : String(embedError),
									provider: embedder.getConfig().type,
								}
							);

							// Immediately disable embeddings globally on first failure
							if (_context?.services?.embeddingManager && embedError instanceof Error) {
								_context.services.embeddingManager.handleRuntimeFailure(
									embedError,
									embedder.getConfig().type
								);
							}

							// Fall back to mock data since embeddings are now disabled
							fallback = true;
							patterns = [];
							usedMock = true;
							logger.debug('ReasoningPatternSearch: Using mock response - embeddings disabled');
							return {
								success: true,
								patterns: [],
								metadata: {
									totalPatterns: 0,
									usedMock: true,
									embeddingDisabled: true,
									error: embedError instanceof Error ? embedError.message : String(embedError),
								},
								timestamp: new Date().toISOString(),
							};
						}

						logger.debug('ReasoningPatternSearch: Embedding generated successfully', {
							embeddingDimensions: Array.isArray(queryEmbeddings[0])
								? queryEmbeddings[0].length
								: 'unknown',
						});

						// Check if we have a DualCollectionVectorManager
						const isDualManager =
							_context.services.vectorStoreManager.constructor.name ===
								'DualCollectionVectorManager' ||
							(typeof _context.services.vectorStoreManager.getStore === 'function' &&
								_context.services.vectorStoreManager.getStore.length === 1);

						let store = null;

						if (isDualManager) {
							// For DualCollectionVectorManager, request reflection collection specifically
							logger.debug(
								'ReasoningPatternSearch: Using DualCollectionVectorManager, accessing reflection collection'
							);
							store = (_context.services.vectorStoreManager as any).getStore('reflection');
						} else {
							// For single collection manager
							logger.debug('ReasoningPatternSearch: Using single collection manager');
							store = _context.services.vectorStoreManager.getStore();
						}

						if (store && typeof store.search === 'function') {
							// Use the first embedding for search (or combine results from all embeddings)
							patterns = await store.search(queryEmbeddings[0], input.options?.maxResults || 10);
							usedMock = false;
							logger.debug('ReasoningPatternSearch: Successfully accessed vector store', {
								isDualManager,
								resultsFound: patterns.length,
							});
						} else {
							fallback = true;
							logger.debug('ReasoningPatternSearch: Store not available or missing search method');
						}
					}
				} catch (error) {
					fallback = true;
					logger.debug('ReasoningPatternSearch: Error accessing vector store, using fallback', {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				fallback = true;
				logger.debug('ReasoningPatternSearch: No services context, using fallback');
			}

			// Fallback to mock data if vector store not available
			if (fallback) {
				patterns = [];
				usedMock = true;
				logger.debug('ReasoningPatternSearch: Using mock response - vector store not available');
			}

			// Filter patterns based on quality and context
			const filteredPatterns = patterns
				.filter((pattern: any) => {
					// Extract quality score from payload (same logic as memory search)
					const rawPayload = pattern.payload || {};
					const qualityScore = rawPayload.evaluation?.qualityScore || rawPayload.qualityScore;

					// Apply quality score filter (relaxed for better recall)
					if (
						qualityScore !== undefined &&
						qualityScore < (input.options?.minQualityScore || 0.3)
					) {
						logger.debug('ReasoningPatternSearch: Filtered out pattern due to low quality score', {
							patternId: pattern.id,
							qualityScore,
							threshold: input.options?.minQualityScore || 0.3,
						});
						return false;
					}

					// Apply cross-tool memory sharing filter if workspace mode is shared
					if (env.CIPHER_WORKSPACE_MODE === 'shared') {
						const payload = rawPayload || {};

						// Check if memory matches shared workspace criteria
						const hasMatchingUserId =
							!env.CIPHER_USER_ID || !payload.userId || payload.userId === env.CIPHER_USER_ID;
						const hasMatchingProjectId =
							!env.CIPHER_PROJECT_NAME ||
							!payload.projectId ||
							payload.projectId === env.CIPHER_PROJECT_NAME;
						const isSharedMode = payload.workspaceMode === 'shared';

						// Include memory if:
						// 1. It's marked as shared mode AND (matches user OR project)
						// 2. OR it has no sharing identifiers (legacy memories)
						const shouldInclude =
							(isSharedMode && (hasMatchingUserId || hasMatchingProjectId)) ||
							(!payload.userId && !payload.projectId && !payload.workspaceMode);

						logger.debug('ReasoningPatternSearch: Cross-tool sharing filter applied', {
							patternId: pattern.id,
							memoryUserId: payload.userId,
							memoryProjectId: payload.projectId,
							memoryWorkspaceMode: payload.workspaceMode,
							envUserId: env.CIPHER_USER_ID,
							envProjectId: env.CIPHER_PROJECT_NAME,
							envWorkspaceMode: env.CIPHER_WORKSPACE_MODE,
							shouldInclude,
						});

						if (!shouldInclude) return false;
					}

					return true;
				})
				.map((pattern: any) => {
					const rawPayload = pattern.payload || {};
					return {
						...pattern,
						context: rawPayload.context || '',
					};
				});

			logger.debug('ReasoningPatternSearch: Search completed', {
				query: input.query,
				totalPatterns: patterns.length,
				filteredPatterns: filteredPatterns.length,
				usedMock,
				fallback,
			});

			return {
				success: true,
				result: {
					patterns: filteredPatterns,
					metadata: {
						searchTime: 0, // Placeholder for Phase 2
						totalResults: filteredPatterns.length,
						usedMock,
						fallback,
						queryRefinementApplied: finalQueries.length > 1,
						originalQuery: input.query,
						refinedQueries: finalQueries,
					},
				},
				metadata: {
					toolName: 'search_reasoning_patterns',
					resultsFound: filteredPatterns.length,
				},
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to search reasoning patterns', { error: errorMessage });

			return {
				success: false,
				result: { error: `Search failed: ${errorMessage}` },
				metadata: { toolName: 'search_reasoning_patterns', error: errorMessage },
			};
		}
	},
};

/**
 * Calculate similarity between two search queries to detect duplicates
 */
function calculateQuerySimilarity(query1: string, query2: string): number {
	const words1 = new Set(query1.toLowerCase().split(/\s+/));
	const words2 = new Set(query2.toLowerCase().split(/\s+/));

	const intersection = new Set([...words1].filter(x => words2.has(x)));
	const union = new Set([...words1, ...words2]);

	return intersection.size / union.size; // Jaccard similarity
}
