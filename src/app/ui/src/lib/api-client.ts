import { ApiResponse, SessionInfo, MessageResponse, SystemHealth, LLMConfig } from '@/types/api';

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiClient {
	private baseUrl: string;

	constructor(baseUrl?: string) {
		this.baseUrl = baseUrl || DEFAULT_BASE_URL;
	}

	private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
		const url = `${this.baseUrl}${endpoint}`;

		const defaultHeaders = {
			'Content-Type': 'application/json',
		};

		try {
			const response = await fetch(url, {
				...options,
				headers: {
					...defaultHeaders,
					...options.headers,
				},
			});

			const data = await response.json();

			if (!response.ok) {
				return {
					success: false,
					error: {
						code: data.error?.code || 'HTTP_ERROR',
						message: data.error?.message || `HTTP ${response.status}: ${response.statusText}`,
						details: data.error?.details,
					},
					requestId: data.requestId,
				};
			}

			return data;
		} catch (error) {
			return {
				success: false,
				error: {
					code: 'NETWORK_ERROR',
					message: error instanceof Error ? error.message : 'Network request failed',
				},
			};
		}
	}

	// Health check
	async getHealth(): Promise<ApiResponse<SystemHealth>> {
		return this.request<SystemHealth>('/health');
	}

	// WebSocket stats
	async getWebSocketStats(): Promise<ApiResponse<any>> {
		return this.request<any>('/ws/stats');
	}

	// Session management
	async createSession(): Promise<ApiResponse<SessionInfo>> {
		return this.request<SessionInfo>('/api/sessions', {
			method: 'POST',
		});
	}

	async getSession(sessionId: string): Promise<ApiResponse<SessionInfo>> {
		return this.request<SessionInfo>(`/api/sessions/${sessionId}`);
	}

	async getSessions(): Promise<ApiResponse<SessionInfo[]>> {
		return this.request<SessionInfo[]>('/api/sessions');
	}

	async deleteSession(sessionId: string): Promise<ApiResponse<void>> {
		return this.request<void>(`/api/sessions/${sessionId}`, {
			method: 'DELETE',
		});
	}

	// Message handling
	async sendMessage(
		message: string,
		sessionId?: string,
		imageData?: string
	): Promise<ApiResponse<MessageResponse>> {
		return this.request<MessageResponse>('/api/message', {
			method: 'POST',
			body: JSON.stringify({
				message,
				sessionId,
				imageData,
			}),
		});
	}

	// LLM configuration
	async getLLMConfig(): Promise<ApiResponse<LLMConfig>> {
		return this.request<LLMConfig>('/api/llm/config');
	}

	async updateLLMConfig(config: Partial<LLMConfig>): Promise<ApiResponse<LLMConfig>> {
		return this.request<LLMConfig>('/api/llm/config', {
			method: 'PUT',
			body: JSON.stringify(config),
		});
	}

	// MCP server management
	async getMCPServers(): Promise<ApiResponse<any>> {
		return this.request<any>('/api/mcp/servers');
	}

	async getMCPTools(): Promise<ApiResponse<any>> {
		return this.request<any>('/api/mcp/tools');
	}

	async addMCPServer(name: string, config: any): Promise<ApiResponse<any>> {
		return this.request<any>('/api/mcp/servers', {
			method: 'POST',
			body: JSON.stringify({ name, config }),
		});
	}

	async removeMCPServer(serverId: string): Promise<ApiResponse<void>> {
		return this.request<void>(`/api/mcp/servers/${serverId}`, {
			method: 'DELETE',
		});
	}

	async getServerTools(serverId: string): Promise<ApiResponse<any>> {
		return this.request<any>(`/api/mcp/servers/${serverId}/tools`);
	}

	async executeServerTool(serverId: string, toolName: string, params: any): Promise<ApiResponse<any>> {
		return this.request<any>(`/api/mcp/servers/${serverId}/tools/${toolName}/execute`, {
			method: 'POST',
			body: JSON.stringify(params),
		});
	}

	// Session management extensions
	async loadSession(sessionId: string): Promise<ApiResponse<SessionInfo>> {
		return this.request<SessionInfo>(`/api/sessions/${sessionId}/load`, {
			method: 'POST',
		});
	}

	async getSessionHistory(sessionId: string): Promise<ApiResponse<any>> {
		return this.request<any>(`/api/sessions/${sessionId}/history`);
	}

	async getCurrentSession(): Promise<ApiResponse<SessionInfo>> {
		return this.request<SessionInfo>('/api/sessions/current');
	}

	// Search functionality
	async searchMessages(query: string, options?: {
		sessionId?: string;
		role?: string;
		limit?: number;
		offset?: number;
	}): Promise<ApiResponse<any>> {
		const params = new URLSearchParams({ query });
		if (options?.sessionId) params.append('sessionId', options.sessionId);
		if (options?.role) params.append('role', options.role);
		if (options?.limit) params.append('limit', options.limit.toString());
		if (options?.offset) params.append('offset', options.offset.toString());

		return this.request<any>(`/api/search/messages?${params}`);
	}

	async searchSessions(query: string): Promise<ApiResponse<any>> {
		return this.request<any>(`/api/search/sessions?query=${encodeURIComponent(query)}`);
	}

	// Webhook management
	async getWebhooks(): Promise<ApiResponse<any>> {
		return this.request<any>('/api/webhooks');
	}

	async createWebhook(url: string, events?: string[]): Promise<ApiResponse<any>> {
		return this.request<any>('/api/webhooks', {
			method: 'POST',
			body: JSON.stringify({ url, events }),
		});
	}

	async deleteWebhook(webhookId: string): Promise<ApiResponse<void>> {
		return this.request<void>(`/api/webhooks/${webhookId}`, {
			method: 'DELETE',
		});
	}

	async testWebhook(webhookId: string): Promise<ApiResponse<any>> {
		return this.request<any>(`/api/webhooks/${webhookId}/test`, {
			method: 'POST',
		});
	}

	// Global operations
	async globalReset(sessionId?: string): Promise<ApiResponse<any>> {
		return this.request<any>('/api/reset', {
			method: 'POST',
			body: JSON.stringify({ sessionId }),
		});
	}

	// A2A Discovery
	async getAgentCard(): Promise<ApiResponse<any>> {
		return this.request<any>('/.well-known/agent.json');
	}

	// LLM Provider information
	async getLLMProviders(): Promise<ApiResponse<any>> {
		return this.request<any>('/api/llm/providers');
	}

	async getLLMStatus(): Promise<ApiResponse<any>> {
		return this.request<any>('/api/llm/status');
	}

	async switchLLM(provider: string, model: string, config?: any, sessionId?: string): Promise<ApiResponse<any>> {
		return this.request<any>('/api/llm/switch', {
			method: 'POST',
			body: JSON.stringify({ provider, model, config, sessionId }),
		});
	}
}

// Default client instance
export const apiClient = new ApiClient();
