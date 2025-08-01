import { ServiceEventBus } from './service-event-bus.js';
import { SessionEventBus } from './session-event-bus.js';
import { ServiceEventMap, SessionEventMap, EventEnvelope, EventFilter } from './event-types.js';
import { EventFilterManager, CommonFilters } from './filtering.js';
import { logger } from '../logger/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { EventPersistence, EventPersistenceConfig } from './persistence.js';

export interface EventManagerOptions {
	enableLogging?: boolean;
	enablePersistence?: boolean;
	enableFiltering?: boolean;
	maxServiceListeners?: number;
	maxSessionListeners?: number;
	maxSessionHistorySize?: number;
	sessionCleanupInterval?: number;
	eventPersistenceConfig?: Partial<EventPersistenceConfig>;
}

export class EventManager {
	private readonly serviceEventBus: ServiceEventBus;
	private readonly sessionEventBuses = new Map<string, SessionEventBus>();
	private readonly filterManager: EventFilterManager;
	private readonly options: Required<EventManagerOptions>;
	private readonly instanceId: string;
	private cleanupInterval?: NodeJS.Timeout;
	private isDisposed = false;
	private eventPersistence?: EventPersistence;

	constructor(options: EventManagerOptions = {}) {
		this.instanceId = uuidv4();
		this.options = {
			enableLogging: options.enableLogging ?? true,
			enablePersistence: options.enablePersistence ?? false,
			enableFiltering: options.enableFiltering ?? false,
			maxServiceListeners: options.maxServiceListeners ?? 200,
			maxSessionListeners: options.maxSessionListeners ?? 100,
			maxSessionHistorySize: options.maxSessionHistorySize ?? 1000,
			sessionCleanupInterval: options.sessionCleanupInterval ?? 300000, // 5 minutes
			eventPersistenceConfig: options.eventPersistenceConfig ?? {},
		};

		// Initialize event persistence if enabled
		if (this.options.enablePersistence) {
			this.eventPersistence = new EventPersistence({
				enabled: true,
				storageType: this.options.eventPersistenceConfig.storageType || 'file',
				filePath: this.options.eventPersistenceConfig.filePath || './data/events',
				retentionDays: this.options.eventPersistenceConfig.retentionDays || 7,
				...(this.options.eventPersistenceConfig.maxEvents !== undefined
					? { maxEvents: this.options.eventPersistenceConfig.maxEvents }
					: {}),
				...(this.options.eventPersistenceConfig.rotationSize !== undefined
					? { rotationSize: this.options.eventPersistenceConfig.rotationSize }
					: {}),
			});
		}

		// Initialize filter manager
		this.filterManager = new EventFilterManager();

		// Initialize service event bus
		this.serviceEventBus = new ServiceEventBus({
			enableLogging: this.options.enableLogging,
			enablePersistence: this.options.enablePersistence,
			maxListeners: this.options.maxServiceListeners,
			...(this.eventPersistence ? { eventPersistence: this.eventPersistence } : {}),
		});

		// Set up session cleanup interval
		if (this.options.sessionCleanupInterval > 0) {
			this.cleanupInterval = setInterval(() => {
				this.cleanupInactiveSessions();
			}, this.options.sessionCleanupInterval);
		}

		logger.debug('EventManager initialized', {
			instanceId: this.instanceId,
			options: this.options,
		});
	}

	/**
	 * Get or create a session event bus
	 */
	getSessionEventBus(sessionId: string): SessionEventBus {
		if (this.isDisposed) {
			throw new Error('EventManager is disposed');
		}

		let sessionBus = this.sessionEventBuses.get(sessionId);

		if (!sessionBus) {
			sessionBus = new SessionEventBus({
				sessionId,
				enableLogging: this.options.enableLogging,
				enablePersistence: this.options.enablePersistence,
				maxListeners: this.options.maxSessionListeners,
				maxHistorySize: this.options.maxSessionHistorySize,
				...(this.eventPersistence ? { eventPersistence: this.eventPersistence } : {}),
			});

			this.sessionEventBuses.set(sessionId, sessionBus);

			logger.debug('SessionEventBus created', {
				sessionId,
				instanceId: this.instanceId,
				totalSessions: this.sessionEventBuses.size,
			});
		}

		return sessionBus;
	}

	/**
	 * Get the service event bus
	 */
	getServiceEventBus(): ServiceEventBus {
		if (this.isDisposed) {
			throw new Error('EventManager is disposed');
		}

		return this.serviceEventBus;
	}

	/**
	 * Remove a session event bus
	 */
	removeSessionEventBus(sessionId: string): void {
		const sessionBus = this.sessionEventBuses.get(sessionId);
		if (sessionBus) {
			sessionBus.dispose();
			this.sessionEventBuses.delete(sessionId);

			logger.debug('SessionEventBus removed', {
				sessionId,
				instanceId: this.instanceId,
				totalSessions: this.sessionEventBuses.size,
			});
		}
	}

