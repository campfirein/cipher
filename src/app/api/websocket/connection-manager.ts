import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@core/logger/index.js';
import { 
	WebSocketConnection, 
	WebSocketResponse, 
	WebSocketConnectionStats,
	WebSocketEventType 
} from './types.js';

export class WebSocketConnectionManager {
	private connections = new Map<string, WebSocketConnection>();
	private sessionConnections = new Map<string, Set<string>>();
	private connectionSessions = new Map<string, string>();
	private stats = {
		totalMessagesReceived: 0,
		totalMessagesSent: 0,
		connectionsCreated: 0,
	};
	private eventSubscriber?: any; // We'll set this after initialization

	constructor(
		private maxConnections: number = 1000,
		private connectionTimeout: number = 300000 // 5 minutes
	) {
		// Start connection cleanup interval
		setInterval(() => {
			this.cleanupStaleConnections();
		}, 60000); // Check every minute
	}

	/**
	 * Set the event subscriber to notify when sessions are bound
	 */
	setEventSubscriber(eventSubscriber: any): void {
		this.eventSubscriber = eventSubscriber;
	}

	/**
	 * Add a new WebSocket connection
	 */
	addConnection(ws: WebSocket, sessionId?: string): string {
		if (this.connections.size >= this.maxConnections) {
			logger.warn('WebSocket connection limit reached', {
				currentConnections: this.connections.size,
				maxConnections: this.maxConnections
			});
			ws.close(1013, 'Server overloaded');
			throw new Error('Maximum connections exceeded');
		}

		const connectionId = uuidv4();
		const now = Date.now();

		const connection: WebSocketConnection = {
			id: connectionId,
			ws,
			sessionId: sessionId || undefined,
			subscribedEvents: new Set(),
			connectedAt: now,
			lastActivity: now
		};

		this.connections.set(connectionId, connection);
		this.connectionSessions.set(connectionId, sessionId || '');
		this.stats.connectionsCreated++;

		if (sessionId) {
			this.bindToSession(connectionId, sessionId);
		}

		// Set up WebSocket event handlers
		this.setupConnectionHandlers(connection);

		logger.info('WebSocket connection added', {
			connectionId,
			sessionId,
			totalConnections: this.connections.size
		});

		return connectionId;
	}

	/**
	 * Remove a WebSocket connection
	 */
	removeConnection(connectionId: string): void {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			return;
		}

		// Remove from session bindings
		if (connection.sessionId) {
			const sessionConnections = this.sessionConnections.get(connection.sessionId);
			if (sessionConnections) {
				sessionConnections.delete(connectionId);
				if (sessionConnections.size === 0) {
					this.sessionConnections.delete(connection.sessionId);
				}
			}
		}

		// Clean up mappings
		this.connections.delete(connectionId);
		this.connectionSessions.delete(connectionId);

		// Close WebSocket if still open
		if (connection.ws.readyState === WebSocket.OPEN) {
			connection.ws.close();
		}

