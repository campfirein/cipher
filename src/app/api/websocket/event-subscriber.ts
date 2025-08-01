import { EventManager } from '@core/events/event-manager.js';
import { logger } from '@core/logger/index.js';
import { WebSocketConnectionManager } from './connection-manager.js';
import { WebSocketResponse, WebSocketEventType, WebSocketEventData } from './types.js';

export class WebSocketEventSubscriber {
	private abortController: AbortController | null = null;
	private subscribedSessions = new Set<string>();
	private subscriptionStats = {
		totalEventsReceived: 0,
		totalEventsBroadcast: 0,
		eventTypeStats: new Map<string, number>(),
		lastEventTime: 0,
	};

	constructor(
		private connectionManager: WebSocketConnectionManager,
		private eventManager: EventManager
	) {}

	/**
	 * Subscribe to events from the EventManager
	 */
	subscribe(): void {
		if (this.abortController) {
			logger.warn('WebSocket event subscriber already active');
			return;
		}

		this.abortController = new AbortController();
		const { signal } = this.abortController;

		logger.info('Starting WebSocket event subscription');

		// Subscribe to Service Events
		this.subscribeToServiceEvents(signal);

		// Subscribe to Session Events (we'll handle session-specific events dynamically)
		this.subscribeToSessionEvents(signal);

		logger.info('WebSocket event subscriptions established');
	}

	/**
	 * Subscribe to service-level events
	 */
	private subscribeToServiceEvents(signal: AbortSignal): void {
		const serviceBus = this.eventManager.getServiceEventBus();

		// MCP Events
		serviceBus.on(
			'cipher:mcpClientConnected',
			data => {
				this.handleEvent(
					'mcpServerConnected',
					{
						serverName: data.serverName,
						capabilities: [],
					},
					signal
				);
			},
			{ signal }
		);

		serviceBus.on(
			'cipher:mcpClientDisconnected',
			data => {
				this.handleEvent(
					'mcpServerDisconnected',
					{
						serverName: data.serverName,
						...(data.reason && { reason: data.reason }),
					},
					signal
				);
			},
			{ signal }
		);

		// Tool Events
		serviceBus.on(
			'cipher:toolRegistered',
			data => {
				this.handleEvent(
					'availableToolsUpdated',
					{
						tools: [data.toolName],
					},
					signal
				);
			},
			{ signal }
		);

		// Memory Events
		serviceBus.on(
			'cipher:memoryOperationCompleted',
			data => {
				this.handleEvent(
					'memoryOperation',
					{
						operation: data.operation as 'store' | 'retrieve' | 'search',
						success: true,
						sessionId: data.sessionId || '',
						details: {
							operation: data.operation,
							duration: data.duration,
						},
					},
					signal
				);
			},
			{ signal }
		);

		serviceBus.on(
			'cipher:memoryOperationFailed',
			data => {
				this.handleEvent(
					'memoryOperation',
					{
						operation: data.operation as 'store' | 'retrieve' | 'search',
						success: false,
						sessionId: data.sessionId || '',
						details: {
							error: data.error,
						},
					},
					signal
				);
			},
			{ signal }
		);

		// System Events
		serviceBus.on(
			'cipher:error',
			data => {
				this.handleEvent(
					'error',
					{
						message: data.error || 'System error',
						code: 'SYSTEM_ERROR',
						...(data.stack && { stack: data.stack }),
					},
					signal
				);
			},
			{ signal }
		);
	}

	/**
	 * Subscribe to session-specific events dynamically
	 */
	private subscribeToSessionEvents(signal: AbortSignal): void {
		// Listen for all active sessions and subscribe to their events
		const activeSessions = this.eventManager.getActiveSessionIds();

		activeSessions.forEach(sessionId => {
			if (!this.subscribedSessions.has(sessionId)) {
				this.subscribeToSingleSessionEvents(sessionId, signal);
				this.subscribedSessions.add(sessionId);
			}
		});

		logger.debug('Session event subscriptions ready for existing sessions', {
			existingSessionCount: activeSessions.length,
			subscribedSessionCount: this.subscribedSessions.size,
		});
	}

	/**
	 * Subscribe to a session's events on-demand (called when session is bound to connection)
	 */
	public subscribeToSession(sessionId: string): void {
		if (this.abortController && !this.subscribedSessions.has(sessionId)) {
			logger.debug('Dynamically subscribing to session events', { sessionId });
			this.subscribeToSingleSessionEvents(sessionId, this.abortController.signal);
			this.subscribedSessions.add(sessionId);
		} else if (this.subscribedSessions.has(sessionId)) {
			logger.debug('Session already subscribed, skipping', { sessionId });
		}
	}

