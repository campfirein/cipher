export interface ServerRegistryEntry {
	id: string;
	name: string;
	description: string;
	category: 'productivity' | 'development' | 'research' | 'data' | 'communication' | 'custom';
	icon?: string;
	version?: string;
	author?: string;
	homepage?: string;
	config: {
		type: 'stdio' | 'sse' | 'streamable-http';
		command?: string;
		args?: string[];
		url?: string;
		env?: Record<string, string>;
		headers?: Record<string, string>;
		timeout?: number;
	};
	tags?: string[];
	isInstalled: boolean;
	isOfficial: boolean;
	popularity?: number;
	lastUpdated: Date;
	requirements?: {
		platform: 'win32' | 'darwin' | 'linux' | 'all';
		node?: string;
		python?: string;
		dependencies?: string[];
	};
}

export type ServerCategory = ServerRegistryEntry['category'];
export type ServerType = ServerRegistryEntry['config']['type'];
export type ServerPlatform = NonNullable<ServerRegistryEntry['requirements']>['platform'];

export interface ServerRegistryFilter {
	category?: string;
	search?: string;
	installed?: boolean;
	official?: boolean;
	tags?: string[];
}

export interface UseServerRegistryOptions {
	autoLoad?: boolean;
	initialFilter?: ServerRegistryFilter;
}

export interface McpServerConfig {
	type: 'stdio' | 'sse' | 'http';
	// For stdio
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// For sse/http
	url?: string;
	headers?: Record<string, string>;
	// Common
	timeout: number;
	connectionMode: 'lenient' | 'strict';
}

export interface HeaderPair {
	key: string;
	value: string;
	id: string;
}


export interface FileData {
	base64: string;
	mimeType: string;
	filename?: string;
}

export interface ImageData {
	base64: string;
	mimeType: string;
}

export interface Model {
	name: string;
	provider: string;
	model: string;
}

export interface LLMProvider {
	name: string;
	models: string[];
	supportedRouters: string[];
	supportsBaseURL: boolean;
}

export interface LLMConfig {
	config: {
		provider: string;
		model: string;
		apiKey?: string;
		baseURL?: string;
	};
	serviceInfo: {
		router: string;
	};
}

export interface LLMSwitchRequest {
	provider: string;
	model: string;
	router: string;
	apiKey?: string;
	baseURL?: string;
	sessionId?: string;
}

export interface ContentPart {
	type: 'text' | 'image' | 'file';
	text?: string;
	base64?: string;
	mimeType?: string;
	data?: string;
	filename?: string;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string | object | ContentPart[];
	createdAt: number;
	toolName?: string;
	toolArgs?: any;
	toolResult?: any;
	imageData?: { base64: string; mimeType: string };
	fileData?: { base64: string; mimeType: string; filename?: string };
	tokenCount?: number;
	model?: string;
	sessionId?: string;
	toolExecutionId?: string;
}


export interface McpServer {
	id: string;
	name: string;
	status: 'connected' | 'error' | 'disconnected';
	config?: {
		type: 'stdio' | 'sse' | 'streamable-http';
		command?: string;
		args?: string[];
		url?: string;
		env?: Record<string, string>;
		headers?: Record<string, string>;
		timeout?: number;
	};
	lastSeen?: number;
	failureCount?: number;
	error?: string;
}

export interface McpTool {
	name: string;
	description?: string;
	parameters?: {
		type?: string;
		properties?: Record<string, any>;
		required?: string[];
	};
	inputSchema?: {
		properties?: Record<string, any>;
	};
}

export interface ServerRegistryEntryForPanel {
	id: string;
	name: string;
	config: {
		type: 'stdio' | 'sse' | 'streamable-http';
		command?: string;
		args?: string[];
		url?: string;
		env?: Record<string, string>;
		headers?: Record<string, string>;
		timeout?: number;
	};
}

export interface Session {
	id: string;
	createdAt: string | null;
	lastActivity: string | null;
	messageCount: number;
}
