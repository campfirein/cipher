/**
 * Deprecation telemetry (Phase 5 Task 5.5).
 *
 * One JSONL line per legacy `brv-query` MCP invocation, written to
 * `<dataDir>/telemetry/mcp-deprecation.jsonl`. Used to track adoption of
 * the new Phase 5 tools (`brv-search` + `brv-gather` + `brv-record-answer`)
 * so we can decide when MCP-side `brv_query` usage has dropped low enough
 * to remove the legacy tool entirely.
 *
 * Honors `BRV_DATA_DIR` per the standard data-dir convention. Best-effort —
 * never throws; telemetry failures must not block the query handler.
 *
 * Lives in its own module (rather than inline in `brv-query-tool.ts`) so it
 * can be unit-tested independently and so future deprecation flows (e.g.,
 * other legacy MCP tools) can reuse the same writer.
 */

import {appendFileSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'

import {getGlobalDataDir} from '../../../utils/global-data-path.js'

const TELEMETRY_DIR = 'telemetry'
const TELEMETRY_FILE = 'mcp-deprecation.jsonl'

/**
 * Record one invocation of the deprecated `brv-query` MCP tool.
 * Called from the tool handler before transport routing, so failed legacy
 * calls also count as legacy usage (adoption metrics aren't skewed by errors).
 *
 * Failures are swallowed: if the data dir is unwritable, telemetry is lost
 * but the user's query is not blocked.
 */
export function recordLegacyQueryInvocation(): void {
  try {
    const dir = join(getGlobalDataDir(), TELEMETRY_DIR)
    mkdirSync(dir, {recursive: true})
    const line = JSON.stringify({
      counter: 'mcp.query.legacy_invocations',
      tool: 'brv-query',
      ts: new Date().toISOString(),
    })
    appendFileSync(join(dir, TELEMETRY_FILE), line + '\n', 'utf8')
  } catch {
    // Best-effort: never block the handler on telemetry failure.
  }
}
