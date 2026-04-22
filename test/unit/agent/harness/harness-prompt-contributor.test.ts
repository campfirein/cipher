import {expect} from 'chai'

import type {
  HarnessMode,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'

import {HarnessModeSchema} from '../../../../src/agent/core/domain/harness/types.js'
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
A validated \`harness.curate(ctx)\` function is available for curate tasks here. Invoke it to obtain the harness's proposed result, then review the returned value before treating it as final. Prefer the harness's proposal unless you identify a specific issue with the output; only then adjust or replace it.
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

  it('3. Mode B frames harness output as the proposal and LLM as reviewer, ≤ 600 chars', () => {
    // Authoritative source: v1-design-decisions.md §2.2 and types.ts
    // line 30 both say filter = "LLM reviews harness proposals". The
    // harness is PROPOSING; the LLM is REVIEWING the output. Pin the
    // harness-first framing to catch any drift back to LLM-first.
    const out = contributeHarnessPrompt(makeCtx('filter'))
    expect(out).to.include('<harness-v2 mode="filter"')
    expect(out).to.include('harness.curate(')
    // Harness-first: "invoke…obtain…" directs the LLM to call first.
    expect(out).to.match(/invoke|obtain|call/i)
    // Review-after semantics: reviewing must apply to the RETURNED
    // VALUE / RESULT / PROPOSAL, not to the task upfront.
    expect(out).to.match(/result|proposal|returned/i)
    expect(out).to.match(/review/i)
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

  it('5. version id appears in the opening tag for every HarnessMode', () => {
    // Iterate over the schema's options rather than a hardcoded list
    // so a new mode added to the enum is automatically covered.
    for (const mode of HarnessModeSchema.options) {
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

  // ── XML-attribute safety ─────────────────────────────────────────────────

  it('8. version id with special characters is escaped in the tag', () => {
    // Version ids are randomUUID() in production today (always safe)
    // but this is defense-in-depth for a future where ids come from
    // elsewhere. Phase 7 CLI will parse these tags; malformed XML
    // would break silently without this escape.
    const version = {...makeVersion(), id: 'v-"broken&<>'}
    const out = contributeHarnessPrompt({mode: 'assisted', version})

    // The raw specials must NOT appear in the emitted attribute.
    expect(out).to.not.include('v-"broken')
    // Expected encoded form:
    expect(out).to.include('version="v-&quot;broken&amp;&lt;&gt;"')
  })
})
