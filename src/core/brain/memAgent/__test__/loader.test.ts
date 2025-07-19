import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAgentConfig } from '../loader.js';
import { promises as fs } from 'fs';
import { parse as parseYaml } from 'yaml';

// Mock external dependencies
vi.mock('fs', () => ({
	promises: {
		readFile: vi.fn(),
	},
}));

vi.mock('yaml', () => ({
	parse: vi.fn(),
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

describe('Loader', () => {
	const mockFs = vi.mocked(fs);
	const mockParseYaml = vi.mocked(parseYaml);

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset environment variables
		delete process.env.TEST_VAR;
		delete process.env.API_KEY;
		delete process.env.PORT;
		delete process.env.TIMEOUT;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Environment Variable Expansion', () => {
		it('should expand simple environment variables', async () => {
			process.env.TEST_VAR = 'test-value';
			process.env.API_KEY = 'secret-key';

			const mockConfig = {
				systemPrompt: '$TEST_VAR',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: '${API_KEY}',
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.systemPrompt).toBe('test-value');
			expect(result.llm.apiKey).toBe('secret-key');
		});

		it('should handle missing environment variables by replacing with empty string', async () => {
			const mockConfig = {
				systemPrompt: '$MISSING_VAR',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: '${ALSO_MISSING}',
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.systemPrompt).toBe('');
			expect(result.llm.apiKey).toBe('');
		});

		it('should convert numeric environment variables to numbers', async () => {
			process.env.PORT = '3000';
			process.env.TIMEOUT = '30.5';
			process.env.SCIENTIFIC = '1.23e-4';

			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
					maxTokens: '$PORT',
					temperature: '${TIMEOUT}',
				},
				sessions: {
					sessionTTL: '$SCIENTIFIC',
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.llm.maxTokens).toBe(3000);
			expect(result.llm.temperature).toBe(30.5);
			expect(result.sessions.sessionTTL).toBe(1.23e-4);
		});

		it('should not convert non-numeric strings to numbers', async () => {
			process.env.TEXT_VAR = 'not-a-number';

			const mockConfig = {
				systemPrompt: '$TEXT_VAR',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.systemPrompt).toBe('not-a-number');
		});

		it('should handle environment variables in nested objects', async () => {
			process.env.DB_HOST = 'localhost';
			process.env.DB_PORT = '5432';

			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
					baseURL: 'https://$DB_HOST:$DB_PORT',
				},
				mcpServers: {
					testServer: {
						command: 'test',
						env: {
							HOST: '$DB_HOST',
							PORT: '$DB_PORT',
							USERNAME: '${USERNAME}',
						},
					},
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.llm.baseURL).toBe('https://localhost:5432');
			expect(result.mcpServers.testServer.env.HOST).toBe('localhost');
			expect(result.mcpServers.testServer.env.PORT).toBe(5432);
			expect(result.mcpServers.testServer.env.USERNAME).toBe('');
		});

		it('should handle environment variables in arrays', async () => {
			process.env.SERVER1 = 'server1.com';
			process.env.SERVER2 = 'server2.com';

			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
				},
				mcpServers: {
					testServer: {
						command: 'test',
						args: ['$SERVER1', '${SERVER2}', 'static.com'],
					},
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.mcpServers.testServer.args).toEqual([
				'server1.com',
				'server2.com',
				'static.com',
			]);
		});

		it('should handle mixed content with environment variables', async () => {
			process.env.HOST = 'api.example.com';
			process.env.VERSION = 'v1';

			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
					baseURL: 'https://$HOST/${VERSION}/users',
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.llm.baseURL).toBe('https://api.example.com/v1/users');
		});

		it('should preserve non-string values unchanged', async () => {
			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
				},
				sessions: {
					maxSessions: 42,
					sessionTTL: 3600000,
				},
				mcpServers: {
					testServer: {
						command: 'test',
						disabled: true,
						timeout: null,
						env: { key: 'value' },
						args: [1, 2, 3],
					},
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.sessions.maxSessions).toBe(42);
			expect(result.mcpServers.testServer.disabled).toBe(true);
			expect(result.mcpServers.testServer.timeout).toBe(null);
			expect(result.mcpServers.testServer.env).toEqual({ key: 'value' });
			expect(result.mcpServers.testServer.args).toEqual([1, 2, 3]);
		});

		it('should handle case-insensitive environment variable names', async () => {
			process.env.test_var = 'lowercase';
			process.env.TEST_VAR = 'uppercase';

			const mockConfig = {
				systemPrompt: '$test_var',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: '$TEST_VAR',
				},
			};

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig));
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.systemPrompt).toBe('lowercase');
			expect(result.llm.apiKey).toBe('uppercase');
		});
	});

	describe('Config File Loading', () => {
		it('should successfully load and parse YAML config', async () => {
			const yamlContent = `
systemPrompt: "You are a helpful assistant"
llm:
  provider: "openai"
  model: "gpt-4"
  apiKey: "test-key"
`;
			const expectedConfig = {
				systemPrompt: 'You are a helpful assistant',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
				},
			};

			mockFs.readFile.mockResolvedValue(yamlContent);
			mockParseYaml.mockReturnValue(expectedConfig);

			const result = await loadAgentConfig('/path/to/config.yml');

			expect(mockFs.readFile).toHaveBeenCalledWith('/path/to/config.yml', 'utf-8');
			expect(mockParseYaml).toHaveBeenCalledWith(yamlContent);
			expect(result).toEqual(expectedConfig);
		});

		it('should log debug message with config path', async () => {
			const { logger } = await import('../../../logger/index.js');
			const mockConfig = { test: 'value' };

			mockFs.readFile.mockResolvedValue('test: value');
			mockParseYaml.mockReturnValue(mockConfig);

			await loadAgentConfig('/custom/path/config.yml');

			expect(logger.debug).toHaveBeenCalledWith(
				'Loading cipher config from: /custom/path/config.yml'
			);
		});

		it('should handle file read errors', async () => {
			const readError = new Error('File not found');
			mockFs.readFile.mockRejectedValue(readError);

			await expect(loadAgentConfig('/nonexistent/config.yml')).rejects.toThrow(
				'Failed to load config file at /nonexistent/config.yml: File not found'
			);
		});

		it('should handle YAML parsing errors', async () => {
			const yamlContent = 'invalid: yaml: content: [unclosed';
			const parseError = new Error('Invalid YAML syntax');

			mockFs.readFile.mockResolvedValue(yamlContent);
			mockParseYaml.mockImplementation(() => {
				throw parseError;
			});

			await expect(loadAgentConfig('/path/to/config.yml')).rejects.toThrow(
				'Failed to parse YAML: Invalid YAML syntax'
			);
		});

		it('should handle non-Error parsing exceptions', async () => {
			const yamlContent = 'test: value';

			mockFs.readFile.mockResolvedValue(yamlContent);
			mockParseYaml.mockImplementation(() => {
				throw 'String error';
			});

			await expect(loadAgentConfig('/path/to/config.yml')).rejects.toThrow(
				'Failed to parse YAML: String error'
			);
		});

		it('should handle file system errors with path property', async () => {
			const fsError = Object.assign(new Error('Permission denied'), {
				path: '/restricted/config.yml',
			});

			mockFs.readFile.mockRejectedValue(fsError);

			await expect(loadAgentConfig('/path/to/config.yml')).rejects.toThrow(
				'Failed to load config file at /restricted/config.yml: Permission denied'
			);
		});

		it('should handle complex configuration with environment variables', async () => {
			process.env.API_KEY = 'secret-123';
			process.env.MAX_ITERATIONS = '50';
			process.env.BASE_URL = 'https://api.openai.com/v1';

			const yamlContent = `
systemPrompt: "You are a helpful assistant"
llm:
  provider: "openai"
  model: "gpt-4"
  apiKey: "\${API_KEY}"
  maxIterations: \${MAX_ITERATIONS}
  baseURL: \${BASE_URL}
mcpServers:
  filesystem:
    type: "stdio"
    command: "npx"
    args: ["@modelcontextprotocol/server-filesystem"]
    env:
      ROOT_PATH: "/tmp"
`;

			const parsedConfig = {
				systemPrompt: 'You are a helpful assistant',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: '${API_KEY}',
					maxIterations: '${MAX_ITERATIONS}',
					baseURL: '${BASE_URL}',
				},
				mcpServers: {
					filesystem: {
						type: 'stdio',
						command: 'npx',
						args: ['@modelcontextprotocol/server-filesystem'],
						env: {
							ROOT_PATH: '/tmp',
						},
					},
				},
			};

			mockFs.readFile.mockResolvedValue(yamlContent);
			mockParseYaml.mockReturnValue(parsedConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.llm.apiKey).toBe('secret-123');
			expect(result.llm.maxIterations).toBe(50);
			expect(result.llm.baseURL).toBe('https://api.openai.com/v1');
			expect(result.mcpServers.filesystem.env.ROOT_PATH).toBe('/tmp');
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty config file', async () => {
			mockFs.readFile.mockResolvedValue('');
			mockParseYaml.mockReturnValue({});

			const result = await loadAgentConfig('/path/to/empty.yml');

			expect(result).toEqual({});
		});

		it('should handle config with only environment variables', async () => {
			process.env.ONLY_ENV = 'env-value';

			const mockConfig = '$ONLY_ENV';

			mockFs.readFile.mockResolvedValue('value');
			mockParseYaml.mockReturnValue(mockConfig);

			const result = await loadAgentConfig('/path/to/config.yml');

			expect(result).toBe('env-value');
		});

		it('should handle deeply nested configuration', async () => {
			process.env.DEEP_VALUE = 'found-it';

			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
				},
				mcpServers: {
					testServer: {
						type: 'stdio',
						command: 'test',
						env: {
							level1: {
								level2: {
									level3: {
										level4: {
											value: '$DEEP_VALUE',
										},
									},
								},
							},
						},
					},
				},
			};

			mockFs.readFile.mockResolvedValue('nested');
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.mcpServers.testServer.env.level1.level2.level3.level4.value).toBe('found-it');
		});

		it('should handle environment variables with underscores and numbers', async () => {
			process.env.VAR_WITH_123 = 'underscore-and-numbers';
			process.env.VAR123 = 'just-numbers';

			const mockConfig = {
				systemPrompt: '$VAR_WITH_123',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: '$VAR123',
				},
			};

			mockFs.readFile.mockResolvedValue('test');
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.systemPrompt).toBe('underscore-and-numbers');
			expect(result.llm.apiKey).toBe('just-numbers');
		});

		it('should handle negative numbers in environment variables', async () => {
			process.env.NEGATIVE_INT = '-42';
			process.env.NEGATIVE_FLOAT = '-3.14';

			const mockConfig = {
				systemPrompt: 'test prompt',
				llm: {
					provider: 'openai',
					model: 'gpt-4',
					apiKey: 'test-key',
					maxIterations: '$NEGATIVE_INT',
				},
				sessions: {
					sessionTTL: '$NEGATIVE_FLOAT',
				},
			};

			mockFs.readFile.mockResolvedValue('negative');
			mockParseYaml.mockReturnValue(mockConfig);

			const result = (await loadAgentConfig('/path/to/config.yml')) as any;

			expect(result.llm.maxIterations).toBe(-42);
			expect(result.sessions.sessionTTL).toBe(-3.14);
		});
	});

	it('should load configuration with OpenAI provider', async () => {
		const config = {
			llm: {
				provider: 'openai',
				model: 'gpt-4o-mini',
				apiKey: 'test-api-key',
				maxIterations: 3,
			},
		};

		mockFs.readFile.mockResolvedValue(JSON.stringify(config));
		mockParseYaml.mockReturnValue(config);

		const result = await loadAgentConfig('/path/to/config.yml');
		expect(result.llm.provider).toBe('openai');
		expect(result.llm.model).toBe('gpt-4o-mini');
	});

	it('should load configuration with Gemini provider', async () => {
		const config = {
			llm: {
				provider: 'gemini',
				model: 'gemini-pro',
				apiKey: 'test-gemini-key',
				maxIterations: 3,
			},
		};

		mockFs.readFile.mockResolvedValue(JSON.stringify(config));
		mockParseYaml.mockReturnValue(config);

		const result = await loadAgentConfig('/path/to/config.yml');
		expect(result.llm.provider).toBe('gemini');
		expect(result.llm.model).toBe('gemini-pro');
	});
});
