import { SessionMessage, ChatMessage, ToolCall } from '@/types/chat';

// API base URL configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// WebSocket URL configuration
export function getWebSocketUrl(customUrl?: string): string {
	let wsUrl = customUrl || process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

	if (typeof window !== 'undefined') {
		try {
			const urlObj = new URL(wsUrl);
			if (urlObj.hostname === 'localhost') {
				// Replace localhost with current hostname for network access
				urlObj.hostname = window.location.hostname;
				wsUrl = urlObj.toString();
			}
		} catch (e) {
			console.warn('Invalid WS URL:', wsUrl);
		}
	}

	return wsUrl;
}

// Auto-session creation
export async function createAutoSession(): Promise<string> {
	try {
		const response = await fetch('/api/sessions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}), // Let server generate random UUID
		});

		if (!response.ok) {
			throw new Error('Failed to create session');
		}

		const data = await response.json();
		// Handle the standardized API response format
		if (data.success && data.data?.session?.id) {
			return data.data.session.id;
		} else if (data.data?.sessionId) {
			return data.data.sessionId;
		} else {
			console.error('Unexpected session response format:', data);
			throw new Error('Invalid session response format');
		}
	} catch (error) {
		console.error('Error creating auto session:', error);
		// Fallback to a simple timestamp-based session ID
		return `chat-${Date.now()}`;
	}
}

// Load session on backend
export async function loadSession(sessionId: string): Promise<void> {
	const response = await fetch(`/api/sessions/${sessionId}/load`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	});

	if (!response.ok) {
		throw new Error('Failed to load session on backend');
	}
}

// Load session history
export async function loadSessionHistory(sessionId: string): Promise<SessionMessage[]> {
	const response = await fetch(`/api/sessions/${sessionId}/history`);

	if (!response.ok) {
		if (response.status === 404) {
			// Session doesn't exist, create it
			const createResponse = await fetch('/api/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId }),
			});

			if (!createResponse.ok) {
				throw new Error('Failed to create session');
			}

			// New session has no history
			return [];
		}
		throw new Error('Failed to load session history');
	}

	const data = await response.json();
	return data.data?.history || data.history || [];
}

// Convert session history to UI messages
export function convertHistoryToUIMessages(
	history: SessionMessage[],
	sessionId: string
): ChatMessage[] {
	const uiMessages: ChatMessage[] = [];

	for (let index = 0; index < history.length; index++) {
		const msg = history[index];
		const baseMessage: ChatMessage = {
			id: `session-${sessionId}-${index}`,
			role: msg.role as ChatMessage['role'],
			content: msg.content,
			createdAt: Date.now() - (history.length - index) * 1000, // Approximate timestamps
			sessionId: sessionId,
		};

		if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
			// Handle assistant messages with tool calls
			if (msg.content) {
				uiMessages.push(baseMessage);
			}

			// Add tool call messages for each tool call
			msg.toolCalls.forEach((toolCall: ToolCall, toolIndex: number) => {
				const toolArgs = toolCall.function ? JSON.parse(toolCall.function.arguments || '{}') : {};
				const toolName = toolCall.function?.name || 'unknown';

				// Look for corresponding tool result in subsequent messages
				let toolResult: string | undefined = undefined;
				for (let j = index + 1; j < history.length; j++) {
					const nextMsg = history[j];
					if (nextMsg.role === 'tool' && nextMsg.toolCallId === toolCall.id) {
						toolResult = nextMsg.content;
						break;
					}
				}

				uiMessages.push({
					id: `session-${sessionId}-${index}-tool-${toolIndex}`,
					role: 'tool',
					content: null,
					createdAt: Date.now() - (history.length - index) * 1000 + toolIndex,
					sessionId: sessionId,
					toolName: toolName,
					toolArgs: toolArgs,
					toolResult: toolResult,
				});
			});
		} else if (msg.role === 'tool') {
			// Skip standalone tool messages as they're handled above
			continue;
		} else {
			// Handle regular messages (user, system, assistant without tool calls)
			uiMessages.push(baseMessage);
		}
	}

	return uiMessages;
}

// Reset backend session
export async function resetBackendSession(): Promise<void> {
	try {
		await fetch('/api/sessions/null/load', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.warn('Error resetting backend session:', error);
	}
}

// Create new session with optional ID
export async function createSession(sessionId?: string): Promise<{ id: string }> {
	const response = await fetch(`${API_BASE_URL}/api/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(sessionId ? { sessionId } : {}),
	});

	if (!response.ok) {
		throw new Error('Failed to create session');
	}

	const data = await response.json();
	// Handle the standardized API response format 
	if (data.success && data.data?.session) {
		return data.data.session;
	} else if (data.data?.sessionId) {
		return { id: data.data.sessionId };
	} else {
		console.error('Unexpected session response format:', data);
		throw new Error('Invalid session response format');
	}
}
