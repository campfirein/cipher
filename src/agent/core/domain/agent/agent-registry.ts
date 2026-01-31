import {
  AgentInfo,
  AgentInfoSchema,
  DEFAULT_AGENT_PERMISSION,
} from './agent-info.js'

/**
 * Built-in agent names.
 * These constants ensure type safety and prevent typos.
 */
export const AgentName = {
  /** Default primary agent with full capabilities */
  CIPHER: 'cipher',
} as const

export type KnownAgent = (typeof AgentName)[keyof typeof AgentName]

/**
 * Built-in agent definitions.
 * These are the native agents available in the system.
 */
const BUILT_IN_AGENTS: Record<KnownAgent, AgentInfo> = {
  /**
   * Cipher Agent - Default primary agent with full capabilities.
   * Handles queries, curation, and all context tree operations directly.
   */
  [AgentName.CIPHER]: AgentInfoSchema.parse({
    description: 'Default agent with full capabilities for context engineering tasks.',
    hidden: false,
    mode: 'primary',
    name: AgentName.CIPHER,
    native: true,
    permission: DEFAULT_AGENT_PERMISSION,
    promptFile: 'system-prompt.yml',
    tools: {}, // All tools enabled by default
  }),
}

/**
 * AgentRegistry - Singleton registry for managing agent definitions.
 *
 * Provides methods to:
 * - Get agent by name
 * - List all agents
 * - List agents by mode (primary, subagent)
 * - Register custom agents
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null
  private agents: Map<string, AgentInfo>

  private constructor() {
    this.agents = new Map()
    // Register built-in agents
    for (const [name, agent] of Object.entries(BUILT_IN_AGENTS)) {
      this.agents.set(name, agent)
    }
  }

  /**
   * Get the singleton instance of AgentRegistry.
   */
  public static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry()
    }

    return AgentRegistry.instance
  }

  /**
   * Reset the singleton instance (for testing).
   */
  public static reset(): void {
    AgentRegistry.instance = null
  }

  /**
   * Get an agent by name.
   * @param name - Agent name
   * @returns Agent info or undefined if not found
   */
  public get(name: string): AgentInfo | undefined {
    return this.agents.get(name)
  }

  /**
   * Get agent names as a formatted list for display.
   * @returns Formatted string of agent names and descriptions
   */
  public getSubagentDescriptions(): string {
    return this.listSubagents()
      .map((agent) => `- ${agent.name}: ${agent.description || 'No description'}`)
      .join('\n')
  }

  /**
   * Check if an agent exists.
   * @param name - Agent name
   * @returns true if agent exists
   */
  public has(name: string): boolean {
    return this.agents.has(name)
  }

  /**
   * List all registered agents.
   * @returns Array of agent info objects
   */
  public list(): AgentInfo[] {
    return [...this.agents.values()]
  }

  /**
   * List agents by mode.
   * @param mode - Agent mode to filter by
   * @returns Array of agents matching the mode
   */
  public listByMode(mode: 'all' | 'primary' | 'subagent'): AgentInfo[] {
    return this.list().filter((agent) => {
      if (mode === 'all') return true
      return agent.mode === mode || agent.mode === 'all'
    })
  }

  /**
   * List primary agents available for direct user interaction.
   * Returns agents that can be used as entry points (mode: 'primary' or 'all').
   * Excludes hidden agents.
   * @returns Array of primary agent info objects
   */
  public listPrimaryAgents(): AgentInfo[] {
    return this.list().filter(
      (agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'),
    )
  }

  /**
   * List subagents available for TaskTool.
   * Returns agents that can be invoked as subagents (mode: 'subagent' or 'all').
   * Excludes hidden agents.
   * @returns Array of subagent info objects
   */
  public listSubagents(): AgentInfo[] {
    return this.list().filter(
      (agent) => !agent.hidden && (agent.mode === 'subagent' || agent.mode === 'all'),
    )
  }

  /**
   * Register a custom agent.
   * @param agent - Agent info to register
   * @throws Error if agent with same name already exists (unless overwrite is true)
   */
  public register(agent: AgentInfo, overwrite = false): void {
    const validated = AgentInfoSchema.parse(agent)
    if (this.agents.has(validated.name) && !overwrite) {
      throw new Error(`Agent '${validated.name}' already exists. Use overwrite=true to replace.`)
    }

    this.agents.set(validated.name, validated)
  }

  /**
   * Unregister an agent.
   * @param name - Agent name to remove
   * @returns true if agent was removed, false if not found
   */
  public unregister(name: string): boolean {
    return this.agents.delete(name)
  }
}

/**
 * Convenience function to get the AgentRegistry instance.
 */
export function getAgentRegistry(): AgentRegistry {
  return AgentRegistry.getInstance()
}
