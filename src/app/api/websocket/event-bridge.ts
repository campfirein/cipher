import { EventManager } from '@core/events/event-manager.js';
import { logger } from '@core/logger/index.js';
import { WebSocketConnectionManager } from './connection-manager.js';
import { WebSocketResponse, WebSocketEventType } from './types.js';

/**
 * WebSocket Event Bridge - Advanced event routing and transformation
 *
 * This class provides additional event transformation and routing capabilities
 * beyond the basic WebSocketEventSubscriber. It's useful for custom event
 * handling, filtering, and transformation logic.
 */
export class WebSocketEventBridge {
	private eventFilters = new Map<WebSocketEventType, (data: any) => boolean>();
	private eventTransformers = new Map<WebSocketEventType, (data: any) => any>();
	private routingRules = new Map<WebSocketEventType, 'session' | 'global' | 'subscribers'>();

	constructor(
		private connectionManager: WebSocketConnectionManager,
		private eventManager: EventManager
	) {
		this.setupDefaultRoutingRules();
	}

	/**
	 * Set up default routing rules for different event types
	 */
	private setupDefaultRoutingRules(): void {
		// Session-specific events
		this.routingRules.set('thinking', 'session');
		this.routingRules.set('chunk', 'session');
		this.routingRules.set('response', 'session');
		this.routingRules.set('toolCall', 'session');
		this.routingRules.set('toolResult', 'session');
		this.routingRules.set('conversationReset', 'session');
		this.routingRules.set('memoryOperation', 'session');
		this.routingRules.set('sessionCreated', 'session');
		this.routingRules.set('sessionEnded', 'session');

		// Global events
		this.routingRules.set('systemMessage', 'global');
		this.routingRules.set('mcpServerConnected', 'global');
		this.routingRules.set('mcpServerDisconnected', 'global');

		// Subscriber-based events (filtered by subscription)
		this.routingRules.set('error', 'subscribers');
		this.routingRules.set('availableToolsUpdated', 'subscribers');
	}

	/**
	 * Register an event filter
	 */
	registerEventFilter(eventType: WebSocketEventType, filter: (data: any) => boolean): void {
		this.eventFilters.set(eventType, filter);
		logger.debug('WebSocket event filter registered', { eventType });
	}

	/**
	 * Register an event transformer
	 */
	registerEventTransformer(eventType: WebSocketEventType, transformer: (data: any) => any): void {
		this.eventTransformers.set(eventType, transformer);
		logger.debug('WebSocket event transformer registered', { eventType });
	}

	/**
	 * Set routing rule for an event type
	 */
	setRoutingRule(eventType: WebSocketEventType, rule: 'session' | 'global' | 'subscribers'): void {
		this.routingRules.set(eventType, rule);
		logger.debug('WebSocket routing rule set', { eventType, rule });
	}

