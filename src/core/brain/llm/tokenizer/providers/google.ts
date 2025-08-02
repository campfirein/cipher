import { ITokenizer, TokenCount, ProviderTokenLimits, TokenizerConfig } from '../types.js';
import { estimateTokensFromText, logTokenCount } from '../utils.js';
import { logger } from '../../../../logger/index.js';

/**
 * Google (Gemini) tokenizer using 4-chars-per-token approximation
 * Supports Gemini models including Gemini Pro and Ultra
 */
export class GoogleTokenizer implements ITokenizer {
	public readonly provider = 'google';
	public readonly model: string;

	private config: TokenizerConfig;
	private tokenLimits: ProviderTokenLimits;
	private tokencountflag: boolean = false;
	// Calibrated token density for Google models
	private avgTokenDensity = 0.28; // Slightly higher than other providers

	constructor(config: TokenizerConfig) {
		this.config = config;
		this.model = config.model ?? 'gemini-default';
		this.tokenLimits = this.getTokenLimitsForModel(config.model || 'gemini-pro');

		logger.debug('Google tokenizer initialized', { model: this.model });
	}

	private getTokenLimitsForModel(model: string): ProviderTokenLimits {
		const limits: Record<string, ProviderTokenLimits> = {
			'gemini-pro': { maxTokens: 8192, contextWindow: 32760 },
			'gemini-pro-vision': { maxTokens: 4096, contextWindow: 16384 },
			'gemini-ultra': { maxTokens: 8192, contextWindow: 32760 },
			'gemini-1.5-pro': { maxTokens: 8192, contextWindow: 1000000 }, // 1M token context
			'gemini-1.5-flash': { maxTokens: 8192, contextWindow: 1000000 },
		};

		return limits[model] || { maxTokens: 8192, contextWindow: 32760 };
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

		// Use enhanced approximation for Google models
		const tokenCount = this.estimateTokensWithCalibration(text);

		const count: TokenCount = {
			total: tokenCount,
			characters: text.length,
			estimated: true,
			provider: this.provider,
			model: this.model,
		};
		if (!this.tokencountflag) {
			logTokenCount('google', count);
			this.tokencountflag = true;
		}
		return count;
	}

	async countMessages(messages: Array<{ role: string; content: string }>): Promise<TokenCount> {
		let totalTokens = 0;
		let totalCharacters = 0;

		for (const message of messages) {
			// Google uses different role formatting
			const roleMapping = this.mapRoleForGoogle(message.role);
			const roleText = `${roleMapping}: `;

			const roleTokens = await this.countTokens(roleText);
			const contentTokens = await this.countTokens(message.content);

			totalTokens += roleTokens.total + contentTokens.total + 3; // 3 tokens for message formatting
			totalCharacters += roleTokens.characters + contentTokens.characters;
		}

		// Add tokens for conversation formatting
		totalTokens += 4; // 4 tokens for conversation start/formatting

		return {
			total: totalTokens,
			characters: totalCharacters,
			estimated: true,
			provider: this.provider,
			model: this.model,
		};
	}

	private mapRoleForGoogle(role: string): string {
		// Google uses different role names
		const roleMap: Record<string, string> = {
			user: 'user',
			assistant: 'model',
			system: 'user', // Google doesn't have explicit system role
			tool: 'function',
		};

		return roleMap[role] || role;
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

		// Enhanced estimation for Gemini models
		// Gemini tends to be slightly less efficient than GPT models
		// but handles multilingual content well

		const baseEstimate = estimateTokensFromText(text);

		// Adjust for Gemini's tokenization characteristics
		let adjustment = 1.1; // Gemini tends to use slightly more tokens

		// Check for non-English content (Gemini handles this well)
		// const nonAsciiCount = Array.from(text).filter(c => c.charCodeAt(0) > 127).length;
		// const nonAsciiRatio = nonAsciiCount / text.length;

		// Check for structured content (JSON, XML, etc.)
		const structuredPatterns = /[{}"':,\]<>]/g;
		const structuredMatches = text.match(structuredPatterns)?.length || 0;
		const structuredRatio = structuredMatches / text.length;

		if (structuredRatio > 0.1) {
			// Structured content - Gemini uses more tokens
			adjustment = 1.15;
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
	 */
	calibrateDensity(text: string, actualTokens: number): void {
		if (text && actualTokens > 0) {
			const actualDensity = actualTokens / text.length;

			// Exponential moving average for calibration
			const alpha = 0.1;
			this.avgTokenDensity = alpha * actualDensity + (1 - alpha) * this.avgTokenDensity;

			logger.debug('Google tokenizer density calibrated', {
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
		this.avgTokenDensity = 0.28; // Reset to default for Google models
	}

	/**
	 * Check if model supports very large context windows
	 */
	isLargeContextModel(): boolean {
		return this.model?.includes('1.5') || false;
	}
}
