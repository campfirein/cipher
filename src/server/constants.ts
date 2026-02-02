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

// Project room naming convention
export const PROJECT_ROOM_PREFIX = 'project:'
export const PROJECT_ROOM_SUFFIX = ':broadcast'

// === Daemon infrastructure constants ===
export const GLOBAL_PROJECTS_DIR = 'projects'
export const REGISTRY_FILE = 'registry.json'
export const DAEMON_PREFERRED_PORT = 37_847
export const DAEMON_PORT_RANGE_MIN = 37_848
export const DAEMON_PORT_RANGE_MAX = 37_947
export const DAEMON_INSTANCE_FILE = 'daemon.json'

// Heartbeat
export const HEARTBEAT_FILE = 'heartbeat'
export const HEARTBEAT_INTERVAL_MS = 5000 // Write every 5s
export const HEARTBEAT_STALE_THRESHOLD_MS = 15_000 // Stale if >15s

// Idle timeout
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const IDLE_CHECK_INTERVAL_MS = 60_000 // Check every 60s

// Sleep/wake detection
export const SLEEP_WAKE_CHECK_INTERVAL_MS = 5000
export const SLEEP_WAKE_THRESHOLD_MULTIPLIER = 3

// Spawn lock
export const SPAWN_LOCK_FILE = 'spawn.lock'
export const SPAWN_LOCK_STALE_THRESHOLD_MS = 30_000 // 30s

// Shutdown
export const TRANSPORT_STOP_TIMEOUT_MS = 3000 // 3s max for transport server to stop
export const SHUTDOWN_FORCE_EXIT_MS = 5000 // 5s safety net before force exit

// Daemon readiness polling
export const DAEMON_READY_TIMEOUT_MS = 5000 // 5s max wait
export const DAEMON_READY_POLL_INTERVAL_MS = 100 // 100ms between polls

// Daemon spawner — budget allocation for stop + poll
export const DAEMON_STOP_BUDGET_MS = 3000 // 3s max to stop old daemon
export const DAEMON_STOP_POLL_INTERVAL_MS = 100 // 100ms between death checks

// Auth state polling (daemon — replaces agent-worker credential polling in M2)
export const AUTH_STATE_POLL_INTERVAL_MS = 5000 // Poll token store every 5s

// Agent Pool (T6)
export const AGENT_POOL_MAX_SIZE = 5
export const AGENT_POOL_FORCE_EVICT_TIMEOUT_MS = 30_000 // 30s queue wait before force evict
export const AGENT_PROCESS_READY_TIMEOUT_MS = 15_000 // 15s max wait for child process to register
export const AGENT_PROCESS_STOP_TIMEOUT_MS = 5000 // 5s max wait for child process to stop gracefully
