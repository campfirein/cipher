import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'

import {streamToText} from '../llm/stream-to-text.js'

/**
 * Result from abstract generation.
 */
export interface AbstractGenerateResult {
  /** L0: one-line summary (~80 tokens) */
  abstractContent: string
  /** L1: key points + structure (~1500 tokens) */
  overviewContent: string
}

const ABSTRACT_SYSTEM_PROMPT = `You are a technical documentation assistant.
Your job is to produce precise, factual summaries of knowledge documents.
Output only the requested content — no preamble, no commentary.`

const OVERVIEW_SYSTEM_PROMPT = `You are a technical documentation assistant.
Your job is to produce structured overviews of knowledge documents.
Preserve factual accuracy, surface important entities and decisions, and format the result in concise markdown.`

function buildAbstractPrompt(content: string): string {
  return `Produce a ONE-LINE summary (max 80 tokens) of the following knowledge document.
The line must be a complete sentence that captures the core topic and key insight.
Output only the single line — nothing else.

<document>
${content}
</document>`
}

function buildOverviewPrompt(content: string): string {
  return `Produce a structured overview of the following knowledge document.
Include:
- Key points (3-7 bullet points)
- Structure / sections summary
- Any notable entities, patterns, or decisions mentioned

Keep it under 1500 tokens. Use markdown formatting.
Output only the overview — no preamble.

<document>
${content}
</document>`
}

/** Truncate content before embedding in LLM prompts to avoid exceeding model context windows during bulk ingest. */
const MAX_ABSTRACT_CONTENT_CHARS = 20_000

/**
 * Per-file truncation when N files share a single batched call. Matches the
 * non-batched cap (20 KB) so each file gets the same view of its content
 * regardless of batched vs per-file mode — total batched user content scales
 * linearly with N. Avoids quality regression on long-file curates that batched
 * mode would otherwise see.
 */
const MAX_BATCHED_CONTENT_CHARS_PER_FILE = MAX_ABSTRACT_CONTENT_CHARS

/** L0 batch output budget: 5 files × ~80 tokens + framing tags ≈ 600 tokens. */
const BATCH_L0_MAX_OUTPUT_TOKENS = 800

/** L1 batch output budget: 5 files × ~1500 tokens + framing tags ≈ 8000 tokens. */
const BATCH_L1_MAX_OUTPUT_TOKENS = 8500

/**
 * Result from a batched abstract generation. One entry per input item, in
 * input order. Empty string fields signal the model failed to produce content
 * for that path — the caller's existing fail-open semantics still apply.
 */
export interface BatchedAbstractItem {
  abstractContent: string
  contextPath: string
  overviewContent: string
}

const BATCHED_ABSTRACT_SYSTEM_PROMPT = `You are a technical documentation assistant.
You produce precise one-line summaries of knowledge documents in a strict XML format.
Output ONLY the XML — no preamble, no commentary, no markdown fences.`

const BATCHED_OVERVIEW_SYSTEM_PROMPT = `You are a technical documentation assistant.
You produce structured overviews of knowledge documents in a strict XML format.
Output ONLY the XML — no preamble, no commentary, no markdown fences.`

function escapeXmlAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Wrap raw file content in a CDATA section so XML/HTML/JSX/markdown that
 * mentions `</document>` or `</file>` (perfectly normal for docs that describe
 * those formats) cannot terminate the envelope and conflate files. The inner
 * `]]>` escape is the standard CDATA-in-CDATA trick: split the sequence so it
 * never appears verbatim inside the active section.
 */
