import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {SessionManager} from '../../session/session-manager.js'

import {AgentRegistry, getAgentRegistry} from '../../../../core/domain/cipher/agent/agent-registry.js'
import {createContextTreeFileSystem} from '../../file-system/context-tree-file-system-factory.js'

/**
 * Tool name constant for task tool.
 */
export const TASK_TOOL_NAME = 'task' as const

/**
 * Input schema for task tool.
 */
const TaskInputSchema = z
  .object({
    /**
     * If true, restricts file operations to .brv/context-tree/ only.
     * Use this for query commands to search only curated knowledge.
     */
    contextTreeOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, restricts file operations to .brv/context-tree/ only'),

    /**
     * Short description of the task (3-5 words).
     * Used for display and tracking purposes.
     */
    description: z.string().min(1).max(100).describe('Short description of the task (3-5 words)'),

    /**
     * Detailed prompt/instructions for the subagent.
     * Should include all context needed to complete the task.
     */
    prompt: z.string().min(1).describe('Detailed instructions for the subagent'),

    /**
     * Optional session ID to continue an existing subagent session.
     * If not provided, a new session will be created.
     */
    sessionId: z.string().optional().describe('Optional: continue existing subagent session'),

    /**
     * The type of subagent to use.
     * Must be a registered subagent name (e.g., "query", "curate").
     */
    subagentType: z.string().min(1).describe('Which subagent to use (e.g., "explore", "curate")'),
  })
  .strict()

/**
 * Input type for task tool.
 */
type TaskInput = z.infer<typeof TaskInputSchema>

/**
 * Result of a task tool execution.
 */
interface TaskResult {
  /** Agent that executed the task */
  agent: string
  /** Task description */
  description: string
  /** Error message if failed */
  error?: string
  /** Output from the subagent */
  output: string
  /** Session ID for the subagent (can be used to continue) */
  sessionId: string
  /** Whether the task succeeded */
  success: boolean
}

/**
 * Lazy getter for session manager (avoids circular dependency).
 */
export type SessionManagerGetter = () => SessionManager | undefined

/**
 * Dependencies for creating the task tool.
 */
export interface TaskToolDependencies {
  /**
   * Lazy getter for session manager.
   * SessionManager is created after ToolProvider, so we need a getter.
   */
  getSessionManager: SessionManagerGetter
}

/**
 * Create task tool.
 *
 * Delegates work to specialized subagents for complex tasks.
 * Each subagent runs in its own session with agent-specific prompts and tool restrictions.
 *
 * Available subagents:
 * - query: Search and retrieve information from the context tree
 * - curate: Create or update knowledge topics in the context tree
 *
 * @param dependencies - Session manager and system prompt manager
 * @returns task tool instance
 */
export function createTaskTool(dependencies: TaskToolDependencies): Tool {
  const {getSessionManager} = dependencies
  const registry = getAgentRegistry()

  return {
    description: buildTaskToolDescription(registry),

    async execute(input: unknown, context?: ToolExecutionContext): Promise<TaskResult> {
      const params = input as TaskInput
      const {contextTreeOnly, description, prompt, sessionId, subagentType} = params

      // Get session manager (lazy loaded)
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        return {
          agent: subagentType,
          description,
          error: 'SessionManager is not available. Task tool requires an active agent session.',
          output: '',
          sessionId: '',
          success: false,
        }
      }

      // Validate subagent exists
      const agent = registry.get(subagentType)
      if (!agent) {
        const availableAgents = registry
          .listSubagents()
          .map((a) => a.name)
          .join(', ')
        return {
          agent: subagentType,
          description,
          error: `Unknown subagent type '${subagentType}'. Available subagents: ${availableAgents}`,
          output: '',
          sessionId: '',
          success: false,
        }
      }

      // Validate agent can be used as subagent
      if (agent.mode === 'primary') {
        return {
          agent: subagentType,
          description,
          error: `Agent '${subagentType}' is a primary agent and cannot be used as a subagent.`,
          output: '',
          sessionId: '',
          success: false,
        }
      }

      // Generate session ID for the subagent
      const subagentSessionId = sessionId ?? `${subagentType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      try {
        // Get or create session for the subagent
        // If contextTreeOnly is true, create a session with restricted file system
        let session
        if (contextTreeOnly) {
          // Create a restricted FileSystemService for context-tree only access
          const restrictedFs = createContextTreeFileSystem(process.cwd())
          await restrictedFs.initialize()

          // Create session with restricted file system
          session = await sessionManager.createChildSessionWithOverrides(
            context?.sessionId ?? 'parent',
            agent.name,
            subagentSessionId,
            {fileSystemService: restrictedFs},
          )
        } else {
          session = await sessionManager.createSession(subagentSessionId)
        }

        // Build the system prompt for the subagent
        // The agent's promptFile will be used by the SystemPromptManager
        const agentPromptSection = agent.promptFile
          ? `\n\n[Agent: ${agent.name}]\nUsing prompt from: ${agent.promptFile}`
          : agent.prompt
            ? `\n\n[Agent: ${agent.name}]\n${agent.prompt}`
            : ''

        // Construct the full message for the subagent
        const fullPrompt = `${agentPromptSection}\n\n## Task\n${prompt}`

        // Stream progress update
        if (context?.metadata) {
          context.metadata({
            description: `Running ${agent.name} subagent`,
            output: `Task: ${description}`,
            progress: 10,
          })
        }

        // Execute the subagent session with parent's taskId for billing tracking
        const response = await session.run(fullPrompt, {taskId: context?.taskId})

        // Stream completion update
        if (context?.metadata) {
          context.metadata({
            description: `${agent.name} subagent completed`,
            output: response.slice(0, 200) + (response.length > 200 ? '...' : ''),
            progress: 100,
          })
        }

        return {
          agent: agent.name,
          description,
          output: response,
          sessionId: subagentSessionId,
          success: true,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Stream error update
        if (context?.metadata) {
          context.metadata({
            description: `${agent.name} subagent failed`,
            output: errorMessage,
            progress: 100,
          })
        }

        return {
          agent: agent.name,
          description,
          error: errorMessage,
          output: '',
          sessionId: subagentSessionId,
          success: false,
        }
      }
    },

    id: TASK_TOOL_NAME,
    inputSchema: TaskInputSchema,
  }
}

/**
 * Build the task tool description dynamically based on available subagents.
 *
 * @param registry - Agent registry to get subagent descriptions
 * @returns Tool description string
 */
function buildTaskToolDescription(registry: AgentRegistry): string {
  const subagents = registry.listSubagents()
  const subagentList = subagents.map((agent) => `- ${agent.name}: ${agent.description || 'No description'}`).join('\n')

  return `Delegate work to a specialized subagent for complex tasks.

Available subagents:
${subagentList}

Use this tool when you need to:
- Search the context tree for existing information (use 'explore' subagent with contextTreeOnly=true)
- Search the codebase for information (use 'explore' subagent without contextTreeOnly)
- Create or update knowledge topics (use 'curate' subagent)

Each subagent runs with its own specialized configuration and tool access.
The subagent will execute and return its results to you.

Parameters:
- subagent_type: Which subagent to use (e.g., "explore", "curate")
- description: Short description of the task (3-5 words)
- prompt: Detailed instructions for the subagent
- context_tree_only: (Optional) If true, restricts file operations to .brv/context-tree/ only. Use this for query commands.
- session_id: (Optional) Continue an existing subagent session`
}
