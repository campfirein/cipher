import { randomUUID } from 'crypto';
import { EnhancedPromptManager } from '../brain/systemPrompt/enhanced-manager.js';
import { MemAgentStateManager } from '../brain/memAgent/state-manager.js';
import { ConversationSession } from './coversation-session.js';
import { MCPManager } from '../mcp/manager.js';
import { UnifiedToolManager } from '../brain/tools/unified-tool-manager.js';
import { logger } from '@core/logger/index.js';
import { EventManager } from '../events/event-manager.js';
import { SessionEvents } from '../events/event-types.js';

export interface SessionManagerConfig {
	maxSessions?: number;
	sessionTTL?: number;
}

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
	private cleanupInterval?: NodeJS.Timeout;
	private initializationPromise!: Promise<void>;
	private readonly pendingCreations = new Map<string, Promise<ConversationSession>>();

	constructor(
		private services: {
			stateManager: MemAgentStateManager;
			promptManager: EnhancedPromptManager;
			mcpManager: MCPManager;
			unifiedToolManager: UnifiedToolManager;
			eventManager: EventManager;
		},
		config: SessionManagerConfig = {}
	) {
		this.maxSessions = config.maxSessions ?? 100;
		this.sessionTTL = config.sessionTTL ?? 3600000; // 1 hour
	}

	public async init(): Promise<void> {
		if (this.initialized) {
			return;
		}
		this.initialized = true;

		// Try to recover existing sessions from conversation history
		await this.recoverExistingSessions();

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
		// Check if we need to evict old sessions to make room
		if (this.sessions.size >= this.maxSessions) {
			await this.evictOldestSession();
		}

		// Create new conversation session
		const session = new ConversationSession(this.services, sessionId);
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

		logger.debug(`Created new session: ${sessionId}`);
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

			logger.debug(`Updated activity for session: ${sessionId}`);
		}
	}

	public async getSession(sessionId: string): Promise<ConversationSession | null> {
		await this.ensureInitialized();

		const sessionMetadata = this.sessions.get(sessionId);
		if (!sessionMetadata) {
			return null;
		}

		// Check if session has expired
		if (this.isSessionExpired(sessionMetadata)) {
			await this.removeSession(sessionId);
			return null;
		}

		// Update activity and return session
		await this.updateSessionActivity(sessionId);
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

			logger.debug(`Removed session: ${sessionId}`);
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

		return Array.from(this.sessions.keys());
	}

	public async getSessionCount(): Promise<number> {
		await this.ensureInitialized();
		return this.sessions.size;
	}

	public async getSessionMetadata(sessionId: string): Promise<{
		createdAt: number;
		lastActivity: number;
	} | null> {
		await this.ensureInitialized();

		const sessionMetadata = this.sessions.get(sessionId);
		if (!sessionMetadata) {
			return null;
		}

		// Check if session has expired
		if (this.isSessionExpired(sessionMetadata)) {
			await this.removeSession(sessionId);
			return null;
		}

		return {
			createdAt: sessionMetadata.createdAt,
			lastActivity: sessionMetadata.lastActivity,
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

		for (const sessionId of expiredSessionIds) {
			// Emit session expired event before removing
			this.services.eventManager.emitSessionEvent(sessionId, SessionEvents.SESSION_EXPIRED, {
				sessionId,
				timestamp: Date.now(),
			});

			await this.removeSession(sessionId);
		}

		if (expiredSessionIds.length > 0) {
			logger.debug(`Cleaned up ${expiredSessionIds.length} expired sessions`);
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

	public async shutdown(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined as any; // Type assertion to handle exact optional property types
		}

		// Clear all sessions
		this.sessions.clear();
		this.pendingCreations.clear();
		this.initialized = false;

		logger.debug('SessionManager shutdown completed');
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
	 * Try to recover existing sessions from conversation history
	 * This helps restore session list after server restarts
	 */
	private async recoverExistingSessions(): Promise<void> {
		try {
			// Create a temporary session to access the storage manager
			const tempSession = new ConversationSession(this.services, 'temp-recovery');
			await tempSession.init();

			const storageManager = tempSession.getStorageManager();
			if (!storageManager) {
				logger.debug('No storage manager available for session recovery');
				return;
			}

			// Try to get all unique session IDs from the database
			const sessionIds = await this.getExistingSessionIds(storageManager);

			// Create session metadata for recovered sessions
			const now = Date.now();
			let recoveredCount = 0;

			for (const sessionId of sessionIds) {
				if (!this.sessions.has(sessionId) && sessionId !== 'temp-recovery') {
					try {
						// Create the session
						const session = new ConversationSession(this.services, sessionId);
						await session.init();

						// Add to sessions map with estimated metadata
						this.sessions.set(sessionId, {
							session,
							lastActivity: now,
							createdAt: now, // We don't know the real creation time
						});

						recoveredCount++;
					} catch (error) {
						logger.warn(`Failed to recover session ${sessionId}:`, error);
					}
				}
			}

			if (recoveredCount > 0) {
				logger.info(`Recovered ${recoveredCount} existing sessions`);
			}

			// Note: temp session will be cleaned up by GC
		} catch (error) {
			logger.warn('Failed to recover existing sessions:', error);
		}
	}

	/**
	 * Get existing session IDs from storage
	 */
	private async getExistingSessionIds(storageManager: any): Promise<string[]> {
		try {
			// Try to get session IDs from different storage backends
			if (storageManager.database) {
				// For database backends, query for distinct session IDs
				const database = storageManager.database;

				if (database.query) {
					// For SQL databases
					const result = await database.query(
						'SELECT DISTINCT session_id FROM conversations WHERE session_id IS NOT NULL AND session_id != ""'
					);
					return result.rows ? result.rows.map((row: any) => row.session_id) : [];
				}
			}

			// Fallback: return empty array if we can't query the database
			return [];
		} catch (error) {
			logger.warn('Failed to query existing session IDs:', error);
			return [];
		}
	}
}