		logger.info('WebSocket connection removed', {
			connectionId,
			sessionId: connection.sessionId,
			totalConnections: this.connections.size
		});
	}

	/**
	 * Bind a connection to a session
	 */
	bindToSession(connectionId: string, sessionId: string): void {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			logger.warn('Attempted to bind non-existent connection to session', {
				connectionId,
				sessionId
			});
			return;
		}

		// Update connection
		connection.sessionId = sessionId;
		this.connectionSessions.set(connectionId, sessionId);

		// Add to session mapping
		if (!this.sessionConnections.has(sessionId)) {
			this.sessionConnections.set(sessionId, new Set());
		}
		this.sessionConnections.get(sessionId)!.add(connectionId);

		// Send connection update to notify client of session binding
		this.sendConnectionUpdate(connectionId);

		// Notify event subscriber to start listening to this session's events
		if (this.eventSubscriber) {
			this.eventSubscriber.subscribeToSession(sessionId);
		}

		logger.debug('Connection bound to session', {
			connectionId,
			sessionId
		});
	}

	/**
	 * Get the session ID for a connection
	 */
	getConnectionSessionId(connectionId: string): string | undefined {
		const connection = this.connections.get(connectionId);
		return connection?.sessionId;
	}

	/**
	 * Send updated connection info to a specific connection
	 */
	sendConnectionUpdate(connectionId: string): void {
		const connection = this.connections.get(connectionId);
		if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
			return;
		}

		const updateMessage = {
			event: 'connectionUpdated',
			data: {
				connectionId,
				sessionId: connection.sessionId,
				timestamp: Date.now()
			},
			timestamp: Date.now()
		};

		try {
			connection.ws.send(JSON.stringify(updateMessage));
			logger.debug('Sent connection update', {
				connectionId,
				sessionId: connection.sessionId
			});
		} catch (error) {
			logger.error('Failed to send connection update', {
				connectionId,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Subscribe a connection to specific event types
	 */
	subscribeToEvents(connectionId: string, eventTypes: WebSocketEventType[]): void {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			logger.warn('Attempted to subscribe non-existent connection to events', {
				connectionId,
				eventTypes
			});
			return;
		}

		eventTypes.forEach(eventType => {
			connection.subscribedEvents!.add(eventType);
		});

		logger.debug('Connection subscribed to events', {
			connectionId,
			eventTypes,
			totalSubscriptions: connection.subscribedEvents!.size
		});
	}

	/**
	 * Unsubscribe a connection from specific event types
	 */
	unsubscribeFromEvents(connectionId: string, eventTypes: WebSocketEventType[]): void {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			return;
		}

		eventTypes.forEach(eventType => {
			connection.subscribedEvents!.delete(eventType);
		});

		logger.debug('Connection unsubscribed from events', {
			connectionId,
			eventTypes,
			totalSubscriptions: connection.subscribedEvents!.size
		});
	}

	/**
	 * Broadcast message to all connections in a session
	 */
	broadcastToSession(sessionId: string, message: WebSocketResponse): void {
		const connectionIds = this.sessionConnections.get(sessionId);
		if (!connectionIds || connectionIds.size === 0) {
			logger.debug('No connections found for session', { sessionId });
			return;
		}

		let sentCount = 0;
		for (const connectionId of connectionIds) {
			if (this.sendToConnection(connectionId, message)) {
				sentCount++;
			}
		}

		logger.debug('Message broadcast to session', {
			sessionId,
			totalConnections: connectionIds.size,
			sentCount,
			event: message.event
		});
	}

	/**
	 * Broadcast message to all active connections
	 */
	broadcastToAll(message: WebSocketResponse): void {
		let sentCount = 0;
		for (const connectionId of this.connections.keys()) {
			if (this.sendToConnection(connectionId, message)) {
				sentCount++;
			}
		}

		logger.debug('Message broadcast to all connections', {
			totalConnections: this.connections.size,
			sentCount,
			event: message.event
		});
	}

	/**
	 * Broadcast message to connections subscribed to specific event type
	 */
	broadcastToSubscribers(eventType: WebSocketEventType, message: WebSocketResponse): void {
		let sentCount = 0;
		for (const connection of this.connections.values()) {
			// If no subscriptions, send all events (default behavior)
			// If has subscriptions, only send subscribed events
			const shouldSend = connection.subscribedEvents!.size === 0 || 
							  connection.subscribedEvents!.has(eventType);

			if (shouldSend && this.sendToConnection(connection.id, message)) {
				sentCount++;
			}
		}

		logger.debug('Message broadcast to subscribers', {
			eventType,
			totalConnections: this.connections.size,
			sentCount,
			event: message.event
		});
	}

	/**
	 * Send message to a specific connection
	 */
	private sendToConnection(connectionId: string, message: WebSocketResponse): boolean {
		const connection = this.connections.get(connectionId);
		if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
			return false;
		}

		try {
			// Add timestamp if not present
			if (!message.timestamp) {
				message.timestamp = Date.now();
			}

			connection.ws.send(JSON.stringify(message));
			connection.lastActivity = Date.now();
			this.stats.totalMessagesSent++;
			return true;
		} catch (error: any) {
			logger.warn('Failed to send WebSocket message', {
				connectionId,
				error: error instanceof Error ? error.message : String(error)
			});
			// Remove failed connection
			this.removeConnection(connectionId);
			return false;
		}
	}

	/**
	 * Get connection statistics
	 */
	getStats(): WebSocketConnectionStats {
		const now = Date.now();
		let totalDuration = 0;
		let activeConnections = 0;
		const activeSessions = new Set<string>();

		for (const connection of this.connections.values()) {
			if (connection.ws.readyState === WebSocket.OPEN) {
				activeConnections++;
				totalDuration += now - connection.connectedAt;
				if (connection.sessionId) {
					activeSessions.add(connection.sessionId);
				}
			}
		}

		const averageConnectionDuration = activeConnections > 0 ? 
			totalDuration / activeConnections : 0;

		return {
			totalConnections: this.stats.connectionsCreated,
			activeConnections,
			totalSessions: this.sessionConnections.size,
			activeSessions: activeSessions.size,
			totalMessagesReceived: this.stats.totalMessagesReceived,
			totalMessagesSent: this.stats.totalMessagesSent,
			averageConnectionDuration
		};
	}

	/**
	 * Get all active session IDs
	 */
	getActiveSessions(): string[] {
		return Array.from(this.sessionConnections.keys()).filter(sessionId => {
			const connections = this.sessionConnections.get(sessionId);
			return connections && connections.size > 0;
		});
	}

	/**
	 * Check if a session has active connections
	 */
	hasActiveConnections(sessionId: string): boolean {
		const connections = this.sessionConnections.get(sessionId);
		if (!connections) return false;

		for (const connectionId of connections) {
			const connection = this.connections.get(connectionId);
			if (connection && connection.ws.readyState === WebSocket.OPEN) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Set up WebSocket event handlers for a connection
	 */
	private setupConnectionHandlers(connection: WebSocketConnection): void {
		connection.ws.on('close', () => {
			this.removeConnection(connection.id);
		});

		connection.ws.on('error', (error) => {
			logger.error('WebSocket connection error', {
				connectionId: connection.id,
				error: error.message
			});
			this.removeConnection(connection.id);
		});

		connection.ws.on('pong', () => {
			connection.lastActivity = Date.now();
		});
	}

	/**
	 * Clean up stale connections
	 */
	private cleanupStaleConnections(): void {
		const now = Date.now();
		const staleConnections: string[] = [];

		for (const [connectionId, connection] of this.connections) {
			// Check if connection is stale
			const isStale = now - connection.lastActivity > this.connectionTimeout ||
							connection.ws.readyState !== WebSocket.OPEN;

			if (isStale) {
				staleConnections.push(connectionId);
			}
		}

		if (staleConnections.length > 0) {
			logger.info('Cleaning up stale WebSocket connections', {
				staleCount: staleConnections.length,
				totalConnections: this.connections.size
			});

			staleConnections.forEach(connectionId => {
				this.removeConnection(connectionId);
			});
		}
	}

	/**
	 * Send heartbeat pings to all connections
	 */
	sendHeartbeat(): void {
		for (const connection of this.connections.values()) {
			if (connection.ws.readyState === WebSocket.OPEN) {
				try {
					connection.ws.ping();
				} catch (error) {
					logger.warn('Failed to send heartbeat ping', {
						connectionId: connection.id,
						error: error instanceof Error ? error.message : String(error)
					});
					this.removeConnection(connection.id);
				}
			}
		}
	}

	/**
	 * Record incoming message for stats
	 */
	recordIncomingMessage(): void {
		this.stats.totalMessagesReceived++;
	}

	/**
	 * Dispose of the connection manager
	 */
	dispose(): void {
		// Close all connections
		for (const connection of this.connections.values()) {
			if (connection.ws.readyState === WebSocket.OPEN) {
				connection.ws.close();
			}
		}

		// Clear all maps
		this.connections.clear();
		this.sessionConnections.clear();
		this.connectionSessions.clear();

		logger.info('WebSocket connection manager disposed');
	}
}