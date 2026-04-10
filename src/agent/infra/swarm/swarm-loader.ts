/* eslint-disable camelcase */

import {load as yamlLoad} from 'js-yaml'
import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import type {AgentSpec, EdgeDef, LoadedSwarm, SwarmFileReader, SwarmRuntimeConfig} from './types.js'

import {SwarmValidationError} from './errors.js'
import {parseFrontmatter} from './frontmatter.js'
import {KNOWN_ADAPTER_TYPES} from './types.js'

// ─── Zod Schemas ───

const SwarmFrontmatterSchema = z.object({
  description: z.string().min(1),
  goals: z.array(z.string()).min(1),
  includes: z.array(z.string()).min(1),
  name: z.string().min(1),
  schema: z.literal('byterover-swarm/v1'),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  version: z.string().min(1),
})

const AgentFrontmatterSchema = z.object({
  description: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  skills: z.array(z.string()).default([]),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
})

const AgentRuntimeConfigSchema = z.object({
  adapter: z.object({
    config: z.record(z.unknown()).optional(),
    type: z.enum(KNOWN_ADAPTER_TYPES),
  }),
  budgetMaxCostUsd: z.number().positive().optional(),
  cwd: z.string().optional(),
  output: z.boolean().optional(),
  timeoutSec: z.number().positive().optional(),
})

const EdgeDefSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

const SwarmRuntimeConfigSchema = z.object({
  agents: z.record(z.string(), AgentRuntimeConfigSchema).refine(
    (obj) => Object.keys(obj).length > 0,
    {message: 'At least one agent must be defined'},
  ),
  edges: z.array(EdgeDefSchema).default([]),
  optimization: z.object({
    edge: z.object({
      batchSize: z.number().positive().optional(),
      enabled: z.boolean().optional(),
      initialProbability: z.number().min(0).max(1).optional(),
      lr: z.number().positive().optional(),
    }).optional(),
    evaluator: z.string().optional(),
    node: z.object({
      enabled: z.boolean().optional(),
      historyWindow: z.number().positive().optional(),
    }).optional(),
  }).optional(),
  potential_edges: z.array(EdgeDefSchema).default([]),
  schema: z.literal('byterover-swarm/v1'),
})

// ─── Default file reader using node:fs/promises ───

const defaultFileReader: SwarmFileReader = {
  async exists(p: string) {
    try {
      await fs.access(p)

      return true
    } catch {
      return false
    }
  },
  // Only supports "**/<suffix>" patterns; full glob not implemented.
  async glob(dir: string, pattern: string) {
    const suffix = pattern.replace('**/', '')
    const entries = await fs.readdir(dir, {recursive: true})

    return entries
      .filter((entry) => typeof entry === 'string' && entry.endsWith(suffix))
      .map((entry) => path.join(dir, entry as string))
  },
  async isDirectory(p: string) {
    try {
      const stat = await fs.stat(p)

      return stat.isDirectory()
    } catch {
      return false
    }
  },
  async readFile(p: string) {
    return fs.readFile(p, 'utf8')
  },
}

// ─── SwarmLoader ───

export class SwarmLoader {
  private readonly reader: SwarmFileReader

  constructor(props?: {fileReader?: SwarmFileReader}) {
    this.reader = props?.fileReader ?? defaultFileReader
  }

