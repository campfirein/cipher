/**
 * Live services adapter — wires the abstract `NodeServices` to ByteRover's
 * real infrastructure (LLM via `agent.generate`, write via `executeCurate`).
 *
 * Used by `curate-executor.ts` to back the curate-flow DAG. Tests inject
 * stub services directly and bypass this module.
 *
 * Phase 1 design notes:
 *   - extract: one LLM call per chunk via `agent.generate` (NO agent loop)
 *   - detectConflicts: per-fact subject lookup against the context tree via
 *     the injected `lookupSubject` function. Subjects already present
 *     produce 'update' decisions; others produce 'add'. Phase 2 may add
 *     LLM-driven conflict reasoning.
 *   - write: builds a CurateInput from decisions and calls executeCurate
 *     directly (same path the curate-tool uses today).
 */

import type {NodeServices} from '../../../core/curation/flow/runner.js'
import type {ICipherAgent} from '../../../core/interfaces/i-cipher-agent.js'
import type {ExistingMemoryEntry} from './existing-memory-loader.js'

import {executeCurate} from '../../tools/implementations/curate-tool.js'

interface BuildLiveServicesDeps {
  readonly agent: ICipherAgent
  readonly basePath?: string
  /**
   * Look up existing memory entries for a given subject (e.g., via
   * SearchKnowledgeService). Returns empty array if nothing matches.
   * Failures should be swallowed by the caller — conflict detection is
   * fail-open on missing data (treat unknown as 'add').
   */
  readonly lookupSubject: (subject: string) => Promise<ExistingMemoryEntry[]>
}

const EXTRACTION_PROMPT_PREFIX = `Extract concrete factual statements from the text below. Output ONLY a JSON array of objects matching this schema:
  [
    {"subject": "string (required)", "statement": "string (required)", "category": "convention | environment | other | personal | preference | project | team (optional)"}
  ]
Return an empty array \`[]\` if no clear facts are present. Do NOT wrap the array in any prose, code fence, or commentary.

TEXT:
`

interface ExtractedFact {
  category?: 'convention' | 'environment' | 'other' | 'personal' | 'preference' | 'project' | 'team'
  statement: string
  subject?: string
}

/**
 * Parse a context-tree relative path from the existing-memory loader back
 * into the `(path, title)` shape executeUpdate expects.
 *
 * Input examples (the loader sets `existingId = SearchKnowledgeResult.path`,
 * which is relative to the context tree root):
 *   "project/auth/jwt_tokens.md"           → {path: "project/auth", title: "jwt_tokens"}
 *   "project/auth/oauth/refresh.md"        → {path: "project/auth/oauth", title: "refresh"}
 *   "/project/auth/jwt_tokens.md"          → same as above (leading slash stripped)
 *   "project/auth"                         → undefined (only 2 segments — no title)
 *   "single-segment"                       → undefined
 *
 * Returns undefined when the input cannot be safely interpreted; the caller
 * then falls back to ADD instead of issuing a guaranteed-failure UPDATE.
 */
function parseExistingIdForUpdate(existingId: string): undefined | {path: string; title: string} {
  const cleaned = existingId.replaceAll(/^\/+|\/+$/g, '').replace(/\.md$/, '')
  const parts = cleaned.split('/').filter(Boolean)
  // Need at least domain/topic/title (3) and at most domain/topic/subtopic/title (4).
  if (parts.length < 3 || parts.length > 4) {
    return undefined
  }

  const title = parts.at(-1) ?? ''
  const path = parts.slice(0, -1).join('/')
  if (!title || !path) return undefined
  return {path, title}
}

function parseFactsFromLlmResponse(content: string): ExtractedFact[] {
  // Strip code fences if the LLM wrapped the JSON despite instructions.
  const cleaned = content
    .replace(/^```(?:json)?\n/, '')
    .replace(/\n```$/, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ExtractedFact[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const i = item as {category?: unknown; statement?: unknown; subject?: unknown}
      if (typeof i.statement !== 'string' || i.statement.length === 0) continue
      out.push({
        category:
          typeof i.category === 'string' ? (i.category as ExtractedFact['category']) : undefined,
        statement: i.statement,
        subject: typeof i.subject === 'string' ? i.subject : undefined,
      })
    }

    return out
  } catch {
    return []
  }
}

