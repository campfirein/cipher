import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemAgent } from '../agent.js';
import { AgentConfig, AgentConfigSchema } from '../config.js';
import { LLMConfigSchema } from '../../llm/config.js';
import { ZodError } from 'zod';

// Mock all external dependencies
vi.mock('../../../utils/service-initializer.js', () => ({
	createAgentServices: vi.fn(),
}));

vi.mock('../../../logger/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		silly: vi.fn(),
	},
}));

vi.mock('../../systemPrompt/manager.js', () => ({
	PromptManager: vi.fn().mockImplementation(() => ({
		load: vi.fn(),
		getInstruction: vi.fn(),
	})),
}));

vi.mock('../state-manager.js', () => ({
	MemAgentStateManager: vi.fn().mockImplementation(() => ({
		getLLMConfig: vi.fn(),
		addMcpServer: vi.fn(),
		removeMcpServer: vi.fn(),
		getRuntimeConfig: vi.fn(),
	})),
}));

vi.mock('../../../session/session-manager.js', () => ({
	SessionManager: vi.fn().mockImplementation(() => ({
		createSession: vi.fn(),
		getSession: vi.fn(),
		init: vi.fn(),
	})),
}));

vi.mock('../../../mcp/manager.js', () => ({
	MCPManager: vi.fn().mockImplementation(() => ({
		disconnectAll: vi.fn(),
		connectServer: vi.fn(),
		removeClient: vi.fn(),
		executeTool: vi.fn(),
		getAllTools: vi.fn(),
		getClients: vi.fn(),
		getFailedConnections: vi.fn(),
	})),
}));

