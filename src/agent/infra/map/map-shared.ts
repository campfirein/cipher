/* eslint-disable camelcase */
import {realpathSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {basename, dirname, join, normalize, resolve, sep} from 'node:path'
import {z} from 'zod'

// ── Path Safety ─────────────────────────────────────────────────────────────

/**
 * Canonicalize a path by resolving symlinks.
 * For existing paths, uses realpathSync.native().
 * For non-existent paths (e.g., output files), walks up to the nearest
 * existing ancestor directory, canonicalizes it, then reconstructs the
 * remaining non-existent segments on top. This catches symlink escapes
 * at any depth (e.g., workspace/symlink-to-outside/new-dir/file.jsonl).
 */
/**
 * Export the canonical path resolver for use in anti-cycle checks.
 * Returns the real path via realpathSync.native(); falls back to walking
 * up to the nearest existing ancestor for non-existent paths.
 */
export function canonicalizePath(absolutePath: string): string {
  return canonicalize(absolutePath)
}

function canonicalize(absolutePath: string): string {
  try {
    return realpathSync.native(absolutePath)
  } catch {
    // Path doesn't exist — recurse up to the nearest existing ancestor
    const dir = dirname(absolutePath)
    const base = basename(absolutePath)

    // Guard: reached filesystem root without finding an existing path
    if (dir === absolutePath) {
      return normalize(absolutePath)
    }

    return join(canonicalize(dir), base)
  }
}

/**
 * Resolve a path relative to the working directory and validate it stays within bounds.
 * Prevents both path traversal (e.g., `../../etc/passwd`) and symlink escape
 * (e.g., a symlink under the repo pointing to an external location).
 *
 * @throws Error if the resolved path escapes the working directory
 */
export function resolveAndValidatePath(workingDirectory: string, filePath: string): string {
  const resolved = resolve(workingDirectory, filePath)

  // Canonicalize both paths to resolve symlinks before containment check
  const canonicalRoot = canonicalize(resolve(workingDirectory))
  const canonicalResolved = canonicalize(resolved)

  if (!canonicalResolved.startsWith(canonicalRoot + sep) && canonicalResolved !== canonicalRoot) {
    throw new Error(`Path "${filePath}" resolves outside the working directory`)
  }

  return resolved
}

// ── Deterministic JSON Serialization ─────────────────────────────────────────

/**
 * Deterministic JSON serialization with recursively sorted keys.
 * Ensures identical output regardless of key insertion order.
 *
 * Ported from VoltCode's map-shared.ts.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k]
      }

      return sorted
    }

    return val
  })
}

// ── User Message Builder ─────────────────────────────────────────────────────

/**
 * Build the user message with prompt + `<map-details-json>` block.
 * Each item gets a deterministic metadata block for reproducibility.
 */
export function buildUserMessage(
  promptText: string,
  mapId: string,
  runStartedAt: string,
  itemIndex: number,
  item: unknown,
  outputSchema: Record<string, unknown>,
): string {
  const details: Record<string, unknown> = {
    item,
    item_index: itemIndex,
    map_id: mapId,
    output_schema: outputSchema,
    run_started_at: runStartedAt,
  }

  return `${promptText}\n\n<map-details-json>\n${stableStringify(details)}\n</map-details-json>`
}

/**
 * Build a retry message that includes the original prompt, the error, and the prior response.
 */
export function buildRetryMessage(
  originalUserMessage: string,
  error: string,
  priorResponse: string,
): string {
  return [
    originalUserMessage,
    '',
    '<map-retry>',
    `Your previous response could not be used: ${error}`,
    '',
    'Your prior response was:',
    priorResponse,
    '',
    'Please output corrected JSON only. No explanations, no markdown fences.',
    '</map-retry>',
  ].join('\n')
}

// ── JSONL Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a JSONL file into an array of JSON values.
 * Each line must be valid JSON. Empty trailing lines are tolerated.
 */
export async function parseJsonlFile(filePath: string): Promise<unknown[]> {
  const rawText = await readFile(filePath, 'utf8')
  const rawLines = rawText.split('\n')
  const lines = rawLines.at(-1) === '' ? rawLines.slice(0, -1) : rawLines
  const items: unknown[] = []

  for (const [i, line] of lines.entries()) {
    if (line.trim() === '') {
      throw new Error(`Line ${i} is empty. Every line must be valid JSON.`)
    }

    try {
      items.push(JSON.parse(line))
    } catch (error) {
      throw new Error(`Line ${i} is not valid JSON: ${error}`)
    }
  }

  return items
}

/**
 * Write items as a JSONL file. Each item is serialized to one line.
 */
export function itemsToJsonl(items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n')
}

// ── Schema Validation ────────────────────────────────────────────────────────

/**
 * Validate a parsed value against a JSON Schema using Zod passthrough.
 * Returns {valid: true, value} on success, {valid: false, error} on failure.
 *
 * For simplicity, we use a basic JSON Schema validation approach rather than
 * requiring ajv as a dependency. The schema is used mainly for type checking
 * (object with expected properties).
 */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
): {error?: string; valid: boolean} {
  // Basic type check
  if (schema.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    return {error: `Expected object, got ${typeof value}`, valid: false}
  }

  if (schema.type === 'array' && !Array.isArray(value)) {
    return {error: `Expected array, got ${typeof value}`, valid: false}
  }

  if (schema.type === 'string' && typeof value !== 'string') {
    return {error: `Expected string, got ${typeof value}`, valid: false}
  }

  if (schema.type === 'number' && typeof value !== 'number') {
    return {error: `Expected number, got ${typeof value}`, valid: false}
  }

  // Check required properties for objects
  if (schema.type === 'object' && schema.required && Array.isArray(schema.required)) {
    const obj = value as Record<string, unknown>
    for (const key of schema.required as string[]) {
      if (!(key in obj)) {
        return {error: `Missing required property: ${key}`, valid: false}
      }
    }
  }

  return {valid: true}
}

