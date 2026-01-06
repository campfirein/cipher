/**
 * Claude Code Hook Constants
 *
 * Centralized configuration constants for Claude Code hook integration.
 * All hook-related constants should be defined here for easy maintenance.
 */

/**
 * IDE/system metadata tags that should be removed ENTIRELY (including content).
 * These are injected by Claude Code IDE integration and are not user prompts.
 *
 * MAINTENANCE NOTE: When Claude Code adds new metadata tags, add them here.
 * Current tags are based on Claude Code VSCode extension behavior as of 2024.
 *
 * Tag categories:
 * - IDE context: ide_opened_file, ide_selection (file/selection context from editor)
 * - System prompts: system-reminder, system (injected system instructions)
 * - Hook markers: user-prompt-submit-hook (marks hook-injected content)
 * - Claude internal: antml:* (Claude's internal XML format for thinking/tool calls)
 */
export const METADATA_TAGS = [
  'ide_opened_file',
  'ide_selection',
  'system-reminder',
  'system',
  'user-prompt-submit-hook',
  'antml:thinking',
  'antml:function_calls',
  'antml:invoke',
  'antml:parameter',
] as const

/** Maximum session age before cleanup (24 hours) */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000
