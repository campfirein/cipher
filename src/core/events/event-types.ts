// Service-level events (global to cipher instance)
export interface ServiceEventMap {
	// Cipher lifecycle events
	'cipher:started': { timestamp: number; version?: string };
	'cipher:stopped': { timestamp: number; reason?: string };
	'cipher:error': { error: string; stack?: string; timestamp: number };

	// Service initialization events
	'cipher:serviceStarted': { serviceType: string; timestamp: number };
	'cipher:serviceError': { serviceType: string; error: string; timestamp: number };
	'cipher:allServicesReady': { timestamp: number; services: string[] };

	// Tool registration events
	'cipher:toolRegistered': { toolName: string; toolType: 'internal' | 'mcp'; timestamp: number };
	'cipher:toolUnregistered': { toolName: string; toolType: 'internal' | 'mcp'; timestamp: number };
	'cipher:toolError': { toolName: string; error: string; timestamp: number };

	// MCP connection events
	'cipher:mcpClientConnected': { clientId: string; serverName: string; timestamp: number };
	'cipher:mcpClientDisconnected': {
		clientId: string;
		serverName: string;
		reason?: string;
		timestamp: number;
	};
	'cipher:mcpClientError': {
		clientId: string;
		serverName: string;
		error: string;
		timestamp: number;
	};

	// Memory operations
	'cipher:memoryOperationStarted': { operation: string; sessionId?: string; timestamp: number };
	'cipher:memoryOperationCompleted': {
		operation: string;
		sessionId?: string;
		duration: number;
		timestamp: number;
	};
	'cipher:memoryOperationFailed': {
		operation: string;
		sessionId?: string;
		error: string;
		timestamp: number;
	};

	// Vector store events
	'cipher:vectorStoreConnected': { provider: string; timestamp: number };
	'cipher:vectorStoreDisconnected': { provider: string; reason?: string; timestamp: number };
	'cipher:vectorStoreError': { provider: string; error: string; timestamp: number };

	// LLM service events
	'cipher:llmProviderRegistered': { provider: string; timestamp: number };
	'cipher:llmProviderError': { provider: string; error: string; timestamp: number };
}

// Session-level events (scoped to individual conversations)
export interface SessionEventMap {
	// Session lifecycle
	'session:created': { sessionId: string; timestamp: number };
	'session:activated': { sessionId: string; timestamp: number };
	'session:deactivated': { sessionId: string; timestamp: number };
	'session:expired': { sessionId: string; timestamp: number };
	'session:deleted': { sessionId: string; timestamp: number };

	// Tool execution events
	'tool:executionStarted': {
		toolName: string;
		toolType: 'internal' | 'mcp';
		sessionId: string;
		executionId: string;
		timestamp: number;
	};
	'tool:executionCompleted': {
		toolName: string;
		toolType: 'internal' | 'mcp';
		sessionId: string;
		executionId: string;
		duration: number;
		success: boolean;
		timestamp: number;
	};
	'tool:executionFailed': {
		toolName: string;
		toolType: 'internal' | 'mcp';
		sessionId: string;
		executionId: string;
		error: string;
		duration: number;
		timestamp: number;
	};

	// LLM interaction events
	'llm:thinking': { sessionId: string; messageId: string; timestamp: number };
	'llm:responseStarted': { sessionId: string; messageId: string; model: string; timestamp: number };
	'llm:responseChunk': {
		sessionId: string;
		messageId: string;
		chunk: string;
		text: string;
		isComplete: boolean;
		timestamp: number;
	};
	'llm:responseCompleted': {
		sessionId: string;
		messageId: string;
		model: string;
		content?: string;
		response?: string;
		tokenCount?: number;
		duration?: number;
		timestamp: number;
	};
	'llm:responseError': {
		sessionId: string;
		messageId: string;
		model: string;
		error: string;
		timestamp: number;
	};

	// Memory operations (session-scoped)
	'memory:stored': {
		sessionId: string;
		type: 'conversation' | 'embedding' | 'knowledge';
		size: number;
		timestamp: number;
	};
	'memory:retrieved': {
		sessionId: string;
		type: 'conversation' | 'embedding' | 'knowledge';
		count: number;
		timestamp: number;
	};
	'memory:searched': {
		sessionId: string;
		query: string;
		resultCount: number;
		duration: number;
		timestamp: number;
	};

