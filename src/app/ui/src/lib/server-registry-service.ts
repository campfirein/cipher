import type { ServerRegistryEntry, ServerRegistryFilter } from '@/types/server-registry';

/**
 * MCP Server Registry Service
 * Manages a registry of available MCP servers that can be quickly added to agents
 */
export class ServerRegistryService {
	private static instance: ServerRegistryService;
	private registryEntries: ServerRegistryEntry[] = [];
	private isInitialized = false;

	private constructor() {
		// Private constructor for singleton
	}

	static getInstance(): ServerRegistryService {
		if (!ServerRegistryService.instance) {
			ServerRegistryService.instance = new ServerRegistryService();
		}
		return ServerRegistryService.instance;
	}

	/**
	 * Initialize the registry with default entries and load from external sources
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) return;

		// Load built-in registry entries
		this.registryEntries = this.getBuiltinEntries();

		// Load custom entries from localStorage
		await this.loadCustomEntries();

		// TODO: Load from external registry sources (GitHub, npm, etc.)
		// await this.loadExternalRegistries();

		this.isInitialized = true;
	}

	/**
	 * Get all registry entries with optional filtering
	 */
	async getEntries(filter?: ServerRegistryFilter): Promise<ServerRegistryEntry[]> {
		await this.initialize();

		let filtered = [...this.registryEntries];

		// Show only official entries by default
		filtered = filtered.filter(entry => entry.isOfficial === true);

		if (filter?.category) {
			filtered = filtered.filter(entry => entry.category === filter.category);
		}

		if (filter?.tags?.length) {
			filtered = filtered.filter(entry => filter.tags!.some(tag => entry.tags?.includes(tag)));
		}

		if (filter?.search) {
			const searchLower = filter.search.toLowerCase();
			filtered = filtered.filter(
				entry =>
					entry.name.toLowerCase().includes(searchLower) ||
					entry.description.toLowerCase().includes(searchLower) ||
					entry.tags?.some(tag => tag.toLowerCase().includes(searchLower))
			);
		}

		if (filter?.installed !== undefined) {
			filtered = filtered.filter(entry => entry.isInstalled === filter.installed);
		}

		// Allow explicit override to show non-official entries
		if (filter?.official !== undefined) {
			filtered = this.registryEntries.filter(entry => entry.isOfficial === filter.official);

			// Re-apply other filters if official filter is explicitly set
			if (filter?.category) {
				filtered = filtered.filter(entry => entry.category === filter.category);
			}
			if (filter?.tags?.length) {
				filtered = filtered.filter(entry => filter.tags!.some(tag => entry.tags?.includes(tag)));
			}
			if (filter?.search) {
				const searchLower = filter.search.toLowerCase();
				filtered = filtered.filter(
					entry =>
						entry.name.toLowerCase().includes(searchLower) ||
						entry.description.toLowerCase().includes(searchLower) ||
						entry.tags?.some(tag => tag.toLowerCase().includes(searchLower))
				);
			}
			if (filter?.installed !== undefined) {
				filtered = filtered.filter(entry => entry.isInstalled === filter.installed);
			}
		}

		return filtered.sort((a, b) => {
			// Sort by: installed first, then official, then popularity, then name
			if (a.isInstalled !== b.isInstalled) {
				return a.isInstalled ? -1 : 1;
			}
			if (a.isOfficial !== b.isOfficial) {
				return a.isOfficial ? -1 : 1;
			}
			if (a.popularity !== b.popularity) {
				return (b.popularity || 0) - (a.popularity || 0);
			}
			return a.name.localeCompare(b.name);
		});
	}

	/**
	 * Add a custom server to the registry
	 */
	async addCustomEntry(
		entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>
	): Promise<ServerRegistryEntry> {
		const newEntry: ServerRegistryEntry = {
			...entry,
			id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			isOfficial: false,
			lastUpdated: new Date(),
		};

		this.registryEntries.push(newEntry);
		await this.saveCustomEntries();

		return newEntry;
	}

	/**
	 * Update an existing registry entry
	 */
	async updateEntry(id: string, updates: Partial<ServerRegistryEntry>): Promise<boolean> {
		const index = this.registryEntries.findIndex(entry => entry.id === id);
		if (index === -1) return false;

		this.registryEntries[index] = {
			...this.registryEntries[index],
			...updates,
			lastUpdated: new Date(),
		};

		await this.saveCustomEntries();
		return true;
	}

	/**
	 * Mark a server as installed/uninstalled
	 */
	async setInstalled(id: string, installed: boolean): Promise<void> {
		const success = await this.updateEntry(id, { isInstalled: installed });
		if (!success) {
			throw new Error(`Server with id "${id}" not found`);
		}
	}

	/**
	 * Remove a custom server entry
	 */
	async removeEntry(id: string): Promise<void> {
		const index = this.registryEntries.findIndex(entry => entry.id === id);
		if (index === -1) {
			throw new Error(`Server with id "${id}" not found`);
		}

		// Only allow removal of custom entries
		const entry = this.registryEntries[index];
		if (entry.isOfficial) {
			throw new Error('Cannot remove official server entries');
		}

		this.registryEntries.splice(index, 1);
		await this.saveCustomEntries();
	}

