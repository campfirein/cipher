import React from 'react';

export interface ChatState {
	// Modal states
	isModalOpen: boolean;
	isServerRegistryOpen: boolean;
	isServersPanelOpen: boolean;
	isSessionsPanelOpen: boolean;
	isExportOpen: boolean;

	// Export functionality
	exportName: string;
	exportError: string | null;
	exportContent: string;
	copySuccess: boolean;

	// UI states
	isSendingMessage: boolean;
	showShortcuts: boolean;
	errorMessage: string | null;

	// Conversation management
	isDeleteDialogOpen: boolean;
	isDeleting: boolean;
}

export interface ModalStates {
	isModalOpen: boolean;
	isServerRegistryOpen: boolean;
	isServersPanelOpen: boolean;
	isSessionsPanelOpen: boolean;
	isExportOpen: boolean;
	showShortcuts: boolean;
	isDeleteDialogOpen: boolean;
}

export interface OperationStates {
	isSendingMessage: boolean;
	isDeleting: boolean;
	copySuccess: boolean;
}

export interface ExportStates {
	exportName: string;
	exportError: string | null;
	exportContent: string;
}

export interface QuickAction {
	title: string;
	description: string;
	action: () => void;
	icon: string;
}

export interface MessageData {
	base64: string;
	mimeType: string;
	filename?: string;
}

export interface HeaderProps {
	currentSessionId?: string | null;
	isWelcomeState: boolean;
	onToggleSearch: () => void;
	onToggleSessions: () => void;
	onToggleServers: () => void;
	isSessionsPanelOpen: boolean;
	isServersPanelOpen: boolean;
}

export interface WelcomeScreenProps {
	quickActions: QuickAction[];
}

export interface SlidingPanelProps {
	isOpen: boolean;
	width?: string;
	children: React.ReactNode;
	side?: 'left' | 'right';
}

export interface ErrorNotificationProps {
	message: string | null;
	onDismiss: () => void;
}

export interface ActionBarProps {
	onToggleSearch: () => void;
	onToggleSessions: () => void;
	onToggleServers: () => void;
	isSessionsPanelOpen: boolean;
	isServersPanelOpen: boolean;
}

export interface QuickActionCardProps {
	action: QuickAction;
}

// Chat content types
export interface TextPart {
	type: 'text';
	text: string;
}

export interface ImagePart {
	type: 'image';
	base64: string;
	mimeType: string;
}

export interface FilePart {
	type: 'file';
	data: string;
	mimeType: string;
	filename?: string;
}

export interface FileData {
	base64: string;
	mimeType: string;
	filename?: string;
}

// Tool result types
export interface ToolResultError {
	error: string | Record<string, unknown>;
}

export interface ToolResultContent {
	content: Array<TextPart | ImagePart | FilePart>;
}

export type ToolResult = ToolResultError | ToolResultContent | string | Record<string, unknown>;

// WebSocket message types
export interface OutgoingMessage {
	type: 'message' | 'reset';
	content?: string;
	imageData?: { base64: string; mimeType: string };
	fileData?: FileData;
	sessionId?: string;
	stream?: boolean;
}

export interface IncomingMessage {
	event:
		| 'thinking'
		| 'chunk'
		| 'response'
		| 'toolCall'
		| 'toolExecutionStarted'
		| 'toolExecutionProgress'
		| 'toolResult'
		| 'toolExecutionCompleted'
		| 'toolExecutionFailed'
		| 'conversationReset'
		| 'connected'
		| 'connectionUpdated'
		| 'error';
	data: {
		text?: string;
		tokenCount?: number;
		model?: string;
		sessionId?: string;
		messageId?: string;
		timestamp?: number;
		toolName?: string;
		args?: Record<string, unknown>;
		result?: ToolResult;
		message?: string;
		callId?: string;
		executionId?: string;
		progress?: string;
		success?: boolean;
		error?: string;
	};
}

// Connection status
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

// Chat message interface (extending existing Message type)
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	createdAt: number;
	content: string | null | Array<TextPart | ImagePart>;
	imageData?: { base64: string; mimeType: string };
	fileData?: FileData;
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	toolResult?: ToolResult;
	tokenCount?: number;
	model?: string;
	sessionId?: string;
	toolExecutionId?: string;
}

// Hook options
export interface UseChatOptions {
	autoConnect?: boolean;
	onMessage?: (message: ChatMessage) => void;
	onError?: (error: string) => void;
	onStatusChange?: (status: ConnectionStatus) => void;
}

// Session-related types
export interface SessionMessage {
	role: string;
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
}

export interface ToolCall {
	id: string;
	function: {
		name: string;
		arguments: string;
	};
}

// Chat context type
export interface ChatContextType {
	messages: ChatMessage[];
	sendMessage: (
		content: string,
		imageData?: { base64: string; mimeType: string },
		fileData?: { base64: string; mimeType: string; filename?: string }
	) => Promise<void>;
	status: ConnectionStatus;
	reset: () => void;
	currentSessionId: string | null;
	switchSession: (sessionId: string) => Promise<void>;
	loadSessionHistory: (sessionId: string) => Promise<void>;
	isWelcomeState: boolean;
	returnToWelcome: () => void;
	isStreaming: boolean;
	setStreaming: (streaming: boolean) => void;
	websocket: WebSocket | null;
}

// Chat provider props
export interface ChatProviderProps {
	children: React.ReactNode;
	wsUrl?: string;
	autoConnect?: boolean;
}
