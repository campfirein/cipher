// ─── Adapter Types (single source of truth, used by Zod schema) ───

export const KNOWN_ADAPTER_TYPES = [
  'claude_code',
  'codex',
  'hermes',
  'openclaw'
] as const

export type AdapterType = (typeof KNOWN_ADAPTER_TYPES)[number]

// ─── Spec Types (parsed from files) ───

export type SwarmFrontmatter = {
  description: string
  goals: string[]
  includes: string[]
  name: string
  schema: string
  slug: string
  version: string
}

export type AgentFrontmatter = {
  description: string
  name: string
  role: string
  skills: string[]
  slug: string
}

export type AgentSpec = {
  frontmatter: AgentFrontmatter
  prompt: string
  sourcePath: string
}

export type AgentRuntimeConfig = {
  adapter: {config?: Record<string, unknown>; type: AdapterType}
  budgetMaxCostUsd?: number
  cwd?: string
  output?: boolean
  timeoutSec?: number
}

export type EdgeDef = {from: string; to: string}

export type SwarmRuntimeConfig = {
  agents: Record<string, AgentRuntimeConfig>
  edges: EdgeDef[]
  optimization?: {
    edge?: {batchSize?: number; enabled?: boolean; initialProbability?: number; lr?: number}
    evaluator?: string
    node?: {enabled?: boolean; historyWindow?: number}
  }
  potentialEdges: EdgeDef[]
  schema: string
}

export type LoadedSwarm = {
  agents: AgentSpec[]
  description: string
  frontmatter: SwarmFrontmatter
  runtimeConfig: SwarmRuntimeConfig
  sourceDir: string
  warnings: string[]
}

// ─── Summary DTO (for CLI output) ───

export type SwarmSummary = {
  agentCount: number
  agents: Array<{adapterType: string; slug: string}>
  fixedEdgeCount: number
  name: string
  outputNodes: string[]
  potentialEdgeCount: number
  slug: string
}

// ─── File Reader (for testability) ───

export type SwarmFileReader = {
  exists(path: string): Promise<boolean>
  glob(dir: string, pattern: string): Promise<string[]>
  isDirectory(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
}
