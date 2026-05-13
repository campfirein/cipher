/**
 * Encode/decode helpers for query-tool-mode task content payloads.
 *
 * Sibling to `search-content.ts`. The transport layer's
 * TaskCreateRequest has a single `content: string` field; tool-mode
 * query packs {query, limit?} as JSON so the agent process can
 * reconstruct the structured options.
 *
 * Lives in shared/ because both the CLI (encoder) and the daemon
 * agent-process (decoder) depend on it.
 */

/**
 * Encode tool-mode query options as JSON content payload.
 */
export function encodeQueryToolModeContent(options: {limit?: number; query: string}): string {
  return JSON.stringify({
    limit: options.limit,
    query: options.query,
  })
}

/**
 * Parse a JSON-encoded tool-mode query content payload back into
 * options. Falls back to treating the entire string as a plain query
 * if parsing fails — matches the lenient pattern used by
 * `decodeSearchContent` so a malformed payload still surfaces the
 * caller's intent.
 */
export function decodeQueryToolModeContent(content: string): {limit?: number; query: string} {
  try {
    const parsed = JSON.parse(content) as {limit?: number; query?: string}
    return {
      limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
      query: typeof parsed.query === 'string' ? parsed.query : content,
    }
  } catch {
    return {query: content}
  }
}
