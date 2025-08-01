/**
 * Event Filtering System
 *
 * Provides efficient filtering capabilities for events to optimize performance
 * and enable selective event processing.
 */

import { EventEnvelope } from './event-types.js';
import { logger } from '../logger/logger.js';

export type EventFilter = (event: EventEnvelope) => boolean;

export interface FilterConfig {
	name: string;
	description?: string;
	enabled: boolean;
	filter: EventFilter;
	priority?: number; // Higher priority filters are applied first
}

export interface FilteringStats {
	totalEventsProcessed: number;
	totalEventsFiltered: number;
	filteringRate: number; // Percentage of events filtered out
	averageFilteringTime: number; // Average time spent filtering per event (ms)
	filterStats: Record<
		string,
		{
			eventsProcessed: number;
			eventsFiltered: number;
			averageExecutionTime: number;
		}
	>;
}

/**
 * Event filtering manager
 */
export class EventFilterManager {
	private filters: Map<string, FilterConfig> = new Map();
	private stats: FilteringStats = {
		totalEventsProcessed: 0,
		totalEventsFiltered: 0,
		filteringRate: 0,
		averageFilteringTime: 0,
		filterStats: {},
	};
	private executionTimes: number[] = [];

	/**
	 * Register a new event filter
	 */
	registerFilter(config: FilterConfig): void {
		this.filters.set(config.name, {
			priority: 0,
			...config,
		});

		this.stats.filterStats[config.name] = {
			eventsProcessed: 0,
			eventsFiltered: 0,
			averageExecutionTime: 0,
		};

		logger.debug('Event filter registered', {
			name: config.name,
			description: config.description,
			enabled: config.enabled,
		});
	}

	/**
	 * Unregister an event filter
	 */
	unregisterFilter(name: string): boolean {
		const removed = this.filters.delete(name);
		if (removed) {
			delete this.stats.filterStats[name];
			logger.debug('Event filter unregistered', { name });
		}
		return removed;
	}

	/**
	 * Enable or disable a filter
	 */
	setFilterEnabled(name: string, enabled: boolean): void {
		const filter = this.filters.get(name);
		if (filter) {
			filter.enabled = enabled;
			logger.debug('Event filter state changed', { name, enabled });
		}
	}

	/**
	 * Update filter priority
	 */
	setFilterPriority(name: string, priority: number): void {
		const filter = this.filters.get(name);
		if (filter) {
			filter.priority = priority;
			logger.debug('Event filter priority changed', { name, priority });
		}
	}

	/**
	 * Apply all enabled filters to an event
	 * Returns true if event should be processed, false if it should be filtered out
	 */
	shouldProcessEvent(event: EventEnvelope): boolean {
		// Fast path: if no filters are registered, return true immediately
		if (this.filters.size === 0) {
			return true;
		}

		const startTime = Date.now();
		this.stats.totalEventsProcessed++;

		try {
			// Get enabled filters sorted by priority (highest first)
			const enabledFilters = Array.from(this.filters.values())
				.filter(f => f.enabled)
				.sort((a, b) => (b.priority || 0) - (a.priority || 0));

			if (enabledFilters.length === 0) {
				// No enabled filters, but we still need to update stats
				this.updateOverallStats(Date.now() - startTime);
				return true; // No filters means all events pass through
			}

			// Apply filters in priority order
			for (const filterConfig of enabledFilters) {
				const filterStartTime = Date.now();
				if (this.stats.filterStats[filterConfig.name]) {
					this.stats.filterStats[filterConfig.name]!.eventsProcessed++;
				}

				try {
					const shouldPass = filterConfig.filter(event);

					// Update filter-specific stats
					const filterExecutionTime = Date.now() - filterStartTime;
					const filterStats = this.stats.filterStats[filterConfig.name];
					if (filterStats) {
						filterStats.averageExecutionTime =
							(filterStats.averageExecutionTime * (filterStats.eventsProcessed - 1) +
								filterExecutionTime) /
							filterStats.eventsProcessed;
					}

					if (!shouldPass) {
						// Event was filtered out by this filter
						this.stats.totalEventsFiltered++;
						if (this.stats.filterStats[filterConfig.name]) {
							this.stats.filterStats[filterConfig.name]!.eventsFiltered++;
						}
						this.updateOverallStats(Date.now() - startTime);
						return false;
					}
				} catch (error) {
					logger.warn('Event filter execution failed', {
						filterName: filterConfig.name,
						eventType: event.type,
						error: error instanceof Error ? error.message : String(error),
					});
					// Continue with other filters if one fails
				}
			}

			// All filters passed
			this.updateOverallStats(Date.now() - startTime);
			return true;
		} catch (error) {
			logger.error('Error during event filtering', {
				eventType: event.type,
				error: error instanceof Error ? error.message : String(error),
			});
			// Default to allowing the event through on error
			this.updateOverallStats(Date.now() - startTime);
			return true;
		}
	}

