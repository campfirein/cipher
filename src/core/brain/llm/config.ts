import { z } from 'zod';

// Gemini-specific configuration schemas
const GeminiToolConfigSchema = z
	.object({
		mode: z.string().optional().default('AUTO'), // Will be converted to FunctionCallingConfigMode in service
		allowedFunctionNames: z.array(z.string()).optional(),
		maxFunctionCalls: z.number().int().positive().optional().default(5),
		confidenceThreshold: z.number().min(0).max(1).optional().default(0.8),
	})
	.optional();

const GeminiGenerationConfigSchema = z
	.object({
		temperature: z.number().min(0).max(2).optional().default(0.7),
		topK: z.number().int().positive().optional().default(40),
		topP: z.number().min(0).max(1).optional().default(0.95),
		maxOutputTokens: z.number().int().positive().optional().default(2048),
		stopSequences: z.array(z.string()).optional(),
	})
	.optional();

export const LLMConfigSchema = z
	.object({
		provider: z
			.string()
			.nonempty()
			.describe("The LLM provider (e.g., 'openai', 'anthropic', 'openrouter', 'ollama')"),
		model: z.string().nonempty().describe('The specific model name for the selected provider'),
		apiKey: z
			.string()
			.optional()
			.describe(
				'API key for the LLM provider (can also be set via environment variables using $VAR syntax). Not required for Ollama.'
			),
		maxIterations: z
			.number()
			.int()
			.positive()
			.optional()
			.default(50)
			.describe(
				'Maximum number of iterations for agentic loops or chained LLM calls, defaults to 50'
			),
		baseURL: z
			.string()
			.url()
			.optional()
			.describe(
				'Base URL for the LLM provider (e.g., https://api.openai.com/v1, https://openrouter.ai/api/v1). \nSupported for OpenAI, OpenRouter, and Ollama providers.'
			),
		// Gemini-specific configuration options
		toolConfig: GeminiToolConfigSchema,
		generationConfig: GeminiGenerationConfigSchema,
	})
	.passthrough() // Allow additional properties for provider-specific configurations
	.superRefine((data, ctx) => {
		const providerLower = data.provider?.toLowerCase();
		const supportedProvidersList = ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'];
		if (!supportedProvidersList.includes(providerLower)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['provider'],
				message: `Provider '${data.provider}' is not supported. Supported: ${supportedProvidersList.join(', ')}`,
			});
		}

		// Validate API key requirements based on provider
		if (providerLower !== 'ollama') {
			// Non-Ollama providers require an API key
			if (!data.apiKey || data.apiKey.trim().length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['apiKey'],
					message: `API key is required for provider '${data.provider}'. Ollama is the only provider that doesn't require an API key.`,
				});
			}
		}

		// Validate Gemini-specific configurations
		if (providerLower === 'gemini') {
			// Validate toolConfig if provided
			if (data.toolConfig) {
				try {
					GeminiToolConfigSchema.parse(data.toolConfig);
				} catch (error) {
					if (error instanceof z.ZodError) {
						for (const issue of error.errors) {
							ctx.addIssue({
								code: z.ZodIssueCode.custom,
								path: ['toolConfig', ...issue.path],
								message: `Invalid Gemini tool configuration: ${issue.message}`,
							});
						}
					}
				}
			}

			// Validate generationConfig if provided
			if (data.generationConfig) {
				try {
					GeminiGenerationConfigSchema.parse(data.generationConfig);
				} catch (error) {
					if (error instanceof z.ZodError) {
						for (const issue of error.errors) {
							ctx.addIssue({
								code: z.ZodIssueCode.custom,
								path: ['generationConfig', ...issue.path],
								message: `Invalid Gemini generation configuration: ${issue.message}`,
							});
						}
					}
				}
			}
		}
	});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;
