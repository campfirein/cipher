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