// ── Zod Schemas for Map Tool Parameters ──────────────────────────────────────

export const LlmMapParametersSchema = z.object({
  concurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max parallel LLM requests (default: 8)'),
  input_path: z.string().describe('File path to JSONL input'),
  max_attempts: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max LLM calls per item (default: 3)'),
  output_path: z.string().describe('File path where JSONL output will be written'),
  output_schema: z
    .record(z.string(), z.any())
    .describe('JSON Schema for LLM output validation'),
  prompt: z.string().describe('Base instruction text sent to the LLM for each item'),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max seconds per item (default: 120)'),
})
export type LlmMapParameters = z.infer<typeof LlmMapParametersSchema>

export const AgenticMapParametersSchema = z.object({
  input_path: z.string().describe('File path to JSONL input'),
  max_attempts: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max attempts per item (default: 3)'),
  max_depth: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Maximum nesting depth for recursive agentic_map calls (default: 1). ' +
      'Requires read_only=false. Capped at a hard server-side ceiling of 3. ' +
      'Nested calls cannot increase the depth limit set by the root call.',
    ),
  output_path: z.string().describe('File path where JSONL output will be written'),
  output_schema: z
    .record(z.string(), z.any())
    .describe('JSON Schema for sub-agent output validation'),
  prompt: z.string().describe('Base instruction text for sub-agents'),
  read_only: z
    .boolean()
    .optional()
    .describe('If true, sub-agent write operations are disabled (default: true)'),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max seconds per item (default: 300)'),
})
export type AgenticMapParameters = z.infer<typeof AgenticMapParametersSchema>

// ── System Messages ──────────────────────────────────────────────────────────

/**
 * System message for LLM-Map: enforces stateless JSON-only output.
 */
export const LLM_MAP_SYSTEM_MESSAGE = [
  'You are processing one item from a parallel LLM map.',
  '',
  'You must return exactly one JSON value as the entire response:',
  '- No surrounding prose, explanations, or commentary.',
  '- No markdown fences (no ```json blocks).',
  '- No trailing text after the JSON.',
  '',
  'Your JSON output must validate against the schema provided in <map-details-json>.',
  'If asked to retry due to an error, output corrected JSON only.',
  '',
  'No external tools exist and no actions can be taken beyond returning JSON text.',
].join('\n')

/**
 * System message for Agentic-Map: allows tool access with JSON output.
 */
export function buildAgenticMapSystemMessage(readOnly: boolean): string {
  const lines = [
    'You are operating on one item from a parallel agentic map.',
    '',
    'You must output exactly one JSON value as your final answer:',
    '- No surrounding prose, explanations, or commentary.',
    '- No markdown fences (no ```json blocks).',
    '- No trailing text after the JSON.',
    '',
    'Your JSON output must validate against the schema provided in <map-details-json>.',
    'If the system reports a JSON parsing or schema validation error, respond with corrected JSON only.',
  ]

  if (readOnly) {
    lines.push('', 'Write operations (edit, write, bash) are disabled for this task.')
  }

  return lines.join('\n')
}

/**
 * Build the recursive composition guidance block appended to sub-agent user messages
 * when this depth level allows further nesting.
 */
export function buildRecursiveCompositionGuidance(
  currentDepth: number,
  maxDepth: number,
): string {
  const remaining = maxDepth - currentDepth
  return [
    '<recursive-map-guidance>',
    `You are at nesting depth ${currentDepth} (hard limit: ${maxDepth}).`,
    `You may call agentic_map up to ${remaining} more level(s).`,
    'Each nested call MUST use a distinct JSONL input_path.',
    "Reusing an ancestor's input_path is a cycle and will fail immediately.",
    '</recursive-map-guidance>',
  ].join('\n')
}
