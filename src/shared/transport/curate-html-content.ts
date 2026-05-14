/**
 * Encode/decode helpers for curate-html-direct task content payloads.
 *
 * Sibling to `query-tool-mode-content.ts`. The transport layer's
 * `TaskCreateRequest` has a single `content: string` field; curate
 * tool mode packs `{html, confirmOverwrite?}` as JSON so the daemon
 * dispatcher can reconstruct the structured options.
 *
 * Lives in `shared/` because the MCP tool (encoder) and the daemon
 * agent-process (decoder) both depend on it.
 */

/**
 * Encode curate-html-direct options as a JSON content payload.
 */
export function encodeCurateHtmlContent(options: {confirmOverwrite?: boolean; html: string}): string {
  return JSON.stringify({
    confirmOverwrite: options.confirmOverwrite,
    html: options.html,
  })
}

/**
 * Parse a JSON-encoded curate-html-direct content payload back into
 * options. Throws on malformed payload — curate-html-direct is brand-new
 * and has no legacy callers, so a parse failure almost certainly means
 * the MCP build and daemon are on incompatible versions. Letting that
 * surface as a `task:error` (outer `success: false`) is much easier for
 * the calling agent to diagnose than silently treating the entire JSON
 * string as a literal HTML payload.
 */
export function decodeCurateHtmlContent(content: string): {confirmOverwrite?: boolean; html: string} {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      'curate-html-direct payload is not valid JSON — likely an MCP/daemon version mismatch. Rebuild byterover-cli to align the encoder and decoder.',
    )
  }

  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as {html?: unknown}).html !== 'string') {
    throw new Error('curate-html-direct payload is missing a string `html` field.')
  }

  const {confirmOverwrite, html} = parsed as {confirmOverwrite?: unknown; html: string}
  return {
    confirmOverwrite: typeof confirmOverwrite === 'boolean' ? confirmOverwrite : undefined,
    html,
  }
}
