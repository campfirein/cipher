/**
 * Policy Engine Interface.
 *
 * Provides rule-based ALLOW/DENY decisions for tool execution.
 * Designed for autonomous execution - no ASK_USER decisions.
 *
 * Based on gemini-cli's policy engine pattern, simplified for autonomous mode.
 */

/**
 * Policy decision for autonomous execution.
 * Note: No ASK_USER - agent runs autonomously without user confirmation.
 */
export type PolicyDecision = 'ALLOW' | 'DENY'

/**
 * A policy rule that determines whether a tool execution should be allowed.
 */
export interface PolicyRule {
  /**
   * Optional condition function for fine-grained control.
   * Only evaluated if toolPattern matches.
   *
   * @param toolName - The name of the tool being executed
   * @param args - The arguments passed to the tool
   * @returns True if this rule should apply, false to skip to next rule
   */
  condition?: (toolName: string, args: Record<string, unknown>) => boolean

  /**
   * The decision to return if this rule matches.
   */
  decision: PolicyDecision

  /**
   * Unique name for this rule (used for removal/debugging).
   */
  name: string

  /**
   * Optional human-readable reason for this rule.
   * Useful for logging and debugging.
   */
  reason?: string

  /**
   * Tool name pattern to match.
   * - String: exact match or '*' for all tools
   * - RegExp: pattern matching for tool names
   */
  toolPattern: RegExp | string
}

/**
 * Result of evaluating a tool execution against policy rules.
 */
export interface PolicyEvaluationResult {
  /**
   * The policy decision (ALLOW or DENY).
   */
  decision: PolicyDecision

  /**
   * Human-readable reason for the decision.
   */
  reason?: string

  /**
   * The rule that matched (if any).
   * Undefined if using default policy.
   */
  rule?: PolicyRule
}

/**
 * Interface for the policy engine.
 *
 * The policy engine evaluates tool execution requests against a set of rules
 * to determine whether execution should be allowed or denied.
 *
 * Rules are evaluated in order - first matching rule wins.
 */
export interface IPolicyEngine {
  /**
   * Add a policy rule.
   * Rules are evaluated in the order they are added.
   *
   * @param rule - The policy rule to add
   */
  addRule(rule: PolicyRule): void

  /**
   * Evaluate a tool execution request against policy rules.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Arguments for the tool
   * @returns Policy evaluation result with decision and reason
   */
  evaluate(toolName: string, args: Record<string, unknown>): PolicyEvaluationResult

  /**
   * Get all registered policy rules.
   * Useful for debugging and introspection.
   *
   * @returns Read-only array of policy rules
   */
  getRules(): readonly PolicyRule[]

  /**
   * Remove a policy rule by name.
   *
   * @param name - The name of the rule to remove
   */
  removeRule(name: string): void
}
