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
		this.sessionTTL = config.sessionTTL ?? 3600000; // 1 hour

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

		logger.info('SessionManager: Starting initialization...');

		// Initialize storage manager for persistence
		await this.initializePersistenceStorage();

		// Load existing sessions from persistent storage
		const restorationStats = await this.loadAllSessions();
		logger.info(
			`SessionManager: Initialization complete. Loaded ${restorationStats.restoredSessions}/${restorationStats.totalSessions} sessions from storage. Current in-memory sessions: ${this.sessions.size}`
		);

		// Start cleanup interval for expired sessions
		this.startCleanupInterval();

		logger.debug(
			`SessionManager initialized with max sessions: ${this.maxSessions}, TTL: ${this.sessionTTL}ms`
		);
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			if (!this.initializationPromise) {
				this.initializationPromise = this.init();
			}
			await this.initializationPromise;
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

		// Create new conversation session
		const session = new ConversationSession(
			{
				...this.services,
				contextManager: this.services.contextManager,
			},
			sessionId
		);
		await session.init();

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

		const sessionMetadata = this.sessions.get(sessionId);
		const removed = this.sessions.delete(sessionId);
		if (removed && sessionMetadata) {
			// Emit session deleted event
			this.services.eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_DELETED, {
				sessionId,
				timestamp: Date.now(),
			});

			logger.info(
				`SessionManager: Removed session ${sessionId}. Remaining active sessions: ${this.sessions.size}`
			);
		}
		return removed;
	}

	public async getAllSessions(): Promise<ConversationSession[]> {
		await this.ensureInitialized();
		return Array.from(this.sessions.values()).map(metadata => metadata.session);
	}

	public async getActiveSessionIds(): Promise<string[]> {
		await this.ensureInitialized();

		// Clean up expired sessions first
		await this.cleanupExpiredSessions();

		// Get in-memory sessions
		const inMemorySessionIds = Array.from(this.sessions.keys());

		// Get persisted sessions from storage
		const persistedSessionKeys = await this.getAllSessionKeys();
		const persistedSessionIds = persistedSessionKeys.map(key => this.extractSessionIdFromKey(key));

		// Combine and deduplicate
		const allSessionIds = [...new Set([...inMemorySessionIds, ...persistedSessionIds])];

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
	}> {
		await this.ensureInitialized();

		const backends = this.storageManager?.getBackends();
		const storageType = backends?.database?.getBackendType?.() || 'none';

		return {
			activeSessions: this.sessions.size,
			storageConnected: this.storageManager?.isConnected() || false,
			storageType,
			persistenceEnabled: !!this.storageManager,
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

		this.cleanupInterval = setInterval(async () => {
			try {
				await this.cleanupExpiredSessions();
			} catch (error) {
				logger.error('Error during session cleanup:', error);
			}
		}, cleanupIntervalMs);
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
			logger.info('SessionManager: Loading sessions from persistent storage...');

			// Get all session keys from storage
			const backends = this.storageManager.getBackends();
			if (!backends) {
				throw new SessionPersistenceError('No storage backends available', 'load');
			}

			// Scan for session keys (this might need to be implemented differently depending on backend)
			const sessionKeys = await this.getAllSessionKeys();
			stats.totalSessions = sessionKeys.length;

			logger.info(`SessionManager: Found ${sessionKeys.length} sessions in persistent storage`);

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

		logger.info(`SessionManager: Session restoration completed`, {
			totalSessions: stats.totalSessions,
			restoredSessions: stats.restoredSessions,
			failedSessions: stats.failedSessions,
			restorationTime: stats.restorationTime,
		});

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
				await this.initializeSqliteStorage();
			}
		} else {
			// No PostgreSQL configuration, try SQLite
			await this.initializeSqliteStorage();
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
	 * Initialize SQLite storage as fallback
	 */
	private async initializeSqliteStorage(): Promise<void> {
		try {
			// Try SQLite as fallback
			logger.debug('SessionManager: Attempting to initialize SQLite storage...');
			this.storageManager = new StorageManager({
				database: {
					type: 'sqlite',
					path: './data',
					database: 'cipher-sessions.db',
				},
				cache: {
					type: 'in-memory',
				},
			});

			await this.storageManager.connect();
			logger.info('SessionManager: SQLite persistence storage initialized successfully');
		} catch (sqliteError) {
			logger.warn(
				'SessionManager: SQLite failed, falling back to in-memory storage for sessions',
				sqliteError
			);

			try {
				// Fallback to in-memory storage for session persistence
				logger.debug('SessionManager: Attempting to initialize in-memory storage...');
				this.storageManager = new StorageManager({
					database: {
						type: 'in-memory',
					},
					cache: {
						type: 'in-memory',
					},
				});

				await this.storageManager.connect();
				logger.warn(
					'SessionManager: In-memory persistence storage initialized (sessions will not persist across restarts)'
				);
			} catch (fallbackError) {
				logger.error(
					'SessionManager: Failed to initialize any persistence storage, continuing without session persistence',
					fallbackError
				);
				this.storageManager = undefined;
				// Continue without persistence rather than failing
			}
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

		logger.debug(
			`SessionManager: Loaded session ${sessionId} from persistent storage with ${serialized.conversationHistory.length} messages`
		);
		return session;
	}

	/**
	 * Get all session keys from storage
	 */
	private async getAllSessionKeys(): Promise<string[]> {
		if (!this.storageManager?.isConnected()) {
			return [];
		}

		const backends = this.storageManager.getBackends();
		if (!backends) {
			return [];
		}

		try {
			// Use the database backend's list method to get all keys with our prefix
			const prefix = this.persistenceConfig.storageKeyPrefix!;
			const sessionKeys = await backends.database.list(prefix);

			logger.info(
				`SessionManager: Found ${sessionKeys.length} session keys in storage with prefix '${prefix}'`
			);
			if (sessionKeys.length > 0) {
				logger.debug(`SessionManager: Session keys found: ${sessionKeys.join(', ')}`);
			}
			return sessionKeys;
		} catch (error) {
			logger.warn('SessionManager: Failed to get session keys from storage:', error);
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
}
