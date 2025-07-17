import { z } from 'zod';
export const LLMConfigSchema = z
	.object({
		provider: z
			.string()
			.nonempty()
			.describe(
				"The LLM provider (e.g., 'openai', 'anthropic', 'openrouter', 'ollama', 'aws', 'azure')"
			),
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
		// AWS-specific fields
		region: z.string().optional().describe('AWS region for Bedrock'),
		modelId: z.string().optional().describe('AWS Bedrock model ID'),
		accessKeyId: z
			.string()
			.optional()
			.describe('AWS Access Key ID (optional, uses default chain if not set)'),
		secretAccessKey: z
			.string()
			.optional()
			.describe('AWS Secret Access Key (optional, uses default chain if not set)'),
		// Azure-specific fields
		endpoint: z.string().optional().describe('Azure OpenAI endpoint'),
		deploymentName: z.string().optional().describe('Azure OpenAI deployment name'),
		resourceName: z.string().optional().describe('Azure resource name'),
	})
	.strict()
	.superRefine((data, ctx) => {
		const providerLower = data.provider?.toLowerCase();
		const supportedProvidersList = ['openai', 'anthropic', 'openrouter', 'ollama', 'aws', 'azure'];
		if (!supportedProvidersList.includes(providerLower)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['provider'],
				message: `Provider '${data.provider}' is not supported. Supported: ${supportedProvidersList.join(', ')}`,
			});
		}

		if (providerLower === 'aws') {
			if (!data.region || !data.modelId) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['region', 'modelId'],
					message: `AWS provider requires 'region' and 'modelId'.`,
				});
			}
			// API key is optional for AWS (can use default credential chain)
		} else if (providerLower === 'azure') {
			if (!data.endpoint || !data.deploymentName || !data.apiKey || !data.resourceName) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['endpoint', 'deploymentName', 'apiKey', 'resourceName'],
					message: `Azure provider requires 'endpoint', 'deploymentName', 'apiKey', and 'resourceName'.`,
				});
			}
		} else if (providerLower !== 'ollama') {
			// Non-Ollama providers require an API key
			if (!data.apiKey || data.apiKey.trim().length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['apiKey'],
					message: `API key is required for provider '${data.provider}'. Ollama and AWS (if using default credentials) are the only providers that don't require an API key.`,
				});
			}
		}
	});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;
