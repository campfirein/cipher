/**
 * Policy Engine Implementation.
 *
 * Rule-based ALLOW/DENY decisions for tool execution.
 * Designed for autonomous execution without user confirmation.
 *
 * Rules are evaluated in order - first matching rule wins.
 * If no rule matches, the default decision is used.
 */

import type {
  IPolicyEngine,
  PolicyDecision,
  PolicyEvaluationResult,
  PolicyRule,
} from '../../core/interfaces/i-policy-engine.js'

/**
 * Configuration options for PolicyEngine.
 */
export interface PolicyEngineConfig {
  /**
   * Default decision when no rule matches.
   * @default 'ALLOW'
   */
  defaultDecision?: PolicyDecision
}

/**
 * Policy Engine implementation.
 *
 * Evaluates tool execution requests against a set of rules.
 * Rules are evaluated in order - first matching rule wins.
 */
export class PolicyEngine implements IPolicyEngine {
  private readonly defaultDecision: PolicyDecision
  private rules: PolicyRule[] = []

  /**
   * Create a new PolicyEngine.
   *
   * @param config - Configuration options
   */
  constructor(config: PolicyEngineConfig = {}) {
    this.defaultDecision = config.defaultDecision ?? 'ALLOW'
  }

  /**
   * Add a policy rule.
   * Rules are evaluated in the order they are added.
   *
   * @param rule - The policy rule to add
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule)
  }

  /**
   * Add multiple policy rules at once.
   *
   * @param rules - The policy rules to add
   */
  addRules(rules: PolicyRule[]): void {
    for (const rule of rules) {
      this.addRule(rule)
    }
  }

  /**
   * Evaluate a tool execution request against policy rules.
   *
   * Rules are evaluated in order. First matching rule wins.
   * If no rule matches, returns the default decision.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Arguments for the tool
   * @returns Policy evaluation result with decision and reason
   */
  evaluate(toolName: string, args: Record<string, unknown>): PolicyEvaluationResult {
    for (const rule of this.rules) {
      // Check if tool pattern matches
      if (!this.matchesPattern(toolName, rule.toolPattern)) {
        continue
      }

      // Check condition if present
      if (rule.condition && !rule.condition(toolName, args)) {
        continue
      }

      // Rule matches - return its decision
      return {
        decision: rule.decision,
        reason: rule.reason,
        rule,
      }
    }

    // No rule matched - return default decision
    return {
      decision: this.defaultDecision,
      reason: 'No matching rule, using default policy',
    }
  }

  /**
   * Get all registered policy rules.
   *
   * @returns Read-only array of policy rules
   */
  getRules(): readonly PolicyRule[] {
    return this.rules
  }

  /**
   * Remove a policy rule by name.
   *
   * @param name - The name of the rule to remove
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter((r) => r.name !== name)
  }

  /**
   * Check if a tool name matches a pattern.
   *
   * @param toolName - The tool name to check
   * @param pattern - The pattern to match against
   * @returns True if the tool name matches the pattern
   */
  private matchesPattern(toolName: string, pattern: RegExp | string): boolean {
    if (typeof pattern === 'string') {
      // Exact match or wildcard
      return toolName === pattern || pattern === '*'
    }

    // Regex pattern
    return pattern.test(toolName)
  }
}