describe('MemAgent', () => {
	let mockServices: any;
	let validConfig: AgentConfig;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Create mock services
		mockServices = {
			mcpManager: {
				disconnectAll: vi.fn().mockResolvedValue(undefined),
				connectServer: vi.fn().mockResolvedValue(undefined),
				removeClient: vi.fn().mockResolvedValue(undefined),
				executeTool: vi.fn().mockResolvedValue({ result: 'success' }),
				getAllTools: vi.fn().mockResolvedValue({}),
				getClients: vi.fn().mockReturnValue(new Map()),
				getFailedConnections: vi.fn().mockReturnValue({}),
			},
			promptManager: {
				load: vi.fn(),
				getInstruction: vi.fn(),
			},
			stateManager: {
				getLLMConfig: vi.fn().mockReturnValue({
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
				}),
				addMcpServer: vi
					.fn()
					.mockReturnValue({ isValid: true, config: {}, errors: [], warnings: [] }),
				removeMcpServer: vi.fn(),
				getRuntimeConfig: vi.fn(),
			},
			sessionManager: {
				createSession: vi.fn().mockResolvedValue({
					id: 'test-session',
					run: vi.fn().mockResolvedValue('Mock response'),
				}),
				getSession: vi.fn().mockResolvedValue(null),
				init: vi.fn().mockResolvedValue(undefined),
			},
			internalToolManager: {
				initialize: vi.fn().mockResolvedValue(undefined),
				getAllTools: vi.fn().mockReturnValue({}),
				executeTool: vi.fn().mockResolvedValue({ success: true }),
				isInternalTool: vi.fn().mockReturnValue(true),
				getManagerStats: vi.fn().mockReturnValue({ totalTools: 3, totalExecutions: 0 }),
			},
			unifiedToolManager: {
				getAllTools: vi.fn().mockResolvedValue({}),
				executeTool: vi.fn().mockResolvedValue({ success: true }),
				getToolsForProvider: vi.fn().mockResolvedValue([]),
				isToolAvailable: vi.fn().mockResolvedValue(true),
				getToolSource: vi.fn().mockResolvedValue('internal'),
				getStats: vi.fn().mockReturnValue({
					internalTools: { totalTools: 3 },
					mcpTools: { clientCount: 0 },
					config: { enableInternalTools: true, enableMcpTools: true },
				}),
			},
		};

		// Mock the service initializer
		const { createAgentServices } = await import('../../../utils/service-initializer.js');
		vi.mocked(createAgentServices).mockResolvedValue(mockServices);

		// Valid configuration for tests
		validConfig = {
			systemPrompt: 'You are a helpful assistant',
			llm: {
				provider: 'openai',
				model: 'gpt-4',
				apiKey: 'test-api-key',
			},
			mcpServers: {},
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Basic Validation', () => {
		it('should require model or provider parameter', () => {
			const invalidConfigs = [
				{
					// Missing both model and provider
					systemPrompt: 'You are a helpful assistant',
					llm: {
						apiKey: 'test-api-key',
					},
				},
				{
					// Missing model
					systemPrompt: 'You are a helpful assistant',
					llm: {
						provider: 'openai',
						apiKey: 'test-api-key',
					},
				},
				{
					// Missing provider
					systemPrompt: 'You are a helpful assistant',
					llm: {
						model: 'gpt-4',
						apiKey: 'test-api-key',
					},
				},
				{
					// Empty provider
					systemPrompt: 'You are a helpful assistant',
					llm: {
						provider: '',
						model: 'gpt-4',
						apiKey: 'test-api-key',
					},
				},
				{
					// Empty model
					systemPrompt: 'You are a helpful assistant',
					llm: {
						provider: 'openai',
						model: '',
						apiKey: 'test-api-key',
					},
				},
			];

			invalidConfigs.forEach((config, _index) => {
				expect(() => {
					AgentConfigSchema.parse(config);
				}).toThrow(ZodError);
			});
		});

		it('should handle validation failure', () => {
			const invalidConfig = {
				systemPrompt: 'You are a helpful assistant',
				llm: {
					provider: 'invalid-provider',
					model: 'gpt-4',
					apiKey: 'test-api-key',
				},
			};

			expect(() => {
				AgentConfigSchema.parse(invalidConfig);
			}).toThrow(ZodError);

			try {
				AgentConfigSchema.parse(invalidConfig);
			} catch (error) {
				expect(error).toBeInstanceOf(ZodError);
				const zodError = error as ZodError;
				expect(zodError.issues).toHaveLength(1);
				expect(zodError.issues[0]?.path).toEqual(['llm', 'provider']);
				expect(zodError.issues[0]?.message).toContain('not supported');
			}
		});

		it('should validate LLM config separately', () => {
			const validLLMConfig = {
				provider: 'openai',
				model: 'gpt-4',
				apiKey: 'test-api-key',
			};

			const result = LLMConfigSchema.safeParse(validLLMConfig);
			expect(result.success).toBe(true);

			const invalidLLMConfig = {
				provider: 'unsupported-provider',
				model: 'gpt-4',
				apiKey: 'test-api-key',
			};

			const invalidResult = LLMConfigSchema.safeParse(invalidLLMConfig);
			expect(invalidResult.success).toBe(false);
			if (!invalidResult.success) {
				expect(invalidResult.error.issues[0]?.message).toContain('not supported');
			}
		});

		it('should require API key', () => {
			const configWithoutApiKey = {
				systemPrompt: 'You are a helpful assistant',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithoutApiKey);
			}).toThrow(ZodError);
		});

		it('should reject empty API key', () => {
			const configWithEmptyApiKey = {
				systemPrompt: 'You are a helpful assistant',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: '',
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithEmptyApiKey);
			}).toThrow(ZodError);
		});

		it('should validate supported providers', () => {
			const supportedProviders = ['openai', 'anthropic', 'gemini'];
			const unsupportedProviders = ['google', 'cohere', 'huggingface', 'custom'];

			// Test supported providers
			supportedProviders.forEach(provider => {
				const config = {
					systemPrompt: 'You are a helpful assistant',
					llm: {
						provider,
						model: 'test-model',
						apiKey: 'test-api-key',
					},
				};

				expect(() => {
					AgentConfigSchema.parse(config);
				}).not.toThrow();
			});

			// Test unsupported providers
			unsupportedProviders.forEach(provider => {
				const config = {
					systemPrompt: 'You are a helpful assistant',
					llm: {
						provider,
						model: 'test-model',
						apiKey: 'test-api-key',
					},
				};

				expect(() => {
					AgentConfigSchema.parse(config);
				}).toThrow(ZodError);
			});
		});

		it('should validate configuration structure', () => {
			const incompleteConfig = {
				// Missing systemPrompt and llm
			};

			expect(() => {
				AgentConfigSchema.parse(incompleteConfig);
			}).toThrow(ZodError);

			const configWithInvalidType = {
				systemPrompt: 123, // Should be string
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-api-key',
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithInvalidType);
			}).toThrow(ZodError);
		});

		it('should accept valid configuration', () => {
			expect(() => {
				AgentConfigSchema.parse(validConfig);
			}).not.toThrow();

			const parsedConfig = AgentConfigSchema.parse(validConfig);
			expect(parsedConfig.llm.provider).toBe('openai');
			expect(parsedConfig.llm.model).toBe('gpt-4');
			expect(parsedConfig.llm.apiKey).toBe('test-api-key');
		});

		it('should handle optional configuration fields', () => {
			const configWithOptionals = {
				...validConfig,
				llm: {
					...validConfig.llm,
					maxIterations: 30,
					baseURL: 'https://api.openai.com/v1',
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithOptionals);
			}).not.toThrow();

			const parsedConfig = AgentConfigSchema.parse(configWithOptionals);
			expect(parsedConfig.llm.maxIterations).toBe(30);
			expect(parsedConfig.llm.baseURL).toBe('https://api.openai.com/v1');
		});

		it('should validate baseURL format when provided', () => {
			const configWithInvalidBaseURL = {
				...validConfig,
				llm: {
					...validConfig.llm,
					baseURL: 'not-a-valid-url',
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithInvalidBaseURL);
			}).toThrow(ZodError);
		});

		it('should validate maxIterations is positive', () => {
			const configWithNegativeIterations = {
				...validConfig,
				llm: {
					...validConfig.llm,
					maxIterations: -1,
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithNegativeIterations);
			}).toThrow(ZodError);

			const configWithZeroIterations = {
				...validConfig,
				llm: {
					...validConfig.llm,
					maxIterations: 0,
				},
			};

			expect(() => {
				AgentConfigSchema.parse(configWithZeroIterations);
			}).toThrow(ZodError);
		});
	});

	describe('Agent Initialization', () => {
		it('should create agent with valid config', () => {
			const agent = new MemAgent(validConfig);
			expect(agent).toBeInstanceOf(MemAgent);
			expect(agent.getIsStarted()).toBe(false);
			expect(agent.getIsStopped()).toBe(false);
		});

		it('should fail to start with invalid configuration during service creation', async () => {
			const { createAgentServices } = await import('../../../utils/service-initializer.js');
			vi.mocked(createAgentServices).mockRejectedValue(
				new Error('Configuration validation failed')
			);

			const agent = new MemAgent(validConfig);

			await expect(agent.start()).rejects.toThrow('Configuration validation failed');
			expect(agent.getIsStarted()).toBe(false);
		});

		it('should start successfully with valid configuration', async () => {
			const agent = new MemAgent(validConfig);

			await agent.start();

			expect(agent.getIsStarted()).toBe(true);
			expect(agent.getIsStopped()).toBe(false);
		});

		it('should throw error when starting already started agent', async () => {
			const agent = new MemAgent(validConfig);
			await agent.start();

			await expect(agent.start()).rejects.toThrow('MemAgent is already started');
		});
	});

	describe('Service Validation', () => {
		it('should fail if required services are missing', async () => {
			const incompleteServices = {
				mcpManager: mockServices.mcpManager,
				promptManager: undefined,
				stateManager: mockServices.stateManager,
				sessionManager: mockServices.sessionManager,
				internalToolManager: mockServices.internalToolManager,
				unifiedToolManager: mockServices.unifiedToolManager,
			};

			const { createAgentServices } = await import('../../../utils/service-initializer.js');
			vi.mocked(createAgentServices).mockResolvedValue(incompleteServices as any);

			const agent = new MemAgent(validConfig);

			await expect(agent.start()).rejects.toThrow('Required service promptManager is missing');
		});

		it('should validate all required services are present', async () => {
			const agent = new MemAgent(validConfig);
			await agent.start();

			expect(agent.mcpManager).toBeDefined();
			expect(agent.promptManager).toBeDefined();
			expect(agent.stateManager).toBeDefined();
			expect(agent.sessionManager).toBeDefined();
			expect(agent.internalToolManager).toBeDefined();
			expect(agent.unifiedToolManager).toBeDefined();
			expect(agent.services).toBeDefined();
		});
	});

	describe('Metadata Propagation', () => {
		it('should propagate memoryMetadata and sessionOptions to session.run', async () => {
			const agent = new MemAgent(validConfig);
			await agent.start();

			const mockSession = {
				id: 'test-session',
				run: vi.fn().mockResolvedValue({
					response: 'Mock response',
					backgroundOperations: Promise.resolve(),
				}),
			};
			mockServices.sessionManager.getSession.mockResolvedValue(mockSession);

			const memoryMetadata = { foo: 'bar' };
			const sessionOptions = { baz: 'qux' };

			await agent.run('test input', undefined, undefined, false, {
				memoryMetadata,
				sessionOptions,
			});

			expect(mockSession.run).toHaveBeenCalledWith('test input', undefined, false, {
				memoryMetadata,
				contextOverrides: sessionOptions,
			});
		});
	});
});
