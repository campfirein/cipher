/**
 * Deprecation telemetry tests (Phase 5 Task 5.5).
 *
 * Each `brv-query` MCP invocation writes one JSONL line to
 * `<dataDir>/telemetry/mcp-deprecation.jsonl`. Used to decide when
 * MCP-side `brv_query` usage is low enough to remove the path.
 *
 * Critical invariants:
 *  - Honors `BRV_DATA_DIR` env override
 *  - Best-effort: telemetry write failures must NOT throw or block the handler
 *  - Append-only (one line per invocation)
 *  - Each line carries timestamp + counter name + tool name (queryable with `jq`)
 */

import {expect} from 'chai'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {recordLegacyQueryInvocation} from '../../../../../src/server/infra/mcp/tools/deprecation-telemetry.js'

describe('deprecation-telemetry', () => {
  let originalDataDir: string | undefined
  let tempDir: string

  beforeEach(() => {
    originalDataDir = process.env.BRV_DATA_DIR
    tempDir = mkdtempSync(join(tmpdir(), 'brv-deprecation-telemetry-'))
    process.env.BRV_DATA_DIR = tempDir
  })

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.BRV_DATA_DIR
    } else {
      process.env.BRV_DATA_DIR = originalDataDir
    }

    rmSync(tempDir, {force: true, recursive: true})
  })

  describe('recordLegacyQueryInvocation', () => {
    it('writes one JSONL line to <dataDir>/telemetry/mcp-deprecation.jsonl', () => {
      recordLegacyQueryInvocation()

      const file = join(tempDir, 'telemetry', 'mcp-deprecation.jsonl')
      expect(existsSync(file)).to.equal(true)

      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      expect(lines).to.have.length(1)

      const entry = JSON.parse(lines[0]) as {counter: string; tool: string; ts: string}
      expect(entry.counter).to.equal('mcp.query.legacy_invocations')
      expect(entry.tool).to.equal('brv-query')
      expect(entry.ts).to.match(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('appends — multiple invocations produce multiple lines', () => {
      recordLegacyQueryInvocation()
      recordLegacyQueryInvocation()
      recordLegacyQueryInvocation()

      const file = join(tempDir, 'telemetry', 'mcp-deprecation.jsonl')
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      expect(lines).to.have.length(3)
    })

    it('honors BRV_DATA_DIR override (does NOT write to default ~/.brv)', () => {
      recordLegacyQueryInvocation()

      // Default location should remain untouched
      const file = join(tempDir, 'telemetry', 'mcp-deprecation.jsonl')
      expect(existsSync(file)).to.equal(true)
    })

    it('creates the telemetry/ subdirectory if missing', () => {
      // tempDir exists but tempDir/telemetry/ does not — exercise mkdir branch
      recordLegacyQueryInvocation()

      const dir = join(tempDir, 'telemetry')
      expect(existsSync(dir)).to.equal(true)
    })

    it('does NOT throw when the data dir is unwritable (best-effort)', () => {
      // Point at a path that exists as a file (so mkdirSync recursive will fail)
      const blockingFile = join(tempDir, 'blocking-file')
      writeFileSync(blockingFile, 'not a dir')
      process.env.BRV_DATA_DIR = blockingFile

      // Must not throw — telemetry failures are silent
      expect(() => recordLegacyQueryInvocation()).to.not.throw()
    })
  })
})