	/**
	 * Check if any filters are registered
	 */
	hasFilters(): boolean {
		return this.filters.size > 0;
	}

	/**
	 * Get current filtering statistics
	 */
	getStats(): FilteringStats {
		// Update filtering rate
		if (this.stats.totalEventsProcessed > 0) {
			this.stats.filteringRate =
				(this.stats.totalEventsFiltered / this.stats.totalEventsProcessed) * 100;
		}

		return { ...this.stats };
	}

	/**
	 * Reset all statistics
	 */
	resetStats(): void {
		this.stats = {
			totalEventsProcessed: 0,
			totalEventsFiltered: 0,
			filteringRate: 0,
			averageFilteringTime: 0,
			filterStats: {},
		};

		// Reinitialize filter stats
		for (const filterName of this.filters.keys()) {
			this.stats.filterStats[filterName] = {
				eventsProcessed: 0,
				eventsFiltered: 0,
				averageExecutionTime: 0,
			};
		}

		this.executionTimes = [];
		logger.debug('Event filtering statistics reset');
	}

	/**
	 * Get list of registered filters
	 */
	getFilters(): FilterConfig[] {
		return Array.from(this.filters.values());
	}

	/**
	 * Get a specific filter configuration
	 */
	getFilter(name: string): FilterConfig | undefined {
		return this.filters.get(name);
	}

	private updateOverallStats(executionTime: number): void {
		this.executionTimes.push(executionTime);

		// Keep only the last 1000 execution times for moving average
		if (this.executionTimes.length > 1000) {
			this.executionTimes = this.executionTimes.slice(-1000);
		}

		// Update average filtering time
		this.stats.averageFilteringTime =
			this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length;
	}
}

/**
 * Common event filters for typical use cases
 */
export class CommonFilters {
	/**
	 * Filter events by type
	 */
	static byEventType(...allowedTypes: string[]): EventFilter {
		return (event: EventEnvelope) => allowedTypes.includes(event.type);
	}

	/**
	 * Filter events by session ID
	 */
	static bySessionId(...allowedSessionIds: string[]): EventFilter {
		return (event: EventEnvelope) => {
			if (!event.metadata.sessionId) return false;
			return allowedSessionIds.includes(event.metadata.sessionId);
		};
	}

	/**
	 * Filter events by source
	 */
	static bySource(...allowedSources: string[]): EventFilter {
		return (event: EventEnvelope) => allowedSources.includes(event.metadata.source ?? '');
	}

	/**
	 * Filter events by priority
	 */
	static byPriority(minPriority: 'low' | 'normal' | 'high'): EventFilter {
		const priorityLevels = { low: 1, normal: 2, high: 3 };
		const minLevel = priorityLevels[minPriority];

		return (event: EventEnvelope) => {
			const eventPriority = event.metadata.priority || 'normal';
			return priorityLevels[eventPriority] >= minLevel;
		};
	}

	/**
	 * Filter events by time range
	 */
	static byTimeRange(startTime: number, endTime: number): EventFilter {
		return (event: EventEnvelope) => {
			const timestamp = event.metadata.timestamp;
			return timestamp >= startTime && timestamp <= endTime;
		};
	}

	/**
	 * Filter out events older than specified age (in milliseconds)
	 */
	static byMaxAge(maxAgeMs: number): EventFilter {
		return (event: EventEnvelope) => {
			const age = Date.now() - event.metadata.timestamp;
			return age <= maxAgeMs;
		};
	}

	/**
	 * Rate limiting filter - only allow N events per time window
	 */
	static rateLimit(maxEvents: number, windowMs: number): EventFilter {
		const eventTimes: number[] = [];

		return (_event: EventEnvelope) => {
			const now = Date.now();
			const windowStart = now - windowMs;

			// Remove events outside the window
			while (eventTimes.length > 0 && eventTimes[0]! < windowStart) {
				eventTimes.shift();
			}

			// Check if we're under the limit
			if (eventTimes.length < maxEvents) {
				eventTimes.push(now);
				return true;
			}

			return false; // Rate limit exceeded
		};
	}

	/**
	 * Filter to reduce noise from frequent events
	 */
	static deduplicateByType(timeWindowMs: number = 1000): EventFilter {
		const lastSeen = new Map<string, number>();

		return (event: EventEnvelope) => {
			const now = Date.now();
			const key = `${event.type}-${event.metadata.sessionId || 'global'}`;
			const lastTime = lastSeen.get(key);

			if (!lastTime || now - lastTime >= timeWindowMs) {
				lastSeen.set(key, now);
				return true;
			}

			return false; // Duplicate within time window
		};
	}