  async load(dirPath: string): Promise<LoadedSwarm> {
    const sourceDir = path.resolve(dirPath)
    const warnings: string[] = []

    // ── Phase 1: File existence (fail-fast) ──
    const exists = await this.reader.exists(sourceDir)
    if (!exists) {
      throw new Error(`Swarm directory does not exist: ${sourceDir}`)
    }

    const isDir = await this.reader.isDirectory(sourceDir)
    if (!isDir) {
      throw new Error(`Path is not a directory: ${sourceDir}`)
    }

    const swarmMdPath = path.join(sourceDir, 'SWARM.md')
    const swarmMdExists = await this.reader.exists(swarmMdPath)
    if (!swarmMdExists) {
      throw new Error(`SWARM.md not found in ${sourceDir}`)
    }

    const yamlPath = path.join(sourceDir, '.swarm.yaml')
    const yamlExists = await this.reader.exists(yamlPath)
    if (!yamlExists) {
      throw new Error(`.swarm.yaml not found in ${sourceDir}`)
    }

    // ── Phase 2: Schema parsing (fail-fast) ──
    const swarmMdContent = await this.reader.readFile(swarmMdPath)
    const swarmParsed = parseFrontmatter(swarmMdContent)
    if (!swarmParsed) {
      throw new Error('SWARM.md has invalid or missing frontmatter')
    }

    const frontmatter = SwarmFrontmatterSchema.parse(swarmParsed.frontmatter)
    const normalizedIncludes = this.validateIncludes(frontmatter.includes, sourceDir)

    const yamlContent = await this.reader.readFile(yamlPath)
    const rawYaml = yamlLoad(yamlContent)
    if (!rawYaml || typeof rawYaml !== 'object' || Array.isArray(rawYaml)) {
      throw new Error('.swarm.yaml must be a YAML object (got empty or non-object content)')
    }

    const parsed = SwarmRuntimeConfigSchema.parse(rawYaml)
    const runtimeConfig: SwarmRuntimeConfig = {
      agents: parsed.agents,
      edges: parsed.edges,
      optimization: parsed.optimization,
      potentialEdges: parsed.potential_edges,
      schema: parsed.schema,
    }

    // ── Phase 3: Agent loading + cross-validation (accumulate errors) ──
    const {agents, errors: agentErrors, failedIncludeCount} = await this.loadAgents(normalizedIncludes, sourceDir)

    // Discovery: warn about orphan AGENT.md files not in includes
    const agentFilesOnDisk = await this.reader.glob(sourceDir, '**/AGENT.md')
    const includedAbsPaths = new Set(normalizedIncludes.map((inc) => path.resolve(sourceDir, inc)))
    for (const diskPath of agentFilesOnDisk) {
      if (!includedAbsPaths.has(path.resolve(diskPath))) {
        warnings.push(`Found ${path.relative(sourceDir, diskPath)} on disk but not in SWARM.md includes`)
      }
    }

    const crossValidationErrors: string[] = []

    // Slug cross-validation
    const agentSlugs = new Set(agents.map((a) => a.frontmatter.slug))
    const configSlugs = new Set(Object.keys(runtimeConfig.agents))

    for (const configSlug of configSlugs) {
      if (!agentSlugs.has(configSlug)) {
        crossValidationErrors.push(`Agent "${configSlug}" in .swarm.yaml has no AGENT.md`)
      }
    }

    for (const agentSlug of agentSlugs) {
      if (!configSlugs.has(agentSlug)) {
        crossValidationErrors.push(`Agent "${agentSlug}" has AGENT.md but no entry in .swarm.yaml`)
      }
    }

    // Edge validation
    const edgeErrors = this.validateEdges(runtimeConfig.edges, runtimeConfig.potentialEdges, agentSlugs)
    crossValidationErrors.push(...edgeErrors)

    // Check for output nodes
    const hasOutput = Object.values(runtimeConfig.agents).some((a) => a.output === true)
    if (!hasOutput) {
      warnings.push('No agents have output: true. At least one output node is recommended.')
    }

    // Throw if any errors accumulated
    const allErrors = [...agentErrors, ...crossValidationErrors]
    if (allErrors.length > 0) {
      const note = failedIncludeCount > 0 && crossValidationErrors.length > 0
        ? `Note: ${failedIncludeCount} included file(s) failed to load. Some errors above may resolve after fixing those files.`
        : null
      throw new SwarmValidationError(allErrors, warnings, note)
    }

    return {
      agents,
      description: swarmParsed.body.trim(),
      frontmatter,
      runtimeConfig,
      sourceDir,
      warnings,
    }
  }

