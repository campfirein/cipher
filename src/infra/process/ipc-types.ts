/**
 * IPC Types - Shared types for Node.js IPC between parent and child processes.
 *
 * Architecture v0.5.0:
 * - IPC is used ONLY for process lifecycle (ready, ping/pong, shutdown, error, health-check)
 * - Task communication uses Socket.IO (NOT IPC)
 *
 * Message flows:
 * - Parent → Child: IPCCommand (ping, shutdown, health-check)
 * - Child → Parent: IPCResponse variants (ready, pong, stopped, error, health-check-result)
 */

// ============================================================================
// Parent → Child Commands
// ============================================================================

/**
 * Commands sent from parent (ProcessManager) to child processes.
 * - ping: Heartbeat check
 * - shutdown: Graceful shutdown request
 * - health-check: Fix #3 - Verify connection health after sleep/wake
 */
export type IPCCommand = {type: 'health-check'} | {type: 'ping'} | {type: 'shutdown'}

// ============================================================================
// Child → Parent Responses
// ============================================================================

/**
 * Base response types (shared by all child processes).
 */
export type IPCPongResponse = {type: 'pong'}
export type IPCStoppedResponse = {type: 'stopped'}
export type IPCErrorResponse = {error: string; type: 'error'}

/**
 * Health-check result response (agent-only).
 * Sent after health-check command to inform ProcessManager of connection status.
 */
export type IPCHealthCheckResultResponse = {success: boolean; type: 'health-check-result'}

/**
 * Ready response variants.
 * - Transport: includes port number
 * - Agent: simple ready signal
 */
export type IPCReadyResponse = {type: 'ready'}
export type IPCReadyWithPortResponse = {port: number; type: 'ready'}

/**
 * Composite response types for each process type.
 */
export type TransportIPCResponse = IPCErrorResponse | IPCPongResponse | IPCReadyWithPortResponse | IPCStoppedResponse
export type AgentIPCResponse =
  | IPCErrorResponse
  | IPCHealthCheckResultResponse
  | IPCPongResponse
  | IPCReadyResponse
  | IPCStoppedResponse

// ============================================================================
// Backward-Compatible Aliases
// ============================================================================

/**
 * Legacy aliases for gradual migration.
 * @deprecated Use IPCCommand instead
 */
export type IPCMessage = IPCCommand
export type IPCMessageToChild = IPCCommand