export function buildLiveServices(deps: BuildLiveServicesDeps): NodeServices {
  return {
    async detectConflicts(facts) {
      // Per-fact subject lookup. Cache within the call to avoid repeat
      // searches for facts sharing a subject.
      const lookupCache = new Map<string, ExistingMemoryEntry[]>()
      const decisions = await Promise.all(
        facts.map(async (fact) => {
          if (!fact.subject) {
            return {action: 'add' as const, fact}
          }

          let existingEntries = lookupCache.get(fact.subject)
          if (!existingEntries) {
            try {
              existingEntries = await deps.lookupSubject(fact.subject)
            } catch {
              existingEntries = []
            }

            lookupCache.set(fact.subject, existingEntries)
          }

          if (existingEntries.length === 0) {
            return {action: 'add' as const, fact}
          }

          const matched = existingEntries[0]
          return {
            action: 'update' as const,
            existingId: matched.existingId,
            fact,
            reason: `subject "${fact.subject}" already present at ${matched.existingId ?? 'unknown path'}`,
          }
        }),
      )
      return {decisions}
    },

    async extract(chunk, taskId) {
      const prompt = `${EXTRACTION_PROMPT_PREFIX}${chunk}`
      const response = await deps.agent.generate(prompt, {taskId})
      const facts = parseFactsFromLlmResponse(response.content)
      return {
        facts,
        failed: facts.length === 0 ? 1 : 0,
        succeeded: facts.length === 0 ? 0 : 1,
        total: 1,
      }
    },

    async write(decisions) {
      // executeCurate's parsePath requires `path` to be `domain/topic` or
      // `domain/topic/subtopic` (2-3 segments) — see curate-tool.ts:689.
      // A single segment like "auth" is rejected with "Invalid path format".
      //
      // ADD path: derive both segments from the fact:
      //   - domain = fact.category (or 'extracted' for facts without
      //     a category — Phase 2 may add LLM-driven domain inference)
      //   - topic  = fact.subject  (or 'misc' if missing)
      //   - title  = short human label from the statement (curate-tool
      //              snake-cases it into the leaf file name)
      //
      // UPDATE path: honor `existingId` (the path of the matched existing
      // file, supplied by detectConflicts via the existing-memory loader).
      // executeUpdate looks up `${path}/${snake_case(title)}.md`, so we
      // must split existingId back into path + title rather than deriving
      // a fresh title from the new statement (which would point to a file
      // that doesn't exist).
      //
      // We also set `summary` since it's required for ADD/UPDATE per the
      // OperationSchema description in curate-tool.ts.
      const operations = decisions.map((d) => {
        const fromStatement = (): string => {
          const rawTitle = d.fact.statement.split(/\s+/).slice(0, 8).join(' ').trim()
          return rawTitle.length > 0 ? rawTitle.slice(0, 80) : 'fact'
        }

        let path: string
        let title: string
        let type: 'ADD' | 'UPDATE'

        const updateTarget = d.action === 'update' && d.existingId
          ? parseExistingIdForUpdate(d.existingId)
          : undefined

        if (updateTarget) {
          // We know the existing file location — point UPDATE at it.
          path = updateTarget.path
          title = updateTarget.title
          type = 'UPDATE'
        } else {
          // Either an ADD, or an UPDATE whose existingId is missing/unparseable.
          // Fall back to ADD shape — UPDATE on an unknown path would fail
          // with "File does not exist", and ADD is the safer recovery.
          const domain = d.fact.category ?? 'extracted'
          const topic = d.fact.subject ?? 'misc'
          path = `${domain}/${topic}`
          title = fromStatement()
          type = 'ADD'
        }

        return {
          confidence: 'high' as const,
          content: {
            facts: [
              {
                category: d.fact.category,
                statement: d.fact.statement,
                subject: d.fact.subject,
              },
            ],
          },
          impact: 'low' as const,
          path,
          reason: d.reason ?? `Curated from agent extraction (${d.action})`,
          summary: d.fact.statement.slice(0, 200),
          title,
          type,
        }
      })

      const result = await executeCurate({basePath: deps.basePath, operations})

      return {
        applied: result.applied,
        summary: result.summary,
      }
    },
  }
}
