/**
 * Circuit Breaker Pattern for Embedding Operations
 *
 * Implements circuit breaker pattern to prevent cascading failures
 * and provide automatic recovery for embedding services.
 */

import { logger } from '../../logger/index.js';
import { LOG_PREFIXES } from './constants.js';

export enum CircuitState {
	CLOSED = 'CLOSED', // Normal operation
	OPEN = 'OPEN', // Failing, reject all calls
	HALF_OPEN = 'HALF_OPEN', // Testing recovery
}

export interface CircuitBreakerConfig {
	/** Number of failures before opening circuit */
	failureThreshold: number;
	/** Time to wait before attempting recovery (ms) */
	recoveryTimeout: number;
	/** Number of successful calls needed to close circuit */
	successThreshold: number;
	/** Time window for failure counting (ms) */
	timeWindow: number;
}

export interface CircuitBreakerStats {
	state: CircuitState;
	failureCount: number;
	successCount: number;
	lastFailureTime: number | null;
	lastSuccessTime: number | null;
	totalOperations: number;
	totalFailures: number;
}

/**
 * Circuit Breaker for Embedding Operations
 */
export class EmbeddingCircuitBreaker {
	private state: CircuitState = CircuitState.CLOSED;
	private failureCount = 0;
	private successCount = 0;
	private lastFailureTime: number | null = null;
	private lastSuccessTime: number | null = null;
	private totalOperations = 0;
	private totalFailures = 0;
	private readonly config: CircuitBreakerConfig;
	private readonly name: string;

	constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
		this.name = name;
		this.config = {
			failureThreshold: config.failureThreshold || 5,
			recoveryTimeout: config.recoveryTimeout || 60000, // 1 minute
			successThreshold: config.successThreshold || 3,
			timeWindow: config.timeWindow || 300000, // 5 minutes
		};

		logger.debug(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit breaker initialized`, {
			name: this.name,
			config: this.config,
		});
	}

	/**
	 * Execute operation with circuit breaker protection
	 */
	async execute<T>(operation: () => Promise<T>): Promise<T> {
		this.totalOperations++;

		// Check circuit state
		if (this.state === CircuitState.OPEN) {
			if (this.shouldAttemptRecovery()) {
				this.state = CircuitState.HALF_OPEN;
				this.successCount = 0;
				logger.info(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit entering HALF_OPEN state`, {
					name: this.name,
				});
			} else {
				const error = new Error(`Circuit breaker OPEN for ${this.name}`);
				logger.debug(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit breaker rejecting operation`, {
					name: this.name,
					state: this.state,
				});
				throw error;
			}
		}

		try {
			const result = await operation();
			this.onSuccess();
			return result;
		} catch (error) {
			this.onFailure(error);
			throw error;
		}
	}

	/**
	 * Check if circuit breaker allows operation
	 */
	isOperationAllowed(): boolean {
		if (this.state === CircuitState.CLOSED) {
			return true;
		}
		if (this.state === CircuitState.HALF_OPEN) {
			return true;
		}
		if (this.state === CircuitState.OPEN) {
			return this.shouldAttemptRecovery();
		}
		return false;
	}

	/**
	 * Get current circuit breaker statistics
	 */
	getStats(): CircuitBreakerStats {
		return {
			state: this.state,
			failureCount: this.failureCount,
			successCount: this.successCount,
			lastFailureTime: this.lastFailureTime,
			lastSuccessTime: this.lastSuccessTime,
			totalOperations: this.totalOperations,
			totalFailures: this.totalFailures,
		};
	}

	/**
	 * Reset circuit breaker to closed state
	 */
	reset(): void {
		this.state = CircuitState.CLOSED;
		this.failureCount = 0;
		this.successCount = 0;
		this.lastFailureTime = null;

		logger.info(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit breaker reset`, {
			name: this.name,
		});
	}

	/**
	 * Force circuit breaker to open state
	 */
	forceOpen(): void {
		this.state = CircuitState.OPEN;
		this.lastFailureTime = Date.now();

		logger.warn(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit breaker forced OPEN`, {
			name: this.name,
		});
	}

	private onSuccess(): void {
		this.lastSuccessTime = Date.now();
		this.successCount++;

		if (this.state === CircuitState.HALF_OPEN) {
			if (this.successCount >= this.config.successThreshold) {
				this.state = CircuitState.CLOSED;
				this.failureCount = 0;
				this.successCount = 0;

				logger.info(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit breaker CLOSED - service recovered`, {
					name: this.name,
					successCount: this.successCount,
				});
			}
		} else if (this.state === CircuitState.CLOSED) {
			// Reset failure count on success in closed state
			this.failureCount = Math.max(0, this.failureCount - 1);
		}
	}

	private onFailure(error: any): void {
		this.lastFailureTime = Date.now();
		this.failureCount++;
		this.totalFailures++;

		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.warn(`${LOG_PREFIXES.CIRCUIT_BREAKER} Operation failed`, {
			name: this.name,
			error: errorMessage,
			failureCount: this.failureCount,
			state: this.state,
		});

		if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
			if (this.failureCount >= this.config.failureThreshold) {
				this.state = CircuitState.OPEN;
				this.successCount = 0;

				logger.error(`${LOG_PREFIXES.CIRCUIT_BREAKER} Circuit breaker OPENED - too many failures`, {
					name: this.name,
					failureCount: this.failureCount,
					threshold: this.config.failureThreshold,
				});
			}
		}
	}

	private shouldAttemptRecovery(): boolean {
		if (!this.lastFailureTime) {
			return true;
		}

		const timeSinceLastFailure = Date.now() - this.lastFailureTime;
		return timeSinceLastFailure >= this.config.recoveryTimeout;
	}
}

/**
 * Circuit Breaker Manager for managing multiple circuit breakers
 */
export class CircuitBreakerManager {
	private circuitBreakers = new Map<string, EmbeddingCircuitBreaker>();

	/**
	 * Get or create circuit breaker for a specific service
	 */
	getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): EmbeddingCircuitBreaker {
		if (!this.circuitBreakers.has(name)) {
			const circuitBreaker = new EmbeddingCircuitBreaker(name, config);
			this.circuitBreakers.set(name, circuitBreaker);
		}
		return this.circuitBreakers.get(name)!;
	}

	/**
	 * Get all circuit breaker statistics
	 */
	getAllStats(): Record<string, CircuitBreakerStats> {
		const stats: Record<string, CircuitBreakerStats> = {};
		for (const [name, circuitBreaker] of this.circuitBreakers) {
			stats[name] = circuitBreaker.getStats();
		}
		return stats;
	}

	/**
	 * Reset all circuit breakers
	 */
	resetAll(): void {
		for (const circuitBreaker of this.circuitBreakers.values()) {
			circuitBreaker.reset();
		}
		logger.info(`${LOG_PREFIXES.CIRCUIT_BREAKER} All circuit breakers reset`);
	}

	/**
	 * Get circuit breakers that are currently open
	 */
	getOpenCircuits(): string[] {
		const openCircuits: string[] = [];
		for (const [name, circuitBreaker] of this.circuitBreakers) {
			if (circuitBreaker.getStats().state === CircuitState.OPEN) {
				openCircuits.push(name);
			}
		}
		return openCircuits;
	}

	/**
	 * Check if any circuit breakers are open
	 */
	hasOpenCircuits(): boolean {
		return this.getOpenCircuits().length > 0;
	}
}
