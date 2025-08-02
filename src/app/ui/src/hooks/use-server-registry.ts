'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
	ServerRegistryEntry,
	ServerRegistryFilter,
	UseServerRegistryOptions,
} from '@/types/server-registry';
import { serverRegistry } from '@/lib/server-registry-service';

export function useServerRegistry(options: UseServerRegistryOptions = {}) {
	const { autoLoad = true, initialFilter } = options;

	// State management
	const [entries, setEntries] = useState<ServerRegistryEntry[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<ServerRegistryFilter>(initialFilter || {});

	// Refs for cleanup and cancellation
	const isMountedRef = useRef(true);
	const abortControllerRef = useRef<AbortController | null>(null);

	// Main data loading function with request cancellation
	const loadEntries = useCallback(
		async (newFilter?: ServerRegistryFilter) => {
			// Cancel any ongoing request
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}

			// Create new AbortController for this request
			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			// Only update state if component is still mounted
			if (!isMountedRef.current) return;

			setIsLoading(true);
			setError(null);

			try {
				const filterToUse = newFilter || filter;
				const registryEntries = await serverRegistry.getEntries(filterToUse);

				// Check if component is still mounted and request wasn't aborted
				if (isMountedRef.current && !abortController.signal.aborted) {
					setEntries(registryEntries);
				}
			} catch (err: unknown) {
				// Only set error if component is still mounted and request wasn't aborted
				if (isMountedRef.current && !abortController.signal.aborted) {
					const errorMessage =
						err instanceof Error ? err.message : 'Failed to load server registry';
					setError(errorMessage);
				}
			} finally {
				// Only update loading state if component is still mounted and request wasn't aborted
				if (isMountedRef.current && !abortController.signal.aborted) {
					setIsLoading(false);
				}
			}
		},
		[filter]
	);

	// Filter management
	const updateFilter = useCallback((newFilter: ServerRegistryFilter) => {
		if (isMountedRef.current) {
			setFilter(newFilter);
		}
	}, []);

	// Installation status management with optimistic updates
	const markAsInstalled = useCallback(async (entryId: string) => {
		if (!isMountedRef.current) return;

		// Optimistic update
		setEntries(prev =>
			prev.map(entry => (entry.id === entryId ? { ...entry, isInstalled: true } : entry))
		);

		try {
			await serverRegistry.setInstalled(entryId, true);
		} catch (err: unknown) {
			// Rollback optimistic update on error
			if (isMountedRef.current) {
				setEntries(prev =>
					prev.map(entry => (entry.id === entryId ? { ...entry, isInstalled: false } : entry))
				);
				const errorMessage =
					err instanceof Error ? err.message : 'Failed to mark server as installed';
				setError(errorMessage);
			}
		}
	}, []);

	// Mark as uninstalled
	const markAsUninstalled = useCallback(async (entryId: string) => {
		if (!isMountedRef.current) return;

		// Optimistic update
		setEntries(prev =>
			prev.map(entry => (entry.id === entryId ? { ...entry, isInstalled: false } : entry))
		);

		try {
			await serverRegistry.setInstalled(entryId, false);
		} catch (err: unknown) {
			// Rollback optimistic update on error
			if (isMountedRef.current) {
				setEntries(prev =>
					prev.map(entry => (entry.id === entryId ? { ...entry, isInstalled: true } : entry))
				);
				const errorMessage =
					err instanceof Error ? err.message : 'Failed to mark server as uninstalled';
				setError(errorMessage);
			}
		}
	}, []);

	// Custom entry addition
	const addCustomEntry = useCallback(
		async (entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>) => {
			if (!isMountedRef.current) return;

			try {
				const newEntry = await serverRegistry.addCustomEntry(entry);
				if (isMountedRef.current) {
					setEntries(prev => [newEntry, ...prev]);
				}
				return newEntry;
			} catch (err: unknown) {
				if (isMountedRef.current) {
					const errorMessage = err instanceof Error ? err.message : 'Failed to add custom server';
					setError(errorMessage);
				}
				throw err;
			}
		},
		[]
	);

	// Remove entry (for custom entries)
	const removeEntry = useCallback(async (entryId: string) => {
		if (!isMountedRef.current) return;

		try {
			await serverRegistry.removeEntry(entryId);

			if (isMountedRef.current) {
				setEntries(prev => prev.filter(entry => entry.id !== entryId));
			}
		} catch (err: unknown) {
			if (isMountedRef.current) {
				const errorMessage = err instanceof Error ? err.message : 'Failed to remove server entry';
				setError(errorMessage);
			}
			throw err;
		}
	}, []);

	// Error management
	const clearError = useCallback(() => {
		if (isMountedRef.current) {
			setError(null);
		}
	}, []);

	// Refresh entries
	const refreshEntries = useCallback(() => {
		if (isMountedRef.current) {
			loadEntries();
		}
	}, [loadEntries]);

	// Find entry by ID
	const findEntry = useCallback(
		(entryId: string): ServerRegistryEntry | undefined => {
			return entries.find(entry => entry.id === entryId);
		},
		[entries]
	);

	// Get filtered entries (client-side filtering for additional performance)
	const getFilteredEntries = useCallback(
		(clientFilter?: Partial<ServerRegistryFilter>): ServerRegistryEntry[] => {
			if (!clientFilter) return entries;

			return entries.filter(entry => {
				if (clientFilter.installed !== undefined && entry.isInstalled !== clientFilter.installed)
					return false;
				if (clientFilter.official !== undefined && entry.isOfficial !== clientFilter.official)
					return false;
				if (clientFilter.category && entry.category !== clientFilter.category) return false;
				if (clientFilter.search) {
					const searchLower = clientFilter.search.toLowerCase();
					const matchesSearch =
						entry.name.toLowerCase().includes(searchLower) ||
						entry.description.toLowerCase().includes(searchLower) ||
						entry.tags?.some(tag => tag.toLowerCase().includes(searchLower));
					if (!matchesSearch) return false;
				}
				if (clientFilter.tags && clientFilter.tags.length > 0) {
					const hasMatchingTag = clientFilter.tags.some(tag => entry.tags?.includes(tag));
					if (!hasMatchingTag) return false;
				}
				return true;
			});
		},
		[entries]
	);

	// Auto-reload when filter changes
	useEffect(() => {
		if (isMountedRef.current) {
			loadEntries();
		}
	}, [filter, loadEntries]);

	// Auto-loading effect
	useEffect(() => {
		if (autoLoad && isMountedRef.current) {
			loadEntries();
		}
	}, [autoLoad, loadEntries]);

	// Listen for server uninstall events from other components
	useEffect(() => {
		const handleServerUninstalled = (event: any) => {
			const { serverId } = event.detail;
			if (isMountedRef.current) {
				console.log(`📨 Received server uninstalled event for: ${serverId}`);
				// Find the server by name (serverId is actually the server name in this context)
				const entry = entries.find(e => e.name === serverId || e.id === serverId);
				if (entry) {
					markAsUninstalled(entry.id);
				}
			}
		};

		window.addEventListener('mcp-server-uninstalled', handleServerUninstalled);

		return () => {
			window.removeEventListener('mcp-server-uninstalled', handleServerUninstalled);
		};
	}, [entries, markAsUninstalled]);

	// Cleanup effect - prevent memory leaks
	useEffect(() => {
		return () => {
			isMountedRef.current = false;
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
		};
	}, []);

	// Derived state
	const installedEntries = entries.filter(entry => entry.isInstalled);
	const officialEntries = entries.filter(entry => entry.isOfficial);
	const customEntries = entries.filter(entry => !entry.isOfficial);
	const categories = Array.from(new Set(entries.map(entry => entry.category)));
	const allTags = Array.from(new Set(entries.flatMap(entry => entry.tags || [])));

	return {
		// State
		entries,
		isLoading,
		error,
		filter,

		// Derived state
		installedEntries,
		officialEntries,
		customEntries,
		categories,
		allTags,

		// Actions
		loadEntries,
		updateFilter,
		markAsInstalled,
		markAsUninstalled,
		addCustomEntry,
		removeEntry,
		clearError,
		refreshEntries,

		// Utilities
		findEntry,
		getFilteredEntries,
	};
}
