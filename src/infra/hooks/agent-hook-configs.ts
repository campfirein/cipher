import {type HookSupportedAgent} from '../../core/interfaces/hooks/i-hook-manager.js'
import {isRecord} from '../../utils/type-guards.js'

/**
 * The command that ByteRover hooks execute.
 * This is used to identify our hooks when checking for duplicates or uninstalling.
 */
export const HOOK_COMMAND = 'brv hook-prompt-submit'

/**
 * Claude Code hook entry structure.
 * Claude Code uses a nested structure with matchers and hooks array.
 */
export type ClaudeCodeHookEntry = {
  hooks: Array<{
    command: string
    type: string
  }>
  matcher: string
}

/**
 * Cursor hook entry structure.
 * Simpler flat structure with just a command.
 */
export type SimpleHookEntry = {
  command: string
}

/**
 * Configuration for each agent's hook system.
 */
export type AgentHookConfig = {
  /** Path to the configuration file (relative to project root) */
  configPath: string
  /** Function to create a new hook entry for this agent */
  createHookEntry: () => ClaudeCodeHookEntry | SimpleHookEntry
  /** Default config structure for new files (optional) */
  defaultConfig?: Record<string, unknown>
  /** The key in the hooks object for the pre-prompt event */
  hookEventKey: string
  /** Function to check if a hook entry is a ByteRover hook */
  isOurHook: (entry: unknown) => boolean
}

/**
 * Type guard to check if value has a command property that is a string.
 */
function hasCommand(value: unknown): value is {command: string} {
  return isRecord(value) && typeof value.command === 'string'
}

/**
 * Check if an entry is a Claude Code hook entry containing our command.
 */
const isClaudeCodeOurHook = (entry: unknown): boolean => {
  if (!isRecord(entry)) return false
  if (!Array.isArray(entry.hooks)) return false
  return entry.hooks.some((h: unknown) => hasCommand(h) && h.command === HOOK_COMMAND)
}

/**
 * Check if an entry is a simple hook entry with our command.
 */
const isSimpleOurHook = (entry: unknown): boolean => hasCommand(entry) && entry.command === HOOK_COMMAND

/**
 * Agent-specific hook configurations.
 * Maps each supported agent to its configuration details.
 */
export const AGENT_HOOK_CONFIGS: Record<HookSupportedAgent, AgentHookConfig> = {
  'Claude Code': {
    configPath: '.claude/settings.local.json',
    createHookEntry: (): ClaudeCodeHookEntry => ({
      hooks: [{command: HOOK_COMMAND, type: 'command'}],
      matcher: '',
    }),
    hookEventKey: 'UserPromptSubmit',
    isOurHook: isClaudeCodeOurHook,
  },
  Cursor: {
    configPath: '.cursor/hooks.json',
    createHookEntry: (): SimpleHookEntry => ({command: HOOK_COMMAND}),
    defaultConfig: {hooks: {}, version: 1},
    hookEventKey: 'beforeSubmitPrompt',
    isOurHook: isSimpleOurHook,
  },
}

/**
 * Get list of all supported agents.
 */
export const HOOK_SUPPORTED_AGENTS: HookSupportedAgent[] = Object.keys(AGENT_HOOK_CONFIGS) as HookSupportedAgent[]