	/**
	 * Remove session from tracking when it's deleted
	 */
	public unsubscribeFromSession(sessionId: string): void {
		if (this.subscribedSessions.has(sessionId)) {
			this.subscribedSessions.delete(sessionId);
			logger.debug('Session removed from subscription tracking', { sessionId });
		}
	}

	/**
	 * Subscribe to events for a specific session
	 */
	private subscribeToSingleSessionEvents(sessionId: string, signal: AbortSignal): void {
		const sessionBus = this.eventManager.getSessionEventBus(sessionId);

		// LLM Events
		sessionBus.on(
			'llm:thinking',
			data => {
				this.handleEvent(
					'thinking',
					{
						sessionId: data.sessionId,
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'llm:responseStarted',
			data => {
				// Don't send another thinking event, just log it
				logger.debug('LLM response started', { sessionId: data.sessionId });
			},
			{ signal }
		);

		// Add streaming chunk event listener
		sessionBus.on(
			'llm:responseChunk',
			data => {
				this.handleEvent(
					'chunk',
					{
						text: data.chunk || data.text || '',
						isComplete: false,
						sessionId: data.sessionId,
						messageId: data.messageId,
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'llm:responseCompleted',
			data => {
				this.handleEvent(
					'response',
					{
						content: data.response || data.content || 'Response completed',
						sessionId: data.sessionId,
						messageId: data.messageId,
						metadata: {
							model: data.model,
							tokenCount: data.tokenCount,
							duration: data.duration,
						},
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'llm:responseError',
			data => {
				this.handleEvent(
					'error',
					{
						message: data.error || 'LLM processing error',
						code: 'LLM_ERROR',
						sessionId: data.sessionId,
					},
					signal
				);
			},
			{ signal }
		);

		// Tool Events
		sessionBus.on(
			'tool:executionStarted',
			data => {
				logger.debug('WebSocket: Received tool:executionStarted event', { 
					toolName: data.toolName, 
					sessionId: data.sessionId,
					executionId: data.executionId
				});
				
				// Send the specific tool execution started event
				this.handleEvent(
					'toolExecutionStarted',
					{
						toolName: data.toolName,
						sessionId: data.sessionId,
						callId: data.executionId,
						executionId: data.executionId,
					},
					signal
				);
				
				// Also send the traditional toolCall event for backward compatibility
				this.handleEvent(
					'toolCall',
					{
						toolName: data.toolName,
						args: {}, // Tool args are not available at execution start
						sessionId: data.sessionId,
						callId: data.executionId,
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'tool:executionCompleted',
			data => {
				// Send specific completion event
				this.handleEvent(
					'toolExecutionCompleted',
					{
						toolName: data.toolName,
						success: data.success,
						sessionId: data.sessionId,
						callId: data.executionId,
						executionId: data.executionId,
					},
					signal
				);
				
				// Send traditional toolResult event with actual result data
				this.handleEvent(
					'toolResult',
					{
						toolName: data.toolName,
						result: data.result || 'Tool execution completed',
						success: data.success,
						sessionId: data.sessionId,
						callId: data.executionId,
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'tool:executionFailed',
			data => {
				// Send specific failure event
				this.handleEvent(
					'toolExecutionFailed',
					{
						toolName: data.toolName,
						error: data.error,
						sessionId: data.sessionId,
						callId: data.executionId,
						executionId: data.executionId,
					},
					signal
				);
				
				// Send traditional toolResult event
				this.handleEvent(
					'toolResult',
					{
						toolName: data.toolName,
						result: data.error,
						success: false,
						sessionId: data.sessionId,
						callId: data.executionId,
					},
					signal
				);
			},
			{ signal }
		);

		// Memory Events
		sessionBus.on(
			'memory:stored',
			data => {
				this.handleEvent(
					'memoryOperation',
					{
						operation: 'store',
						success: true,
						sessionId: data.sessionId,
						details: {
							type: data.type,
							size: data.size,
						},
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'memory:retrieved',
			data => {
				this.handleEvent(
					'memoryOperation',
					{
						operation: 'retrieve',
						success: true,
						sessionId: data.sessionId,
						details: {
							count: data.count,
							type: data.type,
						},
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'memory:searched',
			data => {
				this.handleEvent(
					'memoryOperation',
					{
						operation: 'search',
						success: true,
						sessionId: data.sessionId,
						details: {
							query: data.query,
							resultCount: data.resultCount,
							duration: data.duration,
						},
					},
					signal
				);
			},
			{ signal }
		);

		// Session Lifecycle Events
		sessionBus.on(
			'session:created',
			data => {
				this.handleEvent(
					'sessionCreated',
					{
						sessionId: data.sessionId,
						timestamp: data.timestamp,
					},
					signal
				);
			},
			{ signal }
		);

		sessionBus.on(
			'session:deleted',
			data => {
				// Clean up session subscription tracking
				this.unsubscribeFromSession(data.sessionId);
				
				this.handleEvent(
					'sessionEnded',
					{
						sessionId: data.sessionId,
						timestamp: data.timestamp,
					},
					signal
				);
			},
			{ signal }
		);

		// Conversation Events
		sessionBus.on(
			'conversation:cleared',
			data => {
				this.handleEvent(
					'conversationReset',
					{
						sessionId: data.sessionId,
					},
					signal
				);
			},
			{ signal }
		);
	}

	/**
	 * Handle an event and broadcast to appropriate WebSocket connections
	 */
	private handleEvent<T extends WebSocketEventType>(
		eventType: T,
		data: WebSocketEventData[T],
		signal: AbortSignal
	): void {
		if (signal.aborted) {
			return;
		}

		try {
			// Update statistics
			this.subscriptionStats.totalEventsReceived++;
			this.subscriptionStats.lastEventTime = Date.now();

			const currentCount = this.subscriptionStats.eventTypeStats.get(eventType) || 0;
			this.subscriptionStats.eventTypeStats.set(eventType, currentCount + 1);

			// Create WebSocket response
			const response: WebSocketResponse = {
				event: eventType,
				data: data as Record<string, any>,
				timestamp: Date.now(),
			};

			// Add sessionId to response if present in data
			if (data && typeof data === 'object' && 'sessionId' in data && data.sessionId) {
				response.sessionId = data.sessionId as string;
			}

			// Determine broadcast strategy
			if (response.sessionId) {
				// Session-specific event - broadcast to session connections
				this.connectionManager.broadcastToSession(response.sessionId, response);
				if (eventType.includes('tool')) {
					logger.info('Tool event broadcast to session', {
						eventType,
						sessionId: response.sessionId,
						data: response.data,
					});
				} else {
					logger.debug('Event broadcast to session', {
						eventType,
						sessionId: response.sessionId,
						hasData: !!data,
					});
				}
			} else {
				// Global event - broadcast to all subscribers
				this.connectionManager.broadcastToSubscribers(eventType, response);
				logger.debug('Event broadcast to all subscribers', {
					eventType,
					hasData: !!data,
				});
			}

			this.subscriptionStats.totalEventsBroadcast++;
		} catch (error) {
			logger.error('Error handling WebSocket event', {
				eventType,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}

	/**
	 * Unsubscribe from events
	 */
	unsubscribe(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
			this.subscribedSessions.clear();
			logger.info('WebSocket event subscriptions terminated');
		}
	}

	/**
	 * Get subscription statistics
	 */
	getStats(): {
		isActive: boolean;
		totalEventsReceived: number;
		totalEventsBroadcast: number;
		lastEventTime: number;
		eventTypeStats: Record<string, number>;
		subscribedSessionCount: number;
		connectionStats: any;
	} {
		return {
			isActive: !!this.abortController && !this.abortController.signal.aborted,
			totalEventsReceived: this.subscriptionStats.totalEventsReceived,
			totalEventsBroadcast: this.subscriptionStats.totalEventsBroadcast,
			lastEventTime: this.subscriptionStats.lastEventTime,
			eventTypeStats: Object.fromEntries(this.subscriptionStats.eventTypeStats),
			subscribedSessionCount: this.subscribedSessions.size,
			connectionStats: this.connectionManager.getStats(),
		};
	}

	/**
	 * Manually broadcast a message to all connections
	 */
	broadcastMessage(message: WebSocketResponse): void {
		this.connectionManager.broadcastToAll(message);
		this.subscriptionStats.totalEventsBroadcast++;
	}

	/**
	 * Manually broadcast a message to a specific session
	 */
	broadcastToSession(sessionId: string, message: WebSocketResponse): void {
		this.connectionManager.broadcastToSession(sessionId, message);
		this.subscriptionStats.totalEventsBroadcast++;
	}

	/**
	 * Send a system message to all connections
	 */
	sendSystemMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
		const response: WebSocketResponse = {
			event: 'systemMessage',
			data: {
				message,
				level,
				timestamp: Date.now(),
			},
			timestamp: Date.now(),
		};

		this.broadcastMessage(response);

		logger.info('System message broadcast via WebSocket', {
			message,
			level,
		});
	}

	/**
	 * Check if subscriber is active
	 */
	isActive(): boolean {
		return !!this.abortController && !this.abortController.signal.aborted;
	}

	/**
	 * Dispose of the event subscriber
	 */
	dispose(): void {
		this.unsubscribe();

		// Reset statistics
		this.subscriptionStats = {
			totalEventsReceived: 0,
			totalEventsBroadcast: 0,
			eventTypeStats: new Map<string, number>(),
			lastEventTime: 0,
		};

		// Clear subscribed sessions
		this.subscribedSessions.clear();

		logger.info('WebSocket event subscriber disposed');
	}
}
