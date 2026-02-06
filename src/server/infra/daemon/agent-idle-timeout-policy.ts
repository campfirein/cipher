import type {IAgentIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-agent-idle-timeout-policy.js'

import {AGENT_IDLE_CHECK_INTERVAL_MS, AGENT_IDLE_TIMEOUT_MS} from '../../constants.js'

export interface AgentIdleTimeoutPolicyOptions {
  readonly checkIntervalMs?: number
  readonly getQueueLength: (projectPath: string) => number
  readonly log: (message: string) => void
  readonly onAgentIdle: (projectPath: string, queueLength: number) => void
  readonly timeoutMs?: number
}

/**
 * Tracks agent activity to auto-cleanup idle agents after a period of inactivity.
 *
 * Uses recursive setTimeout (not setInterval) for safe cancellation.
 * Fires callback for all idle agents in a single sweep.
 */
export class AgentIdleTimeoutPolicy implements IAgentIdleTimeoutPolicy {
  private readonly agentActivity: Map<string, number> = new Map() // projectPath → lastActivityAt
  private readonly checkIntervalMs: number
  private readonly getQueueLength: (projectPath: string) => number
  private isRunning = false
  private readonly log: (message: string) => void
  private readonly onAgentIdle: (projectPath: string, queueLength: number) => void
  private timeoutId: ReturnType<typeof setTimeout> | undefined
  private readonly timeoutMs: number

  constructor(options: AgentIdleTimeoutPolicyOptions) {
    this.checkIntervalMs = options.checkIntervalMs ?? AGENT_IDLE_CHECK_INTERVAL_MS
    this.getQueueLength = options.getQueueLength
    this.log = options.log
    this.onAgentIdle = options.onAgentIdle
    this.timeoutMs = options.timeoutMs ?? AGENT_IDLE_TIMEOUT_MS
  }

  getIdleStatus(): Array<{idleMs: number; projectPath: string; remainingMs: number}> {
    const now = Date.now()
    const result: Array<{idleMs: number; projectPath: string; remainingMs: number}> = []

    for (const [projectPath, lastActivityAt] of this.agentActivity.entries()) {
      const idleMs = now - lastActivityAt
      const remainingMs = Math.max(0, this.timeoutMs - idleMs)
      result.push({idleMs, projectPath, remainingMs})
    }

    return result
  }

  onAgentActivity(projectPath: string): void {
    this.agentActivity.set(projectPath, Date.now())
  }

  removeAgent(projectPath: string): void {
    this.agentActivity.delete(projectPath)
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.log('Agent idle timeout policy started')
    this.scheduleCheck()
  }

  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    this.log('Agent idle timeout policy stopped')
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }

  private checkIdleAgents(): void {
    const now = Date.now()
    const idleProjectPaths: string[] = []

    // Find all idle agents
    for (const [projectPath, lastActivityAt] of this.agentActivity.entries()) {
      const idleTime = now - lastActivityAt
      if (idleTime >= this.timeoutMs) {
        idleProjectPaths.push(projectPath)
      }
    }

    // Fire callback for each idle agent
    for (const projectPath of idleProjectPaths) {
      try {
        const queueLength = this.getQueueLength(projectPath)
        this.log(`Agent idle timeout (${this.timeoutMs}ms): ${projectPath}`)
        this.onAgentIdle(projectPath, queueLength)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`onAgentIdle callback failed for ${projectPath}: ${message}`)
        // Continue checking other agents even if one fails
      }
    }
  }

  private scheduleCheck(): void {
    if (!this.isRunning) return

    this.timeoutId = setTimeout(() => {
      this.checkIdleAgents()
      this.scheduleCheck() // Recursive scheduling
    }, this.checkIntervalMs)
  }
}
