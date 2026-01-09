/**
 * Process Manager - Manages the lifecycle of Transport and Agent processes.
 *
 * Architecture v0.5.0:
 * - Spawns 2 separate child processes: Transport and Agent
 * - Transport Process: Socket.IO server only (message hub)
 * - Agent Process: TaskProcessor + UseCases + CipherAgent
 * - ALL task communication via Socket.IO (NO IPC for tasks)
 * - IPC only for process lifecycle: ready, shutdown, stopped
 *
 * Startup sequence:
 * 1. fork('transport-worker.js')
 * 2. Wait for Transport 'ready' with port
 * 3. fork('agent-worker.js') with TRANSPORT_PORT env
 * 4. Wait for Agent 'ready'
 *
 * Shutdown sequence:
 * 1. Send 'shutdown' to Agent via IPC
 * 2. Wait for Agent to exit
 * 3. Send 'shutdown' to Transport via IPC
 * 4. Wait for Transport to exit
 */

import {type ChildProcess, fork} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {AgentIPCResponse, IPCCommand, TransportIPCResponse} from './ipc-types.js'

import {crashLog, getSessionLogPath, processManagerLog} from '../../utils/process-logger.js'

// IPC types imported from ./ipc-types.ts
// - IPCCommand: Parent → Child (ping, shutdown, health-check)
// - TransportIPCResponse: Transport → Parent (ready with port, pong, stopped, error)
// - AgentIPCResponse: Agent → Parent (ready, pong, stopped, error, health-check-result)

/**
 * Process state tracking.
 */
export type ProcessState = {
  /** Agent child process */
  agentProcess?: ChildProcess
  /** Whether Agent is connected */
  agentReady: boolean
  /** Transport port (from Transport Process) */
  port?: number
  /** Whether system is running */
  running: boolean
  /** Transport child process */
  transportProcess?: ChildProcess
  /** Whether Transport is ready */
  transportReady: boolean
}

/**
 * ProcessManager configuration.
 */