	/**
	 * Get server configuration for connecting
	 */
	async getServerConfig(id: string): Promise<ServerRegistryEntry | null> {
		await this.initialize();
		return this.registryEntries.find(entry => entry.id === id) || null;
	}

	/**
	 * Built-in registry entries for popular MCP servers
	 */
	private getBuiltinEntries(): ServerRegistryEntry[] {
		return [
			{
				id: 'filesystem',
				name: 'File System',
				description:
					'Secure file operations with configurable access controls for reading and writing files',
				category: 'productivity',
				icon: '📁',
				config: {
					type: 'stdio',
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
					timeout: 30000,
				},
				tags: ['file', 'directory', 'filesystem', 'io'],
				isOfficial: true,
				isInstalled: false,
				popularity: 95,
				lastUpdated: new Date(),
				requirements: {
					platform: 'all',
					node: '>=20.0.0',
				},
				author: 'Anthropic',
				version: '0.6.0',
				homepage: 'https://github.com/modelcontextprotocol/servers',
			},
			{
				id: 'github',
				name: 'GitHub',
				description:
					'Repository management, file operations, search repositories, manage issues and pull requests',
				category: 'development',
				icon: '🐙',
				config: {
					type: 'stdio',
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-github'],
					env: {
						GITHUB_PERSONAL_ACCESS_TOKEN: '',
					},
					timeout: 30000,
				},
				tags: ['git', 'repository', 'version-control', 'issues', 'pr'],
				isOfficial: true,
				isInstalled: false,
				popularity: 92,
				lastUpdated: new Date(),
				requirements: {
					platform: 'all',
					node: '>=20.0.0',
				},
				author: 'GitHub',
				version: '0.6.0',
				homepage: 'https://github.com/modelcontextprotocol/servers',
			},
			{
				id: 'brave-search',
				name: 'Brave Search',
				description:
					"Web and local search using Brave's Search API for real-time information retrieval",
				category: 'research',
				icon: '🔍',
				config: {
					type: 'stdio',
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-brave-search'],
					env: {
						BRAVE_SEARCH_API_KEY: '',
					},
					timeout: 30000,
				},
				tags: ['search', 'web', 'research', 'information'],
				isOfficial: true,
				isInstalled: false,
				popularity: 88,
				lastUpdated: new Date(),
				requirements: {
					platform: 'all',
					node: '>=20.0.0',
				},
				author: 'Anthropic',
				version: '0.6.0',
				homepage: 'https://github.com/modelcontextprotocol/servers',
			},
			{
				id: 'google-drive',
				name: 'Google Drive',
				description: 'File access and search capabilities for Google Drive integration',
				category: 'productivity',
				icon: '📋',
				config: {
					type: 'stdio',
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-gdrive'],
					env: {
						GOOGLE_APPLICATION_CREDENTIALS: '',
					},
					timeout: 30000,
				},
				tags: ['google', 'drive', 'files', 'cloud', 'storage'],
				isOfficial: true,
				isInstalled: false,
				popularity: 82,
				lastUpdated: new Date(),
				requirements: {
					platform: 'all',
					node: '>=20.0.0',
				},
				author: 'Anthropic',
				version: '0.6.0',
				homepage: 'https://github.com/modelcontextprotocol/servers',
			},
			{
				id: 'git',
				name: 'Git',
				description: 'Tools to read, search, and manipulate Git repositories',
				category: 'development',
				icon: '🌿',
				config: {
					type: 'stdio',
					command: 'uvx',
					args: ['mcp-server-git', '--repository', '/path/to/git/repo'],
					timeout: 30000,
				},
				tags: ['git', 'version-control', 'repository', 'commits', 'diff'],
				isOfficial: true,
				isInstalled: false,
				popularity: 90,
				lastUpdated: new Date(),
				requirements: {
					platform: 'all',
					python: '>=3.8',
				},
				author: 'Anthropic',
				version: '0.6.0',
				homepage: 'https://github.com/modelcontextprotocol/servers',
			},
		];
	}

	/**
	 * Save custom entries to local storage
	 */
	private async saveCustomEntries(): Promise<void> {
		const customEntries = this.registryEntries.filter(entry => !entry.isOfficial);
		if (typeof window !== 'undefined') {
			localStorage.setItem('mcp-custom-servers', JSON.stringify(customEntries));
		}
	}

	/**
	 * Load custom entries from local storage
	 */
	private async loadCustomEntries(): Promise<void> {
		if (typeof window !== 'undefined') {
			const stored = localStorage.getItem('mcp-custom-servers');
			if (stored) {
				try {
					const customEntries = JSON.parse(stored) as ServerRegistryEntry[];
					// Convert string dates back to Date objects
					const processedEntries = customEntries.map(entry => ({
						...entry,
						lastUpdated: new Date(entry.lastUpdated),
					}));
					this.registryEntries.push(...processedEntries);
				} catch (error) {
					console.warn('Failed to load custom server entries:', error);
				}
			}
		}
	}
}

// Export singleton instance
export const serverRegistry = ServerRegistryService.getInstance();