	/**
	 * Emit a service event
	 */
	emitServiceEvent<K extends keyof ServiceEventMap>(event: K, data: ServiceEventMap[K]): void {
		if (this.isDisposed) {
			logger.warn('Attempted to emit service event on disposed EventManager', {
				eventType: event,
				instanceId: this.instanceId,
			});
			return;
		}

		// Apply filtering if enabled and filters exist
		if (this.options.enableFiltering && this.filterManager.hasFilters()) {
			const eventEnvelope: EventEnvelope = {
				id: uuidv4(),
				type: event as string,
				data,
				metadata: {
					timestamp: Date.now(),
					source: 'service',
					eventManagerId: this.instanceId,
				},
			};

			if (!this.filterManager.shouldProcessEvent(eventEnvelope)) {
				// Event was filtered out
				return;
			}
		}

		this.serviceEventBus.emitServiceEvent(event, data);
		// Persist event if enabled
		if (this.eventPersistence) {
			const envelope: EventEnvelope = {
				id: uuidv4(),
				type: event as string,
				data,
				metadata: {
					timestamp: Date.now(),
					source: 'service',
					eventManagerId: this.instanceId,
				},
			};
			void this.eventPersistence.store(envelope);
		}
	}

	/**
	 * Emit a session event
	 */
	emitSessionEvent<K extends keyof SessionEventMap>(
		sessionId: string,
		event: K,
		data: SessionEventMap[K]
	): void {
		if (this.isDisposed) {
			logger.warn('Attempted to emit session event on disposed EventManager', {
				sessionId,
				eventType: event,
				instanceId: this.instanceId,
			});
			return;
		}

		// Apply filtering if enabled and filters exist
		if (this.options.enableFiltering && this.filterManager.hasFilters()) {
			const eventEnvelope: EventEnvelope = {
				id: uuidv4(),
				type: event as string,
				data,
				metadata: {
					timestamp: Date.now(),
					source: 'session',
					sessionId,
					eventManagerId: this.instanceId,
				},
			};

			if (!this.filterManager.shouldProcessEvent(eventEnvelope)) {
				// Event was filtered out
				return;
			}
		}

		const sessionBus = this.getSessionEventBus(sessionId);
		sessionBus.emitSessionEvent(event, data);
		// Persist event if enabled
		if (this.eventPersistence) {
			const envelope: EventEnvelope = {
				id: uuidv4(),
				type: event as string,
				data,
				metadata: {
					timestamp: Date.now(),
					source: 'session',
					sessionId,
					eventManagerId: this.instanceId,
				},
			};
			void this.eventPersistence.store(envelope);
		}
	}

	/**
	 * Get all active session IDs
	 */
	getActiveSessionIds(): string[] {
		return Array.from(this.sessionEventBuses.keys());
	}

	/**
	 * Get comprehensive statistics
	 */
	getStatistics(): {
		instanceId: string;
		uptime: number;
		totalSessions: number;
		activeSessions: number;
		serviceEvents: {
			totalEvents: number;
			eventTypes: Record<string, number>;
			activeListeners: Record<string, number>;
		};
		sessionStats: {
			sessionId: string;
			age: number;
			totalEvents: number;
			recentActivity: {
				lastEventTime?: number;
				eventsInLastMinute: number;
				eventsInLastHour: number;
			};
		}[];
	} {
		const serviceStats = this.serviceEventBus.getStatistics();
		const sessionStats = Array.from(this.sessionEventBuses.entries()).map(([sessionId, bus]) => {
			const stats = bus.getStatistics();
			return {
				sessionId,
				age: stats.age,
				totalEvents: stats.totalEvents,
				recentActivity: stats.recentActivity,
			};
		});

		return {
			instanceId: this.instanceId,
			uptime: serviceStats.uptime,
			totalSessions: this.sessionEventBuses.size,
			activeSessions: Array.from(this.sessionEventBuses.values()).filter(
				bus => !bus.isSessionDisposed()
			).length,
			serviceEvents: {
				totalEvents: serviceStats.totalEvents,
				eventTypes: serviceStats.eventTypes,
				activeListeners: serviceStats.activeListeners,
			},
			sessionStats,
		};
	}

	/**
	 * Search for events across all session buses
	 */
	searchSessionEvents(filter: {
		sessionId?: string;
		eventType?: keyof SessionEventMap;
		since?: number;
		pattern?: RegExp;
		limit?: number;
	}): EventEnvelope[] {
		if (!this.options.enablePersistence) {
			return [];
		}

		let results: EventEnvelope[] = [];
		const sessionBuses = filter.sessionId
			? [this.sessionEventBuses.get(filter.sessionId)].filter(Boolean)
			: Array.from(this.sessionEventBuses.values());

		for (const sessionBus of sessionBuses) {
			if (sessionBus) {
				let events = sessionBus.getEventHistory({
					...(filter.eventType !== undefined ? { eventType: filter.eventType } : {}),
					...(filter.since !== undefined ? { since: filter.since } : {}),
					...(filter.limit !== undefined ? { limit: filter.limit } : {}),
				});

				if (filter.pattern) {
					events = events.filter(event => filter.pattern!.test(event.type));
				}

				results.push(...events);
			}
		}

		// Sort by timestamp (most recent first)
		results.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp);

