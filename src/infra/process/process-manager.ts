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
const HEALTH_CHECK_INTERVAL_MS = 5000 // Check every 5 seconds
const SLEEP_DETECTION_THRESHOLD_MS = 30_000 // If 30s passed when expecting 5s, likely slept

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
  private healthCheckInterval?: NodeJS.Timeout
  private lastHealthCheckTime: number = Date.now()
  private readonly shutdownTimeoutMs: number
  private readonly startupTimeoutMs: number
  private state: ProcessState = {
    agentReady: false,
    running: false,
    transportReady: false,
  }

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

    // Stop health check first
    this.stopHealthCheck()

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
   * Handle system wake from sleep.
   * Verify processes are still alive and restart if needed.
   * Fix #3: Also trigger health-check to verify Socket.IO connections are healthy.
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
      processManagerLog('Processes healthy after wake')

      // Fix #3: Trigger health-check on agent to verify Socket.IO connection
      // Processes may be alive but Socket.IO connections could be stale after sleep
      if (agentProcess) {
        processManagerLog('Sending health-check to agent after wake')
        this.sendToChild(agentProcess, {type: 'health-check'})
      }
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
