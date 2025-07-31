import { WebSocket } from 'ws';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { logger } from '@core/logger/index.js';
import { WebSocketMessage, WebSocketResponse, WebSocketEventType } from './types.js';
import { WebSocketConnectionManager } from './connection-manager.js';
import { v4 as uuidv4 } from 'uuid';

export class WebSocketMessageRouter {
	constructor(
		private agent: MemAgent,
		private connectionManager: WebSocketConnectionManager
	) {}

	/**
	 * Route incoming WebSocket message to appropriate handler
	 */
	async routeMessage(ws: WebSocket, connectionId: string, message: WebSocketMessage): Promise<void> {
		try {
			// Record incoming message for stats
			this.connectionManager.recordIncomingMessage();

			// Validate message format
			if (!this.isValidMessage(message)) {
				this.sendError(ws, 'Invalid message format', connectionId);
				return;
			}

			// Log incoming message
			logger.debug('WebSocket message received', {
				connectionId,
				type: message.type,
				sessionId: message.sessionId,
				hasContent: !!message.content
			});

			// Route based on message type
			switch (message.type) {
				case 'message':
					await this.handleChatMessage(ws, connectionId, message);
					break;
				case 'reset':
					await this.handleReset(ws, connectionId, message);
					break;
				case 'subscribe':
					await this.handleSubscribe(ws, connectionId, message);
					break;
				case 'unsubscribe':
					await this.handleUnsubscribe(ws, connectionId, message);
					break;
				default:
					this.sendError(ws, `Unknown message type: ${message.type}`, connectionId);
			}
		} catch (error) {
			logger.error('Error routing WebSocket message', {
				connectionId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			});
			this.sendError(
				ws, 
				error instanceof Error ? error.message : 'Internal server error',
				connectionId
			);
		}
	}

	/**
	 * Handle chat message - process through MemAgent
	 */
	private async handleChatMessage(ws: WebSocket, connectionId: string, message: WebSocketMessage): Promise<void> {
		if (!message.content) {
			this.sendError(ws, 'Message content is required', connectionId);
			return;
		}

		let sessionId = message.sessionId;

		// Auto-create session if not provided
		if (!sessionId) {
			try {
				const session = await this.agent.sessionManager.createSession();
				sessionId = session.id;
				
				// Bind connection to new session
				this.connectionManager.bindToSession(connectionId, sessionId);

				// Notify client of session creation
				this.sendResponse(ws, {
					event: 'sessionCreated',
					data: { sessionId },
					sessionId
				});

				logger.info('Auto-created session for WebSocket connection', {
					connectionId,
					sessionId
				});
			} catch (error) {
				logger.error('Failed to create session for WebSocket connection', {
					connectionId,
					error: error instanceof Error ? error.message : String(error)
				});
				this.sendError(ws, 'Failed to create session', connectionId);
				return;
			}
		} else {
			// Bind connection to existing session
			this.connectionManager.bindToSession(connectionId, sessionId);
		}

		// Validate session exists
		try {
			const session = await this.agent.sessionManager.getSession(sessionId);
			if (!session) {
				this.sendError(ws, `Session ${sessionId} not found`, connectionId);
				return;
			}
		} catch (error) {
			logger.error('Error validating session', {
				sessionId,
				connectionId,
				error: error instanceof Error ? error.message : String(error)
			});
			this.sendError(ws, 'Session validation failed', connectionId);
			return;
		}

		// Process message through MemAgent with streaming enabled
		try {
			logger.info('Processing WebSocket chat message', {
				connectionId,
				sessionId,
				contentLength: message.content.length,
				hasImageData: !!message.imageData,
				hasFileData: !!message.fileData,
				stream: message.stream ?? true
			});

			// Run the agent with streaming enabled
			// Convert imageData to the expected format if provided
			const imageData = message.imageData ? {
				image: message.imageData,
				mimeType: 'image/jpeg' // Default mime type, could be detected from data
			} : undefined;

			await this.agent.run(
				message.content,
				imageData,
				sessionId,
				message.stream ?? true
			);

			logger.debug('WebSocket chat message processed successfully', {
				connectionId,
				sessionId
			});

		} catch (error) {
			logger.error('Error processing chat message through MemAgent', {
				connectionId,
				sessionId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			});

			// Send error to client
			this.connectionManager.broadcastToSession(sessionId, {
				event: 'error',
				data: {
					message: error instanceof Error ? error.message : 'Processing failed',
					code: 'PROCESSING_ERROR',
					sessionId
				},
				sessionId,
				error: error instanceof Error ? error.message : 'Processing failed'
			});
		}
	}

	/**
	 * Handle conversation reset
	 */
	private async handleReset(ws: WebSocket, connectionId: string, message: WebSocketMessage): Promise<void> {
		const sessionId = message.sessionId;
		if (!sessionId) {
			this.sendError(ws, 'Session ID is required for reset', connectionId);
			return;
		}

		try {
			// Get session and reset it
			const session = await this.agent.getSession(sessionId);
			if (!session) {
				this.sendError(ws, `Session ${sessionId} not found`, connectionId);
				return;
			}

			// Clear conversation history - this will depend on the session implementation
			// For now, we'll emit the reset event and let the client handle it
			
			// Notify client of successful reset
			this.sendResponse(ws, {
				event: 'conversationReset',
				data: { sessionId },
				sessionId
			});

			logger.info('Conversation reset via WebSocket', {
				connectionId,
				sessionId
			});

		} catch (error) {
			logger.error('Error resetting conversation', {
				connectionId,
				sessionId,
				error: error instanceof Error ? error.message : String(error)
			});
			this.sendError(ws, 'Failed to reset conversation', connectionId);
		}
	}

