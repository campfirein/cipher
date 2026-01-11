import type {Agent, HookSupportedAgent} from '../../core/domain/entities/agent.js'
import type {IHookManager} from '../../core/interfaces/hooks/i-hook-manager.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'

import {HOOK_SUPPORTED_AGENTS} from '../../core/domain/entities/agent.js'

/**
 * Type guard to check if an agent supports hooks.
 * Uses .some() with callback to avoid type assertions while maintaining readability.
 * Note: .includes() would require `as readonly string[]` assertion due to TypeScript's strict tuple typing.
 */
export function isHookSupportedAgent(agent: Agent): agent is HookSupportedAgent {
  // eslint-disable-next-line unicorn/prefer-includes -- .includes() requires type assertion; .some() avoids it
  return HOOK_SUPPORTED_AGENTS.some((supported) => supported === agent)
}

/**
 * Attempts to install hook for the agent and shows restart message if successful.
 * Logs errors to terminal but does not throw to avoid interrupting the main workflow.
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
    if (result.success && !result.alreadyInstalled) {
      terminal.warn(`⚠️  Please restart ${agent} to apply the new hooks.`)
    }
  } catch (error) {
    terminal.error(`Failed to install hook for ${agent}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
