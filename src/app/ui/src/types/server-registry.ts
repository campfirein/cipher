export interface ServerRegistryEntry {
	id: string;
	name: string;
	description: string;
	category: 'productivity' | 'development' | 'custom';
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
	lastUpdated: string;
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
	installedOnly?: boolean;
	officialOnly?: boolean;
	tags?: string[];
}

export interface UseServerRegistryOptions {
	autoLoad?: boolean;
	initialFilter?: ServerRegistryFilter;
}

export interface ServerRegistryService {
	getEntries(filter?: ServerRegistryFilter): Promise<ServerRegistryEntry[]>;
	setInstalled(entryId: string, installed: boolean): Promise<void>;
	addCustomEntry(
		entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>
	): Promise<ServerRegistryEntry>;
	removeEntry(entryId: string): Promise<void>;
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

export interface SearchResult {
	sessionId: string;
	message: {
		role: 'user' | 'assistant' | 'system' | 'tool';
		content: string | null;
	};
	matchedText: string;
	context: string;
	messageIndex: number;
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	hasMore: boolean;
	query: string;
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
}

export interface SessionSearchResult {
	sessionId: string;
	matchCount: number;
	firstMatch: SearchResult;
	metadata: {
		createdAt: number;
		lastActivity: number;
		messageCount: number;
	};
}

export interface SessionSearchResponse {
	results: SessionSearchResult[];
	total: number;
	hasMore: boolean;
	query: string;
}

export type SearchMode = 'messages' | 'sessions';

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
}

export interface McpTool {
	name: string;
	description?: string;
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
