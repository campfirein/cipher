import { ITokenizer, TokenCount, ProviderTokenLimits, TokenizerConfig } from '../types.js';
import { estimateTokensFromText, logTokenCount } from '../utils.js';
import { logger } from '../../../../logger/index.js';

/**
 * Default tokenizer for unknown or unsupported providers
 * Uses conservative character-based approximation
 */
export class DefaultTokenizer implements ITokenizer {
	public readonly provider = 'default';
	public readonly model: string;

	private config: TokenizerConfig;
	private tokenLimits: ProviderTokenLimits;
	private tokencountflag: boolean = false;
	// Conservative token density
	private avgTokenDensity = 0.3; // ~3.3 chars per token (conservative)

	constructor(config: TokenizerConfig) {
		this.config = config;
		this.model = config.model ?? 'default-model';
		this.tokenLimits = this.getDefaultTokenLimits();

		logger.debug('Default tokenizer initialized', { model: this.model });
	}

	private getDefaultTokenLimits(): ProviderTokenLimits {
		// Conservative defaults for unknown models
		return {
			maxTokens: 4096,
			contextWindow: 8192,
		};
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

		// Use conservative approximation
		const tokenCount = this.estimateTokensConservatively(text);

		const count: TokenCount = {
			total: tokenCount,
			characters: text.length,
			estimated: true,
			provider: this.provider,
			model: this.model,
		};
		if (!this.tokencountflag) {
			logTokenCount('default', count);
			this.tokencountflag = true;
		}
		return count;
	}

	async countMessages(messages: Array<{ role: string; content: string }>): Promise<TokenCount> {
		let totalTokens = 0;
		let totalCharacters = 0;

		for (const message of messages) {
			// Conservative estimation for role and formatting
			const roleText = `${message.role}: `;
			const roleTokens = await this.countTokens(roleText);
			const contentTokens = await this.countTokens(message.content);

			// Add extra tokens for unknown formatting overhead
			totalTokens += roleTokens.total + contentTokens.total + 5; // 5 tokens for conservative message formatting
			totalCharacters += roleTokens.characters + contentTokens.characters;
		}

		// Add conservative tokens for conversation formatting
		totalTokens += 10; // 10 tokens for conservative conversation formatting

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
		return this.estimateTokensConservatively(text);
	}

	private estimateTokensConservatively(text: string): number {
		if (!text) return 0;

		// Very conservative estimation for unknown models
		const baseEstimate = estimateTokensFromText(text);

		// Apply conservative multiplier to avoid underestimation
		const conservativeMultiplier = 1.25; // 25% safety margin

		// Character-based estimation with conservative density
		const charBasedEstimate = Math.ceil(text.length * this.avgTokenDensity);

		// Return the higher of the two estimates (more conservative)
		const finalEstimate = Math.max(
			Math.ceil(baseEstimate * conservativeMultiplier),
			charBasedEstimate
		);

		return finalEstimate;
	}

	isWithinLimit(tokenCount: number): boolean {
		return tokenCount <= this.tokenLimits.contextWindow;
	}

	getRemainingTokens(currentCount: number): number {
		return Math.max(0, this.tokenLimits.contextWindow - currentCount);
	}

	/**
	 * Update token limits for better model support
	 */
	updateTokenLimits(limits: Partial<ProviderTokenLimits>): void {
		this.tokenLimits = {
			...this.tokenLimits,
			...limits,
		};

		logger.debug('Default tokenizer limits updated', this.tokenLimits);
	}

	/**
	 * Update token density based on observed behavior
	 */
	calibrateDensity(text: string, actualTokens: number): void {
		if (text && actualTokens > 0) {
			const actualDensity = actualTokens / text.length;

			// More conservative calibration for unknown models
			const alpha = 0.05; // Slower adaptation
			this.avgTokenDensity = alpha * actualDensity + (1 - alpha) * this.avgTokenDensity;

			// Ensure we don't go below a minimum conservative density
			this.avgTokenDensity = Math.max(this.avgTokenDensity, 0.2); // At least 5 chars per token

			logger.debug('Default tokenizer density calibrated', {
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
		this.avgTokenDensity = 0.3; // Reset to conservative default
	}

	/**
	 * Set model-specific limits if known
	 */
	setModelLimits(model: string, limits: ProviderTokenLimits): void {
		this.tokenLimits = limits;
		logger.debug('Default tokenizer configured for specific model', { model, limits });
	}
}
