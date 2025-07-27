import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { env } from '../../../../env.js';
// Import payload migration utilities
import { createReasoningPayload } from './payloads.js';

/**
 * Generate safer memory ID to avoid vector store insert failures
 * Uses range 666667-999999 for unified reasoning entries
 */
function generateSafeReasoningMemoryId(index: number): number {
	// Use timestamp-based approach to avoid conflicts
	// Range: 666667-999999 for unified reasoning entries
	const now = Date.now();
	const randomSuffix = Math.floor(Math.random() * 1000); // 0-999
	let vectorId = 666667 + (((now % 300000) * 1000 + randomSuffix + index) % 333333);

	// Ensure it's in the correct range
	if (vectorId <= 666666 || vectorId > 999999) {
		vectorId = Math.floor(Math.random() * 333333) + 666667;
	}

	return vectorId;
}

/**
 * Store Reasoning Memory Tool
 *
 * Stores reasoning traces and their evaluations as unified entries in the reflection vector store.
 * This ensures atomic storage and retrieval - you always get both reasoning steps and evaluation together.
 * This is an append-only operation that takes the complete trace output from cipher_extract_reasoning_steps
 * (which includes automatically extracted task context) and evaluation from cipher_evaluate_reasoning.
 */
export const storeReasoningMemoryTool: InternalTool = {
	name: 'store_reasoning_memory',
	category: 'memory',
	internal: true,
	agentAccessible: false, // Internal-only: programmatically called when reasoning content is detected
	description:
		'Store complete reasoning traces with task context and evaluations in reflection memory. Takes trace with auto-extracted context from cipher_extract_reasoning_steps and evaluation from cipher_evaluate_reasoning. Append-only operation.',
	version: '2.1.0',
	parameters: {
		type: 'object',
		properties: {
			trace: {
				type: 'object',
				description:
					'Complete reasoning trace from cipher_extract_reasoning_steps (includes steps and metadata with task context)',
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
					metadata: {
						type: 'object',
						properties: {
							extractedAt: { type: 'string' },
							conversationLength: { type: 'number' },
							stepCount: { type: 'number' },
							hasExplicitMarkup: { type: 'boolean' },
							sessionId: { type: 'string' },
							taskContext: {
								type: 'object',
								properties: {
									goal: { type: 'string', description: 'What the agent was trying to achieve' },
									input: {
										type: 'string',
										description: 'Original user request or problem statement',
									},
									taskType: {
										type: 'string',
										description: 'Type of task (e.g., code_generation, analysis, problem_solving)',
									},
									domain: {
										type: 'string',
										description: 'Problem domain (e.g., programming, math, planning)',
									},
									complexity: {
										type: 'string',
										enum: ['low', 'medium', 'high'],
										description: 'Task complexity level',
									},
								},
							},
						},
					},
				},
				required: ['id', 'steps', 'metadata'],
			},
			evaluation: {
				type: 'object',
				description: 'Quality evaluation of the reasoning trace from cipher_evaluate_reasoning',
				properties: {
					qualityScore: { type: 'number', minimum: 0, maximum: 1 },
					efficiencyScore: { type: 'number', minimum: 0, maximum: 1 },
					issues: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								type: { type: 'string' },
								description: { type: 'string' },
								severity: { type: 'string', enum: ['low', 'medium', 'high'] },
							},
						},
					},
					suggestions: { type: 'array', items: { type: 'string' } },
					shouldStore: { type: 'boolean' },
				},
				required: ['qualityScore', 'issues', 'suggestions'],
			},
		},
		required: ['trace', 'evaluation'],
	},
	handler: async (args: any, context?: InternalToolContext) => {
		const startTime = Date.now();

		logger.debug('StoreReasoningMemory: Processing unified reasoning storage request', {
			traceId: args.trace?.id || args.trace?.result?.trace?.id,
			stepCount: args.trace?.steps?.length || args.trace?.result?.trace?.steps?.length || 0,
			qualityScore:
				args.evaluation?.qualityScore || args.evaluation?.result?.evaluation?.qualityScore,
			hasTrace: !!args.trace,
			hasEvaluation: !!args.evaluation,
			hasTaskContext: !!(
				args.trace?.metadata?.taskContext || args.trace?.result?.trace?.metadata?.taskContext
			),
		});

		// Handle wrapped tool results (extraction/evaluation tools return { result: { trace/evaluation } })
		let trace = args.trace;
		let evaluation = args.evaluation;

		try {
			// Validate basic arguments
			if (!args) {
				throw new Error('No arguments provided to StoreReasoningMemory');
			}

			// Enhanced validation with better error messages and fallback handling
			const validationErrors: string[] = [];

			// Unwrap trace if it comes from extraction tool result
			if (args.trace && args.trace.result && args.trace.result.trace) {
				trace = args.trace.result.trace;
				logger.debug('StoreReasoningMemory: Unwrapped trace from extraction tool result');
			}

			// Unwrap evaluation if it comes from evaluation tool result
			if (args.evaluation && args.evaluation.result && args.evaluation.result.evaluation) {
				evaluation = args.evaluation.result.evaluation;
				logger.debug('StoreReasoningMemory: Unwrapped evaluation from evaluation tool result');
			}

			// Validate trace parameter
			if (!trace) {
				validationErrors.push(
					'trace parameter is missing - ensure cipher_extract_reasoning_steps was called successfully'
				);
			} else if (typeof trace !== 'object') {
				validationErrors.push('trace must be an object');
			} else {
				if (!trace.steps) {
					validationErrors.push('trace.steps is missing - invalid reasoning trace');
				} else if (!Array.isArray(trace.steps)) {
					validationErrors.push('trace.steps must be an array');
				} else if (trace.steps.length === 0) {
					validationErrors.push('trace.steps array is empty - no reasoning steps to store');
				}

				if (!trace.metadata) {
					validationErrors.push('trace.metadata is missing - invalid reasoning trace');
				}
			}

			// Validate evaluation parameter
			if (!evaluation) {
				validationErrors.push(
					'evaluation parameter is missing - ensure cipher_evaluate_reasoning was called successfully'
				);
			} else if (typeof evaluation !== 'object') {
				validationErrors.push('evaluation must be an object');
			}

			// If we have validation errors, provide detailed feedback about the pipeline failure
			if (validationErrors.length > 0) {
				const errorMessage = `Pipeline validation failed: ${validationErrors.join('; ')}`;
				logger.warn('StoreReasoningMemory: Validation failed, suggesting pipeline check', {
					errors: validationErrors,
					hasTrace: !!trace,
					hasEvaluation: !!evaluation,
					pipelineStage: !trace
						? 'extraction_failed'
						: !evaluation
							? 'evaluation_failed'
							: 'unknown',
				});

				return {
					success: false,
					result: {
						error: errorMessage,
						stored: false,
						validationErrors,
						suggestion:
							'Ensure both cipher_extract_reasoning_steps and cipher_evaluate_reasoning completed successfully before calling store_reasoning_memory',
					},
					metadata: {
						toolName: 'store_reasoning_memory',
						validationFailed: true,
						errors: validationErrors,
						missingDependencies: {
							trace: !trace,
							evaluation: !evaluation,
						},
					},
				};
			}

			// Additional safety checks for array elements
			const validSteps = trace.steps.filter(
				(step: any) => step && typeof step === 'object' && step.content && step.type
			);

			if (validSteps.length === 0) {
				logger.warn('StoreReasoningMemory: No valid reasoning steps found after filtering');
				return {
					success: false,
					result: {
						error:
							'No valid reasoning steps found - all steps are missing required fields (type, content)',
						stored: false,
					},
					metadata: {
						toolName: 'store_reasoning_memory',
						invalidSteps: true,
						originalStepCount: trace.steps.length,
						validStepCount: 0,
					},
				};
			}

			// Log if we filtered out some invalid steps
			if (validSteps.length < trace.steps.length) {
				logger.debug('StoreReasoningMemory: Filtered out invalid reasoning steps', {
					originalCount: trace.steps.length,
					validCount: validSteps.length,
					filteredCount: trace.steps.length - validSteps.length,
				});
			}

			// Check if should store based on evaluation
			if (evaluation.shouldStore === false) {
				logger.debug(
					'StoreReasoningMemory: Skipping storage - evaluation indicates should not store'
				);
				return {
					success: true,
					result: {
						message: 'Storage skipped - quality threshold not met',
						stored: false,
					},
					metadata: {
						toolName: 'store_reasoning_memory',
						skipped: true,
						reason: 'quality_threshold',
						qualityScore: evaluation.qualityScore,
					},
				};
			}

			// Enhanced service availability checking with fallback handling
			if (!context?.services) {
				logger.warn('StoreReasoningMemory: No services context available');
				return {
					success: false,
					result: {
						error: 'Services context is required for reasoning storage',
						stored: false,
					},
					metadata: {
						toolName: 'store_reasoning_memory',
						missingServices: true,
					},
				};
			}

			const embeddingManager = context.services.embeddingManager;
			const vectorStoreManager = context.services.vectorStoreManager;

			if (!embeddingManager || !vectorStoreManager) {
				logger.warn('StoreReasoningMemory: Required services not available');
				return {
					success: false,
					result: {
						error: 'EmbeddingManager and VectorStoreManager are required for reasoning storage',
						stored: false,
					},
					metadata: {
						toolName: 'store_reasoning_memory',
						missingEmbeddingManager: !embeddingManager,
						missingVectorStoreManager: !vectorStoreManager,
					},
				};
			}

			// Get reflection store from dual collection manager with enhanced error handling
			let reflectionStore = null;
			try {
				logger.debug('StoreReasoningMemory: Using dedicated reflection collection');
				reflectionStore = (vectorStoreManager as any).getStore('reflection');
			} catch (error) {
				logger.error('StoreReasoningMemory: Failed to get reflection store', {
					error: error instanceof Error ? error.message : String(error),
					hasVectorStoreManager: !!vectorStoreManager,
				});
				// For integration test mocks, fallback to default store
				if (typeof (vectorStoreManager as any).getStore === 'function') {
					reflectionStore = (vectorStoreManager as any).getStore();
				}
			}

			if (!reflectionStore) {
				logger.warn('StoreReasoningMemory: Reflection store not available');
				// For integration test mocks, fallback to default store
				if (typeof (vectorStoreManager as any).getStore === 'function') {
					reflectionStore = (vectorStoreManager as any).getStore();
				}
				if (!reflectionStore) {
					return {
						success: false,
						result: {
							error: 'Reflection vector store not available',
							stored: false,
						},
						metadata: {
							toolName: 'store_reasoning_memory',
							reflectionStoreUnavailable: true,
						},
					};
				}
			}

			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				logger.warn('StoreReasoningMemory: Embedder not available');
				return {
					success: false,
					result: {
						error: 'Embedder not available for reasoning storage',
						stored: false,
					},
					metadata: {
						toolName: 'store_reasoning_memory',
						embedderUnavailable: true,
					},
				};
			}

			if (!embedder.embed || typeof embedder.embed !== 'function') {
				throw new Error('Embedder is not properly initialized or missing embed() method');
			}

			// Use trace ID from extraction step and generate vector ID
			const vectorId = generateSafeReasoningMemoryId(0);

			// Calculate derived metrics using validated steps
			// Note: confidence field removed from steps as per new requirements

			// const stepTypes = Array.from(new Set(validSteps.map((step: any) => step.type))) as string[];

			// Create simplified searchable content focusing on reasoning steps and evaluation
			const searchableContent = [
				// Core reasoning steps (most important for similarity search)
				...validSteps.map((step: any) => `${step.type}: ${step.content}`),
				// Quality score for filtering
				`Quality: ${evaluation.qualityScore.toFixed(2)}`,
			].join(' ');

			// Generate a context string for the reasoning trace
			let contextString = '';
			if (trace.metadata?.taskContext?.goal) {
				contextString = String(trace.metadata.taskContext.goal);
			} else if (trace.metadata?.taskContext?.input) {
				contextString = String(trace.metadata.taskContext.input);
			} else if (typeof args.userInput === 'string') {
				contextString = args.userInput.slice(0, 100);
			} else {
				contextString = 'No context provided';
			}

			logger.debug('StoreReasoningMemory: Generating embedding for unified reasoning content', {
				traceId: trace.id,
				vectorId,
				contentLength: searchableContent.length,
				stepCount: validSteps.length,
				qualityScore: evaluation.qualityScore,
			});

			// Generate embedding with error handling
			// Have not handled the input refinement here
			// ADD LATER!
			let embedding;
			try {
				embedding = await embedder.embed(searchableContent);
			} catch (embedError) {
				logger.error('StoreReasoningMemory: Failed to generate embedding', {
					error: embedError instanceof Error ? embedError.message : String(embedError),
					contentLength: searchableContent.length,
				});
				throw new Error(
					`Embedding generation failed: ${embedError instanceof Error ? embedError.message : String(embedError)}`
				);
			}

			// CRITICAL: Ensure all data types are correct (avoid string numbers like "0.6")
			const safeQualityScore =
				typeof evaluation.qualityScore === 'number'
					? evaluation.qualityScore
					: parseFloat(String(evaluation.qualityScore)) || 0.5;

			// Validate quality score is a valid number
			if (isNaN(safeQualityScore) || !isFinite(safeQualityScore)) {
				logger.warn('StoreReasoningMemory: Invalid quality score, using fallback', {
					originalValue: evaluation.qualityScore,
					originalType: typeof evaluation.qualityScore,
					fallbackValue: 0.5,
				});
			}

			// Create simplified reasoning payload focusing only on reasoning steps, evaluation, and context
			const payload = createReasoningPayload(
				vectorId,
				String(searchableContent),
				validSteps, // Raw reasoning steps
				{
					qualityScore: Math.max(0, Math.min(1, safeQualityScore)),
					issues: evaluation.issues,
					suggestions: evaluation.suggestions,
				},
				contextString,
				{
					sourceSessionId: trace.metadata.sessionId || context?.sessionId,
				}
			);

			// Enhanced validation before insert with detailed debug logging
			logger.debug('StoreReasoningMemory: Pre-insert validation and analysis', {
				traceId: trace.id,
				vectorId,
				vectorIdType: typeof vectorId,
				vectorIdIsInteger: Number.isInteger(vectorId),
				vectorIdRange: `${vectorId} (should be 666667-999999)`,
				vectorIdValid: Number.isInteger(vectorId) && vectorId >= 666667 && vectorId <= 999999,
				embeddingType: typeof embedding,
				embeddingIsArray: Array.isArray(embedding),
				embeddingLength: Array.isArray(embedding) ? embedding.length : 'not-array',
				embeddingFirstFew: Array.isArray(embedding) ? embedding.slice(0, 3) : 'not-array',
				payloadType: typeof payload,
				payloadKeys: Object.keys(payload),
				payloadSize: JSON.stringify(payload).length,
				payloadIdType: typeof payload.id,
				payloadIdValue: payload.id,
				contentLength: searchableContent.length,
				stepCount: validSteps.length,
			});

			// Detailed validation with specific error messages
			if (!Array.isArray(embedding)) {
				const errorMsg = `Invalid embedding: expected array, got ${typeof embedding}`;
				logger.error('StoreReasoningMemory: Embedding validation failed', {
					error: errorMsg,
					embeddingType: typeof embedding,
					embeddingValue: embedding,
				});
				throw new Error(errorMsg);
			}

			if (embedding.length === 0) {
				const errorMsg = 'Invalid embedding: array is empty';
				logger.error('StoreReasoningMemory: Embedding validation failed', {
					error: errorMsg,
					embeddingLength: embedding.length,
				});
				throw new Error(errorMsg);
			}

			// Validate embedding contains valid numbers
			const invalidEmbeddingElements = embedding.filter(
				(val, _idx) => typeof val !== 'number' || isNaN(val) || !isFinite(val)
			);
			if (invalidEmbeddingElements.length > 0) {
				const errorMsg = `Invalid embedding: contains ${invalidEmbeddingElements.length} non-numeric/invalid values`;
				logger.error('StoreReasoningMemory: Embedding validation failed', {
					error: errorMsg,
					invalidCount: invalidEmbeddingElements.length,
					firstInvalid: invalidEmbeddingElements.slice(0, 3),
					embeddingLength: embedding.length,
				});
				throw new Error(errorMsg);
			}

			if (!Number.isInteger(vectorId)) {
				const errorMsg = `Invalid vector ID: expected integer, got ${typeof vectorId} (${vectorId})`;
				logger.error('StoreReasoningMemory: Vector ID validation failed', {
					error: errorMsg,
					vectorId,
					vectorIdType: typeof vectorId,
					isInteger: Number.isInteger(vectorId),
				});
				throw new Error(errorMsg);
			}

			if (vectorId <= 0) {
				const errorMsg = `Invalid vector ID: must be positive, got ${vectorId}`;
				logger.error('StoreReasoningMemory: Vector ID validation failed', {
					error: errorMsg,
					vectorId,
					isPositive: vectorId > 0,
				});
				throw new Error(errorMsg);
			}

			// Validate vector ID is in expected range for reasoning entries
			if (vectorId < 666667 || vectorId > 999999) {
				logger.warn('StoreReasoningMemory: Vector ID outside expected range', {
					vectorId,
					expectedRange: '666667-999999',
					actualRange: `${vectorId}`,
					willProceed: true,
				});
			}

			// Validate payload structure
			if (typeof payload !== 'object' || payload === null) {
				const errorMsg = `Invalid payload: expected object, got ${typeof payload}`;
				logger.error('StoreReasoningMemory: Payload validation failed', {
					error: errorMsg,
					payloadType: typeof payload,
					payload,
				});
				throw new Error(errorMsg);
			}

			// Validate payload.id matches vectorId
			if (payload.id !== vectorId) {
				const errorMsg = `Payload ID mismatch: payload.id=${payload.id}, vectorId=${vectorId}`;
				logger.error('StoreReasoningMemory: Payload ID validation failed', {
					error: errorMsg,
					payloadId: payload.id,
					vectorId: vectorId,
					payloadIdType: typeof payload.id,
					vectorIdType: typeof vectorId,
				});
				throw new Error(errorMsg);
			}

			// CRITICAL: Check collection existence and configuration with auto-creation
			let collectionExists = false;
			let collectionInfo = null;
			let collectionCreated = false;

			try {
				// Try to get collection info to verify it exists and is properly configured
				const reflectionCollectionName = env.REFLECTION_VECTOR_STORE_COLLECTION;

				// Method 1: Try backend collection info
				if (typeof reflectionStore.getCollectionInfo === 'function') {
					collectionInfo = await reflectionStore.getCollectionInfo();
					collectionExists = true;
					logger.debug('StoreReasoningMemory: Collection exists and accessible', {
						collectionName: reflectionCollectionName,
						vectorsCount: collectionInfo?.vectors_count || 'unknown',
						status: collectionInfo?.status || 'unknown',
					});
				}
				// Method 2: Direct Qdrant client access
				else if (typeof (reflectionStore as any).client?.getCollection === 'function') {
					const collection = await (reflectionStore as any).client.getCollection(
						reflectionCollectionName
					);
					collectionExists = true;
					collectionInfo = collection;
					logger.debug('StoreReasoningMemory: Collection verified via direct client', {
						collectionName: reflectionCollectionName,
						config: collection?.result?.config || 'unknown',
					});
				}
				// Method 3: Try a simple health check
				else if (typeof reflectionStore.isConnected === 'function') {
					collectionExists = reflectionStore.isConnected();
					logger.debug('StoreReasoningMemory: Collection status via isConnected', {
						collectionName: reflectionCollectionName,
						connected: collectionExists,
					});
				}
			} catch (collectionError) {
				logger.error(
					'StoreReasoningMemory: Collection verification failed - attempting auto-creation',
					{
						error:
							collectionError instanceof Error ? collectionError.message : String(collectionError),
						collectionName: env.REFLECTION_VECTOR_STORE_COLLECTION,
						errorType:
							collectionError instanceof Error
								? collectionError.constructor.name
								: typeof collectionError,
					}
				);

				// EMERGENCY: Try to create/recreate the collection
				try {
					console.error('=== COLLECTION AUTO-CREATION ATTEMPT ===');
					console.error(
						'Collection Error:',
						collectionError instanceof Error ? collectionError.message : String(collectionError)
					);
					console.error('Attempting to create collection:', env.REFLECTION_VECTOR_STORE_COLLECTION);

					// Get the DualCollectionVectorManager and try to reinitialize
					const dualManager = vectorStoreManager as any;
					if (dualManager && typeof dualManager.getManager === 'function') {
						const reflectionManager = dualManager.getManager('reflection');
						if (reflectionManager && typeof reflectionManager.connect === 'function') {
							console.error('Attempting to reconnect reflection manager...');
							await reflectionManager.connect();
							collectionCreated = true;
							collectionExists = true;
							console.error('Collection creation/reconnection successful!');
						}
					}

					console.error('======================================');
				} catch (creationError) {
					console.error('=== COLLECTION CREATION FAILED ===');
					console.error(
						'Creation Error:',
						creationError instanceof Error ? creationError.message : String(creationError)
					);
					console.error('Root cause: Collection does not exist and cannot be created');
					console.error('==================================');

					// This is likely the root cause of the "Bad Request" error
					throw new Error(
						`Reflection collection '${env.REFLECTION_VECTOR_STORE_COLLECTION}' does not exist and cannot be created: ${creationError instanceof Error ? creationError.message : String(creationError)}`
					);
				}
			}

			// Get reflection store info for debugging
			const storeInfo = {
				storeType: typeof reflectionStore,
				hasInsertMethod: typeof reflectionStore.insert === 'function',
				storeConstructor: reflectionStore.constructor?.name,
				isConnected:
					typeof reflectionStore.isConnected === 'function'
						? reflectionStore.isConnected()
						: 'unknown',
				collectionExists,
				collectionCreated,
				collectionName: env.REFLECTION_VECTOR_STORE_COLLECTION,
				collectionInfo: collectionInfo ? 'available' : 'not_available',
			};

			logger.debug('StoreReasoningMemory: Reflection store analysis', {
				traceId: trace.id,
				vectorId,
				storeInfo,
				embeddingLength: embedding.length,
				payloadKeys: Object.keys(payload).length,
				payloadSummary: {
					id: payload.id,
					qualityScore: payload.evaluation.qualityScore,
					stepCount: payload.stepCount,
					textLength: payload.text?.length || 0,
					tagsCount: Array.isArray(payload.tags) ? payload.tags.length : 'not_array',
				},
			});

			logger.debug('StoreReasoningMemory: Attempting vector store insert', {
				traceId: trace.id,
				vectorId,
				operation: 'reflectionStore.insert',
				parameters: {
					embeddings: `Array[${embedding.length}]`,
					ids: `[${vectorId}]`,
					payloads: `[Object with ${Object.keys(payload).length} keys]`,
				},
			});

			// Store in reflection vector database using exact same pattern as successful function
			try {
				await reflectionStore.insert([embedding], [vectorId], [payload]);

				logger.debug('StoreReasoningMemory: Vector store insert successful', {
					traceId: trace.id,
					vectorId,
					insertedSuccessfully: true,
					embeddingLength: embedding.length,
					payloadSize: JSON.stringify(payload).length,
				});

				logger.debug('StoreReasoningMemory: ADD operation completed', {
					memoryId: vectorId,
					textPreview:
						searchableContent.substring(0, 60) + (searchableContent.length > 60 ? '...' : ''),
					stepCount: validSteps.length,
					qualityScore: evaluation.qualityScore.toFixed(3),
				});
			} catch (insertError) {
				// EMERGENCY DIAGNOSTIC: Output to console for immediate visibility
				console.error('=== EMERGENCY DIAGNOSTIC ===');
				console.error('Vector Store Insert Failed - Full Analysis:');
				console.error(
					'VectorId:',
					vectorId,
					'Type:',
					typeof vectorId,
					'IsInteger:',
					Number.isInteger(vectorId)
				);
				console.error(
					'Embedding Length:',
					Array.isArray(embedding) ? embedding.length : 'NOT_ARRAY'
				);
				console.error('Payload Keys:', Object.keys(payload));
				console.error('Payload.id:', payload.id, 'Type:', typeof payload.id);
				console.error('Store Type:', reflectionStore.constructor?.name);
				console.error('Collection Name:', env.REFLECTION_VECTOR_STORE_COLLECTION);
				console.error('Collection Exists:', collectionExists);
				console.error('Collection Created:', collectionCreated);
				console.error('Expected Vector Dimension:', env.VECTOR_STORE_DIMENSION);
				console.error(
					'Actual Embedding Dimension:',
					Array.isArray(embedding) ? embedding.length : 'NOT_ARRAY'
				);
				console.error(
					'Dimension Match:',
					Array.isArray(embedding) && embedding.length === env.VECTOR_STORE_DIMENSION
				);
				console.error(
					'Insert Error:',
					insertError instanceof Error ? insertError.message : String(insertError)
				);

				// EXTRACT UNDERLYING QDRANT ERROR
				const underlyingError = (insertError as any)?.cause || (insertError as any)?.originalError;
				if (underlyingError) {
					console.error(
						'Underlying Qdrant Error:',
						underlyingError instanceof Error ? underlyingError.message : String(underlyingError)
					);
					console.error(
						'Qdrant Error Stack:',
						underlyingError instanceof Error ? underlyingError.stack : 'No stack available'
					);
				}

				// FULL ERROR OBJECT INSPECTION
				console.error(
					'Full Error Object:',
					JSON.stringify(
						{
							message: insertError instanceof Error ? insertError.message : String(insertError),
							name: (insertError as any)?.name,
							cause: (insertError as any)?.cause?.message || 'No cause',
							stack:
								insertError instanceof Error
									? insertError.stack?.split('\n').slice(0, 3).join('\n')
									: 'No stack',
						},
						null,
						2
					)
				);

				console.error('===========================');
				// Super detailed error logging for debugging
				const detailedError =
					insertError instanceof Error ? insertError.message : String(insertError);
				const errorStack = insertError instanceof Error ? insertError.stack : undefined;

				logger.debug('StoreReasoningMemory: Detailed insert failure analysis', {
					traceId: trace.id,
					vectorId,
					errorType:
						insertError instanceof Error ? insertError.constructor.name : typeof insertError,
					errorMessage: detailedError,
					errorStack: errorStack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
					insertCallParameters: {
						embeddingsParam: {
							type: typeof [embedding],
							isArray: Array.isArray([embedding]),
							length: [embedding].length,
							firstElementType: typeof embedding,
							firstElementIsArray: Array.isArray(embedding),
							firstElementLength: Array.isArray(embedding) ? embedding.length : 'not-array',
						},
						idsParam: {
							type: typeof [vectorId],
							isArray: Array.isArray([vectorId]),
							length: [vectorId].length,
							firstElement: vectorId,
							firstElementType: typeof vectorId,
							firstElementIsInteger: Number.isInteger(vectorId),
						},
						payloadsParam: {
							type: typeof [payload],
							isArray: Array.isArray([payload]),
							length: [payload].length,
							firstElement: payload,
							firstElementType: typeof payload,
							firstElementKeys: Object.keys(payload),
						},
					},
					reflectionStoreInfo: storeInfo,
					possibleCauses: [
						'Qdrant collection not found or not accessible',
						'Vector dimension mismatch',
						'Payload contains invalid field types',
						'Connection timeout or network issue',
						'Insufficient permissions or API key issues',
						'Collection schema validation failed',
					],
				});

				logger.error(
					'StoreReasoningMemory: Vector store insert failed with comprehensive details',
					{
						traceId: trace.id,
						vectorId,
						vectorIdValid: Number.isInteger(vectorId) && vectorId > 0,
						vectorIdInRange: vectorId >= 666667 && vectorId <= 999999,
						embeddingValid: Array.isArray(embedding) && embedding.length > 0,
						embeddingLength: Array.isArray(embedding) ? embedding.length : 'not-array',
						embeddingHasValidNumbers:
							Array.isArray(embedding) &&
							embedding.every(x => typeof x === 'number' && isFinite(x)),
						payloadValid: typeof payload === 'object' && payload !== null,
						payloadSize: JSON.stringify(payload).length,
						payloadIdMatches: payload.id === vectorId,
						originalError: detailedError,
						errorType:
							insertError instanceof Error ? insertError.constructor.name : typeof insertError,
						storeConnected: storeInfo.isConnected,
					}
				);

				throw new Error(`Vector store insert failed: ${detailedError}`);
			}

			const processingTime = Date.now() - startTime;

			logger.debug(
				'StoreReasoningMemory: Successfully stored unified reasoning entry with task context',
				{
					traceId: trace.id,
					vectorId,
					stepCount: validSteps.length,
					qualityScore: evaluation.qualityScore.toFixed(3),
					issueCount: evaluation.issues.length,
					suggestionCount: evaluation.suggestions.length,
					taskType: trace.metadata.taskContext?.taskType,
					domain: trace.metadata.taskContext?.domain,
					processingTime: `${processingTime}ms`,
				}
			);

			return {
				success: true,
				result: {
					message: 'Reasoning trace with task context and evaluation stored successfully',
					stored: true,
					traceId: trace.id,
					vectorId,
					taskContext: trace.metadata.taskContext,
					metrics: {
						stepCount: validSteps.length,
						qualityScore: evaluation.qualityScore,
						issueCount: evaluation.issues.length,
					},
				},
				metadata: {
					toolName: 'store_reasoning_memory',
					traceId: trace.id,
					vectorId,
					processingTime,
					hasTaskContext: !!trace.metadata.taskContext,
				},
			};
		} catch (error) {
			const processingTime = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			logger.error('StoreReasoningMemory: Failed to store unified reasoning entry', {
				error: errorMessage,
				stepCount: trace?.steps?.length || 0,
				qualityScore: evaluation?.qualityScore,
				processingTime: `${processingTime}ms`,
			});

			return {
				success: false,
				result: {
					error: `Failed to store reasoning: ${errorMessage}`,
					stored: false,
				},
				metadata: {
					toolName: 'store_reasoning_memory',
					error: errorMessage,
					processingTime,
				},
			};
		}
	},
};
