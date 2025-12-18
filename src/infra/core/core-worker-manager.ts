/**
 * Core Worker Manager - Manages the lifecycle of the Core worker process.
 *
 * @deprecated Use ProcessManager from src/infra/process/ instead.
 * Architecture v0.5.0 uses 3-process model (Main, Transport, Agent).
 * This file is kept for backward compatibility with existing tests.
 *
 * Extracted from main.ts to follow Clean Architecture.
 * main.ts (command) should only orchestrate, not contain worker logic.
 */

import {type ChildProcess, fork} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

type CoreWorkerMessage =
  | {error: string; type: 'error'}
  | {port: number; type: 'ready'}
  | {type: 'idle'}
  | {type: 'pong'}
  | {type: 'stopped'}

/**
 * Manages the Core worker process lifecycle.
 */
export class CoreWorkerManager {
  private worker?: ChildProcess

  /**
   * Get the current worker process (if any).
   */
  getWorker(): ChildProcess | undefined {
    return this.worker
  }

  /**
   * Check if worker is running.
   */
  isRunning(): boolean {
    return this.worker !== undefined && this.worker.connected
  }

  /**
   * Start the Core worker process.
   * Returns the worker process, or undefined if failed to start.
   */
  async start(): Promise<ChildProcess | undefined> {
    if (this.worker) {
      return this.worker
    }

    return new Promise<ChildProcess | undefined>((resolve) => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url))
      const workerPath = path.resolve(__dirname, 'core-worker.js')

      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })

      // Don't wait for ready - Core worker handles its own state
      // Just wait for it to start (or fail immediately)
      const timeout = setTimeout(() => {
        this.worker = child
        resolve(child)
      }, 1000)

      child.on('message', (message: CoreWorkerMessage) => {
        // Worker started (ready, idle, or error - all mean it's running)
        if (message.type === 'ready' || message.type === 'idle' || message.type === 'error') {
          clearTimeout(timeout)
          this.worker = child
          resolve(child)
        }
      })

      child.on('error', () => {
        clearTimeout(timeout)
        this.worker = undefined
        // eslint-disable-next-line unicorn/no-useless-undefined
        resolve(undefined)
      })

      child.on('exit', () => {
        this.worker = undefined
      })
    })
  }

  /**
   * Stop the Core worker process.
   */
  async stop(): Promise<void> {
    if (!this.worker) {
      return
    }

    const child = this.worker

    return new Promise((resolve) => {
      child.send({type: 'shutdown'})

      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        this.worker = undefined
        resolve()
      }, 5000)

      child.on('message', (message: CoreWorkerMessage) => {
        if (message.type === 'stopped') {
          clearTimeout(timeout)
          this.worker = undefined
          resolve()
        }
      })

      child.on('exit', () => {
        clearTimeout(timeout)
        this.worker = undefined
        resolve()
      })
    })
  }
}

// Singleton instance
let instance: CoreWorkerManager | undefined

/**
 * Get or create the CoreWorkerManager singleton.
 */
export function getCoreWorkerManager(): CoreWorkerManager {
  if (!instance) {
    instance = new CoreWorkerManager()
  }

  return instance
}
