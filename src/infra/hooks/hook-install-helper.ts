import type {Agent} from '../../core/domain/entities/agent.js'
import type {HookSupportedAgent, IHookManager} from '../../core/interfaces/hooks/i-hook-manager.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'

import {HOOK_SUPPORTED_AGENTS} from './agent-hook-configs.js'

/**
 * Type guard to check if an agent supports hooks.
 */
export function isHookSupportedAgent(agent: Agent): agent is HookSupportedAgent {
  return (HOOK_SUPPORTED_AGENTS as readonly string[]).includes(agent)
}

/**
 * Attempts to install hook for the agent and shows restart message if successful.
 * Silently ignores errors to avoid interrupting the main workflow.
 */
export async function tryInstallHookWithRestartMessage(params: {
  agent: Agent
  hookManager: IHookManager | undefined
  terminal: ITerminal
}): Promise<void> {
  const {agent, hookManager, terminal} = params

  if (!hookManager) return
  if (!isHookSupportedAgent(agent)) return

  try {
    const result = await hookManager.install(agent)
    if (result.success) {
      terminal.warn(`\n⚠️  Please restart ${agent} to apply the new rules.`)
    }
  } catch (error) {
    terminal.error(`Failed to install hook for ${agent}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
