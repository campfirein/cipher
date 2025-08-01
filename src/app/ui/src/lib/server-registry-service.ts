import {
	ServerRegistryEntry,
	ServerRegistryFilter,
	ServerRegistryService,
} from '@/types/server-registry';

export class DefaultServerRegistryService implements ServerRegistryService {
	private baseUrl: string;

	constructor(baseUrl: string = '/api') {
		this.baseUrl = baseUrl;
	}

	async getEntries(filter?: ServerRegistryFilter): Promise<ServerRegistryEntry[]> {
		const params = new URLSearchParams();

		if (filter?.category) params.append('category', filter.category);
		if (filter?.search) params.append('search', filter.search);
		if (filter?.installedOnly) params.append('installedOnly', 'true');
		if (filter?.officialOnly) params.append('officialOnly', 'true');
		if (filter?.tags && filter.tags.length > 0) {
			params.append('tags', filter.tags.join(','));
		}

		const url = `${this.baseUrl}/registry/servers${params.toString() ? `?${params}` : ''}`;

		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(
					`Failed to fetch registry entries: ${response.status} ${response.statusText}`
				);
			}

			const data = await response.json();
			return data.entries || [];
		} catch (error) {
			console.error('Error fetching server registry entries:', error);
			throw error;
		}
	}

	async setInstalled(entryId: string, installed: boolean): Promise<void> {
		const url = `${this.baseUrl}/registry/servers/${entryId}/installed`;

		try {
			const response = await fetch(url, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({ installed }),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(
					errorData.message || `Failed to update installation status: ${response.status}`
				);
			}
		} catch (error) {
			console.error('Error updating installation status:', error);
			throw error;
		}
	}

	async addCustomEntry(
		entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>
	): Promise<ServerRegistryEntry> {
		const url = `${this.baseUrl}/registry/servers`;

		// Ensure required fields for custom entries
		const customEntry = {
			...entry,
			isOfficial: false,
			lastUpdated: new Date().toISOString(),
		};

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify(customEntry),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.message || `Failed to add custom entry: ${response.status}`);
			}

			const data = await response.json();
			return data.entry;
		} catch (error) {
			console.error('Error adding custom entry:', error);
			throw error;
		}
	}

	async removeEntry(entryId: string): Promise<void> {
		const url = `${this.baseUrl}/registry/servers/${entryId}`;

		try {
			const response = await fetch(url, {
				method: 'DELETE',
				headers: {
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.message || `Failed to remove server entry: ${response.status}`);
			}
		} catch (error) {
			console.error('Error removing server entry:', error);
			throw error;
		}
	}

	async updateEntry(
		entryId: string,
		updates: Partial<Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>>
	): Promise<ServerRegistryEntry> {
		const url = `${this.baseUrl}/registry/servers/${entryId}`;

		const updateData = {
			...updates,
			lastUpdated: new Date().toISOString(),
		};

		try {
			const response = await fetch(url, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify(updateData),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.message || `Failed to update server entry: ${response.status}`);
			}

			const data = await response.json();
			return data.entry;
		} catch (error) {
			console.error('Error updating server entry:', error);
			throw error;
		}
	}

	async getEntry(entryId: string): Promise<ServerRegistryEntry | null> {
		const url = `${this.baseUrl}/registry/servers/${entryId}`;

		try {
			const response = await fetch(url);

			if (response.status === 404) {
				return null;
			}

			if (!response.ok) {
				throw new Error(`Failed to fetch server entry: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			return data.entry;
		} catch (error) {
			console.error('Error fetching server entry:', error);
			throw error;
		}
	}

	async getCategories(): Promise<string[]> {
		const url = `${this.baseUrl}/registry/categories`;

		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Failed to fetch categories: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			return data.categories || [];
		} catch (error) {
			console.error('Error fetching categories:', error);
			throw error;
		}
	}

	async getTags(): Promise<string[]> {
		const url = `${this.baseUrl}/registry/tags`;

		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Failed to fetch tags: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			return data.tags || [];
		} catch (error) {
			console.error('Error fetching tags:', error);
			throw error;
		}
	}
}

// Singleton instance
export const serverRegistryService = new DefaultServerRegistryService();
