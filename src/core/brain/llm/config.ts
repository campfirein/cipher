import { z } from 'zod';
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
	})
	.strict()
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
	});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;