function wrapCdata(content: string): string {
  return `<![CDATA[${content.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

function buildBatchedAbstractPrompt(items: ReadonlyArray<{content: string; contextPath: string;}>): string {
  const filesXml = items.map((it) => `<file path="${escapeXmlAttr(it.contextPath)}">
<document>${wrapCdata(it.content)}</document>
</file>`).join('\n')

  return `For each of the following knowledge documents, produce a ONE-LINE summary (max 80 tokens) that is a complete sentence capturing the core topic and key insight.

Output format — emit exactly one <file> element per input file, with the same path attribute:
<file path="<path>"><abstract>One-line summary.</abstract></file>

Output only these XML elements, in any order. No preamble, no markdown fences.

<files>
${filesXml}
</files>`
}

function buildBatchedOverviewPrompt(items: ReadonlyArray<{content: string; contextPath: string;}>): string {
  const filesXml = items.map((it) => `<file path="${escapeXmlAttr(it.contextPath)}">
<document>${wrapCdata(it.content)}</document>
</file>`).join('\n')

  return `For each of the following knowledge documents, produce a structured overview (markdown, under 1500 tokens) that includes:
- Key points (3-7 bullet points)
- Structure / sections summary
- Any notable entities, patterns, or decisions mentioned

Output format — emit exactly one <file> element per input file, with the same path attribute:
<file path="<path>"><overview>
- bullet 1
- bullet 2
...
</overview></file>

Output only these XML elements, in any order. No preamble, no markdown fences.

<files>
${filesXml}
</files>`
}

/**
 * Extract <abstract>...</abstract> per <file path="..."> from the model output.
 * Tolerant: ignores extra whitespace, supports nested newlines inside the inner
 * tag. Returns a Map keyed by path. Paths that don't appear are absent.
 *
 * Anchored on `<file path="...">` openers (not `</file>` closers) so a model
 * overview that mentions `</file>` literally in prose — perfectly normal for
 * docs about XML, JSX, or build systems — cannot prematurely terminate the
 * outer match and orphan the inner tag. Each opener owns the response slice
 * up to the next opener (or end-of-string), and the inner regex extracts
 * the payload from that slice.
 */
function parseBatchedTags(response: string, innerTag: 'abstract' | 'overview'): Map<string, string> {
  const result = new Map<string, string>()
  const fileOpenerRe = /<file\s+path="([^"]*)"[^>]*>/g
  const innerRe = new RegExp(`<${innerTag}>([\\s\\S]*?)<\\/${innerTag}>`)

  const openers: Array<{bodyStart: number; rawPath: string}> = []
  let m: null | RegExpExecArray
  while ((m = fileOpenerRe.exec(response)) !== null) {
    openers.push({bodyStart: fileOpenerRe.lastIndex, rawPath: m[1]})
  }

  for (const [i, opener] of openers.entries()) {
    // Each opener's slice runs from its end to the start of the next opener
    // (or end-of-string). Within that slice, the inner regex picks up the
    // payload. A literal `</file>` in prose has no special meaning here.
    const sliceEnd = i + 1 < openers.length ? openers[i + 1].bodyStart : response.length
    const slice = response.slice(opener.bodyStart, sliceEnd)
    const inner = innerRe.exec(slice)
    if (inner) {
      const path = opener.rawPath
        .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
      result.set(path, inner[1].trim())
    }
  }

  return result
}

/**
 * Generate L0 abstract and L1 overview for a knowledge file.
 *
 * Makes two parallel LLM calls at temperature=0:
 *   1. L0 .abstract.md — one-line summary (~80 tokens)
 *   2. L1 .overview.md — key points + structure (~1500 tokens)
 *
 * @param fullContent - Full markdown content of the knowledge file
 * @param generator - LLM content generator
 * @returns Abstract and overview content strings
 */
export async function generateFileAbstracts(
  fullContent: string,
  generator: IContentGenerator,
): Promise<AbstractGenerateResult> {
  const truncated = fullContent.slice(0, MAX_ABSTRACT_CONTENT_CHARS)
  const [abstractText, overviewText] = await Promise.all([
    streamToText(generator, {
      config: {maxTokens: 150, temperature: 0},
      contents: [{content: buildAbstractPrompt(truncated), role: 'user'}],
      model: 'default',
      systemPrompt: ABSTRACT_SYSTEM_PROMPT,
      taskId: randomUUID(),
    }),
    streamToText(generator, {
      config: {maxTokens: 2000, temperature: 0},
      contents: [{content: buildOverviewPrompt(truncated), role: 'user'}],
      model: 'default',
      systemPrompt: OVERVIEW_SYSTEM_PROMPT,
      taskId: randomUUID(),
    }),
  ])

  return {
    abstractContent: abstractText.trim(),
    overviewContent: overviewText.trim(),
  }
}

/**
 * Generate L0 abstracts and L1 overviews for N knowledge files in two batched
 * LLM calls (one batch for all L0s, one for all L1s) instead of 2N per-file
 * calls.
 *
 * Two parallel calls; each call carries all input files in an XML envelope
 * and the model is instructed to return one element per file. Output is
 * parsed by path tag and matched back to the input order. Files the model
 * fails to produce content for receive empty strings (caller's existing
 * fail-open semantics still apply).
 *
 * Caller is responsible for capping batch size; this function does not split
 * its input. Recommended cap is 5 files per call to keep the L1 batch's
 * output budget under ~8K tokens.
 */
export async function generateFileAbstractsBatch(
  items: ReadonlyArray<{contextPath: string; fullContent: string}>,
  generator: IContentGenerator,
): Promise<BatchedAbstractItem[]> {
  if (items.length === 0) return []

  // Dedup by contextPath, keeping the LAST occurrence's content. The queue is
  // FIFO so later items carry the most recent fullContent — and the disk file
  // already reflects that write, so the abstract must summarize the latest
  // state rather than an intermediate one. Without this dedup, duplicate paths
  // emit two `<file path>` blocks the model may answer in either order; the
  // tag parser keys on path and Map-collapses, leaving non-deterministic
  // results for the duplicates.
  const byPath = new Map<string, {content: string; contextPath: string}>()
  for (const it of items) {
    byPath.set(it.contextPath, {
      content: it.fullContent.slice(0, MAX_BATCHED_CONTENT_CHARS_PER_FILE),
      contextPath: it.contextPath,
    })
  }

  const truncated = [...byPath.values()]

  const [abstractText, overviewText] = await Promise.all([
    streamToText(generator, {
      config: {maxTokens: BATCH_L0_MAX_OUTPUT_TOKENS, temperature: 0},
      contents: [{content: buildBatchedAbstractPrompt(truncated), role: 'user'}],
      model: 'default',
      systemPrompt: BATCHED_ABSTRACT_SYSTEM_PROMPT,
      taskId: randomUUID(),
    }),
    streamToText(generator, {
      config: {maxTokens: BATCH_L1_MAX_OUTPUT_TOKENS, temperature: 0},
      contents: [{content: buildBatchedOverviewPrompt(truncated), role: 'user'}],
      model: 'default',
      systemPrompt: BATCHED_OVERVIEW_SYSTEM_PROMPT,
      taskId: randomUUID(),
    }),
  ])

  const abstracts = parseBatchedTags(abstractText, 'abstract')
  const overviews = parseBatchedTags(overviewText, 'overview')

  return items.map((it) => ({
    abstractContent: (abstracts.get(it.contextPath) ?? '').trim(),
    contextPath: it.contextPath,
    overviewContent: (overviews.get(it.contextPath) ?? '').trim(),
  }))
}
