export const BRV_DIR = '.brv'
export const BLOBS_DIR = 'blobs'
export const PROJECT_CONFIG_FILE = 'config.json'
export const INSTANCE_FILE = 'instance.json'
export const BRV_CONFIG_VERSION = '0.0.1'

// Global config constants (user-level, stored in XDG config directory)
export const GLOBAL_CONFIG_DIR = 'brv'
export const GLOBAL_CONFIG_FILE = 'config.json'
export const GLOBAL_CONFIG_VERSION = '0.0.1'

// Global data directory name (for XDG_DATA_HOME - secrets, credentials, cache)
// Same value as GLOBAL_CONFIG_DIR but different semantic purpose
export const GLOBAL_DATA_DIR = 'brv'

// ACE directory structure constants
export const ACE_DIR = 'ace'
export const PROJECT = 'byterover'

// Context Tree directory structure constants
export const CONTEXT_TREE_DIR = 'context-tree'
export const CONTEXT_FILE = 'context.md'
export const CONTEXT_FILE_EXTENSION = '.md'
export const README_FILE = 'README.md'
export const SNAPSHOT_FILE = '.snapshot.json'

/**
 * Default ByteRover branch name for memory storage.
 * This is ByteRover's internal branching mechanism, not Git branches.
 */
export const DEFAULT_BRANCH = 'main'

/**
 * ByteRover documentation URL.
 * Used in CLI help output to direct users to online documentation.
 */
export const DOCS_URL = 'https://docs.byterover.dev/beta'

// Transport layer constants (optimized for localhost real-time)
export const TRANSPORT_HOST = '127.0.0.1' // Use hostname for better sandbox compatibility
export const TRANSPORT_REQUEST_TIMEOUT_MS = 10_000 // 10s - most operations complete quickly
export const TRANSPORT_ROOM_TIMEOUT_MS = 2000 // 2s - room ops are instant on localhost
export const TRANSPORT_CONNECT_TIMEOUT_MS = 3000 // 3s - 127.0.0.1 connects in <10ms
export const TRANSPORT_RECONNECTION_DELAY_MS = 50 // 50ms - ultra aggressive start
export const TRANSPORT_RECONNECTION_DELAY_MAX_MS = 1000 // 1s cap - fail fast, retry fast
export const TRANSPORT_RECONNECTION_ATTEMPTS = 30 // More attempts with faster retry
export const TRANSPORT_PING_INTERVAL_MS = 5000 // 5s ping - reasonable for local communication
export const TRANSPORT_PING_TIMEOUT_MS = 10_000 // 10s timeout - avoid false disconnects during GC/load
// WebSocket-only transport to avoid HTTP polling issues in sandboxed environments (Cursor, etc.)
// HTTP polling may be blocked by IDE sandboxes causing "xhr poll error"
export const TRANSPORT_DEFAULT_TRANSPORTS: ('polling' | 'websocket')[] = ['websocket']

// LLM Model defaults
export const DEFAULT_LLM_MODEL = 'gemini-3-flash-preview'
