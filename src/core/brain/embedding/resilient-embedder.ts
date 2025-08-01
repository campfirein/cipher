/**
 * Resilient Embedder Wrapper
 *
 * Provides fault-tolerant embedding operations with automatic fallback,
 * circuit breaker protection, and graceful degradation.
 */

import { logger } from '../../logger/index.js';
import { LOG_PREFIXES } from './constants.js';
import { EmbeddingCircuitBreaker, CircuitState } from './circuit-breaker.js';
import type { Embedder, EmbeddingConfig } from './backend/types.js';
import {
	EmbeddingError,
	EmbeddingConnectionError,
	EmbeddingValidationError,
} from './backend/types.js';

export interface ResilientEmbedderConfig {
	/** Enable circuit breaker protection */
	enableCircuitBreaker: boolean;
	/** Enable automatic fallback to disabled state */
	enableFallback: boolean;
	/** Health check interval in milliseconds */
	healthCheckInterval: number;
	/** Maximum consecutive failures before disabling */
	maxConsecutiveFailures: number;
	/** Recovery attempt interval in milliseconds */
	recoveryInterval: number;
}

export interface EmbeddingOperationResult<T> {
	success: boolean;
	data?: T;
	error?: Error;
	fallbackActivated: boolean;
	circuitOpen: boolean;
}

export enum EmbeddingStatus {
	HEALTHY = 'HEALTHY',
	DEGRADED = 'DEGRADED',
	DISABLED = 'DISABLED',
	RECOVERING = 'RECOVERING',
}

/**
 * Resilient wrapper for embedding operations
 */
export class ResilientEmbedder implements Embedder {
	private readonly embedder: Embedder;
	private readonly circuitBreaker: EmbeddingCircuitBreaker;
	private readonly config: ResilientEmbedderConfig;
	private readonly providerName: string;

	private status: EmbeddingStatus = EmbeddingStatus.HEALTHY;
	private consecutiveFailures = 0;
	private lastHealthCheck: number = 0;
	private lastRecoveryAttempt: number = 0;
	private isTemporarilyDisabled = false;

	private healthCheckTimer: NodeJS.Timeout | null = null;

	constructor(
		embedder: Embedder,
		providerName: string,
		config: Partial<ResilientEmbedderConfig> = {}
	) {
		this.embedder = embedder;
		this.providerName = providerName;
		this.config = {
			enableCircuitBreaker: config.enableCircuitBreaker ?? true,
			enableFallback: config.enableFallback ?? true,
			healthCheckInterval: config.healthCheckInterval ?? 300000, // 5 minutes
			maxConsecutiveFailures: config.maxConsecutiveFailures ?? 5,
			recoveryInterval: config.recoveryInterval ?? 60000, // 1 minute
		};

		// Initialize circuit breaker
		this.circuitBreaker = new EmbeddingCircuitBreaker(`${providerName}-embedder`, {
			failureThreshold: this.config.maxConsecutiveFailures,
			recoveryTimeout: this.config.recoveryInterval,
			successThreshold: 3,
			timeWindow: 300000, // 5 minutes
		});

		// Start health checking if enabled
		if (this.config.enableCircuitBreaker) {
			this.startHealthChecking();
		}

		logger.debug(`${LOG_PREFIXES.FALLBACK} Resilient embedder initialized`, {
			provider: this.providerName,
			config: this.config,
		});
	}

	async embed(text: string): Promise<number[]> {
		const result = await this.executeWithFallback(() => this.embedder.embed(text));

		if (!result.success) {
			if (result.fallbackActivated) {
				throw new Error(
					`Embedding temporarily unavailable for ${this.providerName} - operating in chat-only mode`
				);
			}
			throw result.error || new Error('Embedding operation failed');
		}

		return result.data!;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const result = await this.executeWithFallback(() => this.embedder.embedBatch(texts));

		if (!result.success) {
			if (result.fallbackActivated) {
				throw new Error(
					`Batch embedding temporarily unavailable for ${this.providerName} - operating in chat-only mode`
				);
			}
			throw result.error || new Error('Batch embedding operation failed');
		}

		return result.data!;
	}

