import { ITokenizer, TokenCount, ProviderTokenLimits, TokenizerConfig } from '../types.js';
import { estimateTokensFromText, logTokenCount } from '../utils.js';
import { logger } from '../../../../logger/index.js';

/**
 * Anthropic tokenizer using 4-chars-per-token approximation
 * Supports Claude models including Claude-3 series
 */
export class AnthropicTokenizer implements ITokenizer {
	public readonly provider = 'anthropic';
	public readonly model: string;

	private config: TokenizerConfig;
	private tokenLimits: ProviderTokenLimits;
	private tokencountflag: boolean = false;

	// Calibrated token density for this provider
	private avgTokenDensity = 0.25; // 4 chars per token

	constructor(config: TokenizerConfig) {
		this.config = config;
		this.model = config.model ?? 'claude-default';
		this.tokenLimits = this.getTokenLimitsForModel(config.model || 'claude-3-sonnet');

		logger.debug('Anthropic tokenizer initialized', { model: this.model });
	}

	private getTokenLimitsForModel(model: string): ProviderTokenLimits {
		const limits: Record<string, ProviderTokenLimits> = {
			'claude-3-opus': { maxTokens: 4096, contextWindow: 200000 },
			'claude-3-sonnet': { maxTokens: 4096, contextWindow: 200000 },
			'claude-3-haiku': { maxTokens: 4096, contextWindow: 200000 },
			'claude-3-5-sonnet': { maxTokens: 8192, contextWindow: 200000 },
			'claude-2.1': { maxTokens: 4096, contextWindow: 200000 },
			'claude-2.0': { maxTokens: 4096, contextWindow: 100000 },
			'claude-instant-1.2': { maxTokens: 4096, contextWindow: 100000 },
		};

		return limits[model] || { maxTokens: 4096, contextWindow: 200000 };
	}

	async countTokens(text: string): Promise<TokenCount> {
		if (!text) {
			return {
				total: 0,
				characters: 0,
				estimated: true,
				provider: this.provider,
				model: this.model,
			};
		}

		// Use enhanced approximation for Anthropic models
		const tokenCount = this.estimateTokensWithCalibration(text);

		const count: TokenCount = {
			total: tokenCount,
			characters: text.length,
			estimated: true,
			provider: this.provider,
			model: this.model,
		};
		if (!this.tokencountflag) {
			logTokenCount('anthropic', count);
			this.tokencountflag = true;
		}
		return count;
	}

	async countMessages(messages: Array<{ role: string; content: string }>): Promise<TokenCount> {
		let totalTokens = 0;
		let totalCharacters = 0;

		for (const message of messages) {
			// Add tokens for role and formatting
			const roleText = `${message.role}: `;
			const roleTokens = await this.countTokens(roleText);
			const contentTokens = await this.countTokens(message.content);

			totalTokens += roleTokens.total + contentTokens.total + 2; // 2 tokens for message formatting
			totalCharacters += roleTokens.characters + contentTokens.characters;
		}

		// Add tokens for conversation formatting (Claude uses different formatting)
		totalTokens += 5; // 5 tokens for conversation start/formatting

		return {
			total: totalTokens,
			characters: totalCharacters,
			estimated: true,
			provider: this.provider,
			model: this.model,
		};
	}

	getMaxTokens(): number {
		return this.tokenLimits.maxTokens;
	}

	getContextWindow(): number {
		return this.tokenLimits.contextWindow;
	}

	estimateTokens(text: string): number {
		return this.estimateTokensWithCalibration(text);
	}

	private estimateTokensWithCalibration(text: string): number {
		if (!text) return 0;

		// Enhanced estimation for Claude models
		// Claude tends to be more efficient with natural language
		// but similar to GPT models for code

		const baseEstimate = estimateTokensFromText(text);

		// Adjust for Claude's tokenization characteristics
		let adjustment = 1.0;

		// Natural language tends to be more efficient in Claude
		const codePatterns = /[{}()[\];=><]/g;
		const codeMatches = text.match(codePatterns)?.length || 0;
		const codeRatio = codeMatches / text.length;

		if (codeRatio < 0.01) {
			// Mostly natural language - Claude is slightly more efficient
			adjustment = 0.95;
		} else if (codeRatio > 0.05) {
			// Code-heavy content
			adjustment = 1.05;
		}

		// Apply provider-specific density
		const charBasedEstimate = Math.ceil(text.length * this.avgTokenDensity * adjustment);

		// Return the more conservative estimate
		return Math.max(baseEstimate, charBasedEstimate);
	}

	isWithinLimit(tokenCount: number): boolean {
		return tokenCount <= this.tokenLimits.contextWindow;
	}

	getRemainingTokens(currentCount: number): number {
		return Math.max(0, this.tokenLimits.contextWindow - currentCount);
	}

	/**
	 * Update token density based on actual API responses
	 * This can be called when actual token usage is known from API responses
	 */
	calibrateDensity(text: string, actualTokens: number): void {
		if (text && actualTokens > 0) {
			const actualDensity = actualTokens / text.length;

			// Exponential moving average for calibration
			const alpha = 0.1;
			this.avgTokenDensity = alpha * actualDensity + (1 - alpha) * this.avgTokenDensity;

			logger.debug('Anthropic tokenizer density calibrated', {
				actualDensity,
				newAvgDensity: this.avgTokenDensity,
				textLength: text.length,
				actualTokens,
			});
		}
	}

	/**
	 * Get current calibrated token density
	 */
	getTokenDensity(): number {
		return this.avgTokenDensity;
	}

	/**
	 * Reset density to default
	 */
	resetCalibration(): void {
		this.avgTokenDensity = 0.25; // Reset to default 4 chars per token
	}
}
