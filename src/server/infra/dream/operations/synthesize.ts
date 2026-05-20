/**
 * Synthesize operation — detects cross-domain patterns from domain summaries.
 *
 * Flow:
 * 1. Collect domain summaries from _index.md files
 * 2. Collect existing synthesis files (to avoid duplicates)
 * 3. Single LLM call for cross-domain analysis
 * 4. Deduplicate candidates against existing files via BM25
 * 5. Write new synthesis files as regular draft context entries
 *
 * Never throws — returns empty array on errors.
 */

import {dump as yamlDump, load as yamlLoad} from 'js-yaml'
import {randomUUID} from 'node:crypto'
import {access, mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'

import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {ILogger} from '../../../../agent/core/interfaces/i-logger.js'
import type {IRuntimeSignalStore} from '../../../core/interfaces/storage/i-runtime-signal-store.js'
import type {DreamOperation} from '../dream-log-schema.js'
import type {SynthesisCandidate} from '../dream-response-schemas.js'

import {createDefaultRuntimeSignals} from '../../../core/domain/knowledge/runtime-signals-schema.js'
import {warnSidecarFailure} from '../../../core/domain/knowledge/sidecar-logging.js'
import {isDescendantOf} from '../../../utils/path-utils.js'
import {SynthesizeResponseSchema} from '../dream-response-schemas.js'
import {parseDreamResponse} from '../parse-dream-response.js'

export type SynthesizeDeps = {
  agent: ICipherAgent
  contextTreeDir: string
  /**
   * Optional logger. When provided, sidecar seed failures emit a warn
   * so the fail-open degradation is observable rather than silent.
   */
  logger?: ILogger
  /**
   * Optional sidecar store for runtime ranking signals. When provided,
   * newly created synthesis files are seeded with default signals so
   * ranking data lives in the sidecar rather than in markdown frontmatter.
   */
  runtimeSignalStore?: IRuntimeSignalStore
  searchService: {
    search(query: string, options?: {limit?: number; scope?: string}): Promise<{results: Array<{path: string; score: number; title: string}>}>
  }
  signal?: AbortSignal
  taskId: string
}

type DomainSummary = {
  content: string
  name: string
}

const DEDUP_THRESHOLD = 0.5

/**
 * Run synthesis on the context tree.
 * Returns DreamOperation results (never throws).
 */
export async function synthesize(deps: SynthesizeDeps): Promise<DreamOperation[]> {
  const {agent, contextTreeDir, searchService, taskId} = deps

  if (deps.signal?.aborted) return []

  // Step 1: Collect domain summaries
  const domains = await collectDomainSummaries(contextTreeDir)
  if (domains.length < 2) return []

  // Step 2: Collect existing synthesis files
  const existingSyntheses = await collectExistingSyntheses(contextTreeDir, domains)

  // Step 3: LLM cross-domain analysis
  let sessionId: string
  try {
    sessionId = await agent.createTaskSession(taskId, 'dream-synthesize')
  } catch {
    return []
  }

  try {
    const prompt = buildPrompt(domains, existingSyntheses)
    const response = await agent.executeOnSession(sessionId, prompt, {
      executionContext: {commandType: 'curate', maxIterations: 10},
      signal: deps.signal,
      taskId,
    })

    const parsed = parseDreamResponse(response, SynthesizeResponseSchema)
    if (!parsed || parsed.syntheses.length === 0) return []

    // Step 4: Deduplicate against existing synthesis files only — the whole tree
    // will naturally score high since synthesis derives from domain summaries
    const novel: SynthesisCandidate[] = []
    for (const candidate of parsed.syntheses) {
      // eslint-disable-next-line no-await-in-loop
      const isDuplicate = await isDuplicateCandidate(candidate, existingSyntheses, searchService)
      if (!isDuplicate) novel.push(candidate)
    }

    if (novel.length === 0) return []

    // Step 5: Write synthesis files (per-candidate error handling to preserve partial results)
    const results: DreamOperation[] = []
    for (const candidate of novel) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const op = await writeSynthesisFile(candidate, contextTreeDir, deps.runtimeSignalStore, deps.logger)
        if (op) results.push(op)
      } catch {
        // Skip failed candidate — don't discard already-written results
      }
    }

    return results
  } catch {
    return []
  } finally {
    await agent.deleteTaskSession(sessionId).catch(() => {})
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function collectDomainSummaries(contextTreeDir: string): Promise<DomainSummary[]> {
  let dirNames: string[]
  try {
    const entries = await readdir(contextTreeDir, {withFileTypes: true})
    dirNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => String(e.name))
      .filter((n) => !n.startsWith('_') && !n.startsWith('.'))
  } catch {
    return []
  }

  const loaded = await Promise.all(
    dirNames.map(async (name) => {
      try {
        const content = await readFile(join(contextTreeDir, name, '_index.md'), 'utf8')
        return {content, name}
      } catch {
        return null
      }
    }),
  )

  return loaded.filter((item): item is DomainSummary => item !== null)
}

