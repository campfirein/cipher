/**
 * Phase 2 Task 2.5 — curate-flow bench harness.
 *
 * Opt-in: skipped unless `BENCH=1` is set. Not run by CI.
 *
 * Goal: track wall-clock + per-slot timings + LLM-call counts as the
 * curate-flow DAG evolves (Phase 2 fan-out, Phase 3 agent-supplied
 * code, Phase 4 harness promotion). Stub services use a fixed
 * artificial per-chunk latency so the fan-out improvement is visible
 * without a real LLM connection.
 *
 * Usage:
 *
 *   BENCH=1 npx mocha test/benchmarks/curate-flow.bench.ts
 *
 * Writes a JSON results file under
 *   test/benchmarks/results/curate-flow-<timestamp>.json
 *
 * The Phase 1 baseline (sequential extract) is committed at
 *   test/benchmarks/results/curate-flow-phase1-baseline.json so future
 *   runs can compare against it without re-running history.
 */

import {expect} from 'chai'
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {MetricsCollector} from '../../src/agent/core/curation/flow/metrics.js'
import {
  type NodeContext,
  type NodeServices,
  TopologicalCurationRunner,
} from '../../src/agent/core/curation/flow/runner.js'
import {buildCurationDAG} from '../../src/agent/infra/curation/flow/dag-builder.js'

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'curation')
const RESULTS_DIR = join(process.cwd(), 'test', 'benchmarks', 'results')

const PER_CHUNK_LATENCY_MS = 50 // synthetic LLM round-trip

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function makeStubServices(): NodeServices & {readonly llmCallCount: () => number} {
  let calls = 0
  return {
    async detectConflicts(facts) {
      calls++
      return {decisions: facts.map((fact) => ({action: 'add' as const, fact}))}
    },
    async extract(chunk, _taskId) {
      calls++
      await delay(PER_CHUNK_LATENCY_MS)
      const facts: Array<{statement: string; subject: string}> = []
      if (chunk.includes('JWT')) facts.push({statement: 'Auth uses JWT in httpOnly cookies', subject: 'auth'})
      if (chunk.includes('PostgreSQL')) facts.push({statement: 'Database is PostgreSQL 15', subject: 'database'})
      if (chunk.includes('rate limit') || chunk.includes('rate-limit'))
        facts.push({statement: 'Rate limit is 100/min per IP', subject: 'rate-limit'})
      return {facts, failed: 0, succeeded: facts.length, total: 1}
    },
    llmCallCount: () => calls,
    write: async (decisions) => ({
      applied: decisions.map((d) => ({
        confidence: 'high' as const,
        impact: 'low' as const,
        needsReview: false,
        path: `${d.fact.subject ?? 'misc'}/${d.fact.statement.slice(0, 30)}.md`,
        reason: 'bench',
        status: 'success' as const,
        type: 'ADD' as const,
      })),
      summary: {added: decisions.length, deleted: 0, failed: 0, merged: 0, updated: 0},
    }),
  }
}

interface FixtureResult {
  bytes: number
  fixture: string
  llmCallCount: number
  perSlotMs: Record<string, number>
  totalChunks: number
  wallClockMs: number
}

async function runOnce(label: string, fixturePath: string, extractConcurrency: number): Promise<FixtureResult> {
  const context = readFileSync(fixturePath, 'utf8')
  const services = makeStubServices()
  const taskId = `bench-${label}-c${extractConcurrency}`
  const collector = new MetricsCollector(taskId)

  const ctx: NodeContext = {
    extractConcurrency,
    initialInput: {context, history: {}, meta: {}},
    metricsCollector: collector,
    sandboxed: true,
    services,
    taskId,
  }

  const start = Date.now()
  const dag = buildCurationDAG()
  const result = await new TopologicalCurationRunner().run(dag, ctx)
  const wallClockMs = Date.now() - start

  const {totalChunks} = (result.outputs.get('chunk') as {totalChunks: number})
  return {
    bytes: context.length,
    fixture: label,
    llmCallCount: services.llmCallCount(),
    perSlotMs: collector.emit().nodeTimings,
    totalChunks,
    wallClockMs,
  }
}

const BENCH_ENABLED = process.env.BENCH === '1'

;(BENCH_ENABLED ? describe : describe.skip)('curate-flow bench (opt-in: BENCH=1)', function () {
  this.timeout(60_000)

  const fixtures = ['small', 'large', 'xlarge'] as const
  const results: Array<{concurrency: number; result: FixtureResult}> = []

  for (const fixture of fixtures) {
    // c=1 baseline (sequential), c=4 Phase 2 default, c=8 Phase 2.5 R-5 default.
    for (const concurrency of [1, 4, 8]) {
      it(`${fixture} fixture @ extractConcurrency=${concurrency}`, async () => {
        const fixturePath = join(FIXTURES_DIR, `${fixture}.txt`)
        const r = await runOnce(fixture, fixturePath, concurrency)
        results.push({concurrency, result: r})

        // Sanity: results should be plausible (positive durations, > 0 chunks).
        expect(r.wallClockMs).to.be.greaterThan(0)
        expect(r.totalChunks).to.be.greaterThan(0)

        process.stdout.write(
          `  → ${fixture} (${r.bytes}B, ${r.totalChunks} chunks) c=${concurrency}: ` +
            `${r.wallClockMs}ms wall, ${r.llmCallCount} llm calls\n`,
        )
      })
    }
  }

  after(() => {
    const ts = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const outPath = join(RESULTS_DIR, `curate-flow-${ts}.json`)
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          perChunkLatencyMs: PER_CHUNK_LATENCY_MS,
          results,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
    process.stdout.write(`\n  Wrote ${outPath}\n`)
  })
})