	/**
	 * Filter for performance - only allow events during normal business hours
	 */
	static businessHoursOnly(_timezone: string = 'UTC'): EventFilter {
		return () => {
			const eventTime = new Date();
			const hours = eventTime.getHours();

			// Allow events between 8 AM and 6 PM
			return hours >= 8 && hours < 18;
		};
	}

	/**
	 * Complex filter that combines multiple conditions with AND logic
	 */
	static and(...filters: EventFilter[]): EventFilter {
		return (event: EventEnvelope) => filters.every(filter => filter(event));
	}

	/**
	 * Complex filter that combines multiple conditions with OR logic
	 */
	static or(...filters: EventFilter[]): EventFilter {
		return (event: EventEnvelope) => filters.some(filter => filter(event));
	}

	/**
	 * Negate a filter
	 */
	static not(filter: EventFilter): EventFilter {
		return (event: EventEnvelope) => !filter(event);
	}

	/**
	 * Filter for debugging - only allow events with error information
	 */
	static errorsOnly(): EventFilter {
		return (event: EventEnvelope) => {
			if (event.type.includes('error') || event.type.includes('failed')) {
				return true;
			}

			if (event.data && typeof event.data === 'object' && 'error' in event.data) {
				return true;
			}

			return false;
		};
	}

	/**
	 * Filter for performance monitoring - only high-impact events
	 */
	static performanceEvents(): EventFilter {
		const performanceEventTypes = [
			'tool:executionStarted',
			'tool:executionCompleted',
			'tool:executionFailed',
			'llm:responseStarted',
			'llm:responseCompleted',
			'llm:responseError',
			'memory:searched',
			'memory:stored',
			'memory:retrieved',
		];

		return (event: EventEnvelope) => performanceEventTypes.includes(event.type);
	}

	/**
	 * Filter for security monitoring - only security-relevant events
	 */
	static securityEvents(): EventFilter {
		const securityEventTypes = [
			'session:created',
			'session:expired',
			'session:deleted',
			'cipher:mcpClientConnected',
			'cipher:mcpClientDisconnected',
			'cipher:mcpClientError',
			'cipher:toolError',
			'cipher:serviceError',
		];

		return (event: EventEnvelope) => {
			if (securityEventTypes.includes(event.type)) {
				return true;
			}

			// Also include any event with error information
			if (event.data && typeof event.data === 'object' && 'error' in event.data) {
				return true;
			}

			return false;
		};
	}
}

/**
 * Performance-optimized filter chain for high-throughput scenarios
 */
export class OptimizedFilterChain {
	private filters: Array<{ name: string; filter: EventFilter; enabled: boolean }> = [];
	private compiledFilter?: EventFilter;
	private lastCompileTime = 0;
	private compileThreshold = 5000; // Recompile after 5 seconds

	/**
	 * Add a filter to the chain
	 */
	addFilter(name: string, filter: EventFilter, enabled = true): void {
		this.filters.push({ name, filter, enabled });
		this.invalidateCompiledFilter();
	}

	/**
	 * Remove a filter from the chain
	 */
	removeFilter(name: string): boolean {
		const index = this.filters.findIndex(f => f.name === name);
		if (index >= 0) {
			this.filters.splice(index, 1);
			this.invalidateCompiledFilter();
			return true;
		}
		return false;
	}

	/**
	 * Enable or disable a filter
	 */
	setFilterEnabled(name: string, enabled: boolean): void {
		const filter = this.filters.find(f => f.name === name);
		if (filter) {
			filter.enabled = enabled;
			this.invalidateCompiledFilter();
		}
	}

	/**
	 * Apply the filter chain to an event
	 */
	shouldProcessEvent(event: EventEnvelope): boolean {
		const compiledFilter = this.getCompiledFilter();
		return compiledFilter ? compiledFilter(event) : true;
	}

	private getCompiledFilter(): EventFilter | undefined {
		const now = Date.now();

		// Recompile if needed
		if (!this.compiledFilter || now - this.lastCompileTime > this.compileThreshold) {
			this.compileFilters();
			this.lastCompileTime = now;
		}

		return this.compiledFilter;
	}

	private compileFilters(): void {
		const enabledFilters = this.filters.filter(f => f.enabled).map(f => f.filter);

		if (enabledFilters.length === 0) {
			this.compiledFilter = undefined as unknown as EventFilter;
			return;
		}

		// Create an optimized combined filter
		this.compiledFilter = (event: EventEnvelope) => {
			for (const filter of enabledFilters) {
				if (!filter(event)) {
					return false;
				}
			}
			return true;
		};
	}

	private invalidateCompiledFilter(): void {
		this.compiledFilter = undefined as unknown as EventFilter;
	}
}
