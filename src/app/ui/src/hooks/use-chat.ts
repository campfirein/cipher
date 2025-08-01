'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
	ChatMessage,
	ConnectionStatus,
	UseChatOptions,
	OutgoingMessage,
	IncomingMessage,
	FileData,
	TextPart,
	ImagePart,
} from '@/types/chat';
import { generateUniqueId, extractImageFromToolResult, dispatchChatEvent } from '@/lib/chat-utils';

export function useChat(wsUrl: string, options: UseChatOptions = {}) {
	const { autoConnect = true, onMessage, onError, onStatusChange } = options;

	// State management
	const wsRef = useRef<WebSocket | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState<ConnectionStatus>('connecting');
	const lastImageUriRef = useRef<string | null>(null);
	const isMountedRef = useRef(true);

	// Status change handler
	const handleStatusChange = useCallback(
		(newStatus: ConnectionStatus) => {
			setStatus(newStatus);
			onStatusChange?.(newStatus);
		},
		[onStatusChange]
	);

	// WebSocket message handler
	const handleWebSocketMessage = useCallback((event: { data: string }) => {
		let msg: IncomingMessage;
		try {
			msg = JSON.parse(event.data);
		} catch (err) {
			console.error('WebSocket message parse error:', event.data, err);
			return;
		}

		const payload = msg.data || {};

		switch (msg.event) {
			case 'thinking':
				handleThinkingEvent();
				break;
			case 'chunk':
				handleChunkEvent(payload);
				break;
			case 'response':
				handleResponseEvent(payload);
				break;
			case 'conversationReset':
				handleConversationReset();
				break;
			case 'toolCall':
				handleToolCallEvent(payload);
				break;
			case 'toolResult':
				handleToolResultEvent(payload);
				break;
					case 'error':
			handleErrorEvent(payload);
			break;
		case 'connected':
			// WebSocket connection confirmed by backend
			console.log('WebSocket connection confirmed by backend');
			break;
		case 'connectionUpdated':
			// Connection update from backend (e.g., session binding)
			console.log('WebSocket connection updated:', payload);
			break;
		default:
			console.warn('Unknown WebSocket event:', msg.event);
			break;
		}
	}, []);

	// Event handlers
	const handleThinkingEvent = useCallback(() => {
		if (!isMountedRef.current) return;

		setMessages(ms => {
			// Check if there's already a thinking message - if so, don't add another
			const hasThinking = ms.some(m => m.role === 'system' && m.content === 'Cipher is thinking...');
			if (hasThinking) {
				return ms; // Don't add duplicate thinking message
			}

			const thinkingMessage: ChatMessage = {
				id: generateUniqueId(),
				role: 'system',
				content: 'Cipher is thinking...',
				createdAt: Date.now(),
			};

			return [...ms, thinkingMessage];
		});
	}, []);

	// Track processed message content and streaming state
	const processedChunks = useRef<Set<string>>(new Set());
	const currentStreamingMessage = useRef<string | null>(null);

	const handleChunkEvent = useCallback((payload: IncomingMessage['data']) => {
		if (!isMountedRef.current) return;

		const text = typeof payload.text === 'string' ? payload.text : '';
		const messageId = payload.messageId || '';
		
		// Skip empty chunks
		if (!text) return;
		
		// Create unique chunk identifier using message ID and actual content
		const chunkKey = `${messageId}-${text}`;
		
		// Skip if we've already processed this exact chunk content
		if (processedChunks.current.has(chunkKey)) {
			console.warn('Skipping duplicate chunk:', text.slice(0, 50) + '...');
			return;
		}
		
		processedChunks.current.add(chunkKey);

		setMessages(ms => {
			// Remove any existing 'thinking' system messages
			const cleaned = ms.filter(
				m => !(m.role === 'system' && m.content === 'Cipher is thinking...')
			);

			const last = cleaned[cleaned.length - 1];
			
			// If we have an existing assistant message, append to it
			if (last && last.role === 'assistant' && typeof last.content === 'string') {
				// Track the streaming message to detect context switches
				if (currentStreamingMessage.current === null) {
					currentStreamingMessage.current = last.id;
				}
				
				// If this is a different message stream, create new message
				if (messageId && last.id !== messageId) {
					currentStreamingMessage.current = messageId;
					const newMessage: ChatMessage = {
						id: messageId || generateUniqueId(),
						role: 'assistant',
						content: text,
						createdAt: Date.now(),
					};
					return [...cleaned, newMessage];
				}
				
				// Append to existing message
				const newContent = last.content + text;
				const updated: ChatMessage = {
					...last,
					content: newContent,
					createdAt: Date.now(),
				};
				return [...cleaned.slice(0, -1), updated];
			}

			// Create new assistant message
			const newMessageId = messageId || generateUniqueId();
			currentStreamingMessage.current = newMessageId;
			
			const newMessage: ChatMessage = {
				id: newMessageId,
				role: 'assistant',
				content: text,
				createdAt: Date.now(),
			};

			return [...cleaned, newMessage];
		});
	}, []);

	const handleResponseEvent = useCallback(
		(payload: IncomingMessage['data']) => {
			if (!isMountedRef.current) return;

			const text = typeof payload.text === 'string' ? payload.text : '';
			const tokenCount = typeof payload.tokenCount === 'number' ? payload.tokenCount : undefined;
			const model = typeof payload.model === 'string' ? payload.model : undefined;
			const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined;

			setMessages(ms => {
				// Remove 'thinking' placeholders
				const cleaned = ms.filter(
					m => !(m.role === 'system' && m.content === 'Cipher is thinking...')
				);

				// Embed image part in content if available
				let content: string | Array<TextPart | ImagePart> = text;
				if (lastImageUriRef.current) {
					const uri = lastImageUriRef.current;
					const [, base64] = uri.split(',');
					const mimeMatch = uri.match(/data:(.*);base64/);
					const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
					const imagePart: ImagePart = { type: 'image', base64, mimeType };
					content = text.trim() ? [{ type: 'text', text }, imagePart] : [imagePart];
				}

				// Prepare new AI message
				const newMsg: ChatMessage = {
					id: generateUniqueId(),
					role: 'assistant',
					content,
					createdAt: Date.now(),
					tokenCount,
					model,
					sessionId,
				};

				// Check if this response is updating an existing message
				const lastMsg = cleaned[cleaned.length - 1];
				if (lastMsg && lastMsg.role === 'assistant') {
					// If the existing message has content (from streaming), just update metadata
					if (lastMsg.content && typeof lastMsg.content === 'string' && lastMsg.content.trim()) {
						const updatedMsg: ChatMessage = {
							...lastMsg,
							tokenCount,
							model,
							sessionId,
							createdAt: Date.now(), // Update timestamp for completion
						};
						return [...cleaned.slice(0, -1), updatedMsg];
					}
					// If no content yet, replace with new message
					return [...cleaned.slice(0, -1), newMsg];
				}
				return [...cleaned, newMsg];
			});

			// Emit DOM event for other components
			dispatchChatEvent('cipher:response', {
				text,
				sessionId,
				tokenCount,
				model,
				timestamp: Date.now(),
			});

			// Clear the last image for the next message
			lastImageUriRef.current = null;
			
			// Reset streaming state when response is complete
			currentStreamingMessage.current = null;

			// Call onMessage callback if provided
			if (onMessage) {
				const message: ChatMessage = {
					id: generateUniqueId(),
					role: 'assistant',
					content: text,
					createdAt: Date.now(),
					tokenCount,
					model,
					sessionId,
				};
				onMessage(message);
			}
		},
		[onMessage]
	);

	const handleToolCallEvent = useCallback((payload: IncomingMessage['data']) => {
		if (!isMountedRef.current) return;

		const name = payload.toolName;
		const args = payload.args;

		const toolCallMessage: ChatMessage = {
			id: generateUniqueId(),
			role: 'tool',
			content: null,
			toolName: name,
			toolArgs: args,
			createdAt: Date.now(),
		};

		setMessages(ms => [...ms, toolCallMessage]);
	}, []);

	const handleToolResultEvent = useCallback((payload: IncomingMessage['data']) => {
		if (!isMountedRef.current) return;

		const name = payload.toolName;
		const result = payload.result;

		// Extract image URI from tool result
		const uri = result ? extractImageFromToolResult(result) : null;
		lastImageUriRef.current = uri;

		// Merge toolResult into the existing toolCall message
		setMessages(ms => {
			const idx = ms.findIndex(
				m => m.role === 'tool' && m.toolName === name && m.toolResult === undefined
			);
			if (idx !== -1) {
				const updatedMsg: ChatMessage = { ...ms[idx], toolResult: result };
				return [...ms.slice(0, idx), updatedMsg, ...ms.slice(idx + 1)];
			}
			console.warn(`No matching tool call found for result of ${name}`);
			return ms;
		});
	}, []);

	const handleConversationReset = useCallback(() => {
		if (!isMountedRef.current) return;
		setMessages([]);
		// Clear processed chunks and streaming state for new conversation
		processedChunks.current.clear();
		currentStreamingMessage.current = null;
	}, []);

	const handleErrorEvent = useCallback(
		(payload: IncomingMessage['data']) => {
			if (!isMountedRef.current) return;

			const rawMsg = payload.message ?? 'Unknown error';
			const errMsg = typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg, null, 2);

			const errorMessage: ChatMessage = {
				id: generateUniqueId(),
				role: 'system',
				content: errMsg,
				createdAt: Date.now(),
			};

			setMessages(ms => [...ms, errorMessage]);
			onError?.(errMsg);
		},
		[onError]
	);

	// WebSocket connection management
	const connect = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
			return; // Already connected or connecting
		}

		// Close any existing connection first
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		try {
			console.log('Creating WebSocket connection to:', wsUrl);
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				console.log('WebSocket connected successfully');
				handleStatusChange('open');
			};

			ws.onclose = event => {
				console.log('WebSocket disconnected', event.code, event.reason);
				handleStatusChange('closed');

				// Only attempt to reconnect if not intentionally closed and still mounted
				if (event.code !== 1000 && isMountedRef.current && autoConnect) {
					// Add a delay before reconnecting to prevent rapid reconnection loops
					setTimeout(() => {
						if (isMountedRef.current && wsRef.current?.readyState !== WebSocket.OPEN) {
							console.log('Attempting to reconnect...');
							connect();
						}
					}, 3000);
				}
			};

			ws.onerror = error => {
				console.error('WebSocket error:', error);
				onError?.('WebSocket connection error');
			};

			ws.onmessage = handleWebSocketMessage;

			handleStatusChange('connecting');
		} catch (error) {
			console.error('Failed to create WebSocket connection:', error);
			handleStatusChange('closed');
			onError?.('Failed to establish WebSocket connection');
		}
	}, [wsUrl, autoConnect, handleStatusChange, handleWebSocketMessage, onError]);

	const disconnect = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close(1000, 'Intentional disconnect');
			wsRef.current = null;
		}
	}, []);

	// Send message functionality
	const sendMessage = useCallback(
		(
			content: string,
			imageData?: { base64: string; mimeType: string },
			fileData?: FileData,
			sessionId?: string,
			stream = true
		) => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				const message: OutgoingMessage = {
					type: 'message',
					content,
					imageData,
					fileData,
					sessionId,
					stream,
				};

				try {
					wsRef.current.send(JSON.stringify(message));

					// Add user message to local state immediately (optimistic update)
					const userMessage: ChatMessage = {
						id: generateUniqueId(),
						role: 'user',
						content,
						createdAt: Date.now(),
						sessionId,
						imageData,
						fileData,
					};

					setMessages(ms => [...ms, userMessage]);

					// Emit DOM event for other components
					dispatchChatEvent('cipher:message', {
						content,
						sessionId,
						timestamp: Date.now(),
					});

					onMessage?.(userMessage);
				} catch (error) {
					console.error('Failed to send message:', error);
					onError?.('Failed to send message');
				}
			} else {
				console.warn('WebSocket is not connected. Cannot send message.');
				onError?.('Not connected to chat service');
			}
		},
		[onMessage, onError]
	);

	// Reset conversation functionality
	const reset = useCallback(
		(sessionId?: string) => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				const resetMessage: OutgoingMessage = {
					type: 'reset',
					sessionId,
				};

				try {
					wsRef.current.send(JSON.stringify(resetMessage));
				} catch (error) {
					console.error('Failed to send reset message:', error);
					onError?.('Failed to reset conversation');
				}
			}

			// Clear local messages regardless of WebSocket state
			setMessages([]);
		},
		[onError]
	);

	// Clear messages locally
	const clearMessages = useCallback(() => {
		setMessages([]);
		// Clear processed chunks and streaming state
		processedChunks.current.clear();
		currentStreamingMessage.current = null;
	}, []);

	// Auto-connect effect
	useEffect(() => {
		if (autoConnect) {
			connect();
		}

		return () => {
			isMountedRef.current = false;
			if (wsRef.current) {
				wsRef.current.close(1000, 'Component unmounting');
				wsRef.current = null;
			}
		};
	}, [autoConnect]); // Only depend on autoConnect to prevent connection loops

	// Cleanup effect
	useEffect(() => {
		return () => {
			isMountedRef.current = false;
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, []);

	return {
		// State
		messages,
		status,
		isConnected: status === 'open',
		isConnecting: status === 'connecting',

		// Actions
		sendMessage,
		reset,
		clearMessages,
		connect,
		disconnect,

		// Utilities
		setMessages,
		websocket: wsRef.current,
	};
}