	/**
	 * Process and route an event
	 */
	processEvent(eventType: WebSocketEventType, data: any): void {
		try {
			// Apply filter if exists
			const filter = this.eventFilters.get(eventType);
			if (filter && !filter(data)) {
				logger.debug('Event filtered out', { eventType });
				return;
			}

			// Apply transformer if exists
			const transformer = this.eventTransformers.get(eventType);
			const transformedData = transformer ? transformer(data) : data;

			// Create WebSocket response
			const response: WebSocketResponse = {
				event: eventType,
				data: transformedData,
				timestamp: Date.now(),
			};

			// Add sessionId if present
			if (
				transformedData &&
				typeof transformedData === 'object' &&
				'sessionId' in transformedData
			) {
				response.sessionId = transformedData.sessionId;
			}

			// Route based on routing rule
			const routingRule = this.routingRules.get(eventType) || 'subscribers';
			this.routeEvent(routingRule, eventType, response);
		} catch (error) {
			logger.error('Error processing WebSocket event', {
				eventType,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Route event based on routing rule
	 */
	private routeEvent(
		rule: 'session' | 'global' | 'subscribers',
		eventType: WebSocketEventType,
		response: WebSocketResponse
	): void {
		switch (rule) {
			case 'session':
				if (response.sessionId) {
					this.connectionManager.broadcastToSession(response.sessionId, response);
				} else {
					logger.warn('Session routing requested but no sessionId provided', { eventType });
				}
				break;

			case 'global':
				this.connectionManager.broadcastToAll(response);
				break;

			case 'subscribers':
				this.connectionManager.broadcastToSubscribers(eventType, response);
				break;

			default:
				logger.warn('Unknown routing rule', { rule, eventType });
		}
	}

	/**
	 * Setup common event filters
	 */
	setupCommonFilters(): void {
		// Filter out noisy debug events in production
		if (process.env.NODE_ENV === 'production') {
			this.registerEventFilter('thinking', data => {
				// Only show thinking for sessions with active connections
				return data.sessionId && this.connectionManager.hasActiveConnections(data.sessionId);
			});
		}

		// Filter memory operations by success status
		this.registerEventFilter('memoryOperation', data => {
			// Only broadcast successful memory operations unless specifically requested
			return data.success !== false;
		});

		// Filter tool results by importance
		this.registerEventFilter('toolResult', data => {
			// Always show failed tool executions, but successful ones only for subscribed clients
			return !data.success || data.important;
		});

		logger.info('Common WebSocket event filters setup completed');
	}

	/**
	 * Setup common event transformers
	 */
	setupCommonTransformers(): void {
		// Transform error events to include more context
		this.registerEventTransformer('error', data => ({
			...data,
			timestamp: Date.now(),
			severity: this.getErrorSeverity(data.code || data.message),
			suggestions: this.getErrorSuggestions(data.code || data.message),
		}));

		// Transform chunk events to include progress information
		this.registerEventTransformer('chunk', data => ({
			...data,
			timestamp: Date.now(),
			// Add progress estimation if we can determine it
			...(data.messageId && { progress: this.estimateProgress(data) }),
		}));

		// Transform tool call events to include execution context
		this.registerEventTransformer('toolCall', data => ({
			...data,
			timestamp: Date.now(),
			category: this.getToolCategory(data.toolName),
			expectedDuration: this.getExpectedToolDuration(data.toolName),
		}));

		logger.info('Common WebSocket event transformers setup completed');
	}

	/**
	 * Get error severity level
	 */
	private getErrorSeverity(errorCode: string): 'low' | 'medium' | 'high' | 'critical' {
		const criticalErrors = ['SYSTEM_ERROR', 'DATABASE_ERROR', 'MEMORY_ERROR'];
		const highErrors = ['PROCESSING_ERROR', 'LLM_ERROR', 'TOOL_ERROR'];
		const mediumErrors = ['VALIDATION_ERROR', 'AUTHENTICATION_ERROR'];

		if (criticalErrors.some(code => errorCode.includes(code))) return 'critical';
		if (highErrors.some(code => errorCode.includes(code))) return 'high';
		if (mediumErrors.some(code => errorCode.includes(code))) return 'medium';
		return 'low';
	}

	/**
	 * Get error suggestions
	 */
	private getErrorSuggestions(errorCode: string): string[] {
		const suggestions: Record<string, string[]> = {
			WEBSOCKET_ERROR: ['Check your internet connection', 'Try refreshing the page'],
			PROCESSING_ERROR: [
				'Try rephrasing your request',
				'Check if all required fields are provided',
			],
			VALIDATION_ERROR: ['Check your input format', 'Ensure all required fields are provided'],
			AUTHENTICATION_ERROR: ['Please log in again', 'Check your session is still valid'],
		};

		for (const [code, hints] of Object.entries(suggestions)) {
			if (errorCode.includes(code)) {
				return hints;
			}
		}

		return ['Try again in a few moments', 'Contact support if the issue persists'];
	}

	/**
	 * Estimate progress for chunk events
	 */
	private estimateProgress(data: any): number {
		// This is a simple estimation - in a real implementation,
		// you might track message length and estimate based on typical response sizes
		if (data.isComplete) return 100;
		if (data.text && data.text.length > 0) {
			// Simple heuristic: assume we're 10-90% done based on current text length
			const estimatedProgress = Math.min(90, Math.max(10, data.text.length / 10));
			return Math.round(estimatedProgress);
		}
		return 10;
	}

	/**
	 * Get tool category
	 */
	private getToolCategory(toolName: string): string {
		const categories: Record<string, string[]> = {
			memory: ['store_memory', 'search_memory', 'extract_knowledge'],
			knowledge: ['add_node', 'search_graph', 'extract_entities'],
			system: ['reset', 'config', 'health'],
			processing: ['run', 'execute', 'process'],
		};

		for (const [category, tools] of Object.entries(categories)) {
			if (tools.some(tool => toolName.toLowerCase().includes(tool))) {
				return category;
			}
		}

		return 'general';
	}

	/**
	 * Get expected tool duration in milliseconds
	 */
	private getExpectedToolDuration(toolName: string): number {
		const durations: Record<string, number> = {
			store_memory: 2000,
			search_memory: 1500,
			extract_knowledge: 3000,
			add_node: 1000,
			search_graph: 2000,
			reset: 500,
			config: 300,
		};

		const lowerToolName = toolName.toLowerCase();
		for (const [tool, duration] of Object.entries(durations)) {
			if (lowerToolName.includes(tool)) {
				return duration;
			}
		}

		return 2000; // Default 2 seconds
	}

	/**
	 * Get bridge statistics
	 */
	getStats(): {
		filtersRegistered: number;
		transformersRegistered: number;
		routingRules: Record<string, string>;
		eventsProcessed: number;
	} {
		return {
			filtersRegistered: this.eventFilters.size,
			transformersRegistered: this.eventTransformers.size,
			routingRules: Object.fromEntries(this.routingRules),
			eventsProcessed: 0, // TODO: Track this
		};
	}

	/**
	 * Clear all filters, transformers, and routing rules
	 */
	clear(): void {
		this.eventFilters.clear();
		this.eventTransformers.clear();
		this.routingRules.clear();
		this.setupDefaultRoutingRules();
		logger.info('WebSocket event bridge cleared and reset to defaults');
	}
}
