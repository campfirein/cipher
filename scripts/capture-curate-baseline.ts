/**
 * Phase 1 Task 1.0 — capture parity baseline.
 *
 * One-off script (NOT run by CI). Builds large.txt from small.txt by
 * repetition, then runs the default curate DAG against each fixture using
 * deterministic stub services, and writes the resulting outputs to JSON
 * snapshot files.
 *
 * The snapshots document the DAG's edge-by-edge behavior under controlled
 * inputs. The Phase 1 snapshot-parity test (`snapshot-parity.test.ts`)
 * runs the same DAG against the same stubs and asserts matching outputs.
 *
 * Behavioral parity vs today's monolithic curate loop is NOT in scope of
 * Phase 1 — it requires real-LLM benchmarks against today's behavior on
 * the same data, which is non-deterministic and not blocking the cutover.
 *
 * Run: npx ts-node-esm scripts/capture-curate-baseline.ts
 *      (or use the equivalent ts-node-with-loader invocation)
 */

import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {
  type NodeContext,
  type NodeServices,
  TopologicalCurationRunner,
} from '../src/agent/core/curation/flow/runner.js'
import {buildCurationDAG} from '../src/agent/infra/curation/flow/dag-builder.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = join(__dirname, '..', 'test', 'fixtures', 'curation')

const SMALL_PATH = join(FIXTURES_DIR, 'small.txt')
const LARGE_PATH = join(FIXTURES_DIR, 'large.txt')
const XLARGE_PATH = join(FIXTURES_DIR, 'xlarge.txt')

const SMALL_BASELINE_PATH = join(FIXTURES_DIR, 'baseline-small.json')
const LARGE_BASELINE_PATH = join(FIXTURES_DIR, 'baseline-large.json')

const LARGE_REPEAT_TIMES = 25 // ~62 KB — clearly chunked
const LARGE_REPEAT_TIMES_XL = 60 // ~150 KB — Phase 2 bench target (15+ chunks)

// ---------------------------------------------------------------------------
// Generate large fixture from small (idempotent — overwrite each run)
// ---------------------------------------------------------------------------

const small = readFileSync(SMALL_PATH, 'utf8')
const large = Array.from({length: LARGE_REPEAT_TIMES}, (_, i) =>
  small.replaceAll('[USER]:', `[USER session-${i + 1}]:`).replaceAll('[ASSISTANT]:', `[ASSISTANT session-${i + 1}]:`),
).join('\n\n---\n\n')
writeFileSync(LARGE_PATH, large)

console.log(`Wrote ${LARGE_PATH} (${large.length} bytes)`)

// xlarge: only used by `BENCH=1 npm test`; not committed as a baseline
// JSON because it's tracked by the bench harness, not the snapshot test.
const xlarge = Array.from({length: LARGE_REPEAT_TIMES_XL}, (_, i) =>
  small.replaceAll('[USER]:', `[USER session-${i + 1}]:`).replaceAll('[ASSISTANT]:', `[ASSISTANT session-${i + 1}]:`),
).join('\n\n---\n\n')
writeFileSync(XLARGE_PATH, xlarge)

console.log(`Wrote ${XLARGE_PATH} (${xlarge.length} bytes)`)

// ---------------------------------------------------------------------------
// Deterministic stub services — same per run, so baselines are stable.
// ---------------------------------------------------------------------------

function makeStubServices(): NodeServices {
  return {
    detectConflicts: async (facts) => ({
      decisions: facts.map((fact) => ({action: 'add' as const, fact})),
    }),
    async extract(chunk, _taskId) {
      // Synthetic extraction: pull two facts per chunk based on string content.
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

      return {
        facts,
        failed: 0,
        succeeded: facts.length,
        total: 1,
      }
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
      summary: {
        added: decisions.length,
        deleted: 0,
        failed: 0,
        merged: 0,
        updated: 0,
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// Run DAG against a fixture and capture outputs
// ---------------------------------------------------------------------------

async function captureBaseline(label: string, fixturePath: string, outPath: string): Promise<void> {
  const context = readFileSync(fixturePath, 'utf8')
  const ctx: NodeContext = {
    initialInput: {context, history: {}, meta: {}},
    services: makeStubServices(),
    taskId: `baseline-${label}`,
  }

  const dag = buildCurationDAG()
  const runner = new TopologicalCurationRunner()
  const result = await runner.run(dag, ctx)

  const baseline = {
    failures: result.failures,
    fixture: {
      bytes: context.length,
      path: `test/fixtures/curation/${label}.txt`,
    },
    outputs: Object.fromEntries(
      [...result.outputs.entries()].map(([k, v]) => [k, v]),
    ),
  }

  writeFileSync(outPath, JSON.stringify(baseline, null, 2))
  console.log(`Wrote ${outPath}`)
  console.log(`  recon.suggestedMode: ${(baseline.outputs.recon as {suggestedMode: string}).suggestedMode}`)
  console.log(`  chunk.totalChunks: ${(baseline.outputs.chunk as {totalChunks: number}).totalChunks}`)
  console.log(`  extract.facts: ${(baseline.outputs.extract as {facts: unknown[]}).facts.length}`)
  console.log(`  write.summary: ${JSON.stringify((baseline.outputs.write as {summary: unknown}).summary)}`)
}

await captureBaseline('small', SMALL_PATH, SMALL_BASELINE_PATH)
await captureBaseline('large', LARGE_PATH, LARGE_BASELINE_PATH)

console.log('\nBaseline capture complete.')
