/**
 * Encode/decode helpers for search task content payloads.
 *
 * The transport layer's TaskCreateRequest has a single `content: string`
 * field. For search tasks, we pack {query, limit?, scope?} as JSON so
 * the agent process can reconstruct the structured options.
 *
 * Lives in shared/ because both the CLI (encoder) and the daemon
 * agent-process (decoder) depend on it. Keeping it in oclif/ would
 * create a circular dependency (server → oclif).
 */

/**
 * Encode search options as JSON content payload for the transport layer.
 */
export function encodeSearchContent(options: {limit?: number; query: string; scope?: string}): string {
  return JSON.stringify({
    limit: options.limit,
    query: options.query,
    scope: options.scope,
  })
}

/**
 * Parse a JSON-encoded search content payload back into options.
 * Falls back to treating the entire string as a plain query if parsing fails.
 */
export function decodeSearchContent(content: string): {limit?: number; query: string; scope?: string} {
  try {
    const parsed = JSON.parse(content) as {limit?: number; query?: string; scope?: string}
    return {
      limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
      query: typeof parsed.query === 'string' ? parsed.query : content,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
    }
  } catch {
    return {query: content}
  }
}
