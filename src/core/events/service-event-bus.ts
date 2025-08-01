import { TypedEventEmitter } from './typed-event-emitter.js';
import { ServiceEventMap, EventEnvelope, EventMetadata } from './event-types.js';
import { logger } from '../logger/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { EventPersistence } from './persistence.js';

export interface ServiceEventBusOptions {
	enableLogging?: boolean;
	maxListeners?: number;
	enablePersistence?: boolean;
	eventPersistence?: EventPersistence;
}

export class ServiceEventBus extends TypedEventEmitter<ServiceEventMap> {
	private readonly instanceId: string;
	private readonly startTime: number;
	private eventHistory: EventEnvelope[] = [];
	private readonly enablePersistence: boolean;
	private readonly maxHistorySize = 10000;
	private readonly eventPersistence?: EventPersistence;

	constructor(options: ServiceEventBusOptions = {}) {
		super({
			maxListeners: options.maxListeners ?? 200,
			enableLogging: options.enableLogging ?? true,
		});

		this.instanceId = uuidv4();
		this.startTime = Date.now();
		this.enablePersistence = options.enablePersistence ?? false;
		this.eventPersistence = options.eventPersistence!;

		logger.debug('ServiceEventBus initialized', {
			instanceId: this.instanceId,
			maxListeners: options.maxListeners ?? 200,
			enablePersistence: this.enablePersistence,
		});
	}

	/**
	 * Emit a service event with metadata and optional persistence
	 */
	emitServiceEvent<K extends keyof ServiceEventMap>(
		event: K,
		data: ServiceEventMap[K],
		metadata: Partial<EventMetadata> = {}
	): void {
		const envelope: EventEnvelope<ServiceEventMap[K]> = {
			id: uuidv4(),
			type: event as string,
			data,
			metadata: {
				timestamp: Date.now(),
				source: 'service',
				priority: 'normal',
				...metadata,
			},
		};

		// Store in history if persistence is enabled
		if (this.enablePersistence) {
			this.addToHistory(envelope);
		}

		// Persist event if eventPersistence is provided
		if (this.eventPersistence) {
			void this.eventPersistence.store(envelope);
		}

		// Emit the event
		this.emit(event, data);

		// Log high priority events
		if (envelope.metadata.priority === 'high') {
			logger.info('High priority service event emitted', {
				eventType: event,
				eventId: envelope.id,
				instanceId: this.instanceId,
			});
		}
	}

	/**
	 * Get event history (if persistence is enabled)
	 */
	getEventHistory(filter?: {
		eventType?: keyof ServiceEventMap;
		since?: number;
		limit?: number;
	}): EventEnvelope[] {
		if (!this.enablePersistence) {
			return [];
		}

		let history = this.eventHistory;

		if (filter) {
			if (filter.eventType) {
				history = history.filter(event => event.type === filter.eventType);
			}

			if (filter.since) {
				history = history.filter(event => event.metadata.timestamp >= filter.since!);
			}

			if (filter.limit) {
				history = history.slice(-filter.limit);
			}
		}

		return history;
	}

	/**
	 * Get service event bus statistics
	 */
	getStatistics(): {
		instanceId: string;
		uptime: number;
		totalEvents: number;
		eventTypes: Record<string, number>;
		activeListeners: Record<string, number>;
	} {
		const eventTypes: Record<string, number> = {};
		const activeListeners: Record<string, number> = {};

		// Count events by type
		this.eventHistory.forEach(event => {
			eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
		});

		// Count active listeners by event type
		this.eventNames().forEach(eventName => {
			activeListeners[eventName as string] = this.listenerCountFor(eventName);
		});

		return {
			instanceId: this.instanceId,
			uptime: Date.now() - this.startTime,
			totalEvents: this.eventHistory.length,
			eventTypes,
			activeListeners,
		};
	}

	/**
	 * Clear event history
	 */
	clearHistory(): void {
		this.eventHistory = [];
		logger.info('Service event history cleared', {
			instanceId: this.instanceId,
		});
	}

	/**
	 * Dispose of the service event bus
	 */
	public override dispose(): void {
		this.clearHistory();
		super.dispose();
		logger.info('ServiceEventBus disposed', {
			instanceId: this.instanceId,
		});
	}

	/**
	 * Add event to history with size management
	 */
	private addToHistory(envelope: EventEnvelope): void {
		this.eventHistory.push(envelope);

		// Maintain maximum history size
		if (this.eventHistory.length > this.maxHistorySize) {
			this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
		}
	}

	/**
	 * Get instance ID
	 */
	getInstanceId(): string {
		return this.instanceId;
	}

	/**
	 * Get uptime in milliseconds
	 */
	getUptime(): number {
		return Date.now() - this.startTime;
	}
}