async function collectExistingSyntheses(contextTreeDir: string, domains: DomainSummary[]): Promise<string[]> {
  const syntheses: string[] = []

  const domainResults = await Promise.all(
    domains.map(async (domain) => {
      const domainDir = join(contextTreeDir, domain.name)
      let files: string[]
      try {
        const entries = await readdir(domainDir)
        files = entries.filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      } catch {
        return []
      }

      const found: string[] = []
      const checks = files.map(async (file) => {
        try {
          const content = await readFile(join(domainDir, file), 'utf8')
          const fm = parseFrontmatterType(content)
          if (fm === 'synthesis') {
            return `${domain.name}/${file}`
          }
        } catch {
          // skip
        }

        return null
      })
      const results = await Promise.all(checks)
      for (const r of results) {
        if (r) found.push(r)
      }

      return found
    }),
  )

  for (const paths of domainResults) syntheses.push(...paths)
  return syntheses
}

/** Extract the `type` field from YAML frontmatter, or undefined. */
function parseFrontmatterType(content: string): string | undefined {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return undefined

  const endIndex = content.indexOf('\n---\n', 4)
  const endIndexCrlf = content.indexOf('\r\n---\r\n', 5)
  const actualEnd = endIndex === -1 ? endIndexCrlf : endIndex
  if (actualEnd < 0) return undefined

  try {
    const yamlBlock = content.slice(4, actualEnd)
    const raw = yamlLoad(yamlBlock)
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'type' in raw && typeof raw.type === 'string') {
      return raw.type
    }
  } catch {
    // Invalid YAML
  }

  return undefined
}

async function isDuplicateCandidate(
  candidate: SynthesisCandidate,
  existingSyntheses: string[],
  searchService: SynthesizeDeps['searchService'],
): Promise<boolean> {
  if (existingSyntheses.length === 0) return false

  try {
    const query = `${candidate.title} ${candidate.claim}`
    const results = await searchService.search(query, {limit: 5})
    // Only consider matches against existing synthesis files — the whole tree
    // will naturally score high since synthesis derives from domain summaries
    const synthesisMatch = results.results.find((r) => existingSyntheses.includes(r.path))
    const topScore = synthesisMatch?.score ?? 0
    return topScore >= DEDUP_THRESHOLD
  } catch {
    return false // Search failure → assume novel
  }
}

