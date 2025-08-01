import { WebSocket } from 'ws';

export interface WebSocketMessage {
	type: 'message' | 'reset' | 'subscribe' | 'unsubscribe';
	content?: string;
	sessionId?: string;
	stream?: boolean;
	imageData?: string;
	fileData?: any;
	eventTypes?: string[];
}

export interface WebSocketResponse {
	event: string;
	data?: Record<string, any>;
	sessionId?: string;
	error?: string;
	timestamp?: number;
}

export interface WebSocketConnection {
	id: string;
	ws: WebSocket;
	sessionId?: string | undefined;
	subscribedEvents: Set<string>;
	connectedAt: number;
	lastActivity: number;
}

export interface WebSocketConnectionStats {
	totalConnections: number;
	activeConnections: number;
	totalSessions: number;
	activeSessions: number;
	totalMessagesReceived: number;
	totalMessagesSent: number;
	averageConnectionDuration: number;
}

export interface WebSocketConfig {
	path?: string;
	heartbeatInterval?: number;
	connectionTimeout?: number;
	maxConnections?: number;
	maxMessageSize?: number;
	enableCompression?: boolean;
}

export type WebSocketEventType =
	| 'thinking'
	| 'chunk'
	| 'toolCall'
	| 'toolResult'
	| 'response'
	| 'error'
	| 'conversationReset'
	| 'memoryOperation'
	| 'systemMessage'
	| 'sessionCreated'
	| 'sessionEnded'
	| 'connectionUpdated'
	| 'mcpServerConnected'
	| 'mcpServerDisconnected'
	| 'availableToolsUpdated';

export interface WebSocketEventData {
	thinking: { sessionId: string };
	chunk: {
		text: string;
		isComplete: boolean;
		sessionId: string;
		messageId?: string;
	};
	toolCall: {
		toolName: string;
		args: Record<string, any>;
		sessionId: string;
		callId?: string;
	};
	toolResult: {
		toolName: string;
		result: any;
		success: boolean;
		sessionId: string;
		callId?: string;
	};
	response: {
		content: string;
		sessionId: string;
		messageId?: string;
		metadata?: Record<string, any>;
	};
	error: {
		message: string;
		code?: string;
		sessionId?: string;
		stack?: string;
	};
	conversationReset: { sessionId: string };
	memoryOperation: {
		operation: 'store' | 'retrieve' | 'search';
		success: boolean;
		sessionId: string;
		details?: Record<string, any>;
	};
	systemMessage: {
		message: string;
		level: 'info' | 'warning' | 'error';
		sessionId?: string;
	};
	sessionCreated: { sessionId: string; timestamp: number };
	sessionEnded: { sessionId: string; timestamp: number };
	connectionUpdated: { connectionId: string; sessionId?: string; timestamp: number };
	mcpServerConnected: { serverName: string; capabilities: string[] };
	mcpServerDisconnected: { serverName: string; reason?: string };
	availableToolsUpdated: { tools: string[]; sessionId?: string };
}
