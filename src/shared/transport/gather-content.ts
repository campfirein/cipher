/**
 * Encode/decode helpers for `gather` task content payloads.
 *
 * The transport layer's TaskCreateRequest has a single `content: string`
 * field. For gather tasks (Phase 5 Task 5.3), we pack
 * {query, limit?, scope?, tokenBudget?} as JSON so the daemon's
 * GatherExecutor can reconstruct the structured options.
 *
 * Lives in shared/ because both the CLI (encoder, brv gather command)
 * and the daemon agent-process (decoder) depend on it.
 */

export interface GatherContentPayload {
  limit?: number
  query: string
  scope?: string
  tokenBudget?: number
}

export function encodeGatherContent(options: GatherContentPayload): string {
  return JSON.stringify({
    limit: options.limit,
    query: options.query,
    scope: options.scope,
    tokenBudget: options.tokenBudget,
  })
}

/**
 * Parse a JSON-encoded gather content payload back into options.
 * Falls back to treating the entire string as a plain query if parsing fails.
 */
export function decodeGatherContent(content: string): GatherContentPayload {
  try {
    const parsed = JSON.parse(content) as Partial<GatherContentPayload>
    return {
      limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
      query: typeof parsed.query === 'string' ? parsed.query : content,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
      tokenBudget: typeof parsed.tokenBudget === 'number' ? parsed.tokenBudget : undefined,
    }
  } catch {
    return {query: content}
  }
}
