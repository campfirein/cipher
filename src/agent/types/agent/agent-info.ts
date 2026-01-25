import {z} from 'zod'

/**
 * Permission values for agent operations.
 * - allow: Operation is permitted without asking
 * - deny: Operation is blocked
 * - ask: User must approve the operation
 */
export const PermissionValue = z.enum(['allow', 'deny', 'ask'])
export type PermissionValue = z.infer<typeof PermissionValue>

/**
 * Agent mode determines how the agent can be used.
 * - primary: Entry point agent (e.g., plan, cipher)
 * - subagent: Can only be invoked by primary agents via TaskTool
 * - all: Can be used as both primary and subagent
 */
export const AgentMode = z.enum(['primary', 'subagent', 'all'])
export type AgentMode = z.infer<typeof AgentMode>

/**
 * Permission configuration for an agent.
 * Controls what operations the agent is allowed to perform.
 */
export const AgentPermissionSchema = z.object({
  /**
   * Permission map for bash commands.
   * Keys are command patterns (supports wildcards like 'git*', 'ls*').
   * Value '*' applies to all commands not matched by other patterns.
   * @default { '*': 'allow' }
   */
  bash: z.record(z.string(), PermissionValue).default({'*': 'allow'}),

  /**
   * Permission for file editing operations (edit_file, write_file).
   * @default 'allow'
   */
  edit: PermissionValue.default('allow'),
})
export type AgentPermission = z.infer<typeof AgentPermissionSchema>

/**
 * Agent information schema.
 * Defines the configuration for a Cipher agent (modeled after OpenCode's Agent.Info).
 */
export const AgentInfoSchema = z.object({
  /**
   * Optional color for UI display (hex code like #RRGGBB).
   */
  color: z.string().optional(),

  /**
   * Human-readable description of when to use this agent.
   * Displayed to LLM when selecting subagents via TaskTool.
   */
  description: z.string().optional(),

  /**
   * Whether this agent is hidden from user selection.
   * Hidden agents can still be invoked programmatically.
   * @default false
   */
  hidden: z.boolean().default(false),

  /**
   * Maximum number of LLM iterations for this agent.
   * Overrides the default maxIterations from config.
   */
  maxIterations: z.number().int().positive().optional(),

  /**
   * Agent mode: primary, subagent, or all.
   * - primary: Direct entry point for users
   * - subagent: Invoked via TaskTool from primary agents
   * - all: Can be used in both contexts
   */
  mode: AgentMode,

  /**
   * Optional model override for this agent.
   * If not specified, uses the default model from agent config.
   */
  model: z
    .object({
      modelId: z.string(),
      providerId: z.string().optional(),
    })
    .optional(),

  /**
   * Unique identifier for the agent.
   * Used to reference the agent in TaskTool and registry.
   */
  name: z.string().min(1),

  /**
   * Whether this is a native (built-in) agent.
   * Native agents are defined in code, not config files.
   * @default true
   */
  native: z.boolean().default(true),

  /**
   * Permission configuration for this agent.
   * Controls file editing and bash command access.
   */
  permission: AgentPermissionSchema.default({
    bash: {'*': 'allow'},
    edit: 'allow',
  }),

  /**
   * Inline system prompt for this agent.
   * Used when promptFile is not specified.
   */
  prompt: z.string().optional(),

  /**
   * Reference to a YAML prompt file in src/resources/prompts/.
   * The file content will be used as the agent's system prompt.
   * Takes precedence over inline `prompt` if both are specified.
   */
  promptFile: z.string().optional(),

  /**
   * LLM temperature for this agent.
   * Controls randomness/creativity of responses.
   */
  temperature: z.number().min(0).max(2).optional(),

  /**
   * Tool enable/disable configuration.
   * Keys are tool names, values are boolean (true = enabled, false = disabled).
   * Supports wildcard '*' for all tools.
   * Tools not listed inherit from parent/default configuration.
   */
  tools: z.record(z.string(), z.boolean()).default({}),
})

/**
 * Type for agent information.
 */
export type AgentInfo = z.infer<typeof AgentInfoSchema>

/**
 * Default permission configuration for agents.
 */
export const DEFAULT_AGENT_PERMISSION: AgentPermission = {
  bash: {'*': 'allow'},
  edit: 'allow',
}

/**
 * Read-only permission configuration (for planning agents).
 */
export const READONLY_AGENT_PERMISSION: AgentPermission = {
  bash: {
    '*': 'ask',
    'cat*': 'allow',
    'find*': 'allow',
    'git*': 'allow',
    'grep*': 'allow',
    'head*': 'allow',
    'ls*': 'allow',
    'pwd*': 'allow',
    'tail*': 'allow',
    'tree*': 'allow',
  },
  edit: 'deny',
}