  private async loadAgents(
    normalizedIncludes: string[],
    sourceDir: string,
  ): Promise<{agents: AgentSpec[]; errors: string[]; failedIncludeCount: number}> {
    const agents: AgentSpec[] = []
    const errors: string[] = []
    const slugToPath = new Map<string, string>()
    let failedIncludeCount = 0

    const readResults = await Promise.allSettled(
      normalizedIncludes.map(async (includePath) => {
        const agentMdPath = path.join(sourceDir, includePath)
        const agentExists = await this.reader.exists(agentMdPath)
        if (!agentExists) {
          throw new Error(`Agent spec not found: ${includePath} referenced in includes but not found`)
        }

        const content = await this.reader.readFile(agentMdPath)

        return {content, includePath}
      }),
    )

    for (const result of readResults) {
      if (result.status === 'rejected') {
        errors.push((result.reason as Error).message)
        failedIncludeCount++
        continue
      }

      const {content, includePath} = result.value

      const agentParsed = parseFrontmatter(content)
      if (!agentParsed) {
        errors.push(`${includePath} has invalid or missing frontmatter`)
        failedIncludeCount++
        continue
      }

      const agentFmResult = AgentFrontmatterSchema.safeParse(agentParsed.frontmatter)
      if (!agentFmResult.success) {
        const issues = agentFmResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
        errors.push(`${includePath}: ${issues}`)
        failedIncludeCount++
        continue
      }

      const agentFm = agentFmResult.data

      // Check duplicate slugs
      const existingPath = slugToPath.get(agentFm.slug)
      if (existingPath) {
        errors.push(`Duplicate agent slug "${agentFm.slug}" defined in both ${existingPath} and ${includePath}`)
        continue
      }

      slugToPath.set(agentFm.slug, includePath)

      agents.push({
        frontmatter: agentFm,
        prompt: agentParsed.body.trim(),
        sourcePath: path.resolve(sourceDir, includePath),
      })
    }

    return {agents, errors, failedIncludeCount}
  }

  private validateEdges(edges: EdgeDef[], potentialEdges: EdgeDef[], validSlugs: Set<string>): string[] {
    const errors: string[] = []
    const edgeKeys = new Set<string>()

    for (const edge of edges) {
      if (!validSlugs.has(edge.from)) {
        errors.push(`Edge references unknown agent "${edge.from}"`)
      }

      if (!validSlugs.has(edge.to)) {
        errors.push(`Edge references unknown agent "${edge.to}"`)
      }

      const key = `${edge.from}->${edge.to}`
      if (edgeKeys.has(key)) {
        errors.push(`Duplicate fixed edge: ${key}`)
      }

      edgeKeys.add(key)
    }

    const potentialKeys = new Set<string>()
    for (const edge of potentialEdges) {
      if (!validSlugs.has(edge.from)) {
        errors.push(`Potential edge references unknown agent "${edge.from}"`)
      }

      if (!validSlugs.has(edge.to)) {
        errors.push(`Potential edge references unknown agent "${edge.to}"`)
      }

      const key = `${edge.from}->${edge.to}`
      if (potentialKeys.has(key)) {
        errors.push(`Duplicate potential edge: ${key}`)
      }

      if (edgeKeys.has(key)) {
        errors.push(`Edge ${key} appears in both edges and potential_edges`)
      }

      potentialKeys.add(key)
    }

    return errors
  }

  private validateIncludes(includes: string[], sourceDir: string): string[] {
    const normalized: string[] = []
    const seen = new Set<string>()

    for (const inc of includes) {
      const norm = path.normalize(inc)

      const resolved = path.resolve(sourceDir, norm)
      if (!resolved.startsWith(sourceDir + path.sep) && resolved !== sourceDir) {
        throw new Error(`Include path "${inc}" escapes swarm directory`)
      }

      if (seen.has(norm)) {
        throw new Error(`Duplicate include: "${inc}" (resolves to "${norm}")`)
      }

      seen.add(norm)
      normalized.push(norm)
    }

    return normalized
  }
}
