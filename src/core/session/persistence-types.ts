/**
 * Session Persistence Types
 *
 * Defines the types and interfaces for serializing and deserializing
 * conversation sessions and their complete state for persistence.
 *
 * @module session/persistence-types
 */

import type { InternalMessage } from '../brain/llm/messages/types.js';

/**
 * Serialized form of a ConversationSession for storage
 */
export interface SerializedSession {
	/** Unique session identifier */
	id: string;

	/** Session metadata */
	metadata: {
		/** When the session was created */
		createdAt: number;
		/** Last activity timestamp */
		lastActivity: number;
		/** Session-specific memory metadata if any */
		sessionMemoryMetadata?: Record<string, any>;
		/** History settings */
		historyEnabled: boolean;
		historyBackend: 'database' | 'memory';
	};

	/** Complete conversation history */
	conversationHistory: InternalMessage[];

	/** Session configuration options */
	options?: {
		hadMetadataSchema?: boolean; // Indicates if the session had a metadata schema
		// Note: Functions (mergeMetadata, beforeMemoryExtraction) are not serialized
		// for security reasons and must be re-configured on session restoration
	};

	/** Version for schema evolution */
	version: string;

	/** When this serialization was created */
	serializedAt: number;
}

/**
 * Session persistence statistics
 */
export interface SessionPersistenceStats {
	/** Total number of sessions processed */
	totalSessions: number;
	/** Number of sessions successfully saved */
	savedSessions: number;
	/** Number of sessions that failed to save */
	failedSessions: number;
	/** Total time taken for persistence operation (ms) */
	persistenceTime: number;
	/** Session IDs that failed to persist (for debugging) */
	failedSessionIds: string[];
	/** Any error messages encountered */
	errors: string[];
}

/**
 * Session restoration statistics
 */
export interface SessionRestorationStats {
	/** Total number of sessions found in storage */
	totalSessions: number;
	/** Number of sessions successfully restored */
	restoredSessions: number;
	/** Number of sessions that failed to restore */
	failedSessions: number;
	/** Total time taken for restoration operation (ms) */
	restorationTime: number;
	/** Session IDs that failed to restore (for debugging) */
	failedSessionIds: string[];
	/** Any error messages encountered */
	errors: string[];
}

/**
 * Configuration for session persistence behavior
 */
export interface SessionPersistenceConfig {
	/** Storage key prefix for session data */
	storageKeyPrefix?: string;

	/** Maximum number of sessions to persist */
	maxSessionsToSave?: number;

	/** Maximum age of sessions to restore (ms) */
	maxSessionAge?: number;

	/** Whether to compress session data */
	compress?: boolean;

	/** Timeout for save operations (ms) */
	saveTimeout?: number;

	/** Timeout for load operations (ms) */
	loadTimeout?: number;

	/** Whether to validate restored sessions */
	validateOnRestore?: boolean;
}

/**
 * Session persistence error types
 */
export class SessionPersistenceError extends Error {
	constructor(
		message: string,
		public readonly operation: 'save' | 'load' | 'serialize' | 'deserialize',
		public readonly sessionId?: string,
		public override readonly cause?: Error
	) {
		super(message);
		this.name = 'SessionPersistenceError';
	}
}

/**
 * Constants for session persistence
 */
export const SESSION_PERSISTENCE_CONSTANTS = {
	/** Current version of the serialization format */
	CURRENT_VERSION: '1.0.0',

	/** Default storage key prefix */
	DEFAULT_STORAGE_PREFIX: 'cipher:sessions:',

	/** Default maximum number of sessions to save */
	DEFAULT_MAX_SESSIONS: 50,

	/** Default maximum session age (24 hours) */
	DEFAULT_MAX_AGE: 24 * 60 * 60 * 1000,

	/** Default save timeout (30 seconds) */
	DEFAULT_SAVE_TIMEOUT: 30 * 1000,

	/** Default load timeout (30 seconds) */
	DEFAULT_LOAD_TIMEOUT: 30 * 1000,
} as const;