async function writeSynthesisFile(
  candidate: SynthesisCandidate,
  contextTreeDir: string,
  runtimeSignalStore?: IRuntimeSignalStore,
  logger?: ILogger,
): Promise<DreamOperation | undefined> {
  const slug = slugify(candidate.title)
  const relativePath = `${candidate.placement}/${slug}.md`
  const absPath = resolve(contextTreeDir, relativePath)

  // Guard against LLM-supplied path traversal (e.g. placement = "../../etc")
  if (!isDescendantOf(absPath, contextTreeDir)) {
    return undefined
  }

  // Name collision check
  try {
    await access(absPath)
    return undefined // File exists — skip
  } catch {
    // ENOENT — good, proceed
  }

  const sources = candidate.evidence.map((e) => `${e.domain}/_index.md`)
  // Normalize tags to lowercase kebab-case so card chips and BM25 search see
  // a consistent label regardless of whether the model honored the prompt's
  // formatting rule. Empty entries (post-trim) are dropped.
  const normalizedTags = candidate.tags
    .map((t) => t.toLowerCase().trim().replaceAll(/\s+/g, '-'))
    .filter((t) => t.length > 0)
  const now = new Date().toISOString()
  // Field order is enforced by insertion order (yamlDump uses sortKeys:false).
  // Synthesis markers (confidence, sources, synthesized_at, type) come first
  // in the order pre-existing synthesized files use on disk, so re-generating
  // an old file does not produce a mechanical reorder diff. The seven
  // semantic fields below mirror the order in markdown-writer.ts's
  // generateFrontmatter so the on-disk shape matches regular `brv save`
  // files; cogit then exposes them in DtoV3MemoryCardResource for card-mode
  // display in the web UI.
  /* eslint-disable camelcase */
  const frontmatter: Record<string, number | string | string[]> = {}
  frontmatter.confidence = candidate.confidence
  frontmatter.sources = sources
  frontmatter.synthesized_at = now
  frontmatter.type = 'synthesis'
  frontmatter.title = candidate.title
  frontmatter.summary = candidate.summary
  frontmatter.tags = normalizedTags
  frontmatter.related = []
  frontmatter.keywords = candidate.keywords
  frontmatter.createdAt = now
  frontmatter.updatedAt = now
  /* eslint-enable camelcase */
  const yaml = yamlDump(frontmatter, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
  const body = [
    `# ${candidate.title}`,
    '',
    candidate.claim,
    '',
    '## Evidence',
    '',
    ...candidate.evidence.map((e) => `- **${e.domain}**: ${e.fact}`),
    '',
  ].join('\n')
  const content = `---\n${yaml}\n---\n\n${body}`

  await atomicWrite(absPath, content)

  // Seed the sidecar with default signals so ranking data lives in the
  // sidecar rather than in markdown frontmatter. Best-effort — a sidecar
  // failure must never prevent the synthesis file from being created.
  if (runtimeSignalStore) {
    try {
      await runtimeSignalStore.set(relativePath, createDefaultRuntimeSignals())
    } catch (error) {
      warnSidecarFailure(logger, 'synthesize', 'seed', relativePath, error)
    }
  }

  return {
    action: 'CREATE',
    confidence: candidate.confidence,
    needsReview: candidate.confidence < 0.7,
    outputFile: relativePath,
    sources,
    type: 'SYNTHESIZE',
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 80)
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), {recursive: true})
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}

function buildPrompt(domains: DomainSummary[], existingSyntheses: string[]): string {
  const existingList = existingSyntheses.length > 0
    ? `Existing synthesis files (do NOT recreate these):\n${existingSyntheses.map((s) => `- ${s}`).join('\n')}`
    : 'No existing synthesis files.'

  const marker = '━'.repeat(60)
  const domainBlocks = domains
    .map((d) => `\n${marker}\nDOMAIN: ${d.name}\n${marker}\n${d.content}`)
    .join('\n')

  return [
    'You are analyzing a knowledge base organized into domains. The full _index.md content for every domain is included below — read them directly. Do NOT use code_exec.',
    '',
    `Domains: ${domains.map((d) => d.name).join(', ')}`,
    '',
    existingList,
    '',
    'Domain summaries:',
    domainBlocks,
    '',
    'Your job is to find cross-cutting patterns — concepts, concerns, or conflicts that span multiple domains.',
    '',
    'Rules:',
    '- Report genuinely useful insights that a developer would benefit from knowing.',
    '- Any named abstraction, component, or concept that appears in 2+ domains is worth synthesizing.',
    '- Do NOT report trivial or obvious connections (e.g., "both domains use TypeScript").',
    '- Each synthesis must reference at least 2 domains with specific evidence.',
    '- For "placement", choose the domain where this insight is MOST actionable.',
    '- "summary" is one sentence (≤ 200 chars) describing the insight; this is what the UI shows as a card preview.',
    '- "tags" are 3-5 short topical labels drawn from the source domains (e.g., "auth", "caching"). Lowercase, kebab-case.',
    '- "keywords" are 5-10 single words a developer would search for to surface this synthesis.',
    '- If nothing meaningful is found, return an empty array. That is fine — but missing a clear cross-domain pattern is a failure.',
    '',
    // Keep the JSON shape below in sync with SynthesisCandidateSchema in
    // dream-response-schemas.ts; the schema rejects responses that omit any
    // listed field, so adding a field there requires updating this example.
    'Respond with JSON:',
    '```',
    '{ "syntheses": [{ "title": "...", "summary": "...", "claim": "...", "evidence": [{"domain": "...", "fact": "..."}], "tags": ["..."], "keywords": ["..."], "confidence": 0.0-1.0, "placement": "..." }] }',
    '```',
  ].join('\n')
}