export type ProcessManagerConfig = {
  /** Timeout for process shutdown (ms) */
  shutdownTimeoutMs?: number
  /** Timeout for process startup (ms) */
  startupTimeoutMs?: number
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
const HEALTH_CHECK_INTERVAL_MS = 5000 // Check every 5 seconds for sleep detection
const SLEEP_DETECTION_THRESHOLD_MS = 30_000 // If 30s passed when expecting 5s, likely slept
const TRANSPORT_PING_TIMEOUT_MS = 5000 // Timeout for Transport ping response
const AGENT_HEALTH_CHECK_TIMEOUT_MS = 5000 // Timeout for Agent health-check response
const PERIODIC_HEALTH_CHECK_INTERVAL_MS = 30_000 // Periodic health check every 30s

/**
 * Creates a system error with crash log.
 * Logs error details to session log and returns user-friendly message.
 */
function createSystemError(error: string, context: string): Error {
  const logPath = crashLog(new Error(error), context)
  return new Error(`brv failed to start. Details logged to: ${logPath}`)
}

/**
 * ProcessManager - Spawns and manages Transport and Agent processes.
 *
 * Architecture v0.5.0:
 * - Single source of truth for child process lifecycle
 * - Transport spawned first (needs port)
 * - Agent spawned second (needs transport port)
 * - Crash recovery: respawn on exit
 */
export class ProcessManager {
  /** Whether an Agent health-check is pending response */
  private agentHealthCheckPending = false
  /** Timeout for Agent health-check response */
  private agentHealthCheckTimeout?: NodeJS.Timeout
  private healthCheckInterval?: NodeJS.Timeout
  /** Guard to prevent concurrent Agent restarts */
  private isRestartingAgent = false
  /** Guard to prevent concurrent Transport restarts */
  private isRestartingTransport = false
  private lastHealthCheckTime: number = Date.now()
  /** Periodic health check interval (30s) */
  private periodicHealthCheckInterval?: NodeJS.Timeout
  /** Stored handler ref for idempotent listener setup (prevents accumulation on respawn) */
  private runtimeMessageHandler?: (msg: AgentIPCResponse) => void
  private readonly shutdownTimeoutMs: number
  private readonly startupTimeoutMs: number
  private state: ProcessState = {
    agentReady: false,
    running: false,
    transportReady: false,
  }
  /** Stored handler ref for Transport runtime messages (prevents accumulation on respawn) */
  private transportMessageHandler?: (msg: TransportIPCResponse) => void
  /** Whether a Transport ping is pending response */
  private transportPingPending = false
  /** Timeout for Transport ping response */
  private transportPingTimeout?: NodeJS.Timeout

  constructor(config?: ProcessManagerConfig) {
    this.startupTimeoutMs = config?.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    this.shutdownTimeoutMs = config?.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  }

  /**
   * Get current state.
   */
  getState(): Readonly<ProcessState> {
    return {...this.state}
  }

  /**
   * Get transport port (for TUI to connect).
   */
  getTransportPort(): number | undefined {
    return this.state.port
  }

  /**
   * Check if system is fully running.
   */
  isRunning(): boolean {
    return this.state.running && this.state.transportReady && this.state.agentReady
  }

  /**
   * Start Transport and Agent processes.
   *
   * Sequence:
   * 1. Start Transport Process
   * 2. Wait for Transport 'ready' with port
   * 3. Start Agent Process with TRANSPORT_PORT env
   * 4. Wait for Agent 'ready'
   *
   * @throws Error if startup fails or times out
   */
  async start(): Promise<void> {
    if (this.state.running) {
      return
    }

    // Step 1: Start Transport Process
    const port = await this.startTransportProcess()
    this.state.port = port
    this.state.transportReady = true

    // Step 2: Start Agent Process (with transport port)
    await this.startAgentProcess(port)
    this.state.agentReady = true

    this.state.running = true

    // Step 3: Start health check for sleep/wake detection
    this.startHealthCheck()

    // Step 4: Start periodic health check (30s) for zombie detection mid-session
    this.startPeriodicHealthCheck()
  }

  /**
   * Stop all processes gracefully.
   *
   * Sequence:
   * 1. Stop Agent first (so it can disconnect cleanly)
   * 2. Stop Transport after Agent is gone
   */
  async stop(): Promise<void> {
    if (!this.state.running) {
      return
    }

    this.state.running = false

    // Stop health checks first
    this.stopHealthCheck()
    this.stopPeriodicHealthCheck()

    // Step 1: Stop Agent Process
    await this.stopAgentProcess()
    this.state.agentReady = false

    // Step 2: Stop Transport Process
    await this.stopTransportProcess()
    this.state.transportReady = false
    this.state.port = undefined
  }

  /**
   * Get directory for worker files.
   * In dev mode (tsx), import.meta.url points to src/ but workers need compiled .js from dist/
   */
  private getWorkerDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    // If running from src/ (dev mode with tsx), redirect to dist/
    if (currentDir.includes(`${path.sep}src${path.sep}`)) {
      return currentDir.replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`)
    }
    
    return currentDir
  }

  /**
   * Handle runtime IPC messages from Agent process.
   * Called by the message event handler set up in setupAgentRuntimeHandlers.
   */
  private handleAgentRuntimeMessage(message: AgentIPCResponse): void {
    if (message.type === 'health-check-result') {
      // Clear pending flag and timeout (for periodic health check)
      if (this.agentHealthCheckTimeout) {
        clearTimeout(this.agentHealthCheckTimeout)
        this.agentHealthCheckTimeout = undefined
      }

      this.agentHealthCheckPending = false

      if (message.success) {
        processManagerLog('Agent health-check passed')
      } else {
        processManagerLog('Agent health-check FAILED - Socket.IO connection stale, restarting agent')
        // Restart agent to force reconnection
        this.restartAgent().catch((error) => {
          processManagerLog(`Failed to restart agent after health-check failure: ${error}`)
        })
      }
    }
  }

  /**
   * Handle system wake from sleep.
   * Verify processes are still alive and restart if needed.
   * Triggers immediate health checks on both Transport and Agent.
   */
  private handleSystemWake(): void {
    const {agentProcess, transportProcess} = this.state

    // Check if processes are still running
    const agentAlive = agentProcess && !agentProcess.killed && agentProcess.exitCode === null
    const transportAlive = transportProcess && !transportProcess.killed && transportProcess.exitCode === null

    if (!agentAlive || !transportAlive) {
      processManagerLog('Processes not healthy after wake, triggering restart')

      // Trigger restart by simulating crash recovery
      if (!transportAlive && transportProcess) {
        processManagerLog('Transport process died during sleep, respawning...')
        // The crash recovery handler will handle this
        transportProcess.emit('exit', 1, null)
      } else if (!agentAlive && agentProcess) {
        processManagerLog('Agent process died during sleep, respawning...')
        // The crash recovery handler will handle this
        agentProcess.emit('exit', 1, null)
      }
    } else {
      processManagerLog('Processes healthy after wake - triggering immediate health check')

      // Trigger immediate health checks (reuse the timeout-based methods)
      // Check Transport (if not already pinging)
      if (this.state.transportReady && !this.transportPingPending) {
        this.pingTransportWithTimeout()
      }

      // Check Agent (if not already checking)
      if (this.state.agentReady && !this.agentHealthCheckPending) {
        this.healthCheckAgentWithTimeout()
      }
    }
  }

  /**
   * Handle runtime IPC messages from Transport process.
   * Called by the message event handler set up in setupTransportRuntimeHandlers.
   */
  private handleTransportRuntimeMessage(message: TransportIPCResponse): void {
    if (message.type === 'pong' && this.transportPingPending) {
      // Clear timeout and flag
      if (this.transportPingTimeout) {
        clearTimeout(this.transportPingTimeout)
        this.transportPingTimeout = undefined
      }

      this.transportPingPending = false
      processManagerLog('Transport ping successful - process healthy')
    }
  }

  /**
   * Send health-check to Agent with timeout.
   * If no response within timeout, Agent is considered stuck and restarted.
   * Used by periodic health check and after system wake.
   */
  private healthCheckAgentWithTimeout(): void {
    const {agentProcess} = this.state
    if (!agentProcess || this.agentHealthCheckPending) return

    this.agentHealthCheckPending = true
    processManagerLog('Sending health-check to agent')
    this.sendToChild(agentProcess, {type: 'health-check'})

    this.agentHealthCheckTimeout = setTimeout(() => {
      if (this.agentHealthCheckPending) {
        processManagerLog('Agent health-check timeout - process may be stuck, restarting')
        this.agentHealthCheckPending = false
        this.agentHealthCheckTimeout = undefined
        this.restartAgent().catch((error) => {
          processManagerLog(`Failed to restart agent after health-check timeout: ${error}`)
        })
      }
    }, AGENT_HEALTH_CHECK_TIMEOUT_MS)

    // Don't block process exit
    this.agentHealthCheckTimeout.unref()
  }

  /**
   * Send ping to Transport with timeout.
   * If no pong received within timeout, Transport is considered zombie and restarted.
   */
  private pingTransportWithTimeout(): void {
    const {transportProcess} = this.state
    if (!transportProcess || this.transportPingPending) return

    this.transportPingPending = true
    processManagerLog('Sending ping to transport after wake')
    this.sendToChild(transportProcess, {type: 'ping'})

    this.transportPingTimeout = setTimeout(() => {
      if (this.transportPingPending) {
        processManagerLog('Transport ping timeout - process may be zombie, restarting')
        this.transportPingPending = false
        this.transportPingTimeout = undefined
        this.restartTransport().catch((error) => {
          processManagerLog(`Failed to restart transport after ping timeout: ${error}`)
        })
      }
    }, TRANSPORT_PING_TIMEOUT_MS)

    // Don't block process exit
    this.transportPingTimeout.unref()
  }

  /**
   * Restart Agent process gracefully.
   * Used when health-check fails after sleep/wake or periodic check.
   * Guarded to prevent concurrent restart race conditions.
   */
  private async restartAgent(): Promise<void> {
    // Guard: prevent concurrent restarts
    if (!this.state.running || !this.state.port || this.isRestartingAgent) return

    this.isRestartingAgent = true
    try {
      processManagerLog('Restarting agent process...')

      // Stop existing agent
      await this.stopAgentProcess()
      this.state.agentReady = false

      // Start new agent
      await this.startAgentProcess(this.state.port)
      this.state.agentReady = true

      processManagerLog('Agent process restarted successfully')
    } finally {
      this.isRestartingAgent = false
    }
  }

  /**
   * Restart Transport process gracefully.
   * Used when ping timeout detects zombie process after sleep/wake or periodic check.
   * Note: Agent must also be restarted since Transport port changes.
   * Guarded to prevent concurrent restart race conditions.
   */
  private async restartTransport(): Promise<void> {
    // Guard: prevent concurrent restarts
    if (!this.state.running || this.isRestartingTransport) return

    this.isRestartingTransport = true
    try {
      processManagerLog('Restarting transport process...')

      // Stop existing transport
      await this.stopTransportProcess()
      this.state.transportReady = false

      // Start new transport (gets new port)
      const newPort = await this.startTransportProcess()
      this.state.port = newPort
      this.state.transportReady = true

      processManagerLog(`Transport process restarted on port ${newPort}`)

      // Agent needs to reconnect to new port - restart Agent too
      if (this.state.agentProcess) {
        await this.stopAgentProcess()
        this.state.agentReady = false
        await this.startAgentProcess(newPort)
        this.state.agentReady = true
        processManagerLog('Agent reconnected to new Transport')
      }

      processManagerLog('Transport process restarted successfully')
    } finally {
      this.isRestartingTransport = false
    }
  }

  /**
   * Send IPC message to child process.
   */
  private sendToChild(child: ChildProcess, message: IPCCommand): void {
    child.send?.(message)
  }

  /**
   * Setup Agent crash recovery.
   */
  private setupAgentCrashRecovery(): void {
    const {agentProcess} = this.state
    if (!agentProcess) return

    // Use .once() to prevent listener accumulation on crash/respawn cycles
    agentProcess.once('exit', (code, signal) => {
      if (!this.state.running) return // Intentional shutdown

      processManagerLog(`Agent process exited unexpectedly (code=${code}, signal=${signal})`)
      this.state.agentReady = false

      // Respawn Agent
      if (this.state.port) {
        this.startAgentProcess(this.state.port)
          .then(() => {
            this.state.agentReady = true
            processManagerLog('Agent process respawned')
          })
          .catch((error) => {
            processManagerLog(`Failed to respawn Agent: ${error}`)
          })
      }
    })

    // Setup runtime message handler for health-check results
    this.setupAgentRuntimeHandlers()
  }

  /**
   * Setup runtime message handlers for Agent process.
   * Handles IPC messages that arrive during normal operation (not just startup).
   *
   * IMPORTANT: Uses stored handler reference to prevent listener accumulation.
   * Each respawn calls this method, so we must remove the old listener first.
   */
  private setupAgentRuntimeHandlers(): void {
    const {agentProcess} = this.state
    if (!agentProcess) return

    // Remove old listener FIRST (prevents accumulation on respawn)
    if (this.runtimeMessageHandler) {
      agentProcess.off('message', this.runtimeMessageHandler)
    }

    // Create and store new handler
    this.runtimeMessageHandler = (message: AgentIPCResponse) => {
      this.handleAgentRuntimeMessage(message)
    }

    agentProcess.on('message', this.runtimeMessageHandler)
  }

  /**
   * Setup Transport crash recovery.
   */
  private setupTransportCrashRecovery(): void {
    const {transportProcess} = this.state
    if (!transportProcess) return

    // Use .once() to prevent listener accumulation on crash/respawn cycles
    transportProcess.once('exit', (code, signal) => {
      if (!this.state.running) return // Intentional shutdown

      processManagerLog(`Transport process exited unexpectedly (code=${code}, signal=${signal})`)
      this.state.transportReady = false

      // Respawn Transport, then reconnect Agent
      this.startTransportProcess()
        .then(async (newPort) => {
          this.state.port = newPort
          this.state.transportReady = true
          processManagerLog(`Transport process respawned on port ${newPort}`)

          // Agent needs to reconnect to new port
          // For now, just restart Agent
          if (this.state.agentProcess) {
            await this.stopAgentProcess()
            await this.startAgentProcess(newPort)
            this.state.agentReady = true
            processManagerLog('Agent reconnected to new Transport')
          }
        })
        .catch((error) => {
          processManagerLog(`Failed to respawn Transport: ${error}`)
        })
    })

    // Setup runtime message handler for ping/pong health checks
    this.setupTransportRuntimeHandlers()
  }

  /**
   * Setup runtime message handlers for Transport process.
   * Handles IPC messages that arrive during normal operation (pong for health check).
   *
   * IMPORTANT: Uses stored handler reference to prevent listener accumulation.
   * Each respawn calls this method, so we must remove the old listener first.
   */
  private setupTransportRuntimeHandlers(): void {
    const {transportProcess} = this.state
    if (!transportProcess) return

    // Remove old listener FIRST (prevents accumulation on respawn)
    if (this.transportMessageHandler) {
      transportProcess.off('message', this.transportMessageHandler)
    }

    // Create and store new handler
    this.transportMessageHandler = (message: TransportIPCResponse) => {
      this.handleTransportRuntimeMessage(message)
    }

    transportProcess.on('message', this.transportMessageHandler)
  }

  /**
   * Start Agent Process.
   */
  private async startAgentProcess(transportPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.resolve(this.getWorkerDir(), 'agent-worker.js')

      const child = fork(workerPath, [], {
        env: {
          ...process.env,
          BRV_SESSION_LOG: getSessionLogPath(),
          TRANSPORT_PORT: String(transportPort),
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })

      this.state.agentProcess = child

      const timeout = setTimeout(() => {
        cleanup()
        child.kill('SIGKILL')
        reject(createSystemError(`Agent startup timed out after ${this.startupTimeoutMs}ms`, 'Agent startup timeout'))
      }, this.startupTimeoutMs)

      const onMessage = (message: AgentIPCResponse): void => {
        if (message.type === 'ready') {
          cleanup()
          this.setupAgentCrashRecovery()
          resolve()
        } else if (message.type === 'error') {
          cleanup()
          child.kill('SIGKILL')
          reject(createSystemError(message.error, 'Agent startup error'))
        }
      }

      const onError = (error: Error): void => {
        cleanup()
        reject(createSystemError(error.message, 'Agent process error'))
      }

      const onExit = (code: null | number): void => {
        cleanup()
        reject(createSystemError(`Agent exited with code ${code}`, 'Agent unexpected exit'))
      }

      const cleanup = (): void => {
        clearTimeout(timeout)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
      }

      child.on('message', onMessage)
      child.on('error', onError)
      child.on('exit', onExit)

      // Forward stdout/stderr
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    })
  }

  /**
   * Start health check interval for sleep/wake detection.
   * Detects system sleep by monitoring for large time gaps between checks.
   */
  private startHealthCheck(): void {
    this.lastHealthCheckTime = Date.now()

    this.healthCheckInterval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastHealthCheckTime
      this.lastHealthCheckTime = now

      // If significantly more time passed than expected, system likely slept
      if (elapsed > SLEEP_DETECTION_THRESHOLD_MS) {
        processManagerLog(`System wake detected (${Math.round(elapsed / 1000)}s gap)`)
        this.handleSystemWake()
      }
    }, HEALTH_CHECK_INTERVAL_MS)

    // Don't prevent process exit
    this.healthCheckInterval.unref()
  }

  /**
   * Start periodic health check for Transport and Agent.
   * Runs every 30s to detect zombie processes mid-session (not just after wake).
   */
  private startPeriodicHealthCheck(): void {
    this.periodicHealthCheckInterval = setInterval(() => {
      if (!this.state.running) return

      // Check Transport (if ready and not already pinging)
      if (this.state.transportReady && !this.transportPingPending) {
        this.pingTransportWithTimeout()
      }

      // Check Agent (if ready and not already checking)
      if (this.state.agentReady && !this.agentHealthCheckPending) {
        this.healthCheckAgentWithTimeout()
      }
    }, PERIODIC_HEALTH_CHECK_INTERVAL_MS)

    // Don't prevent process exit
    this.periodicHealthCheckInterval.unref()
    processManagerLog('Periodic health check started (30s interval)')
  }

  /**
   * Start Transport Process.
   * @returns The port Transport is listening on
   */
  private async startTransportProcess(): Promise<number> {
    return new Promise((resolve, reject) => {
      const workerPath = path.resolve(this.getWorkerDir(), 'transport-worker.js')

      const child = fork(workerPath, [], {
        env: {
          ...process.env,
          BRV_SESSION_LOG: getSessionLogPath(),
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })

      this.state.transportProcess = child

      const timeout = setTimeout(() => {
        cleanup()
        child.kill('SIGKILL')
        reject(
          createSystemError(
            `Transport startup timed out after ${this.startupTimeoutMs}ms`,
            'Transport startup timeout',
          ),
        )
      }, this.startupTimeoutMs)

      const onMessage = (message: TransportIPCResponse): void => {
        if (message.type === 'ready') {
          cleanup()
          this.setupTransportCrashRecovery()
          resolve(message.port)
        } else if (message.type === 'error') {
          cleanup()
          child.kill('SIGKILL')
          // Pass through user-friendly errors directly
          const isUserFriendly = message.error.startsWith('brv is already running')
          if (isUserFriendly) {
            reject(new Error(message.error))
          } else {
            reject(createSystemError(message.error, 'Transport startup error'))
          }
        }
      }

      const onError = (error: Error): void => {
        cleanup()
        reject(createSystemError(error.message, 'Transport process error'))
      }

      const onExit = (code: null | number): void => {
        cleanup()
        reject(createSystemError(`Transport exited with code ${code}`, 'Transport unexpected exit'))
      }

      const cleanup = (): void => {
        clearTimeout(timeout)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
      }

      child.on('message', onMessage)
      child.on('error', onError)
      child.on('exit', onExit)

      // Forward stdout/stderr
      child.stdout?.pipe(process.stdout)
      child.stderr?.pipe(process.stderr)
    })
  }

  /**
   * Stop Agent Process.
   */
  private async stopAgentProcess(): Promise<void> {
    const {agentProcess} = this.state
    if (!agentProcess) return

    return new Promise((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timeout)
        agentProcess.off('message', onMessage)
        agentProcess.off('exit', onExit)
        // Clear stored handler reference (prevents stale refs on respawn)
        this.runtimeMessageHandler = undefined
      }

      const timeout = setTimeout(() => {
        cleanup()
        agentProcess.kill('SIGKILL')
        this.state.agentProcess = undefined
        resolve()
      }, this.shutdownTimeoutMs)

      const onMessage = (message: AgentIPCResponse): void => {
        if (message.type === 'stopped') {
          cleanup()
          this.state.agentProcess = undefined
          resolve()
        }
      }

      const onExit = (): void => {
        cleanup()
        this.state.agentProcess = undefined
        resolve()
      }

      agentProcess.on('message', onMessage)
      agentProcess.on('exit', onExit)

      // Send shutdown command
      this.sendToChild(agentProcess, {type: 'shutdown'})
    })
  }

  /**
   * Stop health check interval.
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  /**
   * Stop periodic health check interval.
   * Also clears any pending agent health check timeout.
   */
  private stopPeriodicHealthCheck(): void {
    if (this.periodicHealthCheckInterval) {
      clearInterval(this.periodicHealthCheckInterval)
      this.periodicHealthCheckInterval = undefined
    }

    // Clear any pending agent health check
    if (this.agentHealthCheckTimeout) {
      clearTimeout(this.agentHealthCheckTimeout)
      this.agentHealthCheckTimeout = undefined
    }

    this.agentHealthCheckPending = false
  }

  /**
   * Stop Transport Process.
   */
  private async stopTransportProcess(): Promise<void> {
    const {transportProcess} = this.state
    if (!transportProcess) return

    return new Promise((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timeout)
        transportProcess.off('message', onMessage)
        transportProcess.off('exit', onExit)
        // Clear stored handler reference (prevents stale refs on respawn)
        this.transportMessageHandler = undefined
        // Clear ping state
        if (this.transportPingTimeout) {
          clearTimeout(this.transportPingTimeout)
          this.transportPingTimeout = undefined
        }

        this.transportPingPending = false
      }

      const timeout = setTimeout(() => {
        cleanup()
        transportProcess.kill('SIGKILL')
        this.state.transportProcess = undefined
        resolve()
      }, this.shutdownTimeoutMs)

      const onMessage = (message: TransportIPCResponse): void => {
        if (message.type === 'stopped') {
          cleanup()
          this.state.transportProcess = undefined
          resolve()
        }
      }

      const onExit = (): void => {
        cleanup()
        this.state.transportProcess = undefined
        resolve()
      }

      transportProcess.on('message', onMessage)
      transportProcess.on('exit', onExit)

      // Send shutdown command
      this.sendToChild(transportProcess, {type: 'shutdown'})
    })
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ProcessManager | undefined

/**
 * Get or create the ProcessManager singleton.
 */
export function getProcessManager(config?: ProcessManagerConfig): ProcessManager {
  if (!instance) {
    instance = new ProcessManager(config)
  }

  return instance
}

/**
 * Dispose the ProcessManager singleton.
 */
export async function disposeProcessManager(): Promise<void> {
  if (instance) {
    await instance.stop()
    instance = undefined
  }
}
