/**
 * Embedding Configuration Schema and Utilities
 *
 * This module provides Zod schemas for validating embedding configurations
 * and utilities for parsing configurations from environment variables.
 */

import { z } from 'zod';

/**
 * OpenAI embedding configuration schema
 */
export const OpenAIEmbeddingConfigSchema = z.object({
	type: z.literal('openai'),
	apiKey: z.string().optional(),
	model: z
		.enum(['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'])
		.default('text-embedding-3-small'),
	baseUrl: z.string().optional(),
	organization: z.string().optional(),
	dimensions: z.number().optional(),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * Gemini embedding configuration schema
 */
export const GeminiEmbeddingConfigSchema = z.object({
	type: z.literal('gemini'),
	apiKey: z.string().optional(),
	model: z.enum(['gemini-embedding-001', 'text-embedding-004']).default('gemini-embedding-001'),
	baseUrl: z.string().optional(),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * Ollama embedding configuration schema
 */
export const OllamaEmbeddingConfigSchema = z.object({
	type: z.literal('ollama'),
	baseUrl: z.string().default('http://localhost:11434'),
	model: z.string().default('nomic-embed-text'),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * Voyage embedding configuration schema (for Claude/Anthropic fallback)
 */
export const VoyageEmbeddingConfigSchema = z.object({
	type: z.literal('voyage'),
	apiKey: z.string().optional(),
	model: z.enum(['voyage-3-large', 'voyage-3', 'voyage-2']).default('voyage-3-large'),
	baseUrl: z.string().optional(),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * Qwen embedding configuration schema
 */
export const QwenEmbeddingConfigSchema = z.object({
	type: z.literal('qwen'),
	apiKey: z.string().optional(),
	model: z.enum(['text-embedding-v3']).default('text-embedding-v3'),
	baseUrl: z.string().optional(),
	dimensions: z
		.number()
		.refine(val => [1024, 768, 512].includes(val))
		.default(1024),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * AWS Bedrock embedding configuration schema
 */
export const AWSBedrockEmbeddingConfigSchema = z.object({
	type: z.literal('aws-bedrock'),
	model: z
		.enum(['amazon.titan-embed-text-v2:0', 'cohere.embed-english-v3'])
		.default('amazon.titan-embed-text-v2:0'),
	region: z.string().optional(),
	accessKeyId: z.string().optional(),
	secretAccessKey: z.string().optional(),
	sessionToken: z.string().optional(),
	dimensions: z
		.number()
		.refine(val => [1024, 512, 256].includes(val))
		.default(1024),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * LM Studio embedding configuration schema
 */
export const LMStudioEmbeddingConfigSchema = z.object({
	type: z.literal('lmstudio'),
	baseUrl: z.string().default('http://localhost:1234/v1'),
	model: z.string().default('nomic-embed-text-v1.5'),
	dimensions: z.number().optional(),
	timeout: z.number().default(30000),
	maxRetries: z.number().default(3),
});

/**
 * Main embedding configuration schema
 */
export const EmbeddingConfigSchema = z.union([
	OpenAIEmbeddingConfigSchema,
	GeminiEmbeddingConfigSchema,
	OllamaEmbeddingConfigSchema,
	VoyageEmbeddingConfigSchema,
	QwenEmbeddingConfigSchema,
	AWSBedrockEmbeddingConfigSchema,
	LMStudioEmbeddingConfigSchema,
]);

/**
 * Environment configuration type
 */
export interface EmbeddingEnvConfig {
	type: string;
	apiKey?: string | undefined;
	baseUrl?: string | undefined;
	model?: string | undefined;
	region?: string | undefined;
	accessKeyId?: string | undefined;
	secretAccessKey?: string | undefined;
	sessionToken?: string | undefined;
}

/**
 * Parse embedding configuration from environment variables
 */
export function parseEmbeddingConfigFromEnv(): EmbeddingEnvConfig | null {
	// Priority order: OpenAI > Gemini > Ollama
	if (process.env.OPENAI_API_KEY) {
		return {
			type: 'openai',
			apiKey: process.env.OPENAI_API_KEY,
			baseUrl: process.env.OPENAI_BASE_URL,
			model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
		};
	}

	if (process.env.GEMINI_API_KEY) {
		return {
			type: 'gemini',
			apiKey: process.env.GEMINI_API_KEY,
			baseUrl: process.env.GEMINI_BASE_URL,
			model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
		};
	}

	if (process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY) {
		return {
			type: 'qwen',
			apiKey: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY,
			baseUrl: process.env.QWEN_BASE_URL,
			model: process.env.QWEN_EMBEDDING_MODEL || 'text-embedding-v3',
		};
	}

	if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
		return {
			type: 'aws-bedrock',
			region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
			accessKeyId: process.env.AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
			sessionToken: process.env.AWS_SESSION_TOKEN,
			model: process.env.AWS_BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
		};
	}

	if (process.env.OLLAMA_BASE_URL) {
		return {
			type: 'ollama',
			baseUrl: process.env.OLLAMA_BASE_URL,
			model: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
		};
	}

	if (process.env.LMSTUDIO_BASE_URL) {
		return {
			type: 'lmstudio',
			baseUrl: process.env.LMSTUDIO_BASE_URL,
			model: process.env.LMSTUDIO_EMBEDDING_MODEL || 'nomic-embed-text-v1.5',
		};
	}

	return null;
}

/**
 * Parse and validate embedding configuration
 */
export function parseEmbeddingConfig(config: unknown): z.infer<typeof EmbeddingConfigSchema> {
	return EmbeddingConfigSchema.parse(config);
}

/**
 * Validate embedding configuration
 */
export function validateEmbeddingConfig(config: unknown): boolean {
	try {
		EmbeddingConfigSchema.parse(config);
		return true;
	} catch {
		return false;
	}
}

// Export types
export type OpenAIEmbeddingConfig = z.infer<typeof OpenAIEmbeddingConfigSchema>;
export type GeminiEmbeddingConfig = z.infer<typeof GeminiEmbeddingConfigSchema>;
export type OllamaEmbeddingConfig = z.infer<typeof OllamaEmbeddingConfigSchema>;
export type VoyageEmbeddingConfig = z.infer<typeof VoyageEmbeddingConfigSchema>;
export type QwenEmbeddingConfig = z.infer<typeof QwenEmbeddingConfigSchema>;
export type AWSBedrockEmbeddingConfig = z.infer<typeof AWSBedrockEmbeddingConfigSchema>;
export type LMStudioEmbeddingConfig = z.infer<typeof LMStudioEmbeddingConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
