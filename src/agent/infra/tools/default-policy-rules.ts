/**
 * Default Policy Rules for Autonomous Execution.
 *
 * These rules define the default behavior for tool execution in autonomous mode.
 * All tools are ALLOWED by default since the agent runs without user approval.
 *
 * DENY rules are only for truly dangerous operations that should never run,
 * such as destructive commands that could harm the system.
 */

import type {PolicyRule} from '../../core/interfaces/i-policy-engine.js'

/**
 * Default policy rules for autonomous execution.
 *
 * Rule evaluation order:
 * 1. DENY rules for dangerous operations (evaluated first via conditions)
 * 2. ALLOW rules for all known tool categories
 * 3. Default ALLOW for any unlisted tools
 */
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  // ============================================
  // DENY rules for dangerous operations
  // ============================================

  /**
   * Deny destructive root filesystem deletion.
   * Matches: rm -rf / , rm -r / , rm -f /
   */
  {
    condition(_, args) {
      const command = String(args.command || '')
      // Match rm with -r or -f flags targeting root /
      // Negative lookahead (?!\w) ensures / is not followed by word chars
      return /rm\s+(-[rf]+\s+)+\/(?!\w)/.test(command)
    },
    decision: 'DENY',
    name: 'deny-rm-rf-root',
    reason: 'Destructive root filesystem deletion not allowed',
    toolPattern: 'bash_exec',
  },

  /**
   * Deny format commands on disk devices.
   */
  {
    condition(_, args) {
      const command = String(args.command || '')
      return /mkfs\.|format\s+[cdefg]:/i.test(command)
    },
    decision: 'DENY',
    name: 'deny-format-disk',
    reason: 'Disk formatting not allowed',
    toolPattern: 'bash_exec',
  },

  /**
   * Deny dd commands that could overwrite disks.
   */
  {
    condition(_, args) {
      const command = String(args.command || '')
      return /dd\s+.*of=\/dev\/(sd[a-z]|hd[a-z]|nvme|disk)/i.test(command)
    },
    decision: 'DENY',
    name: 'deny-dd-disk',
    reason: 'Direct disk write with dd not allowed',
    toolPattern: 'bash_exec',
  },

  // ============================================
  // ALLOW rules for tool categories
  // ============================================

  /**
   * Allow all read operations (safe by default).
   */
  {
    decision: 'ALLOW',
    name: 'allow-read-tools',
    reason: 'Read operations are safe',
    toolPattern: /^(read_file|glob_files|grep_content|list_memories|read_memory|search_history)$/,
  },

  /**
   * Allow all write operations (autonomous mode).
   */
  {
    decision: 'ALLOW',
    name: 'allow-write-tools',
    reason: 'Write operations allowed in autonomous mode',
    toolPattern: /^(write_file|edit_file|write_memory|edit_memory|delete_memory|create_knowledge_topic |curate)$/,
  },

  /**
   * Allow bash execution (autonomous mode, with DENY rules above as safety net).
   */
  {
    decision: 'ALLOW',
    name: 'allow-bash-tools',
    reason: 'Shell execution allowed in autonomous mode',
    toolPattern: /^(bash_exec|bash_output|kill_process)$/,
  },

  /**
   * Allow discovery/exploration tools.
   */
  {
    decision: 'ALLOW',
    name: 'allow-discovery-tools',
    reason: 'Discovery operations are safe',
    toolPattern: /^(detect_domains)$/,
  },

  // ============================================
  // Catch-all ALLOW for any other tools
  // ============================================

  /**
   * Allow all other tools by default.
   * This ensures new tools work without explicit rules.
   */
  {
    decision: 'ALLOW',
    name: 'allow-all-default',
    reason: 'Default allow for autonomous mode',
    toolPattern: '*',
  },
]

/**
 * Create a copy of the default rules.
 * Useful when you want to modify rules without affecting the defaults.
 *
 * @returns A new array with copies of the default rules
 */
export function createDefaultPolicyRules(): PolicyRule[] {
  return DEFAULT_POLICY_RULES.map((rule) => ({...rule}))
}
