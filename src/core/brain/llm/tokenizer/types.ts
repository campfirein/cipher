import { z } from 'zod';

export const TokenizerConfigSchema = z.object({
	provider: z.enum(['openai', 'anthropic', 'google', 'default']),
	model: z.string().optional(),
	fallbackToApproximation: z.boolean().default(true),
	hybridTracking: z.boolean().default(true),
});

export type TokenizerConfig = z.infer<typeof TokenizerConfigSchema>;

export interface ProviderTokenLimits {
	maxTokens: number;
	contextWindow: number;
	outputTokens?: number;
}
export interface TokenCount {
	total: number;
	characters: number;
	estimated: boolean;
	provider: string;
	model: string;
}

export interface ITokenizer {
	provider: string;
	model: string;

	countTokens(text: string): Promise<TokenCount>;
	countMessages(messages: Array<{ role: string; content: string }>): Promise<TokenCount>;

	getMaxTokens(): number;
	getContextWindow(): number;

	estimateTokens(text: string): number;
	isWithinLimit(tokenCount: number): boolean;
	getRemainingTokens(currentCount: number): number;
}
