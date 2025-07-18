/**
 * Content Analyzer
 *
 * LLM-based content analysis for memory notes using cipher's LLM services
 */

import type { ILLMService } from '../brain/llm/services/types.js';
import type { ContentAnalysis } from './types.js';
import { MemoryAnalysisError } from './types.js';
import { SYSTEM_PROMPTS, ERROR_MESSAGES, LOG_PREFIXES } from './constants.js';
import { getPerformanceConfig } from './config.js';
import { createLogger } from '../logger/index.js';
import { env } from '../env.js';

/**
 * Content analyzer for extracting metadata from memory content
 */
export class ContentAnalyzer {
	private readonly logger = createLogger({ level: env.CIPHER_LOG_LEVEL });
	private readonly performanceConfig = getPerformanceConfig();

	constructor(private readonly llmService: ILLMService) {}

	/**
	 * Analyze content to extract keywords, context, and tags
	 */
	async analyzeContent(content: string): Promise<ContentAnalysis> {
		this.logger.debug(`${LOG_PREFIXES.CONTENT_ANALYZER} Analyzing content`, {
			contentLength: content.length,
			contentPreview: content.substring(0, 100),
		});

		try {
			const prompt = `${SYSTEM_PROMPTS.CONTENT_ANALYSIS}\n\n${content}`;

			const response = await this.callLLMWithRetry(prompt);
			const analysis = this.parseAnalysisResponse(response);

			this.logger.debug(`${LOG_PREFIXES.CONTENT_ANALYZER} Content analysis completed`, {
				keywordCount: analysis.keywords.length,
				tagCount: analysis.tags.length,
				context: analysis.context,
			});

			return analysis;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.CONTENT_ANALYZER} Content analysis failed`, {
				error: error instanceof Error ? error.message : String(error),
				contentLength: content.length,
			});

			throw new MemoryAnalysisError(ERROR_MESSAGES.CONTENT_ANALYSIS_FAILED, content, error);
		}
	}

	/**
	 * Analyze multiple contents in batch
	 */
	async analyzeContentBatch(contents: string[]): Promise<ContentAnalysis[]> {
		this.logger.debug(`${LOG_PREFIXES.CONTENT_ANALYZER} Analyzing content batch`, {
			batchSize: contents.length,
		});

		const results: ContentAnalysis[] = [];
		const batchSize = this.performanceConfig.batchSize;

		for (let i = 0; i < contents.length; i += batchSize) {
			const batch = contents.slice(i, i + batchSize);
			const batchPromises = batch.map(content => this.analyzeContent(content));

			try {
				const batchResults = await Promise.all(batchPromises);
				results.push(...batchResults);
			} catch (error) {
				this.logger.error(`${LOG_PREFIXES.CONTENT_ANALYZER} Batch analysis failed`, {
					batchStart: i,
					batchSize: batch.length,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		}

		this.logger.debug(`${LOG_PREFIXES.CONTENT_ANALYZER} Batch analysis completed`, {
			totalProcessed: results.length,
		});

		return results;
	}

	/**
	 * Extract keywords from content using LLM
	 */
	async extractKeywords(content: string): Promise<string[]> {
		const analysis = await this.analyzeContent(content);
		return analysis.keywords;
	}

	/**
	 * Extract context from content using LLM
	 */
	async extractContext(content: string): Promise<string> {
		const analysis = await this.analyzeContent(content);
		return analysis.context;
	}

	/**
	 * Extract tags from content using LLM
	 */
	async extractTags(content: string): Promise<string[]> {
		const analysis = await this.analyzeContent(content);
		return analysis.tags;
	}

	/**
	 * Validate if content is suitable for memory storage
	 */
	validateContent(content: string): boolean {
		if (!content || typeof content !== 'string') {
			return false;
		}

		// Check minimum length
		if (content.trim().length < 10) {
			return false;
		}

		// Check if content is too repetitive
		const words = content.toLowerCase().split(/\s+/);
		const uniqueWords = new Set(words);
		if (uniqueWords.size < words.length * 0.3) {
			return false;
		}

		return true;
	}

	/**
	 * Calculate content complexity score
	 */
	calculateComplexity(content: string): number {
		const words = content.split(/\s+/);
		const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
		const uniqueWords = new Set(words.map(w => w.toLowerCase()));

		// Basic complexity metrics
		const avgWordsPerSentence = words.length / sentences.length;
		const vocabularyRichness = uniqueWords.size / words.length;
		const lengthFactor = Math.min(content.length / 1000, 1);

		return avgWordsPerSentence * 0.3 + vocabularyRichness * 0.4 + lengthFactor * 0.3;
	}

	/**
	 * Call LLM with retry logic
	 */
	private async callLLMWithRetry(prompt: string): Promise<string> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= this.performanceConfig.maxRetries; attempt++) {
			try {
				const systemPrompt =
					'You are a helpful assistant that analyzes content and responds with valid JSON.';
				const response = await Promise.race([
					this.llmService.directGenerate(prompt, systemPrompt),
					this.createTimeout(),
				]);

				if (typeof response === 'string' && response === 'TIMEOUT') {
					throw new Error('LLM request timed out');
				}

				return response;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt < this.performanceConfig.maxRetries) {
					this.logger.warn(`${LOG_PREFIXES.CONTENT_ANALYZER} LLM call failed, retrying`, {
						attempt,
						error: lastError.message,
					});

					await this.delay(this.performanceConfig.maxRetries * attempt);
				}
			}
		}

		throw lastError || new Error('LLM call failed after all retries');
	}

	/**
	 * Parse LLM response for content analysis
	 */
	private parseAnalysisResponse(response: string): ContentAnalysis {
		try {
			const parsed = JSON.parse(response);

			// Validate response structure
			if (!parsed.keywords || !Array.isArray(parsed.keywords)) {
				throw new Error('Invalid keywords in response');
			}

			if (!parsed.context || typeof parsed.context !== 'string') {
				throw new Error('Invalid context in response');
			}

			if (!parsed.tags || !Array.isArray(parsed.tags)) {
				throw new Error('Invalid tags in response');
			}

			return {
				keywords: parsed.keywords.filter((k: any) => typeof k === 'string'),
				context: parsed.context,
				tags: parsed.tags.filter((t: any) => typeof t === 'string'),
			};
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.CONTENT_ANALYZER} Failed to parse analysis response`, {
				response,
				error: error instanceof Error ? error.message : String(error),
			});

			// Return fallback analysis
			return {
				keywords: [],
				context: 'General',
				tags: [],
			};
		}
	}

	/**
	 * Create timeout promise
	 */
	private createTimeout(): Promise<string> {
		return new Promise(resolve => {
			setTimeout(() => {
				resolve('TIMEOUT');
			}, this.performanceConfig.llmTimeout);
		});
	}

	/**
	 * Delay for retry logic
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
