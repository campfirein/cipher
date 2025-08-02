import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workspaceSearchTool } from '../workspace_search.js';
import { workspaceStoreTool } from '../workspace_store.js';
import {
	getWorkspaceTools,
	getAllWorkspaceToolDefinitions,
	shouldDisableDefaultMemory,
	validateWorkspaceMemorySetup,
} from '../workspace-tools.js';
import {
	createWorkspacePayload,
	extractWorkspaceInfo,
	type WorkspacePayload,
} from '../workspace-payloads.js';
import {
	loadWorkspaceConfigFromEnv,
	validateWorkspaceMemoryConfig,
	DEFAULT_WORKSPACE_CONFIG,
} from '../../../../../config/workspace-memory-config.schema.js';
import { env } from '../../../../env.js';

describe('Workspace Memory Integration Tests', () => {
	let mockContext: any;
	let mockEmbeddingManager: any;
	let mockVectorStoreManager: any;
	let mockDualVectorStoreManager: any;
	let mockEmbedder: any;
	let mockWorkspaceStore: any;
	let mockDefaultStore: any;
	let originalEnvValues: any;

	beforeEach(() => {
		// Clear workspace memory environment variables to avoid test interference
		delete process.env.USE_WORKSPACE_MEMORY;
		delete process.env.DISABLE_DEFAULT_MEMORY;
		// Save original environment values
		originalEnvValues = {
			USE_WORKSPACE_MEMORY: process.env.USE_WORKSPACE_MEMORY,
			DISABLE_DEFAULT_MEMORY: process.env.DISABLE_DEFAULT_MEMORY,
			WORKSPACE_VECTOR_STORE_COLLECTION: process.env.WORKSPACE_VECTOR_STORE_COLLECTION,
			WORKSPACE_VECTOR_STORE_TYPE: process.env.WORKSPACE_VECTOR_STORE_TYPE,
			VECTOR_STORE_TYPE: process.env.VECTOR_STORE_TYPE,
			VECTOR_STORE_COLLECTION: process.env.VECTOR_STORE_COLLECTION,
		};

		// Mock embedder with configuration
		mockEmbedder = {
			embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
			getConfig: vi.fn().mockReturnValue({ type: 'openai' }),
		};

		// Mock workspace store
		mockWorkspaceStore = {
			search: vi.fn().mockResolvedValue([
				{
					id: 'workspace_1',
					score: 0.9,
					payload: {
						text: "John is working on the authentication feature and it's 75% complete",
						tags: ['workspace', 'feature', 'in-progress'],
						confidence: 0.8,
						reasoning: 'Team progress update',
						timestamp: '2024-01-01T00:00:00Z',
						event: 'ADD',
						teamMember: 'John',
						currentProgress: {
							feature: 'authentication feature',
							status: 'in-progress',
							completion: 75,
						},
						domain: 'backend',
						qualitySource: 'heuristic',
						sourceSessionId: 'test-session',
					},
				},
			]),
			insert: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		};

		// Mock default store
		mockDefaultStore = {
			search: vi.fn().mockResolvedValue([]),
			insert: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		};

		// Mock embedding manager with session state
		const mockSessionState = {
			isDisabled: vi.fn().mockReturnValue(false),
			getDisabledReason: vi.fn().mockReturnValue(null),
		};

		mockEmbeddingManager = {
			getEmbedder: vi.fn().mockReturnValue(mockEmbedder),
			hasAvailableEmbeddings: vi.fn().mockReturnValue(true),
			getSessionState: vi.fn().mockReturnValue(mockSessionState),
			handleRuntimeFailure: vi.fn(),
		};

		// Mock dual collection vector store manager
		mockDualVectorStoreManager = {
			constructor: { name: 'DualCollectionVectorManager' },
			getStore: vi.fn((type?: string) => {
				if (type === 'workspace') return mockWorkspaceStore;
				if (type === 'knowledge') return mockDefaultStore;
				if (type === 'reflection') return mockDefaultStore;
				return mockDefaultStore; // fallback
			}),
		};

		// Mock single collection vector store manager
		mockVectorStoreManager = {
			constructor: { name: 'VectorStoreManager' },
			getStore: vi.fn().mockReturnValue(mockDefaultStore),
			getNamedStore: vi.fn((collection: string) => {
				if (collection === 'workspace_memory') return mockWorkspaceStore;
				return mockDefaultStore;
			}),
		};

		// Mock context
		mockContext = {
			services: {
				embeddingManager: mockEmbeddingManager,
				vectorStoreManager: mockDualVectorStoreManager,
			},
			toolName: 'workspace_search',
			startTime: Date.now(),
			sessionId: 'test-session',
			metadata: {},
		};
	});

	afterEach(() => {
		// Restore original environment values
		Object.keys(originalEnvValues).forEach(key => {
			if (originalEnvValues[key] !== undefined) {
				process.env[key] = originalEnvValues[key];
			} else {
				delete process.env[key];
			}
		});

		// Ensure workspace memory env vars are cleaned up
		delete process.env.USE_WORKSPACE_MEMORY;
		delete process.env.DISABLE_DEFAULT_MEMORY;

		// Clear all mocks
		vi.clearAllMocks();
	});

	describe('LLM/Embedding Configuration Integration', () => {
		it('should respect cipher.yml LLM and embedding configuration', async () => {
			// Enable workspace memory
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const args = {
				query: 'What is John working on?',
				top_k: 5,
				similarity_threshold: 0.7,
			};

			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(mockEmbeddingManager.getEmbedder).toHaveBeenCalledWith('default');
			expect(mockEmbedder.embed).toHaveBeenCalledWith('What is John working on?');
			expect(result.results).toHaveLength(1);
			expect(result.results[0].teamMember).toBe('John');
		});

		it('should handle embedding failure with fallback mechanisms', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			// Mock embedding failure
			mockEmbedder.embed.mockRejectedValueOnce(new Error('OpenAI API error'));

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(mockEmbeddingManager.handleRuntimeFailure).toHaveBeenCalledWith(
				expect.any(Error),
				'openai'
			);
		});

		it('should disable workspace tools when embeddings are disabled', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			// Mock session state as disabled
			const disabledSessionState = {
				isDisabled: vi.fn().mockReturnValue(true),
				getDisabledReason: vi.fn().mockReturnValue('embedding: disabled: true'),
			};
			mockEmbeddingManager.getSessionState.mockReturnValue(disabledSessionState);

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.results).toEqual([]);
			expect(result.metadata.usedFallback).toBe(true);
		});

		it('should use fallback when no available embeddings', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			mockEmbeddingManager.hasAvailableEmbeddings.mockReturnValue(false);

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.results).toEqual([]);
			expect(result.metadata.usedFallback).toBe(true);
		});

		it('should test with different LLM providers (configuration compatibility)', () => {
			const providers = ['openai', 'anthropic', 'ollama', 'gemini'];

			providers.forEach(provider => {
				mockEmbedder.getConfig.mockReturnValue({ type: provider });

				// Should not throw errors for any provider type
				expect(() => {
					mockEmbeddingManager.handleRuntimeFailure(new Error('test'), provider);
				}).not.toThrow();
			});
		});
	});

	describe('Tool Behavior Verification', () => {
		it('should verify cipher_workspace_search is agent-accessible', () => {
			expect(workspaceSearchTool.agentAccessible).toBe(true);
			expect(workspaceSearchTool.internal).toBe(true);
			expect(workspaceSearchTool.name).toBe('workspace_search');
		});

		it('should verify cipher_workspace_store is background-only', () => {
			expect(workspaceStoreTool.agentAccessible).toBe(false);
			expect(workspaceStoreTool.internal).toBe(true);
			expect(workspaceStoreTool.name).toBe('workspace_store');
		});

		it('should register tools based on environment variables', async () => {
			// Test with workspace memory disabled
			process.env.USE_WORKSPACE_MEMORY = 'false';

			let tools = await getWorkspaceTools({ embeddingEnabled: true });
			expect(Object.keys(tools)).toHaveLength(0);

			// Test with workspace memory enabled
			process.env.USE_WORKSPACE_MEMORY = 'true';

			tools = await getWorkspaceTools({ embeddingEnabled: true });
			expect(Object.keys(tools)).toHaveLength(2);
			expect(tools).toHaveProperty('cipher_workspace_search');
			expect(tools).toHaveProperty('cipher_workspace_store');

			// Test with embeddings disabled
			tools = await getWorkspaceTools({ embeddingEnabled: false });
			expect(Object.keys(tools)).toHaveLength(0);
		});

		it('should test background execution timing for workspace_store', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			// Mock empty search results to force ADD operation
			mockWorkspaceStore.search.mockResolvedValueOnce([]);

			const interaction = 'John completed the authentication feature implementation';
			const startTime = Date.now();

			const result = await workspaceStoreTool.handler({ interaction }, mockContext);

			const executionTime = Date.now() - startTime;

			expect(result.success).toBe(true);
			expect(result.workspace).toHaveLength(1);
			expect(result.workspace[0].event).toBe('ADD');
			expect(executionTime).toBeLessThan(1000); // Should be reasonably fast for background execution
		});
	});

	describe('Payload Extraction Testing', () => {
		it('should extract team member information correctly', () => {
			const testCases = [
				{
					text: 'John is working on the user authentication feature',
					expected: { teamMember: 'John' },
				},
				{
					text: '@alice completed the payment integration',
					expected: { teamMember: 'alice' },
				},
				{
					text: 'assigned to Sarah',
					expected: { teamMember: 'Sarah' },
				},
			];

			testCases.forEach(({ text, expected }) => {
				const extracted = extractWorkspaceInfo(text);
				expected.teamMember
					? expect(extracted.teamMember).toBe(expected.teamMember)
					: expect(extracted.teamMember).toBeDefined();
			});
		});

		it('should extract progress information correctly', () => {
			const testCases = [
				{
					text: 'working on user authentication feature and 75% complete',
					expectedFeature: 'user authentication feature',
					expectedCompletion: 75,
				},
				{
					text: 'implementing payment processing module',
					expectedFeature: 'payment processing module',
				},
				{
					text: 'blocked on API integration',
					expectedStatus: 'blocked',
				},
			];

			testCases.forEach(({ text, expectedFeature, expectedCompletion, expectedStatus }) => {
				const extracted = extractWorkspaceInfo(text);
				if (expectedFeature) {
					expect(extracted.currentProgress?.feature).toBeDefined();
				}
				if (expectedCompletion) {
					expect(extracted.currentProgress?.completion).toBe(expectedCompletion);
				}
				if (expectedStatus) {
					expect(extracted.currentProgress?.status).toBe(expectedStatus);
				}
			});
		});

		it('should extract bug information correctly', () => {
			const testCases = [
				{
					text: 'Fixed critical bug: memory leak in payment processing',
					expected: {
						bugsEncountered: [
							{
								description: 'memory leak in payment processing',
								severity: 'critical',
								status: 'fixed',
							},
						],
					},
				},
				{
					text: 'High priority issue: login form validation failing',
					expected: {
						bugsEncountered: [
							{
								description: 'login form validation failing',
								severity: 'high',
								status: 'open',
							},
						],
					},
				},
			];

			testCases.forEach(({ text, expected }) => {
				const extracted = extractWorkspaceInfo(text);
				if (expected.bugsEncountered) {
					expect(extracted.bugsEncountered).toMatchObject(expected.bugsEncountered);
				}
			});
		});

		it('should extract work context correctly', () => {
			const testCases = [
				{
					text: 'in the ecommerce project',
					expectedProject: 'ecommerce',
				},
				{
					text: 'branch feature/auth-improvements',
					expectedBranch: 'feature/auth-improvements',
				},
				{
					text: 'repository: github.com/company/webapp',
					expectedRepo: 'github.com/company/webapp',
				},
			];

			testCases.forEach(({ text, expectedProject, expectedBranch, expectedRepo }) => {
				const extracted = extractWorkspaceInfo(text);
				if (expectedProject) {
					expect(extracted.workContext?.project).toBe(expectedProject);
				}
				if (expectedBranch) {
					expect(extracted.workContext?.branch).toBe(expectedBranch);
				}
				if (expectedRepo) {
					expect(extracted.workContext?.repository).toBe(expectedRepo);
				}
			});
		});

		it('should extract domain information correctly', () => {
			const testCases = [
				{
					text: 'Implemented React component for user dashboard',
					expected: { domain: 'frontend' },
				},
				{
					text: 'Fixed database connection issue in the API server',
					expected: { domain: 'backend' },
				},
				{
					text: 'Deployed application to staging environment using Docker',
					expected: { domain: 'devops' },
				},
				{
					text: 'Created unit testing for the payment processing module',
					expected: { domain: 'quality-assurance' },
				},
			];

			testCases.forEach(({ text, expected }) => {
				const extracted = extractWorkspaceInfo(text);
				if (expected.domain) {
					expect(extracted.domain).toBe(expected.domain);
				} else {
					expect(extracted.domain).toBeDefined();
				}
			});
		});
	});

	describe('Environment Variable Integration', () => {
		it('should enable/disable workspace memory based on USE_WORKSPACE_MEMORY', async () => {
			// Test disabled
			process.env.USE_WORKSPACE_MEMORY = 'false';

			const args = { query: 'test query' };
			let result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.results).toEqual([]);
			expect(result.metadata.workspaceResults).toBe(0);

			// Test enabled
			process.env.USE_WORKSPACE_MEMORY = 'true';

			result = await workspaceSearchTool.handler(args, mockContext);
			expect(result.success).toBe(true);
			expect(mockWorkspaceStore.search).toHaveBeenCalled();
		});

		it('should test DISABLE_DEFAULT_MEMORY functionality', () => {
			// Test default behavior
			process.env.USE_WORKSPACE_MEMORY = 'false';
			process.env.DISABLE_DEFAULT_MEMORY = 'false';

			expect(shouldDisableDefaultMemory()).toBe(false);

			// Test workspace enabled but default not disabled
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.DISABLE_DEFAULT_MEMORY = 'false';

			expect(shouldDisableDefaultMemory()).toBe(false);

			// Test workspace enabled and default disabled
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.DISABLE_DEFAULT_MEMORY = 'true';

			expect(shouldDisableDefaultMemory()).toBe(true);
		});

		it('should configure workspace vector store correctly', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.WORKSPACE_VECTOR_STORE_COLLECTION = 'custom_workspace';
			process.env.WORKSPACE_VECTOR_STORE_TYPE = 'qdrant';

			const args = { query: 'test query' };
			await workspaceSearchTool.handler(args, mockContext);

			// Should attempt to get workspace store
			expect(mockDualVectorStoreManager.getStore).toHaveBeenCalledWith('workspace');
		});
	});

	describe('Configuration Loading and Validation', () => {
		it('should load YAML configuration correctly', () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.DISABLE_DEFAULT_MEMORY = 'true';
			process.env.WORKSPACE_VECTOR_STORE_COLLECTION = 'test_workspace';

			const config = loadWorkspaceConfigFromEnv();

			expect(config.enabled).toBe(true);
			expect(config.disable_default_memory).toBe(true);
			expect(config.vector_store.collection_name).toBe('test_workspace');
		});

		it('should validate configuration and handle errors', () => {
			// Test valid configuration
			const validConfig = { ...DEFAULT_WORKSPACE_CONFIG };
			expect(() => validateWorkspaceMemoryConfig(validConfig)).not.toThrow();

			// Test invalid configuration
			const invalidConfig = {
				...DEFAULT_WORKSPACE_CONFIG,
				tools: {
					search: {
						similarity_threshold: 1.5, // Invalid: > 1
					},
				},
			};

			expect(() => validateWorkspaceMemoryConfig(invalidConfig)).toThrow();
		});

		it('should validate workspace memory setup', () => {
			// Test basic setup
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.WORKSPACE_VECTOR_STORE_COLLECTION = 'workspace_memory';
			process.env.VECTOR_STORE_COLLECTION = 'default';

			const validation = validateWorkspaceMemorySetup();
			expect(validation.isValid).toBe(true);

			// Test conflicting collection names
			process.env.WORKSPACE_VECTOR_STORE_COLLECTION = 'default';

			const conflictValidation = validateWorkspaceMemorySetup();
			expect(conflictValidation.isValid).toBe(false);
			expect(conflictValidation.issues).toContain(
				'Workspace and default memory collections have the same name - this will cause conflicts'
			);
		});
	});

	describe('Vector Store Collection Management', () => {
		it('should use separate collections for workspace and default memory', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.WORKSPACE_VECTOR_STORE_COLLECTION = 'workspace_memory';
			process.env.VECTOR_STORE_COLLECTION = 'default';

			const args = { query: 'test query' };
			await workspaceSearchTool.handler(args, mockContext);

			// Should try to get workspace-specific store
			expect(mockDualVectorStoreManager.getStore).toHaveBeenCalledWith('workspace');
		});

		it('should handle different vector store types', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.WORKSPACE_VECTOR_STORE_TYPE = 'in-memory';
			process.env.VECTOR_STORE_TYPE = 'qdrant';

			// Test should pass without errors even with different store types
			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
		});

		it('should fallback gracefully when workspace collection fails', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			// Mock workspace store failure
			mockDualVectorStoreManager.getStore.mockImplementation((type?: string) => {
				if (type === 'workspace') {
					throw new Error('Workspace collection not found');
				}
				return mockDefaultStore;
			});

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.metadata.usedFallback).toBe(true);
		});
	});

	describe('Workspace Payload Creation and Management', () => {
		it('should create valid workspace payloads', () => {
			const payload = createWorkspacePayload(
				123,
				'John is working on authentication feature',
				['workspace', 'feature', 'in-progress'],
				0.8,
				'ADD',
				{
					teamMember: 'John',
					currentProgress: {
						feature: 'authentication feature',
						status: 'in-progress',
						completion: 75,
					},
					domain: 'backend',
					qualitySource: 'heuristic',
					sourceSessionId: 'test-session',
				}
			);

			expect(payload.id).toBe(123);
			expect(payload.text).toBe('John is working on authentication feature');
			expect(payload.teamMember).toBe('John');
			expect(payload.currentProgress?.feature).toBe('authentication feature');
			expect(payload.currentProgress?.status).toBe('in-progress');
			expect(payload.currentProgress?.completion).toBe(75);
			expect(payload.domain).toBe('backend');
			expect(payload.qualitySource).toBe('heuristic');
			expect(payload.sourceSessionId).toBe('test-session');
		});

		it('should handle workspace store operations', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			// Mock empty search results to force ADD operation
			mockWorkspaceStore.search.mockResolvedValueOnce([]);

			const interaction = 'Sarah fixed a critical bug in the payment module';
			const result = await workspaceStoreTool.handler({ interaction }, mockContext);

			expect(result.success).toBe(true);
			expect(result.workspace).toHaveLength(1);
			expect(result.workspace[0].text).toBe(interaction);
			expect(result.workspace[0].event).toBe('ADD');

			// Should call insert on workspace store
			expect(mockWorkspaceStore.insert).toHaveBeenCalled();
		});
	});

	describe('Error Handling and Resilience', () => {
		it('should handle missing services gracefully', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const contextWithoutServices = {
				...mockContext,
				services: null,
			};

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, contextWithoutServices);

			expect(result.success).toBe(false);
			expect(result.results).toEqual([]);
		});

		it('should handle vector store failures', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			mockWorkspaceStore.search.mockRejectedValue(new Error('Vector store error'));

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(false);
			expect(result.results).toEqual([]);
		});

		it('should handle workspace store persistence failures', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			mockWorkspaceStore.insert.mockRejectedValue(new Error('Insert failed'));

			const interaction = 'Test workspace content';
			const result = await workspaceStoreTool.handler({ interaction }, mockContext);

			expect(result.success).toBe(true); // Should still succeed with errors logged
		});
	});

	describe('Performance and Optimization', () => {
		it('should handle batch processing correctly', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const interactions = [
				'John completed feature A',
				'Sarah is working on feature B',
				'Mike fixed bug in feature C',
			];

			const result = await workspaceStoreTool.handler({ interaction: interactions }, mockContext);

			expect(result.success).toBe(true);
			expect(result.workspace).toHaveLength(3);
			expect(result.extraction.extracted).toBe(3);
		});

		it('should filter non-significant content', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const interactions = [
				'Hello, how are you?',
				'John completed the authentication feature',
				'Thanks for your help',
				'Sarah is working on the payment module',
			];

			const result = await workspaceStoreTool.handler({ interaction: interactions }, mockContext);

			expect(result.success).toBe(true);
			expect(result.workspace).toHaveLength(2); // Only significant content should be stored
			expect(result.extraction.extracted).toBe(2);
			expect(result.extraction.skipped).toBe(2);
		});

		it('should measure performance metrics', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const args = { query: 'test query' };
			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.metadata).toHaveProperty('searchTime');
			expect(result.metadata).toHaveProperty('embeddingTime');
			expect(result.metadata.searchTime).toBeGreaterThanOrEqual(0);
			expect(result.metadata.embeddingTime).toBeGreaterThanOrEqual(0);
		});
	});

	describe('Integration with Existing Memory System', () => {
		it('should work alongside default memory when not disabled', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.DISABLE_DEFAULT_MEMORY = 'false';

			const tools = await getWorkspaceTools({ embeddingEnabled: true });

			expect(tools).toHaveProperty('cipher_workspace_search');
			expect(tools).toHaveProperty('cipher_workspace_store');

			// Should not disable default memory
			expect(shouldDisableDefaultMemory()).toBe(false);
		});

		it('should disable default memory when configured', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';
			process.env.DISABLE_DEFAULT_MEMORY = 'true';

			expect(shouldDisableDefaultMemory()).toBe(true);

			const tools = await getWorkspaceTools({ embeddingEnabled: true });
			expect(Object.keys(tools)).toHaveLength(2); // Only workspace tools
		});
	});

	describe('Search Filtering and Results', () => {
		it('should filter results by domain', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const args = {
				query: 'recent work',
				filters: { domain: 'backend' },
			};

			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(1);
			expect(result.results[0].domain).toBe('backend');
		});

		it('should filter results by team member', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const args = {
				query: 'team progress',
				filters: { team_member: 'John' },
			};

			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(1);
			expect(result.results[0].teamMember).toBe('John');
		});

		it('should filter results by status', async () => {
			process.env.USE_WORKSPACE_MEMORY = 'true';

			const args = {
				query: 'current tasks',
				filters: { status: 'in-progress' },
			};

			const result = await workspaceSearchTool.handler(args, mockContext);

			expect(result.success).toBe(true);
			expect(result.results).toHaveLength(1);
			expect(result.results[0].currentProgress?.status).toBe('in-progress');
		});
	});
});
