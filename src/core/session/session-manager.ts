import { randomUUID } from 'crypto';
import { EnhancedPromptManager } from '../brain/systemPrompt/enhanced-manager.js';
import { MemAgentStateManager } from '../brain/memAgent/state-manager.js';
import { ConversationSession } from './coversation-session.js';
import { MCPManager } from '../mcp/manager.js';
import { UnifiedToolManager } from '../brain/tools/unified-tool-manager.js';
import { logger } from '@core/logger/index.js';
import { EventManager } from '../events/event-manager.js';
import { SessionEvents } from '../events/event-types.js';
import { StorageManager } from '../storage/manager.js';
import type {
	SerializedSession,
	SessionPersistenceConfig,
	SessionPersistenceStats,
	SessionRestorationStats,
} from './persistence-types.js';
import { SESSION_PERSISTENCE_CONSTANTS, SessionPersistenceError } from './persistence-types.js';
import { env } from '../env.js';

export interface SessionManagerConfig {
	maxSessions?: number;
	sessionTTL?: number;
	persistence?: SessionPersistenceConfig;
}

// Re-export persistence types for convenience
export type {
	SerializedSession,
	SessionPersistenceConfig,
	SessionPersistenceStats,
	SessionRestorationStats,
} from './persistence-types.js';
export { SESSION_PERSISTENCE_CONSTANTS, SessionPersistenceError } from './persistence-types.js';

export interface SessionMetadata {
	session: ConversationSession;
	lastActivity: number;
	createdAt: number;
}

export class SessionManager {
	private sessions: Map<string, SessionMetadata> = new Map();
	private readonly maxSessions: number;
	private readonly sessionTTL: number;
	private initialized = false;
	private cleanupInterval?: NodeJS.Timeout | undefined;
	private initializationPromise!: Promise<void>;
	private readonly pendingCreations = new Map<string, Promise<ConversationSession>>();

	// Performance optimizations
	private readonly sessionMetadataCache = new Map<
		string,
		{ metadata: SessionMetadata; cachedAt: number; expiresAt: number }
	>();
	private readonly messageCountCache = new Map<
		string,
		{ count: number; cachedAt: number; expiresAt: number }
	>();
	private readonly requestDeduplicator = new Map<string, Promise<any>>();
	private readonly CACHE_TTL = 30000; // 30 seconds
	private readonly BATCH_SIZE = 10; // Parallel processing batch size
	private performanceMetrics = {
		cacheHits: 0,
		cacheMisses: 0,
		parallelLoads: 0,
		sequentialLoads: 0,
		averageLoadTime: 0,
	};

	// Persistence-related fields
	private readonly persistenceConfig: SessionPersistenceConfig;
	private storageManager?: StorageManager | undefined;

	constructor(
		private services: {
			stateManager: MemAgentStateManager;
			promptManager: EnhancedPromptManager;
			contextManager: any;
			mcpManager: MCPManager;
			unifiedToolManager: UnifiedToolManager;
			eventManager: EventManager;
			embeddingManager?: any; // Optional embedding manager for status checking
		},
		config: SessionManagerConfig = {}
	) {
		this.maxSessions = config.maxSessions ?? 100;
		this.sessionTTL = config.sessionTTL ?? 24 * 3600000; // 24 hours (instead of 1 hour)

		// Initialize persistence configuration with defaults
		this.persistenceConfig = {
			storageKeyPrefix: SESSION_PERSISTENCE_CONSTANTS.DEFAULT_STORAGE_PREFIX,
			maxSessionsToSave: SESSION_PERSISTENCE_CONSTANTS.DEFAULT_MAX_SESSIONS,
			maxSessionAge: SESSION_PERSISTENCE_CONSTANTS.DEFAULT_MAX_AGE,
			compress: false,
			saveTimeout: SESSION_PERSISTENCE_CONSTANTS.DEFAULT_SAVE_TIMEOUT,
			loadTimeout: SESSION_PERSISTENCE_CONSTANTS.DEFAULT_LOAD_TIMEOUT,
			validateOnRestore: true,
			...config.persistence,
		};
	}

