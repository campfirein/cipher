/**
 * Regression guard: `rebindMapTools` in cipher-agent.ts must wrap the
 * raw `mapGenerator` with `wrapWithUsageOnlyTelemetry({sessionTag:
 * 'map-extract'})` BEFORE passing it to:
 *   - `services.toolProvider.replaceTools([LLM_MAP, AGENTIC_MAP], {...})`
 *   - `services.sandboxService.setContentGenerator?.(...)`
 *
 * Root cause this guards: `tools.curation.mapExtract()`,
 * `tools.llmMap`, and `tools.agenticMap` all drive their LLM calls
 * through the generator set by these two wirings. Without the wrap,
 * those calls bypass the agent event bus and never reach UsageLogger
 * — silently undercounting per-chunk extraction tokens in any
 * cost-measurement experiment.
 *
 * Testing the runtime path end-to-end requires bootstrapping a full
 * CipherAgent. We pin the wiring at the source level — same approach
 * as `rebind-curate-tools-sidecar-wiring.test.ts`.
 */

import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {join} from 'node:path'

describe('cipher-agent.ts — rebindMapTools telemetry wiring regression', () => {
  let source: string

  before(async () => {
    const sourcePath = join(process.cwd(), 'src/agent/infra/agent/cipher-agent.ts')
    source = await fs.readFile(sourcePath, 'utf8')
  })

  it('wraps mapGenerator with wrapWithUsageOnlyTelemetry tagged map-extract', () => {
    // Anchor on the wrap call. Window covers the wrap's arg literal.
    const anchor = source.indexOf('wrapWithUsageOnlyTelemetry({')
    expect(anchor, 'no wrapWithUsageOnlyTelemetry call in cipher-agent.ts').to.be.greaterThan(-1)

    // There are multiple wrapWithUsageOnlyTelemetry call sites (abstract-queue,
    // compaction, map-extract). Assert at least one carries the map-extract tag
    // AND wraps `mapGenerator` (not the curate or compression generator).
    const mapExtractWrap = source.match(
      /wrapWithUsageOnlyTelemetry\(\{[^}]*?inner:\s*mapGenerator[^}]*?sessionTag:\s*'map-extract'[^}]*?\}\)/s,
    ) ?? source.match(
      /wrapWithUsageOnlyTelemetry\(\{[^}]*?sessionTag:\s*'map-extract'[^}]*?inner:\s*mapGenerator[^}]*?\}\)/s,
    )

    expect(
      mapExtractWrap,
      "rebindMapTools must wrap `mapGenerator` with sessionTag 'map-extract'",
    ).to.not.equal(null)
  })

  it('passes the metered (wrapped) map generator to replaceTools for LLM_MAP / AGENTIC_MAP', () => {
    // Anchor on the replaceTools call for the map tools, then check the arg.
    const anchor = source.indexOf('replaceTools(\n      [ToolName.LLM_MAP, ToolName.AGENTIC_MAP]')
    expect(anchor, 'replaceTools([LLM_MAP, AGENTIC_MAP]) call missing').to.be.greaterThan(-1)
    const window = source.slice(anchor, anchor + 400)

    expect(window, 'LLM_MAP/AGENTIC_MAP must receive the metered (wrapped) map generator').to.match(
      /contentGenerator:\s*meteredMapGenerator/,
    )
  })

  it('sets the metered (wrapped) map generator on the sandbox for tools.curation.mapExtract', () => {
    // Anchor on the setContentGenerator call inside rebindMapTools.
    const anchor = source.indexOf('services.sandboxService.setContentGenerator?.(')
    expect(anchor, 'sandboxService.setContentGenerator?. call missing').to.be.greaterThan(-1)
    const window = source.slice(anchor, anchor + 200)

    expect(window, 'sandbox setContentGenerator must receive the metered (wrapped) map generator').to.match(
      /setContentGenerator\?\.\(meteredMapGenerator\)/,
    )
  })
})
