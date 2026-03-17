// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsingTier = 'json-block' | 'key-value' | 'marker-based' | 'raw-json'

/**
 * Result of a successful parse attempt.
 */
export interface ParseResult<T> {
  /** Confidence score for this parse (0-1). */
  confidence: number

  /** The parsed value. */
  parsed: T

  /** Which tier succeeded. */
  strategy: ParsingTier
}

/**
 * Options for configuring the multi-strategy parser.
 */
export interface MultiStrategyParserOptions<T> {
  /** Which tiers to attempt, in order (default: all 4). */
  enabledTiers?: ParsingTier[]

  /** Optional validator — if provided, a tier's result must pass this check. */
  validator?: (parsed: unknown) => parsed is T
}

// ---------------------------------------------------------------------------
// Default tier order
// ---------------------------------------------------------------------------

const DEFAULT_TIERS: readonly ParsingTier[] = ['marker-based', 'json-block', 'raw-json', 'key-value']

// ---------------------------------------------------------------------------
// JSON repair helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to fix common JSON formatting issues from LLM output:
 * - Trailing commas before `]` or `}`
 * - Extra whitespace around commas
 *
 * Returns the repaired string (may still be invalid JSON).
 */
function repairJson(text: string): string {
  // Remove trailing commas: `,` followed by optional whitespace then `]` or `}`
  return text.replaceAll(/,\s*([}\]])/g, '$1')
}

// ---------------------------------------------------------------------------
// MultiStrategyParser
// ---------------------------------------------------------------------------

/**
 * 4-tier fallback parser for extracting structured data from LLM text responses.
 *
 * Tries tiers in order until one succeeds (parses + passes optional validator).
 * Designed to handle formatting inconsistencies across multiple LLM providers.
 *
 * Tiers:
 * 1. **marker-based** (0.95): `<!-- RESULT_START -->...<!-- RESULT_END -->`
 * 2. **json-block** (0.85): ````json ... ` `` `
 * 3. **raw-json** (0.6): outermost `{...}` or `[...]`
 * 4. **key-value** (0.3): `Key: value` line patterns
 */
export class MultiStrategyParser<T = unknown> {
  private readonly enabledTiers: readonly ParsingTier[]
  private readonly validator?: (parsed: unknown) => parsed is T

  constructor(options?: MultiStrategyParserOptions<T>) {
    this.enabledTiers = options?.enabledTiers ?? DEFAULT_TIERS
    this.validator = options?.validator
  }

  /**
   * Attempt to parse structured data from raw text.
   * Returns null if all enabled tiers fail.
   */
  public parse(text: string): null | ParseResult<T> {
    for (const tier of this.enabledTiers) {
      let result: null | ParseResult<T> = null

      switch (tier) {
        case 'json-block': {
          result = this.tryJsonBlock(text)

          break
        }

        case 'key-value': {
          result = this.tryKeyValue(text)

          break
        }

        case 'marker-based': {
          result = this.tryMarkerBased(text)

          break
        }

        case 'raw-json': {
          result = this.tryRawJson(text)

          break
        }
      }

      if (result) {
        return result
      }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Private tier implementations
  // ---------------------------------------------------------------------------

  /**
   * Tier 2: JSON code block parsing.
   * Looks for ```json ... ``` or ``` ... ``` blocks.
   */
  private tryJsonBlock(text: string): null | ParseResult<T> {
    // Try ```json first, then plain ```
    const jsonMatch = /```json\s*\n([\s\S]*?)\n\s*```/.exec(text)
    if (jsonMatch) {
      return this.tryParseJson(jsonMatch[1].trim(), 'json-block', 0.85)
    }

    const plainMatch = /```\s*\n([\s\S]*?)\n\s*```/.exec(text)
    if (plainMatch) {
      const content = plainMatch[1].trim()
      // Only try if it looks like JSON
      if (content.startsWith('{') || content.startsWith('[')) {
        return this.tryParseJson(content, 'json-block', 0.85)
      }
    }

    return null
  }

  /**
   * Tier 4: Key-value extraction.
   * Extracts `Key: value` patterns into a Record.
   */
  private tryKeyValue(text: string): null | ParseResult<T> {
    const kvPattern = /^([A-Za-z_]\w*)\s*:\s*(.+)$/gm
    const record: Record<string, string> = {}
    let matchCount = 0

    let kvMatch
    while ((kvMatch = kvPattern.exec(text)) !== null) {
      record[kvMatch[1]] = kvMatch[2].trim()
      matchCount++
    }

    if (matchCount === 0) {
      return null
    }

    if (this.validator) {
      if (!this.validator(record)) {
        return null
      }

      return {confidence: 0.3, parsed: record as T, strategy: 'key-value'}
    }

    return {confidence: 0.3, parsed: record as unknown as T, strategy: 'key-value'}
  }

  /**
   * Tier 1: Marker-based parsing.
   * Looks for `<!-- RESULT_START -->` ... `<!-- RESULT_END -->` markers.
   */
  private tryMarkerBased(text: string): null | ParseResult<T> {
    const match = /<!--\s*RESULT_START\s*-->([\s\S]*?)<!--\s*RESULT_END\s*-->/.exec(text)
    if (!match) {
      return null
    }

    return this.tryParseJson(match[1].trim(), 'marker-based', 0.95)
  }

  /**
   * Try to JSON.parse a string and validate with the optional validator.
   */
  private tryParseJson(jsonStr: string, strategy: ParsingTier, confidence: number): null | ParseResult<T> {
    // Try strict parse first, then repair malformed JSON (trailing commas, etc.)
    for (const candidate of [jsonStr, repairJson(jsonStr)]) {
      try {
        const parsed: unknown = JSON.parse(candidate)

        if (this.validator) {
          if (!this.validator(parsed)) {
            continue
          }

          return {confidence, parsed: parsed as T, strategy}
        }

        return {confidence, parsed: parsed as T, strategy}
      } catch {
        // Try next candidate
      }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Tier 3: Raw JSON parsing.
   * Looks for outermost `{...}` or `[...]` in the text.
   */
  private tryRawJson(text: string): null | ParseResult<T> {
    // Try array first (more specific), then object
    for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
      const startIdx = text.indexOf(open)
      if (startIdx === -1) {
        continue
      }

      // Find matching close bracket from the end
      const endIdx = text.lastIndexOf(close)
      if (endIdx <= startIdx) {
        continue
      }

      const candidate = text.slice(startIdx, endIdx + 1)
      const result = this.tryParseJson(candidate, 'raw-json', 0.6)
      if (result) {
        return result
      }
    }

    return null
  }
}
