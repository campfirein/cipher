/**
 * Array of all supported Agents.
 */
export const AGENT_VALUES = [
  'Amp',
  'Augment Code',
  'Claude Code',
  'Cline',
  'Codex',
  'Cursor',
  'Gemini CLI',
  'Github Copilot',
  'Junie',
  'Kilo Code',
  'Kiro',
  'Qoder',
  'Qwen Code',
  'Roo Code',
  'Trae.ai',
  'Warp',
  'Windsurf',
  'Zed',
] as const

export type Agent = (typeof AGENT_VALUES)[number]

/**
 * Array of agents that support hook management.
 * Single source of truth - HookSupportedAgent type is derived from this.
 */
export const HOOK_SUPPORTED_AGENTS = ['Claude Code'] as const satisfies readonly Agent[]

/**
 * Type for agents that support hook management.
 * Derived from HOOK_SUPPORTED_AGENTS - add new agents to the array above.
 */
export type HookSupportedAgent = (typeof HOOK_SUPPORTED_AGENTS)[number]