	async isHealthy(): Promise<boolean> {
		// If temporarily disabled, always return false
		if (this.isTemporarilyDisabled) {
			return false;
		}

		try {
			// Use circuit breaker to check health
			if (this.config.enableCircuitBreaker && !this.circuitBreaker.isOperationAllowed()) {
				return false;
			}

			return await this.embedder.isHealthy();
		} catch (error) {
			logger.debug(`${LOG_PREFIXES.FALLBACK} Health check failed for ${this.providerName}`, {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}

	getDimension(): number {
		return this.embedder.getDimension();
	}

	getConfig(): EmbeddingConfig {
		return this.embedder.getConfig();
	}

	async disconnect(): Promise<void> {
		// Stop health checking
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = null;
		}

		// Disconnect underlying embedder
		await this.embedder.disconnect();

		logger.debug(`${LOG_PREFIXES.FALLBACK} Resilient embedder disconnected`, {
			provider: this.providerName,
		});
	}

	/**
	 * Get current embedding status
	 */
	getStatus(): EmbeddingStatus {
		return this.status;
	}

	/**
	 * Get detailed statistics
	 */
	getStats() {
		return {
			status: this.status,
			consecutiveFailures: this.consecutiveFailures,
			isTemporarilyDisabled: this.isTemporarilyDisabled,
			lastHealthCheck: this.lastHealthCheck,
			lastRecoveryAttempt: this.lastRecoveryAttempt,
			circuitBreakerStats: this.circuitBreaker.getStats(),
		};
	}

	/**
	 * Force disable embeddings
	 */
	forceDisable(): void {
		this.isTemporarilyDisabled = true;
		this.status = EmbeddingStatus.DISABLED;
		this.circuitBreaker.forceOpen();

		logger.warn(`${LOG_PREFIXES.FALLBACK} Embeddings force-disabled for ${this.providerName}`);
	}

	/**
	 * Reset to healthy state
	 */
	reset(): void {
		this.isTemporarilyDisabled = false;
		this.consecutiveFailures = 0;
		this.status = EmbeddingStatus.HEALTHY;
		this.circuitBreaker.reset();

		logger.info(
			`${LOG_PREFIXES.FALLBACK} Embeddings reset to healthy state for ${this.providerName}`
		);
	}

	/**
	 * Execute operation with fallback protection
	 */
	private async executeWithFallback<T>(
		operation: () => Promise<T>
	): Promise<EmbeddingOperationResult<T>> {
		// Check if temporarily disabled
		if (this.isTemporarilyDisabled) {
			return {
				success: false,
				fallbackActivated: true,
				circuitOpen: false,
				error: new Error(`Embeddings temporarily disabled for ${this.providerName}`),
			};
		}

		// Check circuit breaker
		if (this.config.enableCircuitBreaker) {
			const circuitStats = this.circuitBreaker.getStats();
			if (circuitStats.state === CircuitState.OPEN) {
				return {
					success: false,
					fallbackActivated: true,
					circuitOpen: true,
					error: new Error(`Circuit breaker OPEN for ${this.providerName}`),
				};
			}
		}

		try {
			let result: T;

			if (this.config.enableCircuitBreaker) {
				// Execute with circuit breaker protection
				result = await this.circuitBreaker.execute(operation);
			} else {
				// Execute directly
				result = await operation();
			}

			// Operation succeeded
			this.onOperationSuccess();

			return {
				success: true,
				data: result,
				fallbackActivated: false,
				circuitOpen: false,
			};
		} catch (error) {
			// Operation failed
			const shouldFallback = this.onOperationFailure(error);

			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
				fallbackActivated: shouldFallback,
				circuitOpen: this.circuitBreaker.getStats().state === CircuitState.OPEN,
			};
		}
	}

	/**
	 * Handle successful operation
	 */
	private onOperationSuccess(): void {
		// Reset failure count
		if (this.consecutiveFailures > 0) {
			logger.info(`${LOG_PREFIXES.FALLBACK} ${this.providerName} embeddings recovered`, {
				previousFailures: this.consecutiveFailures,
			});
		}

		this.consecutiveFailures = 0;

		// Update status based on current state
		if (this.status === EmbeddingStatus.RECOVERING) {
			this.status = EmbeddingStatus.HEALTHY;
			logger.info(`${LOG_PREFIXES.FALLBACK} ${this.providerName} embeddings fully recovered`);
		} else if (this.status === EmbeddingStatus.DISABLED) {
			this.status = EmbeddingStatus.RECOVERING;
			logger.info(`${LOG_PREFIXES.FALLBACK} ${this.providerName} embeddings started recovery`);
		}
	}

	/**
	 * Handle failed operation
	 */
	private onOperationFailure(error: any): boolean {
		this.consecutiveFailures++;

		const errorMessage = error instanceof Error ? error.message : String(error);
		const errorType = this.classifyError(error);

		logger.warn(`${LOG_PREFIXES.FALLBACK} ${this.providerName} embedding operation failed`, {
			error: errorMessage,
			errorType,
			consecutiveFailures: this.consecutiveFailures,
			maxFailures: this.config.maxConsecutiveFailures,
		});

		// Check if we should activate fallback
		if (
			this.config.enableFallback &&
			this.consecutiveFailures >= this.config.maxConsecutiveFailures
		) {
			this.isTemporarilyDisabled = true;
			this.status = EmbeddingStatus.DISABLED;

			logger.error(
				`${LOG_PREFIXES.FALLBACK} ${this.providerName} embeddings disabled after ${this.consecutiveFailures} consecutive failures - switching to chat-only mode`
			);

			return true; // Fallback activated
		}

		// Update status to degraded if not yet disabled
		if (this.status === EmbeddingStatus.HEALTHY) {
			this.status = EmbeddingStatus.DEGRADED;
		}

		return false; // No fallback yet
	}

	/**
	 * Classify error type for better handling
	 */
	private classifyError(error: any): string {
		if (error instanceof EmbeddingValidationError) {
			return 'validation';
		}
		if (error instanceof EmbeddingConnectionError) {
			return 'connection';
		}
		if (error instanceof EmbeddingError) {
			return 'embedding';
		}

		const message =
			error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

		if (message.includes('timeout') || message.includes('timed out')) {
			return 'timeout';
		}
		if (message.includes('rate limit') || message.includes('429')) {
			return 'rate_limit';
		}
		if (message.includes('quota') || message.includes('exceeded')) {
			return 'quota';
		}
		if (message.includes('unauthorized') || message.includes('401')) {
			return 'auth';
		}
		if (message.includes('network') || message.includes('connection')) {
			return 'network';
		}

		return 'unknown';
	}

	/**
	 * Start periodic health checking
	 */
	private startHealthChecking(): void {
		if (this.healthCheckTimer) {
			return; // Already started
		}

		this.healthCheckTimer = setInterval(async () => {
			await this.performHealthCheck();
		}, this.config.healthCheckInterval);

		logger.debug(`${LOG_PREFIXES.FALLBACK} Health checking started for ${this.providerName}`, {
			interval: this.config.healthCheckInterval,
		});
	}

	/**
	 * Perform health check and attempt recovery if needed
	 */
	private async performHealthCheck(): Promise<void> {
		this.lastHealthCheck = Date.now();

		try {
			// Only attempt recovery if we're in a failed state
			if (this.status === EmbeddingStatus.DISABLED) {
				// Check if enough time has passed since last recovery attempt
				const timeSinceLastAttempt = Date.now() - this.lastRecoveryAttempt;
				if (timeSinceLastAttempt < this.config.recoveryInterval) {
					return; // Too soon to retry
				}

				this.lastRecoveryAttempt = Date.now();

				logger.debug(`${LOG_PREFIXES.FALLBACK} Attempting recovery for ${this.providerName}`);

				// Try a simple health check
				const isHealthy = await this.embedder.isHealthy();

				if (isHealthy) {
					// Service appears to be back online
					this.isTemporarilyDisabled = false;
					this.consecutiveFailures = 0;
					this.status = EmbeddingStatus.RECOVERING;
					this.circuitBreaker.reset();

					logger.info(
						`${LOG_PREFIXES.FALLBACK} ${this.providerName} embeddings health check passed - enabling recovery mode`
					);
				}
			}
		} catch (error) {
			logger.debug(`${LOG_PREFIXES.FALLBACK} Health check failed for ${this.providerName}`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
