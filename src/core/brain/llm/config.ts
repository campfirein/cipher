import { z } from 'zod';

const AwsConfigSchema = z.object({
	region: z
		.string()
		.optional()
		.describe('AWS region (defaults to us-east-1 or AWS_DEFAULT_REGION)'),
	accessKeyId: z
		.string()
		.optional()
		.describe('AWS Access Key ID (can use AWS_ACCESS_KEY_ID env var)'),
	secretAccessKey: z
		.string()
		.optional()
		.describe('AWS Secret Access Key (can use AWS_SECRET_ACCESS_KEY env var)'),
	sessionToken: z
		.string()
		.optional()
		.describe('AWS Session Token (can use AWS_SESSION_TOKEN env var)'),
	inferenceProfileArn: z
		.string()
		.optional()
		.describe(
			'ARN of the AWS Bedrock provisioned throughput (inference profile) for the selected model'
		),
});

const AzureConfigSchema = z.object({
	endpoint: z.string().url().describe('Azure OpenAI endpoint URL (required for Azure)'),
	deployment: z
		.string()
		.optional()
		.describe('Azure deployment name (defaults to model name if not provided)'),
	apiVersion: z.string().optional().describe('Azure OpenAI API version (defaults to 2023-05-15)'),
	resourceName: z.string().optional().describe('Azure resource name (optional, for reference)'),
});

export const LLMConfigSchema = z
	.object({
		provider: z
			.string()
			.nonempty()
			.describe(
				"The LLM provider (e.g., 'openai', 'anthropic', 'openrouter', 'ollama', 'lmstudio', 'qwen', 'aws', 'azure', 'gemini', 'deepseek', 'groq')"
			),
		model: z.string().nonempty().describe('The specific model name for the selected provider'),
		apiKey: z
			.string()
			.optional()
			.describe(
				'API key for the LLM provider (can also be set via environment variables using $VAR syntax). Not required for Ollama, LM Studio, or AWS (if using IAM roles).'
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
				'Base URL for the LLM provider (e.g., https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:1234/v1). \nSupported for OpenAI, OpenRouter, Ollama, LM Studio, and Qwen providers.'
			),
		qwenOptions: z
			.object({
				enableThinking: z.boolean().optional(),
				thinkingBudget: z.number().int().positive().optional(),
				temperature: z.number().min(0).max(2).optional(),
				top_p: z.number().min(0).max(1).optional(),
			})
			.optional()
			.describe('Qwen-specific options for advanced configuration'),
		aws: AwsConfigSchema.optional().describe('AWS-specific configuration options'),
		azure: AzureConfigSchema.optional().describe('Azure-specific configuration options'),
	})
	.strict()
	.superRefine((data, ctx) => {
		const providerLower = data.provider?.toLowerCase();
		const supportedProvidersList = [
			'openai',
			'anthropic',
			'openrouter',
			'ollama',
			'lmstudio', // Added LM Studio as a supported provider
			'qwen',
			'aws',
			'azure',
			'gemini',
			'deepseek',
			'groq',
		];
		if (!supportedProvidersList.includes(providerLower)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['provider'],
				message: `Provider '${data.provider}' is not supported. Supported: ${supportedProvidersList.join(', ')}`,
			});
		}

		// Provider-specific validation
		if (providerLower === 'aws') {
			// AWS requires aws config object
			if (!data.aws) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['aws'],
					message: 'AWS configuration object is required when using AWS provider',
				});
			}
		} else if (providerLower === 'azure') {
			// Azure requires azure config object with endpoint
			if (!data.azure) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['azure'],
					message: 'Azure configuration object is required when using Azure provider',
				});
			} else if (!data.azure.endpoint) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['azure', 'endpoint'],
					message: 'Azure endpoint is required when using Azure provider',
				});
			}
			// Azure requires API key
			if (!data.apiKey || data.apiKey.trim().length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['apiKey'],
					message: 'API key is required for Azure OpenAI provider',
				});
			}
		} else if (
			providerLower !== 'ollama' &&
			providerLower !== 'aws' &&
			providerLower !== 'lmstudio'
		) {
			// Non-Ollama, non-AWS, non-LMStudio providers require an API key
			if (!data.apiKey || data.apiKey.trim().length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['apiKey'],
					message: `API key is required for provider '${data.provider}'. Only Ollama, LM Studio, and AWS (with IAM roles) don't require an API key.`,
				});
			}
		}
	});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type AwsConfig = z.infer<typeof AwsConfigSchema>;
export type AzureConfig = z.infer<typeof AzureConfigSchema>;
