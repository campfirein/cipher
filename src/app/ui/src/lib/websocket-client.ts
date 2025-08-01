import {
	WebSocketMessage,
	WebSocketResponse,
	ConnectionStatus,
	WebSocketConfig,
} from '@/types/websocket';

export class WebSocketClient {
	private ws: WebSocket | null = null;
	private config: WebSocketConfig;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private listeners: Map<string, Set<(data: any) => void>> = new Map();
	private status: ConnectionStatus = {
		connected: false,
		connecting: false,
		error: null,
		connectionId: null,
		sessionId: null,
	};

	constructor(config: Partial<WebSocketConfig> = {}) {
		this.config = {
			url: config.url || process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws',
			reconnectAttempts: config.reconnectAttempts || 5,
			reconnectInterval: config.reconnectInterval || 3000,
			heartbeatInterval: config.heartbeatInterval || 30000,
		};
	}

	public connect(sessionId?: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				resolve();
				return;
			}

			this.status.connecting = true;
			this.status.error = null;

			const url = sessionId ? `${this.config.url}?sessionId=${sessionId}` : this.config.url;

			try {
				this.ws = new WebSocket(url);

				this.ws.onopen = () => {
					console.log('WebSocket connected to Cipher backend');
					this.status.connected = true;
					this.status.connecting = false;
					this.reconnectAttempts = 0;
					this.startHeartbeat();
					this.emit('connection', { status: 'connected' });
					resolve();
				};

				this.ws.onmessage = event => {
					try {
						const message: WebSocketResponse = JSON.parse(event.data);
						this.handleMessage(message);
					} catch (error) {
						console.error('Failed to parse WebSocket message:', error);
					}
				};

				this.ws.onclose = event => {
					console.log('WebSocket connection closed:', event.code, event.reason);
					this.status.connected = false;
					this.status.connecting = false;
					this.stopHeartbeat();

					if (event.code !== 1000 && this.reconnectAttempts < this.config.reconnectAttempts) {
						this.scheduleReconnect();
					}

					this.emit('connection', {
						status: 'disconnected',
						code: event.code,
						reason: event.reason,
					});
				};

				this.ws.onerror = error => {
					console.error('WebSocket error:', error);
					this.status.error = 'Connection error';
					this.status.connecting = false;
					this.emit('connection', { status: 'error', error: 'Connection failed' });
					reject(new Error('WebSocket connection failed'));
				};
			} catch (error) {
				this.status.connecting = false;
				this.status.error = 'Failed to create WebSocket connection';
				reject(error);
			}
		});
	}

	public disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.stopHeartbeat();

		if (this.ws) {
			this.ws.close(1000, 'Client disconnect');
			this.ws = null;
		}

		this.status.connected = false;
		this.status.connecting = false;
	}

	public send(message: WebSocketMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn('WebSocket not connected. Cannot send message:', message);
			throw new Error('WebSocket not connected');
		}

		const messageWithTimestamp = {
			...message,
			timestamp: Date.now(),
		};

		this.ws.send(JSON.stringify(messageWithTimestamp));
	}

	public sendChatMessage(message: string, sessionId?: string): void {
		this.send({
			event: 'chat',
			data: {
				message,
				sessionId: sessionId || this.status.sessionId,
				streaming: true,
			},
		});
	}

	public on(event: string, listener: (data: any) => void): void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		this.listeners.get(event)!.add(listener);
	}

	public off(event: string, listener: (data: any) => void): void {
		const eventListeners = this.listeners.get(event);
		if (eventListeners) {
			eventListeners.delete(listener);
			if (eventListeners.size === 0) {
				this.listeners.delete(event);
			}
		}
	}

	public getStatus(): ConnectionStatus {
		return { ...this.status };
	}

	private handleMessage(message: WebSocketResponse): void {
		// Handle connection events
		if (message.event === 'connected') {
			this.status.connectionId = message.data?.connectionId || null;
			this.status.sessionId = message.data?.sessionId || null;
		}

		// Emit to specific event listeners
		this.emit(message.event, message.data);

		// Also emit to general message listeners
		this.emit('message', message);
	}

	private emit(event: string, data: any): void {
		const eventListeners = this.listeners.get(event);
		if (eventListeners) {
			eventListeners.forEach(listener => {
				try {
					listener(data);
				} catch (error) {
					console.error(`Error in WebSocket event listener for ${event}:`, error);
				}
			});
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}

		this.reconnectAttempts++;
		const delay = this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);

		console.log(`Scheduling WebSocket reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

		this.reconnectTimer = setTimeout(() => {
			this.connect().catch(error => {
				console.error('Reconnect attempt failed:', error);
			});
		}, delay);
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.send({
					event: 'ping',
					data: { timestamp: Date.now() },
				});
			}
		}, this.config.heartbeatInterval);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