		// Apply limit
		if (filter.limit && filter.limit > 0) {
			results = results.slice(0, filter.limit);
		}

		return results;
	}

	/**
	 * Clean up inactive sessions
	 */
	private cleanupInactiveSessions(): void {
		// const now = Date.now();
		const maxAge = 24 * 60 * 60 * 1000; // 24 hours
		const inactiveSessionIds: string[] = [];

		for (const [sessionId, sessionBus] of this.sessionEventBuses) {
			if (sessionBus.isSessionDisposed() || sessionBus.getAge() > maxAge) {
				inactiveSessionIds.push(sessionId);
			}
		}

		if (inactiveSessionIds.length > 0) {
			logger.info('Cleaning up inactive sessions', {
				count: inactiveSessionIds.length,
				sessionIds: inactiveSessionIds,
				instanceId: this.instanceId,
			});

			inactiveSessionIds.forEach(sessionId => {
				this.removeSessionEventBus(sessionId);
			});
		}
	}

	/**
	 * Create a cross-bus event forwarding rule
	 */
	createForwardingRule<K extends keyof SessionEventMap>(
		sessionEventType: K,
		forwardToService: boolean = true,
		filter?: EventFilter
	): void {
		// This would be implemented to forward session events to service bus
		// For now, we'll add a placeholder for future implementation
		logger.debug('Event forwarding rule created', {
			sessionEventType,
			forwardToService,
			hasFilter: !!filter,
			instanceId: this.instanceId,
		});
	}

	/**
	 * Get event manager instance ID
	 */
	getInstanceId(): string {
		return this.instanceId;
	}

	/**
	 * Check if event manager is disposed
	 */
	isEventManagerDisposed(): boolean {
		return this.isDisposed;
	}

	/**
	 * Register an event filter
	 */
	registerFilter(config: import('./filtering.js').FilterConfig): void {
		this.filterManager.registerFilter(config);
	}

	/**
	 * Unregister an event filter
	 */
	unregisterFilter(name: string): boolean {
		return this.filterManager.unregisterFilter(name);
	}

	/**
	 * Enable or disable a filter
	 */
	setFilterEnabled(name: string, enabled: boolean): void {
		this.filterManager.setFilterEnabled(name, enabled);
	}

	/**
	 * Get filtering statistics
	 */
	getFilteringStats(): import('./filtering.js').FilteringStats {
		return this.filterManager.getStats();
	}

	/**
	 * Get list of registered filters
	 */
	getFilters(): import('./filtering.js').FilterConfig[] {
		return this.filterManager.getFilters();
	}

	/**
	 * Setup common filters for typical use cases
	 */
	setupCommonFilters(): void {
		// Rate limiting for high-frequency events
		this.registerFilter({
			name: 'rate-limit-tool-events',
			description: 'Limit tool execution events to prevent spam',
			enabled: true,
			priority: 100,
			filter: CommonFilters.and(
				CommonFilters.byEventType('tool:executionStarted', 'tool:executionCompleted'),
				CommonFilters.rateLimit(50, 60000) // Max 50 tool events per minute
			),
		});

		// Filter out noisy debug events in production
		if (process.env.NODE_ENV === 'production') {
			this.registerFilter({
				name: 'production-noise-filter',
				description: 'Filter out noisy events in production',
				enabled: true,
				priority: 90,
				filter: CommonFilters.not(CommonFilters.byEventType('llm:thinking', 'context:updated')),
			});
		}

		// Only allow error events during incident response
		this.registerFilter({
			name: 'incident-mode',
			description: 'Only allow error events during incident response',
			enabled: false, // Disabled by default, enable manually during incidents
			priority: 200,
			filter: CommonFilters.errorsOnly(),
		});

		// Deduplicate frequent memory operations
		this.registerFilter({
			name: 'memory-deduplication',
			description: 'Reduce duplicate memory operation events',
			enabled: true,
			priority: 80,
			filter: CommonFilters.and(
				CommonFilters.byEventType('memory:stored', 'memory:retrieved', 'memory:searched'),
				CommonFilters.deduplicateByType(500) // Deduplicate within 500ms
			),
		});

		logger.info('Common event filters setup completed', {
			filtersRegistered: this.getFilters().length,
			instanceId: this.instanceId,
		});
	}

	/**
	 * Dispose of the event manager and all resources
	 */
	dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;

		// Clear cleanup interval
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}

		// Dispose all session event buses
		for (const [, sessionBus] of this.sessionEventBuses) {
			sessionBus.dispose();
		}
		this.sessionEventBuses.clear();

		// Dispose service event bus
		this.serviceEventBus.dispose();

		// Dispose event persistence if it exists
		if (this.eventPersistence) {
			this.eventPersistence.dispose();
		}

		logger.info('EventManager disposed', {
			instanceId: this.instanceId,
		});
	}
}
