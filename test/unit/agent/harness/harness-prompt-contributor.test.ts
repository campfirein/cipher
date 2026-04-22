import {expect} from 'chai'

import type {
  HarnessMode,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'

import {
  contributeHarnessPrompt,
  type PromptContributionContext,
} from '../../../../src/agent/infra/harness/harness-prompt-contributor.js'

const TEST_VERSION_ID = 'v-test-123'

function makeVersion(): HarnessVersion {
  return {
    code: '/* placeholder */',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.45,
    id: TEST_VERSION_ID,
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*.ts'],
      version: 1,
    },
    projectId: 'p1',
    projectType: 'typescript',
    version: 1,
  }
}

function makeCtx(mode: HarnessMode): PromptContributionContext {
  return {mode, version: makeVersion()}
}

// Inline snapshot constants — avoids a new `chai-snapshot` devDep per
// the repo's dependency-minimization policy. If any of these change,
// the test fails with a clear diff and the reviewer must explicitly
// accept the new wording.
const SNAPSHOT_ASSISTED = `<harness-v2 mode="assisted" version="v-test-123">
A learned \`harness.curate(ctx)\` function is available for curate tasks in this project. It has been validated on recent invocations; call it when the task is a clean match for curate. For tasks that don't fit, orchestrate with \`tools.*\` as usual.
</harness-v2>`

const SNAPSHOT_FILTER = `<harness-v2 mode="filter" version="v-test-123">
A \`harness.curate(ctx)\` function is available for curate tasks here. When the task fits the harness, state your plan briefly and then invoke \`harness.curate(ctx)\`. If the harness approach does not fit this task, write your own orchestration instead.
</harness-v2>`

const SNAPSHOT_POLICY = `<harness-v2 mode="policy" version="v-test-123">
This project has a proven \`harness.curate(ctx)\` for curate tasks. For this request, invoke \`harness.curate(ctx)\` directly. Do NOT write your own orchestration code — the harness handles this end to end.
</harness-v2>`

describe('contributeHarnessPrompt', () => {
  // ── Empty path ────────────────────────────────────────────────────────────

  it('1. undefined context returns empty string', () => {
    expect(contributeHarnessPrompt()).to.equal('')
  })

  // ── Mode-specific structure ──────────────────────────────────────────────

  it('2. Mode A contains assisted tag + harness.curate reference, ≤ 600 chars', () => {
    const out = contributeHarnessPrompt(makeCtx('assisted'))
    expect(out).to.include('<harness-v2 mode="assisted"')
    expect(out).to.include('harness.curate(')
    expect(out.length).to.be.at.most(600)
  })

  it('3. Mode B mentions propose/plan workflow, ≤ 600 chars', () => {
    const out = contributeHarnessPrompt(makeCtx('filter'))
    expect(out).to.include('<harness-v2 mode="filter"')
    expect(out).to.match(/plan|propose/i)
    expect(out).to.include('harness.curate(')
    expect(out.length).to.be.at.most(600)
  })

  it('4. Mode C instructs autonomous call + forbids own orchestration, ≤ 600 chars', () => {
    const out = contributeHarnessPrompt(makeCtx('policy'))
    expect(out).to.include('<harness-v2 mode="policy"')
    expect(out).to.include('harness.curate(')
    // The "don't write your own" instruction is the load-bearing
    // Mode C directive — weak models tend to ignore it; pin it here.
    expect(out).to.match(/do not|don['’]t/i)
    expect(out.length).to.be.at.most(600)
  })

  // ── Version id attribute ──────────────────────────────────────────────────

  it('5. version id appears in the opening tag for all three modes', () => {
    for (const mode of ['assisted', 'filter', 'policy'] as const) {
      const out = contributeHarnessPrompt(makeCtx(mode))
      expect(out, `mode=${mode}`).to.include(`version="${TEST_VERSION_ID}"`)
    }
  })

  // ── Snapshot tests (drift catchers) ──────────────────────────────────────

  it('6a. Mode A output matches snapshot', () => {
    expect(contributeHarnessPrompt(makeCtx('assisted'))).to.equal(SNAPSHOT_ASSISTED)
  })

  it('6b. Mode B output matches snapshot', () => {
    expect(contributeHarnessPrompt(makeCtx('filter'))).to.equal(SNAPSHOT_FILTER)
  })

  it('6c. Mode C output matches snapshot', () => {
    expect(contributeHarnessPrompt(makeCtx('policy'))).to.equal(SNAPSHOT_POLICY)
  })

  // ── Stability ─────────────────────────────────────────────────────────────

  it('7. Mode A output is stable across calls', () => {
    const first = contributeHarnessPrompt(makeCtx('assisted'))
    const second = contributeHarnessPrompt(makeCtx('assisted'))
    expect(first).to.equal(second)
  })
})