	public async init(): Promise<void> {
		if (this.initialized) {
			return;
		}
		this.initialized = true;

		logger.debug('SessionManager: Starting initialization...');

		// Initialize storage manager for persistence
		await this.initializePersistenceStorage();

		// Load existing sessions from persistent storage
		const restorationStats = await this.loadAllSessions();

		if (restorationStats.totalSessions > 0) {
			logger.info(
				`SessionManager: Initialization complete. Loaded ${restorationStats.restoredSessions}/${restorationStats.totalSessions} sessions from storage. Current in-memory sessions: ${this.sessions.size}`
			);
		} else {
			logger.debug(
				`SessionManager: Initialization complete. No sessions found in storage. Current in-memory sessions: ${this.sessions.size}`
			);
		}

		// Start cleanup interval for expired sessions
		this.startCleanupInterval();

		logger.debug(
			`SessionManager initialized with max sessions: ${this.maxSessions}, TTL: ${this.sessionTTL}ms`
		);
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			if (!this.initializationPromise) {
				logger.debug('SessionManager: Starting initialization...');
				this.initializationPromise = this.init();
			}
			try {
				await this.initializationPromise;
				logger.debug('SessionManager: Initialization completed successfully');
			} catch (error) {
				logger.error('SessionManager: Initialization failed:', error);
				throw error;
			}
		}
	}

	public async createSession(sessionId?: string): Promise<ConversationSession> {
		await this.ensureInitialized();

		const id = sessionId ?? randomUUID();

		// Check if there's already a pending creation for this session ID
		if (this.pendingCreations.has(id)) {
			return await this.pendingCreations.get(id)!;
		}

		// Check if session already exists
		if (this.sessions.has(id)) {
			await this.updateSessionActivity(id);
			return this.sessions.get(id)!.session;
		}

		// Create a promise for the session creation and track it to prevent concurrent operations
		const creationPromise = this.createSessionInternal(id);
		this.pendingCreations.set(id, creationPromise);

		try {
			const session = await creationPromise;
			return session;
		} finally {
			// Always clean up the pending creation tracker
			this.pendingCreations.delete(id);
		}
	}

	private async createSessionInternal(sessionId: string): Promise<ConversationSession> {
		logger.debug(`SessionManager: Creating new session ${sessionId}...`);

		// Check if we need to evict old sessions to make room
		if (this.sessions.size >= this.maxSessions) {
			logger.warn(
				`SessionManager: Reached max sessions limit (${this.maxSessions}), evicting oldest session...`
			);
			await this.evictOldestSession();
		}

		// CRITICAL FIX: Add a small delay to prevent race conditions when creating multiple sessions
		// This prevents storage conflicts when sessions are created in quick succession
		if (this.sessions.size > 0) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		// Create new conversation session with shared storage manager
		logger.debug(
			`SessionManager: Creating session ${sessionId} with storage manager: ${this.storageManager ? 'available' : 'undefined'}`
		);
		const session = new ConversationSession(
			{
				...this.services,
				contextManager: this.services.contextManager,
			},
			sessionId,
			{
				...(this.storageManager && { sharedStorageManager: this.storageManager }),
			}
		);
		await session.init();

		// CRITICAL FIX: Ensure conversation history is properly initialized for new sessions
		// This is essential for UI mode to display messages correctly
		try {
			// Force initialize the history provider
			const historyProvider = await session.getHistoryProvider();
			if (historyProvider) {
				logger.debug(`SessionManager: History provider initialized for new session ${sessionId}`);
			}

			await session.refreshConversationHistory();
			logger.debug(`SessionManager: Initialized conversation history for new session ${sessionId}`);

			// Verify that the session has proper initialization
			const contextHistory = session.getContextHistory();
			const history = await session.getConversationHistory();
			logger.debug(
				`SessionManager: New session ${sessionId} - Context: ${contextHistory.length} messages, History: ${history.length} messages`
			);
		} catch (error) {
			logger.warn(
				`SessionManager: Failed to initialize conversation history for new session ${sessionId}:`,
				error
			);
			// Continue even if history initialization fails
		}

		// Store session with metadata
		const now = Date.now();
		this.sessions.set(sessionId, {
			session,
			lastActivity: now,
			createdAt: now,
		});

		// Emit session created event
		this.services.eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_CREATED, {
			sessionId,
			timestamp: now,
		});

		// Save session to persistent storage immediately
		try {
			await this.saveSession(sessionId, session);
			logger.info(
				`SessionManager: Session ${sessionId} created and saved to persistent storage. Total active sessions: ${this.sessions.size}`
			);
		} catch (error) {
			logger.warn(
				`SessionManager: Failed to save session ${sessionId} to persistent storage:`,
				error
			);
			// Continue even if save fails
		}

		return session;
	}

	private async updateSessionActivity(sessionId: string): Promise<void> {
		const sessionMetadata = this.sessions.get(sessionId);
		if (sessionMetadata) {
			const now = Date.now();
			sessionMetadata.lastActivity = now;

			// Emit session activated event
			this.services.eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_ACTIVATED, {
				sessionId,
				timestamp: now,
			});

			// Save updated session activity to persistent storage
			try {
				await this.saveSession(sessionId, sessionMetadata.session);
				logger.debug(`Updated activity for session: ${sessionId}`);
			} catch (error) {
				logger.warn(`Failed to save updated session ${sessionId} to persistent storage:`, error);
			}
		}
	}

	public async getSession(sessionId: string): Promise<ConversationSession | null> {
		await this.ensureInitialized();

		const sessionMetadata = this.sessions.get(sessionId);
		if (!sessionMetadata) {
			logger.debug(
				`SessionManager: Session ${sessionId} not found in memory (${this.sessions.size} active sessions), attempting to restore from persistent storage...`
			);

			// Session not in memory, try to load from persistent storage
			try {
				const restoredSession = await this.loadSession(sessionId);
				if (restoredSession) {
					logger.info(
						`SessionManager: Successfully restored session ${sessionId} from persistent storage. Total active sessions: ${this.sessions.size}`
					);
					return restoredSession;
				} else {
					logger.debug(
						`SessionManager: Session ${sessionId} not found in persistent storage either`
					);
				}
			} catch (error) {
				logger.warn(
					`SessionManager: Failed to restore session ${sessionId} from persistent storage:`,
					error
				);
			}
			return null;
		}

		// Check if session has expired
		if (this.isSessionExpired(sessionMetadata)) {
			logger.debug(`SessionManager: Session ${sessionId} has expired, removing...`);
			await this.removeSession(sessionId);
			return null;
		}

		// Update activity and return session
		await this.updateSessionActivity(sessionId);
		logger.debug(
			`SessionManager: Retrieved active session ${sessionId}. Total active sessions: ${this.sessions.size}`
		);
		return sessionMetadata.session;
	}

	public async removeSession(sessionId: string): Promise<boolean> {
		await this.ensureInitialized();

		// Handle null or invalid session IDs
		if (!sessionId || sessionId === 'null' || sessionId === 'undefined') {
			logger.debug(`SessionManager: Cannot remove session with invalid ID: ${sessionId}`);
			return false;
		}

		// CRITICAL FIX: Check if session exists before deletion
		const sessionMetadata = this.sessions.get(sessionId);

		// If session doesn't exist in memory and storage is not connected, definitely return false
		if (!sessionMetadata && !this.storageManager?.isConnected()) {
			logger.debug(
				`SessionManager: Session ${sessionId} not found in memory and storage unavailable`
			);
			return false;
		}

		// If session doesn't exist in memory and we need to check storage
		if (!sessionMetadata && this.storageManager?.isConnected()) {
			// Check if session exists in storage before proceeding
			try {
				const backends = this.storageManager.getBackends();
				if (backends?.database) {
					const sessionKey = this.getSessionStorageKey(sessionId);
					const existsInStorage = await backends.database.get(sessionKey);
					if (!existsInStorage) {
						logger.debug(`SessionManager: Session ${sessionId} not found in memory or storage`);
						return false;
					}
				}
			} catch (error) {
				logger.debug(`SessionManager: Error checking storage for session ${sessionId}:`, error);
				return false;
			}
		}

		// CRITICAL FIX: Use transaction-like approach for consistent deletion
		let memoryDeleted = false;
		let storageDeleted = false;
		const deletionErrors: string[] = [];

		try {
			// Step 1: Delete from memory
			memoryDeleted = this.sessions.delete(sessionId);
			logger.debug(`SessionManager: Memory deletion for ${sessionId}: ${memoryDeleted}`);

			// Step 2: Delete from persistent storage if available
			if (this.storageManager?.isConnected()) {
				try {
					const backends = this.storageManager.getBackends();
					if (backends?.database) {
						// Delete both session data and conversation history
						const sessionKey = this.getSessionStorageKey(sessionId);
						const historyKey = `messages:${sessionId}`;

						// Delete session data
						try {
							await backends.database.delete(sessionKey);
							logger.debug(`SessionManager: Deleted session data ${sessionKey}`);
						} catch (sessionDeleteError) {
							deletionErrors.push(`Session data: ${sessionDeleteError}`);
						}

						// Delete conversation history
						try {
							await backends.database.delete(historyKey);
							logger.debug(`SessionManager: Deleted conversation history ${historyKey}`);
						} catch (historyDeleteError) {
							deletionErrors.push(`History data: ${historyDeleteError}`);
						}

						storageDeleted = true;
					}
				} catch (storageError) {
					deletionErrors.push(`Storage operation: ${storageError}`);
					logger.warn(`SessionManager: Storage deletion failed for ${sessionId}:`, storageError);
				}
			} else {
				logger.debug(`SessionManager: Storage manager not available for deletion of ${sessionId}`);
				storageDeleted = true; // Consider successful if no storage to delete from
			}

			// Step 3: Clear all caches for this session
			this.clearSessionFromAllCaches(sessionId);

			// Step 4: Emit events and log results
			if (memoryDeleted || storageDeleted) {
				// Emit session deleted event
				this.services.eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_DELETED, {
					sessionId,
					timestamp: Date.now(),
				});

				if (deletionErrors.length > 0) {
					logger.warn(
						`SessionManager: Session ${sessionId} partially deleted with errors: ${deletionErrors.join('; ')}. Remaining active sessions: ${this.sessions.size}`
					);
				} else {
					logger.info(
						`SessionManager: Successfully deleted session ${sessionId} from memory and storage. Remaining active sessions: ${this.sessions.size}`
					);
				}
				return true;
			}

			logger.warn(
				`SessionManager: Failed to delete session ${sessionId} - not found in memory or storage`
			);
			return false;
		} catch (error) {
			logger.error(
				`SessionManager: Critical error during session deletion for ${sessionId}:`,
				error
			);
			// If we deleted from memory but failed storage, still return true as session is functionally deleted
			return memoryDeleted;
		}
	}

	public async getAllSessions(): Promise<ConversationSession[]> {
		await this.ensureInitialized();
		return Array.from(this.sessions.values()).map(metadata => metadata.session);
	}

	/**
	 * Optimized session listing with parallel processing and caching
	 */
	public async getActiveSessionIds(): Promise<string[]> {
		await this.ensureInitialized();

		const startTime = Date.now();
		const cacheKey = 'active_session_ids';

		// CRITICAL FIX: Don't use cache for session IDs to prevent phantom sessions
		// Always fetch fresh data to ensure UI shows accurate session list

		// Prevent duplicate requests
		if (this.requestDeduplicator.has(cacheKey)) {
			logger.debug('SessionManager: Deduplicating concurrent request for active session IDs');
			return await this.requestDeduplicator.get(cacheKey)!;
		}

		try {
			this.performanceMetrics.cacheMisses++;

			const fetchPromise = this.fetchActiveSessionIds();
			this.requestDeduplicator.set(cacheKey, fetchPromise);

			const result = await fetchPromise;

			// CRITICAL FIX: Filter out sessions with 0 messages to prevent phantom sessions
			const validSessions = await this.filterValidSessions(result);

			const loadTime = Date.now() - startTime;
			this.updateAverageLoadTime(loadTime);

			logger.debug(
				`SessionManager: Fetched ${validSessions.length}/${result.length} valid session IDs in ${loadTime}ms`
			);
			return validSessions;
		} catch (error) {
			logger.error('SessionManager: Failed to get active session IDs:', error);
			// Return in-memory sessions as fallback
			const inMemorySessionIds = Array.from(this.sessions.keys());
			logger.debug(
				`SessionManager: Returning ${inMemorySessionIds.length} in-memory sessions as fallback`
			);
			return inMemorySessionIds;
		} finally {
			this.requestDeduplicator.delete(cacheKey);
		}
	}

	/**
	 * Internal method to fetch active session IDs with optimized queries
	 */
	private async fetchActiveSessionIds(): Promise<string[]> {
		// Clean up expired sessions first
		await this.cleanupExpiredSessions();

		// Get in-memory sessions
		const inMemorySessionIds = Array.from(this.sessions.keys());
		logger.debug(`SessionManager: Found ${inMemorySessionIds.length} in-memory sessions`);

		// Get persisted sessions from storage in parallel
		let persistedSessionIds: string[] = [];
		try {
			const [sessionKeys, messageKeys] = await Promise.allSettled([
				this.getAllSessionKeys(),
				this.getAllMessageKeys(),
			]);

			// Extract session IDs from both sources
			const sessionIdsFromKeys =
				sessionKeys.status === 'fulfilled'
					? sessionKeys.value.map(key => this.extractSessionIdFromKey(key))
					: [];

			const sessionIdsFromMessages =
				messageKeys.status === 'fulfilled'
					? messageKeys.value.map(key => key.replace('messages:', ''))
					: [];

			persistedSessionIds = [...new Set([...sessionIdsFromKeys, ...sessionIdsFromMessages])];
			logger.debug(`SessionManager: Found ${persistedSessionIds.length} persisted sessions`);
		} catch (storageError) {
			logger.warn('SessionManager: Failed to get persisted sessions from storage:', storageError);
		}

		// Combine and deduplicate
		const allSessionIds = [...new Set([...inMemorySessionIds, ...persistedSessionIds])];
		logger.debug(`SessionManager: Combined ${allSessionIds.length} unique session IDs`);

		return allSessionIds;
	}

	public async getSessionCount(): Promise<number> {
		await this.ensureInitialized();
		return this.sessions.size;
	}

	/**
	 * Get detailed session statistics for monitoring
	 */
	public async getSessionStats(): Promise<{
		activeSessions: number;
		storageConnected: boolean;
		storageType: string;
		persistenceEnabled: boolean;
		performanceMetrics: {
			cacheHitRate: number;
			parallelLoadRatio: number;
			averageLoadTime: number;
			cacheSize: number;
		};
	}> {
		await this.ensureInitialized();

		const backends = this.storageManager?.getBackends();
		const storageType = backends?.database?.getBackendType?.() || 'none';

		const totalRequests = this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses;
		const cacheHitRate =
			totalRequests > 0 ? (this.performanceMetrics.cacheHits / totalRequests) * 100 : 0;
		const totalLoads =
			this.performanceMetrics.parallelLoads + this.performanceMetrics.sequentialLoads;
		const parallelLoadRatio =
			totalLoads > 0 ? (this.performanceMetrics.parallelLoads / totalLoads) * 100 : 0;

		return {
			activeSessions: this.sessions.size,
			storageConnected: this.storageManager?.isConnected() || false,
			storageType,
			persistenceEnabled: !!this.storageManager,
			performanceMetrics: {
				cacheHitRate: Math.round(cacheHitRate * 100) / 100,
				parallelLoadRatio: Math.round(parallelLoadRatio * 100) / 100,
				averageLoadTime: Math.round(this.performanceMetrics.averageLoadTime * 100) / 100,
				cacheSize: this.sessionMetadataCache.size + this.messageCountCache.size,
			},
		};
	}

	private isSessionExpired(sessionMetadata: SessionMetadata): boolean {
		const now = Date.now();
		return now - sessionMetadata.lastActivity > this.sessionTTL;
	}

	private async evictOldestSession(): Promise<void> {
		if (this.sessions.size === 0) {
			return;
		}

		let oldestSessionId: string | null = null;
		let oldestActivity = Number.MAX_SAFE_INTEGER; // Initialize to maximum value to find minimum

		for (const [sessionId, metadata] of this.sessions) {
			if (metadata.lastActivity < oldestActivity) {
				oldestActivity = metadata.lastActivity;
				oldestSessionId = sessionId;
			}
		}

		if (oldestSessionId) {
			await this.removeSession(oldestSessionId);
			logger.debug(`Evicted oldest session: ${oldestSessionId}`);
		}
	}

	private async cleanupExpiredSessions(): Promise<void> {
		const expiredSessionIds: string[] = [];

		for (const [sessionId, metadata] of this.sessions) {
			if (this.isSessionExpired(metadata)) {
				expiredSessionIds.push(sessionId);
			}
		}

		if (expiredSessionIds.length > 0) {
			logger.info(`SessionManager: Cleaning up ${expiredSessionIds.length} expired sessions...`);

			for (const sessionId of expiredSessionIds) {
				// Emit session expired event before removing
				this.services.eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_EXPIRED, {
					sessionId,
					timestamp: Date.now(),
				});

				await this.removeSession(sessionId);
			}

			logger.info(
				`SessionManager: Cleanup complete. Remaining active sessions: ${this.sessions.size}`
			);
		}
	}

	private startCleanupInterval(): void {
		// Run cleanup every 5 minutes
		const cleanupIntervalMs = 5 * 60 * 1000;

		// Only start cleanup if sessionTTL is not 0 (disabled)
		if (this.sessionTTL > 0) {
			this.cleanupInterval = setInterval(async () => {
				try {
					await this.cleanupExpiredSessions();
					// Also cleanup expired cache entries
					this.cleanupExpiredCache();
				} catch (error) {
					logger.error('Error during session cleanup:', error);
				}
			}, cleanupIntervalMs);
		} else {
			logger.debug('Session cleanup disabled (sessionTTL = 0)');
		}
	}

	/**
	 * Save all active sessions to persistent storage
	 * @returns Statistics about the save operation
	 */
	public async saveAllSessions(): Promise<SessionPersistenceStats> {
		await this.ensureInitialized();

		const startTime = Date.now();
		const stats: SessionPersistenceStats = {
			totalSessions: 0,
			savedSessions: 0,
			failedSessions: 0,
			persistenceTime: 0,
			failedSessionIds: [],
			errors: [],
		};

		if (!this.storageManager) {
			const error = 'No storage manager available for session persistence';
			stats.errors.push(error);
			logger.warn(`SessionManager.saveAllSessions: ${error}`);
			return stats;
		}

		if (!this.storageManager.isConnected()) {
			const error = 'Storage manager is not connected';
			stats.errors.push(error);
			logger.warn(`SessionManager.saveAllSessions: ${error}`);
			return stats;
		}

		try {
			logger.info(
				`SessionManager: Starting to save ${this.sessions.size} sessions to persistent storage...`
			);

			// Get all active sessions
			const activeSessions = Array.from(this.sessions.entries());
			stats.totalSessions = activeSessions.length;

			if (activeSessions.length === 0) {
				logger.debug('SessionManager.saveAllSessions: No active sessions to save');
				stats.persistenceTime = Date.now() - startTime;
				return stats;
			}

			// Save sessions with timeout
			const saveTimeout = this.persistenceConfig.saveTimeout!;
			const maxSessionsToSave = this.persistenceConfig.maxSessionsToSave!;

			const savePromises = activeSessions
				.slice(0, maxSessionsToSave)
				.map(async ([sessionId, metadata]) => {
					try {
						const savePromise = this.saveSession(sessionId, metadata.session);
						await Promise.race([
							savePromise,
							new Promise<void>((_, reject) =>
								setTimeout(() => reject(new Error('Save timeout')), saveTimeout)
							),
						]);

						stats.savedSessions++;
						logger.debug(`SessionManager: Successfully saved session ${sessionId}`);
					} catch (error) {
						stats.failedSessions++;
						stats.failedSessionIds.push(sessionId);
						const errorMsg = error instanceof Error ? error.message : String(error);
						stats.errors.push(`Session ${sessionId}: ${errorMsg}`);
						logger.error(`SessionManager: Failed to save session ${sessionId}:`, error);
					}
				});

			// Execute all saves in parallel
			await Promise.allSettled(savePromises);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			stats.errors.push(`Save operation failed: ${errorMsg}`);
			logger.error('SessionManager: Failed to save sessions:', error);
		}

		stats.persistenceTime = Date.now() - startTime;

		logger.info(`SessionManager: Session persistence completed`, {
			totalSessions: stats.totalSessions,
			savedSessions: stats.savedSessions,
			failedSessions: stats.failedSessions,
			persistenceTime: stats.persistenceTime,
		});

		return stats;
	}

	/**
	 * Load all sessions from persistent storage
	 * @returns Statistics about the load operation
	 */
	public async loadAllSessions(): Promise<SessionRestorationStats> {
		await this.ensureInitialized();

		const startTime = Date.now();
		const stats: SessionRestorationStats = {
			totalSessions: 0,
			restoredSessions: 0,
			failedSessions: 0,
			restorationTime: 0,
			failedSessionIds: [],
			errors: [],
		};

		if (!this.storageManager) {
			const error = 'No storage manager available for session persistence';
			stats.errors.push(error);
			logger.debug(`SessionManager.loadAllSessions: ${error}`);
			return stats;
		}

		if (!this.storageManager.isConnected()) {
			const error = 'Storage manager is not connected';
			stats.errors.push(error);
			logger.warn(`SessionManager.loadAllSessions: ${error}`);
			return stats;
		}

		try {
			// Get all session keys from storage
			const backends = this.storageManager.getBackends();
			if (!backends) {
				throw new SessionPersistenceError('No storage backends available', 'load');
			}

			// Scan for session keys (this might need to be implemented differently depending on backend)
			const sessionKeys = await this.getAllSessionKeys();
			stats.totalSessions = sessionKeys.length;

			if (sessionKeys.length === 0) {
				logger.debug('SessionManager.loadAllSessions: No sessions found in storage');
				stats.restorationTime = Date.now() - startTime;
				return stats;
			}

			// Load sessions with timeout
			const loadTimeout = this.persistenceConfig.loadTimeout!;
			const maxAge = this.persistenceConfig.maxSessionAge!;
			const now = Date.now();

			const loadPromises = sessionKeys.map(async key => {
				try {
					const sessionId = this.extractSessionIdFromKey(key);

					const loadPromise = this.loadSession(sessionId);
					const session = await Promise.race([
						loadPromise,
						new Promise<ConversationSession | null>((_, reject) =>
							setTimeout(() => reject(new Error('Load timeout')), loadTimeout)
						),
					]);

					if (session) {
						// Check if session is too old
						const sessionAge = now - (this.sessions.get(sessionId)?.createdAt || now);
						if (sessionAge > maxAge) {
							logger.debug(
								`SessionManager: Session ${sessionId} is too old (${sessionAge}ms), skipping`
							);
							return;
						}

						stats.restoredSessions++;
						logger.debug(`SessionManager: Successfully restored session ${sessionId}`);
					}
				} catch (error) {
					const sessionId = this.extractSessionIdFromKey(key);
					stats.failedSessions++;
					stats.failedSessionIds.push(sessionId);
					const errorMsg = error instanceof Error ? error.message : String(error);
					stats.errors.push(`Session ${sessionId}: ${errorMsg}`);
					logger.error(`SessionManager: Failed to restore session ${sessionId}:`, error);
				}
			});

			// Execute all loads in parallel
			await Promise.allSettled(loadPromises);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			stats.errors.push(`Load operation failed: ${errorMsg}`);
			logger.error('SessionManager: Failed to load sessions:', error);
		}

		stats.restorationTime = Date.now() - startTime;

		// Only log if there are issues or in debug mode
		if (stats.failedSessions > 0 || stats.errors.length > 0) {
			logger.warn(`SessionManager: Session restoration completed with issues`, {
				totalSessions: stats.totalSessions,
				restoredSessions: stats.restoredSessions,
				failedSessions: stats.failedSessions,
				restorationTime: stats.restorationTime,
			});
		} else if (stats.totalSessions > 0) {
			logger.debug(`SessionManager: Session restoration completed`, {
				totalSessions: stats.totalSessions,
				restoredSessions: stats.restoredSessions,
				restorationTime: stats.restorationTime,
			});
		}

		return stats;
	}

	/**
	 * Initialize storage manager for session persistence
	 */
	private async initializePersistenceStorage(): Promise<void> {
		logger.info('SessionManager: Initializing persistence storage...');

		// Check for PostgreSQL environment variables
		const postgresUrl = process.env.CIPHER_PG_URL;
		const postgresHost = process.env.STORAGE_DATABASE_HOST;
		const postgresDatabase = process.env.STORAGE_DATABASE_NAME;
		logger.debug('SessionManager: Checking PostgreSQL initialization');
		if (postgresUrl || (postgresHost && postgresDatabase)) {
			try {
				// Try PostgreSQL first if PostgreSQL environment variables are set
				logger.debug('SessionManager: Attempting to initialize PostgreSQL storage...');

				let postgresConfig: any = {
					type: 'postgres' as const,
				};

				if (postgresUrl) {
					// Use connection URL if provided
					postgresConfig.url = postgresUrl;
					logger.debug('SessionManager: Using PostgreSQL connection URL');
				} else {
					// Use individual parameters
					postgresConfig.host = postgresHost;
					postgresConfig.database = postgresDatabase;
					postgresConfig.port = process.env.STORAGE_DATABASE_PORT
						? parseInt(process.env.STORAGE_DATABASE_PORT, 10)
						: 5432;
					postgresConfig.user = process.env.STORAGE_DATABASE_USER;
					postgresConfig.password = process.env.STORAGE_DATABASE_PASSWORD;
					postgresConfig.ssl = process.env.STORAGE_DATABASE_SSL === 'true';
					logger.debug('SessionManager: Using PostgreSQL individual parameters');
				}

				this.storageManager = new StorageManager({
					database: postgresConfig,
					cache: {
						type: 'in-memory',
					},
				});

				await this.storageManager.connect();
				logger.info('SessionManager: PostgreSQL persistence storage initialized successfully');
			} catch (postgresError) {
				logger.warn(
					'SessionManager: PostgreSQL failed, falling back to SQLite storage',
					postgresError
				);
				await this.initializeBasicStorage();
			}
		} else {
			logger.debug('SessionManager: No PostgreSQL configuration, using SQLite');
			// No PostgreSQL configuration, try SQLite
			await this.initializeBasicStorage();
		}

		if (this.storageManager) {
			const backends = this.storageManager.getBackends();
			logger.info(
				`SessionManager: Storage initialized with database backend: ${backends?.database?.getBackendType?.() || 'unknown'}`
			);
		} else {
			logger.warn('SessionManager: No storage manager available - sessions will not persist');
		}
	}

	/**
	 * Initialize In-memory storage as fallback
	 */
	private async initializeBasicStorage(): Promise<void> {
		try {
			// Check if we should use in-memory storage based on environment variable
			if (env.STORAGE_DATABASE_TYPE === 'in-memory') {
				logger.debug('SessionManager: Using in-memory storage as configured');
				this.storageManager = new StorageManager({
					database: {
						type: 'in-memory',
					},
					cache: {
						type: 'in-memory',
					},
				});
				await this.storageManager.connect();
				logger.info('SessionManager: In-memory storage initialized successfully');
				return;
			}

			// Use environment variables for SQLite configuration
			const dbPath = env.STORAGE_DATABASE_PATH;
			let sqlitePath = './data';
			let sqliteDatabase = 'cipher-sessions.db';

			if (dbPath) {
				const pathParts = dbPath.split('/');
				sqliteDatabase = pathParts.pop() || 'cipher-sessions.db';
				sqlitePath = pathParts.join('/') || './data';
			}

			this.storageManager = new StorageManager({
				database: {
					type: 'sqlite',
					path: sqlitePath,
					database: sqliteDatabase,
				},
				cache: {
					type: 'in-memory',
				},
			});
			await this.storageManager.connect();
			logger.info('SessionManager: SQLite storage initialized successfully');
			return;
		} catch (error) {
			logger.error('SessionManager: Failed to initialize basic storage:', error);
			throw error;
		}
	}
	/**
	 * Save a single session to storage
	 */
	private async saveSession(sessionId: string, session: ConversationSession): Promise<void> {
		if (!this.storageManager?.isConnected()) {
			throw new SessionPersistenceError('Storage manager not connected', 'save', sessionId);
		}

		const serialized = await session.serialize();

		// CRITICAL FIX: Don't save sessions with 0 messages to prevent phantom sessions
		if (serialized.conversationHistory.length === 0) {
			logger.debug(`SessionManager: Skipping save of session ${sessionId} with 0 messages`);
			return;
		}

		const key = this.getSessionStorageKey(sessionId);

		const backends = this.storageManager.getBackends();
		if (!backends) {
			throw new SessionPersistenceError('No storage backends available', 'save', sessionId);
		}

		await backends.database.set(key, serialized);
		logger.debug(
			`SessionManager: Saved session ${sessionId} to persistent storage with ${serialized.conversationHistory.length} messages`
		);
	}

	/**
	 * Load a single session from storage
	 */
	private async loadSession(sessionId: string): Promise<ConversationSession | null> {
		// Handle null or invalid session IDs
		if (!sessionId || sessionId === 'null' || sessionId === 'undefined') {
			logger.debug(`SessionManager: Invalid session ID provided: ${sessionId}`);
			return null;
		}

		if (!this.storageManager?.isConnected()) {
			throw new SessionPersistenceError('Storage manager not connected', 'load', sessionId);
		}

		const key = this.getSessionStorageKey(sessionId);
		const backends = this.storageManager.getBackends();

		if (!backends) {
			throw new SessionPersistenceError('No storage backends available', 'load', sessionId);
		}

		const serialized = await backends.database.get<SerializedSession>(key);
		if (!serialized) {
			logger.debug(`SessionManager: No serialized data found for session ${sessionId}`);
			return null;
		}

		// Validate the serialized data if configured to do so
		if (this.persistenceConfig.validateOnRestore) {
			if (!this.validateSerializedSession(serialized)) {
				throw new SessionPersistenceError('Invalid serialized session data', 'load', sessionId);
			}
		}

		// Deserialize and restore the session
		const session = await ConversationSession.deserialize(serialized, this.services);

		// Add to active sessions
		// const now = Date.now();
		this.sessions.set(sessionId, {
			session,
			lastActivity: serialized.metadata.lastActivity,
			createdAt: serialized.metadata.createdAt,
		});

		// CRITICAL FIX: Force refresh conversation history after session is loaded
		// This ensures the context manager has the conversation history when switching sessions
		try {
			await session.refreshConversationHistory();
			logger.debug(`SessionManager: Refreshed conversation history for session ${sessionId}`);

			// Verify that the context manager has the messages
			const contextHistory = session.getContextHistory();
			logger.debug(
				`SessionManager: Context manager for session ${sessionId} has ${contextHistory.length} messages`
			);

			// Also verify history provider has messages
			const history = await session.getConversationHistory();
			logger.debug(
				`SessionManager: History provider for session ${sessionId} has ${history.length} messages`
			);
		} catch (error) {
			logger.warn(
				`SessionManager: Failed to refresh conversation history for session ${sessionId}:`,
				error
			);
			// Continue even if history refresh fails
		}

		logger.debug(
			`SessionManager: Loaded session ${sessionId} from persistent storage with ${serialized.conversationHistory.length} messages`
		);
		return session;
	}

	/**
	 * Get all session keys from storage with optimized batch processing
	 */
	private async getAllSessionKeys(): Promise<string[]> {
		if (!this.storageManager?.isConnected()) {
			logger.warn('SessionManager: Storage manager not connected, cannot get session keys');
			return [];
		}

		const backends = this.storageManager.getBackends();
		if (!backends) {
			logger.warn('SessionManager: No storage backends available');
			return [];
		}

		try {
			// Use the database backend's list method to get all keys with our prefix
			const prefix = this.persistenceConfig.storageKeyPrefix!;
			logger.debug(`SessionManager: Searching for session keys with prefix '${prefix}'`);

			const sessionKeys = await backends.database.list(prefix);

			logger.debug(
				`SessionManager: Found ${sessionKeys.length} session keys in storage with prefix '${prefix}'`
			);
			return sessionKeys;
		} catch (error) {
			logger.warn('SessionManager: Failed to get session keys from storage:', error);
			return [];
		}
	}

	/**
	 * Get all message keys from storage for session discovery
	 */
	private async getAllMessageKeys(): Promise<string[]> {
		if (!this.storageManager?.isConnected()) {
			return [];
		}

		const backends = this.storageManager.getBackends();
		if (!backends) {
			return [];
		}

		try {
			const messageKeys = await backends.database.list('messages:');
			logger.debug(`SessionManager: Found ${messageKeys.length} message keys in storage`);
			return messageKeys;
		} catch (error) {
			logger.warn('SessionManager: Failed to get message keys from storage:', error);
			return [];
		}
	}

	/**
	 * Get the storage key for a session
	 */
	private getSessionStorageKey(sessionId: string): string {
		return `${this.persistenceConfig.storageKeyPrefix}${sessionId}`;
	}

	/**
	 * Extract session ID from storage key
	 */
	private extractSessionIdFromKey(key: string): string {
		const prefix = this.persistenceConfig.storageKeyPrefix!;
		return key.startsWith(prefix) ? key.substring(prefix.length) : key;
	}

	/**
	 * Validate a serialized session object
	 */
	private validateSerializedSession(data: SerializedSession): boolean {
		try {
			return (
				typeof data.id === 'string' &&
				typeof data.version === 'string' &&
				typeof data.serializedAt === 'number' &&
				data.metadata &&
				typeof data.metadata.createdAt === 'number' &&
				typeof data.metadata.lastActivity === 'number' &&
				Array.isArray(data.conversationHistory)
			);
		} catch {
			return false;
		}
	}

	public async shutdown(): Promise<void> {
		logger.info(
			`SessionManager: Starting shutdown process for ${this.sessions.size} active sessions...`
		);

		// Save all sessions before shutting down
		try {
			const saveStats = await this.saveAllSessions();
			logger.info(
				`SessionManager: Shutdown save completed - ${saveStats.savedSessions}/${saveStats.totalSessions} sessions saved`
			);
		} catch (error) {
			logger.error('SessionManager: Failed to save sessions during shutdown:', error);
		}

		// Stop cleanup interval
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined;
		}

		// Clear performance caches and request deduplicators
		this.sessionMetadataCache.clear();
		this.messageCountCache.clear();
		this.requestDeduplicator.clear();

		// Log performance metrics
		logger.info('SessionManager: Final performance metrics:', this.performanceMetrics);

		// Disconnect storage manager
		if (this.storageManager) {
			try {
				await this.storageManager.disconnect();
				logger.debug('SessionManager: Storage manager disconnected');
			} catch (error) {
				logger.warn('SessionManager: Failed to disconnect storage manager:', error);
			}
		}

		// Clear in-memory sessions
		const sessionCount = this.sessions.size;
		this.sessions.clear();

		logger.info(`SessionManager: Shutdown complete. Cleared ${sessionCount} in-memory sessions`);
	}

	/**
	 * Get the storageManager for a given session (if available)
	 */
	public getStorageManagerForSession(sessionId: string): any {
		const sessionMetadata = this.sessions.get(sessionId);
		if (
			sessionMetadata &&
			sessionMetadata.session &&
			typeof sessionMetadata.session.getStorageManager === 'function'
		) {
			return sessionMetadata.session.getStorageManager();
		}
		return undefined;
	}

	/**
	 * Performance optimization: Cache management methods
	 */
	private getCachedResult<T>(key: string): T | null {
		const now = Date.now();

		// Check session metadata cache
		const metadataEntry = this.sessionMetadataCache.get(key);
		if (metadataEntry && now < metadataEntry.expiresAt) {
			return metadataEntry.metadata as unknown as T;
		}

		// Check message count cache
		const countEntry = this.messageCountCache.get(key);
		if (countEntry && now < countEntry.expiresAt) {
			return countEntry.count as unknown as T;
		}

		return null;
	}

	private setCacheResult<T>(key: string, value: T): void {
		const now = Date.now();
		const expiresAt = now + this.CACHE_TTL;

		if (Array.isArray(value)) {
			// For arrays (like session IDs), create a special cache entry
			this.sessionMetadataCache.set(key, {
				metadata: value as unknown as SessionMetadata,
				cachedAt: now,
				expiresAt,
			});
		} else if (typeof value === 'number') {
			// For numbers (like message counts)
			this.messageCountCache.set(key, {
				count: value,
				cachedAt: now,
				expiresAt,
			});
		}
	}

	private cleanupExpiredCache(): void {
		const now = Date.now();

		// Clean up expired session metadata cache entries
		for (const [key, entry] of this.sessionMetadataCache.entries()) {
			if (now >= entry.expiresAt) {
				this.sessionMetadataCache.delete(key);
			}
		}

		// Clean up expired message count cache entries
		for (const [key, entry] of this.messageCountCache.entries()) {
			if (now >= entry.expiresAt) {
				this.messageCountCache.delete(key);
			}
		}
	}

	private updateAverageLoadTime(loadTime: number): void {
		const alpha = 0.1; // Exponential moving average factor
		this.performanceMetrics.averageLoadTime =
			this.performanceMetrics.averageLoadTime === 0
				? loadTime
				: alpha * loadTime + (1 - alpha) * this.performanceMetrics.averageLoadTime;
	}

	/**
	 * Clear session from all caches to prevent phantom sessions
	 */
	private clearSessionFromAllCaches(sessionId: string): void {
		// Clear from metadata cache
		this.sessionMetadataCache.delete(`metadata_${sessionId}`);

		// Clear from message count cache
		this.messageCountCache.delete(`count_${sessionId}`);

		// Clear from active session IDs cache (invalidate the list)
		this.sessionMetadataCache.delete('active_session_ids');

		logger.debug(`SessionManager: Cleared all caches for session ${sessionId}`);
	}

	/**
	 * Filter out invalid sessions (empty sessions with 0 messages)
	 */
	private async filterValidSessions(sessionIds: string[]): Promise<string[]> {
		const validSessions: string[] = [];

		for (const sessionId of sessionIds) {
			try {
				// Check if session has messages or is in active memory
				const isInMemory = this.sessions.has(sessionId);
				const messageCount = await this.getSessionMessageCount(sessionId);

				// Keep sessions that are either in memory OR have messages
				if (isInMemory || messageCount > 0) {
					validSessions.push(sessionId);
				} else {
					// Clean up phantom sessions with 0 messages
					logger.debug(`SessionManager: Cleaning up phantom session ${sessionId} with 0 messages`);
					await this.cleanupPhantomSession(sessionId);
				}
			} catch (error) {
				logger.warn(`SessionManager: Error validating session ${sessionId}:`, error);
				// Include session in case of validation error to be safe
				validSessions.push(sessionId);
			}
		}

		return validSessions;
	}

	/**
	 * Clean up phantom sessions that have no messages
	 */
	private async cleanupPhantomSession(sessionId: string): Promise<void> {
		try {
			if (this.storageManager?.isConnected()) {
				const backends = this.storageManager.getBackends();
				if (backends?.database) {
					// Delete phantom session data
					const sessionKey = this.getSessionStorageKey(sessionId);
					const historyKey = `messages:${sessionId}`;

					await Promise.allSettled([
						backends.database.delete(sessionKey),
						backends.database.delete(historyKey),
					]);

					logger.debug(`SessionManager: Cleaned up phantom session ${sessionId}`);
				}
			}
		} catch (error) {
			logger.warn(`SessionManager: Failed to cleanup phantom session ${sessionId}:`, error);
		}
	}

	/**
	 * Get batch session metadata with parallel processing and caching
	 */
	public async getBatchSessionMetadata(
		sessionIds: string[]
	): Promise<
		Map<string, { id: string; messageCount: number; createdAt: number; lastActivity: number }>
	> {
		const startTime = Date.now();
		const result = new Map<
			string,
			{ id: string; messageCount: number; createdAt: number; lastActivity: number }
		>();

		// Process sessions in parallel batches
		const batches = [];
		for (let i = 0; i < sessionIds.length; i += this.BATCH_SIZE) {
			batches.push(sessionIds.slice(i, i + this.BATCH_SIZE));
		}

		for (const batch of batches) {
			const batchPromises = batch.map(async sessionId => {
				try {
					// Check cache first
					const cacheKey = `metadata_${sessionId}`;
					const cached = this.getCachedResult<{
						id: string;
						messageCount: number;
						createdAt: number;
						lastActivity: number;
					}>(cacheKey);

					if (cached) {
						this.performanceMetrics.cacheHits++;
						return { sessionId, metadata: cached };
					}

					this.performanceMetrics.cacheMisses++;

					// Get metadata from session or storage
					let metadata: {
						id: string;
						messageCount: number;
						createdAt: number;
						lastActivity: number;
					} | null = null;

					// Try in-memory session first
					const sessionMetadata = this.sessions.get(sessionId);
					if (sessionMetadata) {
						metadata = {
							id: sessionId,
							messageCount: await this.getSessionMessageCount(sessionId),
							createdAt: sessionMetadata.createdAt,
							lastActivity: sessionMetadata.lastActivity,
						};
					} else {
						// Load from storage
						metadata = await this.getSessionMetadataFromStorage(sessionId);
					}

					if (metadata) {
						// Cache the result
						this.setCacheResult(cacheKey, metadata);
						return { sessionId, metadata };
					}

					return { sessionId, metadata: null };
				} catch (error) {
					logger.warn(`Failed to get metadata for session ${sessionId}:`, error);
					return { sessionId, metadata: null };
				}
			});

			// Process batch in parallel
			const batchResults = await Promise.allSettled(batchPromises);
			this.performanceMetrics.parallelLoads += batchResults.length;

			// Collect results
			for (const promiseResult of batchResults) {
				if (promiseResult.status === 'fulfilled' && promiseResult.value.metadata) {
					result.set(promiseResult.value.sessionId, promiseResult.value.metadata);
				}
			}
		}

		const loadTime = Date.now() - startTime;
		this.updateAverageLoadTime(loadTime);

		logger.debug(
			`SessionManager: Batch loaded ${result.size}/${sessionIds.length} session metadata in ${loadTime}ms`
		);
		return result;
	}

	/**
	 * Get session message count with caching
	 */
	private async getSessionMessageCount(sessionId: string): Promise<number> {
		const cacheKey = `count_${sessionId}`;
		const cached = this.getCachedResult<number>(cacheKey);

		if (cached !== null) {
			this.performanceMetrics.cacheHits++;
			return cached;
		}

		this.performanceMetrics.cacheMisses++;

		try {
			// Try to get from active session
			const sessionMetadata = this.sessions.get(sessionId);
			if (sessionMetadata) {
				const history = await sessionMetadata.session.getConversationHistory();
				// Filter to only include user and assistant messages (excluding tool calls)
				const filteredHistory = history.filter((msg: any) => {
					// Include user messages
					if (msg.role === 'user') return true;
					// Include assistant messages that don't have tool calls
					if (msg.role === 'assistant' && (!msg.toolCalls || msg.toolCalls.length === 0))
						return true;
					// Exclude everything else
					return false;
				});
				const count = filteredHistory.length;
				this.setCacheResult(cacheKey, count);
				return count;
			}

			// Try to get from storage
			if (this.storageManager?.isConnected()) {
				const backends = this.storageManager.getBackends();
				if (backends?.database) {
					// Try messages key first
					const historyKey = `messages:${sessionId}`;
					const historyData = await backends.database.get(historyKey);
					if (historyData && Array.isArray(historyData)) {
						// Filter to only include user and assistant messages (excluding tool calls)
						const filteredHistory = historyData.filter((msg: any) => {
							// Include user messages
							if (msg.role === 'user') return true;
							// Include assistant messages that don't have tool calls
							if (msg.role === 'assistant' && (!msg.toolCalls || msg.toolCalls.length === 0))
								return true;
							// Exclude everything else
							return false;
						});
						const count = filteredHistory.length;
						this.setCacheResult(cacheKey, count);
						return count;
					}

					// Try session data
					const sessionKey = this.getSessionStorageKey(sessionId);
					const sessionData = await backends.database.get(sessionKey);
					if ((sessionData as any)?.conversationHistory?.length) {
						// Filter to only include user and assistant messages (excluding tool calls)
						const filteredHistory = (sessionData as any).conversationHistory.filter((msg: any) => {
							// Include user messages
							if (msg.role === 'user') return true;
							// Include assistant messages that don't have tool calls
							if (msg.role === 'assistant' && (!msg.toolCalls || msg.toolCalls.length === 0))
								return true;
							// Exclude everything else
							return false;
						});
						const count = filteredHistory.length;
						this.setCacheResult(cacheKey, count);
						return count;
					}
				}
			}

			// Default to 0 if not found
			this.setCacheResult(cacheKey, 0);
			return 0;
		} catch (error) {
			logger.warn(`Failed to get message count for session ${sessionId}:`, error);
			this.setCacheResult(cacheKey, 0);
			return 0;
		}
	}

	/**
	 * Get session metadata from storage
	 */
	private async getSessionMetadataFromStorage(
		sessionId: string
	): Promise<{ id: string; messageCount: number; createdAt: number; lastActivity: number } | null> {
		if (!this.storageManager?.isConnected()) {
			return null;
		}

		const backends = this.storageManager.getBackends();
		if (!backends?.database) {
			return null;
		}

		try {
			// Get message count and session data in parallel
			const [messageCount, sessionData] = await Promise.allSettled([
				this.getSessionMessageCount(sessionId),
				backends.database.get(this.getSessionStorageKey(sessionId)),
			]);

			const count = messageCount.status === 'fulfilled' ? messageCount.value : 0;
			const data = sessionData.status === 'fulfilled' ? sessionData.value : null;

			// Create metadata with best available information
			const now = Date.now();
			return {
				id: sessionId,
				messageCount: count,
				createdAt: (data as any)?.metadata?.createdAt || now - count * 60000, // Estimate based on message count
				lastActivity: (data as any)?.metadata?.lastActivity || now,
			};
		} catch (error) {
			logger.warn(`Failed to get session metadata from storage for ${sessionId}:`, error);
			return null;
		}
	}
}
