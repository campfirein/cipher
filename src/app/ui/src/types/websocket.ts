// WebSocket message types matching Cipher's backend implementation
export interface WebSocketMessage {
	event: string;
	data?: any;
	timestamp?: number;
	connectionId?: string;
	sessionId?: string;
}

export interface ChatMessage {
	event: 'chat' | 'streaming' | 'tools' | 'memory' | 'reset';
	data: {
		message?: string;
		sessionId?: string;
		streaming?: boolean;
		toolName?: string;
		toolArgs?: Record<string, any>;
		memoryOperation?: 'add' | 'search' | 'clear';
	};
}

export interface WebSocketResponse {
	event: string;
	data: any;
	timestamp: number;
	success?: boolean;
	error?: string;
}

// AI Event types from Cipher's EventManager
export interface AIEvent {
	sessionId: string;
	event: string;
	data: {
		messageId?: string;
		model?: string;
		timestamp: number;
		content?: string;
		tokenCount?: number;
		toolName?: string;
		toolResult?: any;
		error?: string;
	};
}

export interface ConnectionStatus {
	connected: boolean;
	connecting: boolean;
	error: string | null;
	connectionId: string | null;
	sessionId: string | null;
}

export interface WebSocketConfig {
	url: string;
	reconnectAttempts: number;
	reconnectInterval: number;
	heartbeatInterval: number;
}
