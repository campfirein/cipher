// API response types matching Cipher's backend
export interface ApiResponse<T = any> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: any;
	};
	requestId?: string;
}

export interface SessionInfo {
	sessionId: string;
	createdAt: string;
	lastActivity: string;
	messageCount: number;
	status: 'active' | 'inactive';
}

export interface MessageResponse {
	response: string;
	sessionId: string;
	messageId: string;
	timestamp: number;
	model?: string;
	tokenCount?: number;
	toolsUsed?: string[];
}

export interface LLMConfig {
	provider: string;
	model: string;
	maxTokens?: number;
	temperature?: number;
	topP?: number;
}

export interface MCPServer {
	name: string;
	status: 'connected' | 'disconnected' | 'error';
	tools?: string[];
	lastPing?: number;
}

export interface SystemHealth {
	status: 'healthy' | 'degraded' | 'unhealthy';
	timestamp: string;
	uptime: number;
	version: string;
	websocket?: {
		enabled: boolean;
		active: boolean;
		stats: {
			connections: number;
			totalMessages: number;
			totalEvents: number;
		};
	};
}