	/**
	 * Handle event subscription
	 */
	private async handleSubscribe(ws: WebSocket, connectionId: string, message: WebSocketMessage): Promise<void> {
		if (!message.eventTypes || message.eventTypes.length === 0) {
			this.sendError(ws, 'Event types are required for subscription', connectionId);
			return;
		}

		try {
			// Validate event types
			const validEventTypes = message.eventTypes.filter(eventType => 
				this.isValidEventType(eventType)
			) as WebSocketEventType[];

			if (validEventTypes.length === 0) {
				this.sendError(ws, 'No valid event types provided', connectionId);
				return;
			}

			// Subscribe connection to events
			this.connectionManager.subscribeToEvents(connectionId, validEventTypes);

			// Confirm subscription
			this.sendResponse(ws, {
				event: 'subscribed',
				data: { 
					eventTypes: validEventTypes,
					connectionId 
				}
			});

			logger.info('WebSocket connection subscribed to events', {
				connectionId,
				eventTypes: validEventTypes
			});

		} catch (error) {
			logger.error('Error handling event subscription', {
				connectionId,
				error: error instanceof Error ? error.message : String(error)
			});
			this.sendError(ws, 'Failed to subscribe to events', connectionId);
		}
	}

	/**
	 * Handle event unsubscription
	 */
	private async handleUnsubscribe(ws: WebSocket, connectionId: string, message: WebSocketMessage): Promise<void> {
		if (!message.eventTypes || message.eventTypes.length === 0) {
			this.sendError(ws, 'Event types are required for unsubscription', connectionId);
			return;
		}

		try {
			// Validate event types
			const validEventTypes = message.eventTypes.filter(eventType => 
				this.isValidEventType(eventType)
			) as WebSocketEventType[];

			// Unsubscribe connection from events
			this.connectionManager.unsubscribeFromEvents(connectionId, validEventTypes);

			// Confirm unsubscription
			this.sendResponse(ws, {
				event: 'unsubscribed',
				data: { 
					eventTypes: validEventTypes,
					connectionId 
				}
			});

			logger.info('WebSocket connection unsubscribed from events', {
				connectionId,
				eventTypes: validEventTypes
			});

		} catch (error) {
			logger.error('Error handling event unsubscription', {
				connectionId,
				error: error instanceof Error ? error.message : String(error)
			});
			this.sendError(ws, 'Failed to unsubscribe from events', connectionId);
		}
	}

	/**
	 * Send error response to WebSocket client
	 */
	private sendError(ws: WebSocket, message: string, connectionId?: string): void {
		try {
			const errorResponse: WebSocketResponse = {
				event: 'error',
				error: message,
				data: {
					message,
					code: 'WEBSOCKET_ERROR',
					timestamp: Date.now(),
					...(connectionId && { connectionId })
				},
				timestamp: Date.now()
			};

			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(errorResponse));
			}

			logger.warn('WebSocket error sent to client', {
				connectionId,
				message
			});
		} catch (error) {
			logger.error('Failed to send error response', {
				connectionId,
				originalMessage: message,
				sendError: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Send response to WebSocket client
	 */
	private sendResponse(ws: WebSocket, response: WebSocketResponse): void {
		try {
			if (!response.timestamp) {
				response.timestamp = Date.now();
			}

			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(response));
			}
		} catch (error) {
			logger.error('Failed to send WebSocket response', {
				event: response.event,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Validate incoming message format
	 */
	private isValidMessage(message: any): message is WebSocketMessage {
		if (!message || typeof message !== 'object') {
			return false;
		}

		// Check required type field
		if (!message.type || typeof message.type !== 'string') {
			return false;
		}

		// Validate type values
		const validTypes = ['message', 'reset', 'subscribe', 'unsubscribe'];
		if (!validTypes.includes(message.type)) {
			return false;
		}

		// Type-specific validation
		switch (message.type) {
			case 'message':
				return typeof message.content === 'string' && message.content.length > 0;
			case 'reset':
				return typeof message.sessionId === 'string';
			case 'subscribe':
			case 'unsubscribe':
				return Array.isArray(message.eventTypes) && message.eventTypes.length > 0;
			default:
				return false;
		}
	}

	/**
	 * Validate event type
	 */
	private isValidEventType(eventType: string): boolean {
		const validEventTypes: WebSocketEventType[] = [
			'thinking', 'chunk', 'toolCall', 'toolResult', 'response', 'error',
			'conversationReset', 'memoryOperation', 'systemMessage', 'sessionCreated',
			'sessionEnded', 'mcpServerConnected', 'mcpServerDisconnected', 'availableToolsUpdated'
		];
		return validEventTypes.includes(eventType as WebSocketEventType);
	}

	/**
	 * Get router statistics
	 */
	getStats(): {
		messagesProcessed: number;
		errorsHandled: number;
		activeSessions: number;
	} {
		return {
			messagesProcessed: this.connectionManager.getStats().totalMessagesReceived,
			errorsHandled: 0, // TODO: Track errors
			activeSessions: this.connectionManager.getActiveSessions().length
		};
	}
}