	// Conversation events
	'conversation:messageAdded': {
		sessionId: string;
		messageId: string;
		role: 'user' | 'assistant' | 'system';
		timestamp: number;
	};
	'conversation:messageUpdated': {
		sessionId: string;
		messageId: string;
		timestamp: number;
	};
	'conversation:cleared': { sessionId: string; timestamp: number };

	// Context events
	'context:updated': { sessionId: string; contextSize: number; timestamp: number };
	'context:truncated': { sessionId: string; removedCount: number; timestamp: number };
}

// Event metadata for filtering and routing
export interface EventMetadata {
	timestamp: number;
	sessionId?: string;
	source?: string;
	priority?: 'high' | 'normal' | 'low';
	tags?: string[];
	eventManagerId?: string;
}

// Event envelope for persistence and routing
export interface EventEnvelope<T = any> {
	id: string;
	type: string;
	data: T;
	metadata: EventMetadata;
}

// Event filter function type
export type EventFilter<T = any> = (event: EventEnvelope<T>) => boolean;

// Event transformation function type
export type EventTransformer<T = any, R = any> = (event: EventEnvelope<T>) => EventEnvelope<R>;

// Event constants to prevent typos
export const ServiceEvents = {
	CIPHER_STARTED: 'cipher:started' as const,
	CIPHER_STOPPED: 'cipher:stopped' as const,
	CIPHER_ERROR: 'cipher:error' as const,
	SERVICE_STARTED: 'cipher:serviceStarted' as const,
	SERVICE_ERROR: 'cipher:serviceError' as const,
	ALL_SERVICES_READY: 'cipher:allServicesReady' as const,
	TOOL_REGISTERED: 'cipher:toolRegistered' as const,
	TOOL_UNREGISTERED: 'cipher:toolUnregistered' as const,
	TOOL_ERROR: 'cipher:toolError' as const,
	MCP_CLIENT_CONNECTED: 'cipher:mcpClientConnected' as const,
	MCP_CLIENT_DISCONNECTED: 'cipher:mcpClientDisconnected' as const,
	MCP_CLIENT_ERROR: 'cipher:mcpClientError' as const,
	MEMORY_OPERATION_STARTED: 'cipher:memoryOperationStarted' as const,
	MEMORY_OPERATION_COMPLETED: 'cipher:memoryOperationCompleted' as const,
	MEMORY_OPERATION_FAILED: 'cipher:memoryOperationFailed' as const,
	VECTOR_STORE_CONNECTED: 'cipher:vectorStoreConnected' as const,
	VECTOR_STORE_DISCONNECTED: 'cipher:vectorStoreDisconnected' as const,
	VECTOR_STORE_ERROR: 'cipher:vectorStoreError' as const,
	LLM_PROVIDER_REGISTERED: 'cipher:llmProviderRegistered' as const,
	LLM_PROVIDER_ERROR: 'cipher:llmProviderError' as const,
} as const;

export const SessionEvents = {
	SESSION_CREATED: 'session:created' as const,
	SESSION_ACTIVATED: 'session:activated' as const,
	SESSION_DEACTIVATED: 'session:deactivated' as const,
	SESSION_EXPIRED: 'session:expired' as const,
	SESSION_DELETED: 'session:deleted' as const,
	TOOL_EXECUTION_STARTED: 'tool:executionStarted' as const,
	TOOL_EXECUTION_COMPLETED: 'tool:executionCompleted' as const,
	TOOL_EXECUTION_FAILED: 'tool:executionFailed' as const,
	LLM_THINKING: 'llm:thinking' as const,
	LLM_RESPONSE_STARTED: 'llm:responseStarted' as const,
	LLM_RESPONSE_CHUNK: 'llm:responseChunk' as const,
	LLM_RESPONSE_COMPLETED: 'llm:responseCompleted' as const,
	LLM_RESPONSE_ERROR: 'llm:responseError' as const,
	MEMORY_STORED: 'memory:stored' as const,
	MEMORY_RETRIEVED: 'memory:retrieved' as const,
	MEMORY_SEARCHED: 'memory:searched' as const,
	CONVERSATION_MESSAGE_ADDED: 'conversation:messageAdded' as const,
	CONVERSATION_MESSAGE_UPDATED: 'conversation:messageUpdated' as const,
	CONVERSATION_CLEARED: 'conversation:cleared' as const,
	CONTEXT_UPDATED: 'context:updated' as const,
	CONTEXT_TRUNCATED: 'context:truncated' as const,
} as const;
