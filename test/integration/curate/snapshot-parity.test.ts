/**
 * Phase 1 Task 1.0 / 1.8 — DAG plumbing-consistency snapshot test.
 *
 * ⚠️ SCOPE — read this before changing the test or trusting it as a parity
 * gate:
 *
 * What this test PROVES:
 *   - The 7-slot DAG runs end-to-end against representative fixture inputs.
 *   - Given identical stub services, the DAG produces byte-identical
 *     outputs at every slot edge across runs and across commits.
 *   - If a node implementation drifts (extract count aggregation, dedup
 *     thresholds, group bucket keys, etc.), this test catches the drift.
 *
 * What this test does NOT prove:
 *   - Behavioral parity vs the pre-cutover monolithic curate loop. The
 *     baselines are captured FROM the new DAG (using the same stub
 *     services for both capture and assertion); they are NOT captured
 *     from the old executor against a real LLM.
 *   - The original Phase 1 plan called for capturing snapshots from the
 *     pre-cutover executor across three fixture sizes with fact-set
 *     Jaccard, summary counts, LLM-call counts, and applied-operation
 *     checks. THAT WAS NOT DONE before the cutover landed. Doing it now
 *     would require reverting the cutover, capturing, and re-applying.
 *   - That `services-adapter.write` builds operations the real
 *     `executeCurate` accepts. See `services-adapter-live-write.test.ts`
 *     for that — it exercises the production write path against a real
 *     `executeCurate` writing to a tempdir, and catches regressions like
 *     the path-format bug uncovered in code review.
 *
 * The intended safety net for true behavioral parity is manual smoke-
 * testing against a real configured LLM provider on real codebases
 * during the dogfood window between Phase 1 and Phase 2. If the new
 * path produces visibly worse curations than the old loop, that needs
 * to surface before merging. This test cannot catch that.
 *
 * Two fixtures (small, large) — not three as the plan called for. The
 * medium fixture was dropped because chunked behavior is already
 * exercised by the large fixture and the marginal coverage didn't
 * justify the maintenance cost.
 */

import {expect} from 'chai'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {
  type NodeContext,
  type NodeServices,
  TopologicalCurationRunner,
} from '../../../src/agent/core/curation/flow/runner.js'
import {buildCurationDAG} from '../../../src/agent/infra/curation/flow/dag-builder.js'

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'curation')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.txt`), 'utf8')
}

function loadBaseline(name: string): {
  failures: unknown[]
  fixture: {bytes: number; path: string}
  outputs: Record<string, unknown>
} {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `baseline-${name}.json`), 'utf8'))
}

// SAME stub services as in scripts/capture-curate-baseline.ts.
// If you change one, change both, then re-run capture and commit the
// updated baseline JSON.
function makeStubServices(): NodeServices {
  return {
    detectConflicts: async (facts) => ({
      decisions: facts.map((fact) => ({action: 'add' as const, fact})),
    }),
    async extract(chunk, _taskId) {
      const facts: Array<{statement: string; subject: string}> = []
      if (chunk.includes('JWT')) {
        facts.push({statement: 'Auth uses JWT in httpOnly cookies', subject: 'auth'})
      }

      if (chunk.includes('PostgreSQL')) {
        facts.push({statement: 'Database is PostgreSQL 15', subject: 'database'})
      }

      if (chunk.includes('rate limit') || chunk.includes('rate-limit')) {
        facts.push({statement: 'Rate limit is 100/min per IP', subject: 'rate-limit'})
      }

      return {facts, failed: 0, succeeded: facts.length, total: 1}
    },
    write: async (decisions) => ({
      applied: decisions.map((d) => ({
        confidence: 'high' as const,
        impact: 'low' as const,
        needsReview: false,
        path: `${d.fact.subject ?? 'misc'}/${d.fact.statement.slice(0, 30)}.md`,
        reason: 'baseline capture',
        status: 'success' as const,
        type: 'ADD' as const,
      })),
      summary: {added: decisions.length, deleted: 0, failed: 0, merged: 0, updated: 0},
    }),
  }
}

async function runDagAgainstFixture(label: string): Promise<{
  failures: ReadonlyArray<unknown>
  outputs: Record<string, unknown>
}> {
  const context = loadFixture(label)
  const ctx: NodeContext = {
    initialInput: {context, existing: [], history: {}, meta: {}},
    services: makeStubServices(),
    taskId: `baseline-${label}`,
  }

  const dag = buildCurationDAG()
  const runner = new TopologicalCurationRunner()
  const result = await runner.run(dag, ctx)

  return {
    failures: result.failures,
    outputs: Object.fromEntries(result.outputs.entries()),
  }
}

describe('curate DAG — snapshot parity', () => {
  for (const label of ['small', 'large']) {
    describe(`${label} fixture`, () => {
      it('matches the committed baseline (failures empty)', async () => {
        const result = await runDagAgainstFixture(label)
        const baseline = loadBaseline(label)

        expect(result.failures).to.deep.equal(baseline.failures)
      })

      it('produces matching recon output', async () => {
        const result = await runDagAgainstFixture(label)
        const baseline = loadBaseline(label)

        expect(result.outputs.recon).to.deep.equal(baseline.outputs.recon)
      })

      it('produces matching chunk output (totalChunks + chunks)', async () => {
        const result = await runDagAgainstFixture(label)
        const baseline = loadBaseline(label)

        expect(result.outputs.chunk).to.deep.equal(baseline.outputs.chunk)
      })

      it('produces matching extract output (facts + counts)', async () => {
        const result = await runDagAgainstFixture(label)
        const baseline = loadBaseline(label)

        expect(result.outputs.extract).to.deep.equal(baseline.outputs.extract)
      })

      it('produces matching group + dedup outputs', async () => {
        const result = await runDagAgainstFixture(label)
        const baseline = loadBaseline(label)

        expect(result.outputs.group).to.deep.equal(baseline.outputs.group)
        expect(result.outputs.dedup).to.deep.equal(baseline.outputs.dedup)
      })

      it('produces matching write summary', async () => {
        const result = await runDagAgainstFixture(label)
        const baseline = loadBaseline(label)

        expect(result.outputs.write).to.deep.equal(baseline.outputs.write)
      })
    })
  }
})
