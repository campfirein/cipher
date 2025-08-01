import { ITokenizer, TokenCount, ProviderTokenLimits, TokenizerConfig } from '../types.js';
import { estimateTokensFromText, createFallbackTokenCount, logTokenCount } from '../utils.js';
import { logger } from '../../../../logger/index.js';

/**
 * OpenAI tokenizer using tiktoken for accurate token counting
 * Supports GPT models including GPT-3.5, GPT-4, and o1 series
 */
export class OpenAITokenizer implements ITokenizer {
	public readonly provider = 'openai';
	public readonly model: string;

	private config: TokenizerConfig;
	private tokenLimits: ProviderTokenLimits;
	private tiktoken: any = null;
	private encoding: any = null;
	private tiktokencountflag: boolean = false;
	private approximationcountflag: boolean = false;

	// Token density calibration for hybrid tracking
	private densityHistory: number[] = [];
	private maxHistorySize = 100;

	constructor(config: TokenizerConfig) {
		this.config = config;
		this.model = config.model ?? 'gpt-3.5-turbo';
		this.tokenLimits = this.getTokenLimitsForModel(config.model || 'gpt-3.5-turbo');

		// Initialize tiktoken if available
		this.initializeTiktoken();
	}

	private async initializeTiktoken(): Promise<void> {
		try {
			// Use dynamic import instead of eval to avoid bundler warnings
			const tiktokenModule = await import('tiktoken').catch(() => null);

			if (!tiktokenModule) {
				logger.warn('tiktoken not available, using approximation');
				return;
			}

			this.tiktoken = tiktokenModule;

			const modelName = this.model || 'gpt-3.5-turbo';

			// Get encoding for the specific model
			try {
				if (this.isO1Model(modelName)) {
					// o1 models use o200k_base encoding
					this.encoding = this.tiktoken.encoding_for_model('gpt-4o');
				} else if (this.isQwenModel(modelName)) {
					// Qwen models use cl100k_base encoding (same as GPT-4)
					this.encoding = this.tiktoken.encoding_for_model('gpt-4');
				} else {
					this.encoding = this.tiktoken.encoding_for_model(modelName);
				}
			} catch (encodingError) {
				// If the specific model encoding fails, try with a fallback
				logger.debug('Failed to get encoding for specific model, trying fallback', {
					model: modelName,
					error: (encodingError as Error).message,
				});

				// Use gpt-4 encoding as fallback for most models
				this.encoding = this.tiktoken.encoding_for_model('gpt-4');
			}

			logger.debug('OpenAI tokenizer initialized with tiktoken', { model: modelName });
		} catch (error) {
			logger.warn('Failed to initialize tiktoken, falling back to approximation', {
				error: (error as Error).message,
			});
			this.tiktoken = null;
			this.encoding = null;
		}
	}

	private isO1Model(model: string): boolean {
		return model.startsWith('o1-');
	}

	private isQwenModel(model: string): boolean {
		return model.startsWith('qwen') || model.includes('qwen');
	}

	private getTokenLimitsForModel(model: string): ProviderTokenLimits {
		const limits: Record<string, ProviderTokenLimits> = {
			'gpt-3.5-turbo': { maxTokens: 4096, contextWindow: 16385 },
			'gpt-3.5-turbo-16k': { maxTokens: 4096, contextWindow: 16385 },
			'gpt-4': { maxTokens: 4096, contextWindow: 8192 },
			'gpt-4-32k': { maxTokens: 4096, contextWindow: 32768 },
			'gpt-4-turbo': { maxTokens: 4096, contextWindow: 128000 },
			'gpt-4o': { maxTokens: 4096, contextWindow: 128000 },
			'gpt-4o-mini': { maxTokens: 16384, contextWindow: 128000 },
			'o1-preview': { maxTokens: 32768, contextWindow: 128000 },
			'o1-mini': { maxTokens: 65536, contextWindow: 128000 },
		};

		return limits[model] || { maxTokens: 4096, contextWindow: 8192 };
	}

	async countTokens(text: string): Promise<TokenCount> {
		if (!text) {
			return {
				total: 0,
				characters: 0,
				estimated: false,
				provider: this.provider,
				model: this.model,
			};
		}

		try {
			if (this.encoding) {
				// Use tiktoken for accurate counting
				const tokens = this.encoding.encode(text);
				const count: TokenCount = {
					total: tokens.length,
					characters: text.length,
					estimated: false,
					provider: this.provider,
					model: this.model,
				};

				// Update density history for hybrid tracking
				if (this.config.hybridTracking) {
					this.updateDensityHistory(text.length, tokens.length);
				}
				if (!this.tiktokencountflag) {
					logTokenCount('tiktoken count', count);
					this.tiktokencountflag = true;
				}
				return count;
			} else {
				// Fallback to approximation
				const estimated = this.estimateTokens(text);
				const count = createFallbackTokenCount(text, this.provider, this.model);
				count.total = estimated;
				if (!this.approximationcountflag) {
					logTokenCount('openai approximation', count);
					this.approximationcountflag = true;
				}
				return count;
			}
		} catch (error) {
			logger.warn('Error in OpenAI token counting, falling back to approximation', {
				error: (error as Error).message,
			});

			const estimated = this.estimateTokens(text);
			const count = createFallbackTokenCount(text, this.provider, this.model);
			count.total = estimated;

			return count;
		}
	}

	async countMessages(messages: Array<{ role: string; content: string }>): Promise<TokenCount> {
		let totalTokens = 0;
		let totalCharacters = 0;
		let isEstimated = false;

		for (const message of messages) {
			// Add tokens for role and formatting
			const roleTokens = await this.countTokens(`${message.role}: `);
			const contentTokens = await this.countTokens(message.content);

			totalTokens += roleTokens.total + contentTokens.total + 3; // 3 tokens for message formatting
			totalCharacters += roleTokens.characters + contentTokens.characters;

			if (roleTokens.estimated || contentTokens.estimated) {
				isEstimated = true;
			}
		}

		// Add tokens for conversation formatting
		totalTokens += 3; // 3 tokens for conversation start

		return {
			total: totalTokens,
			characters: totalCharacters,
			estimated: isEstimated,
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
		if (this.config.hybridTracking && this.densityHistory.length > 0) {
			// Use calibrated density from previous actual counts
			const avgDensity =
				this.densityHistory.reduce((a, b) => a + b, 0) / this.densityHistory.length;
			return Math.ceil(text.length * avgDensity);
		}

		return estimateTokensFromText(text);
	}

	isWithinLimit(tokenCount: number): boolean {
		return tokenCount <= this.tokenLimits.contextWindow;
	}

	getRemainingTokens(currentCount: number): number {
		return Math.max(0, this.tokenLimits.contextWindow - currentCount);
	}

	private updateDensityHistory(characters: number, tokens: number): void {
		if (characters > 0 && tokens > 0) {
			const density = tokens / characters;
			this.densityHistory.push(density);

			// Keep only recent history
			if (this.densityHistory.length > this.maxHistorySize) {
				this.densityHistory.shift();
			}
		}
	}

	/**
	 * Get current calibrated token density
	 */
	getTokenDensity(): number {
		if (this.densityHistory.length === 0) {
			return 0.25; // Default for OpenAI models
		}

		return this.densityHistory.reduce((a, b) => a + b, 0) / this.densityHistory.length;
	}

	/**
	 * Reset density calibration
	 */
	resetCalibration(): void {
		this.densityHistory = [];
	}
}
