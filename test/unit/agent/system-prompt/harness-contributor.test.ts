import {expect} from 'chai'

import type {
  HarnessMode,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {ContributorContext} from '../../../../src/agent/core/domain/system-prompt/types.js'

import {HarnessContributor} from '../../../../src/agent/infra/system-prompt/contributors/harness-contributor.js'

function makeVersion(): HarnessVersion {
  return {
    code: '/* placeholder */',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.45,
    id: 'v-test-contrib',
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

function ctxWith(mode?: HarnessMode, version?: HarnessVersion): ContributorContext {
  return {harnessMode: mode, harnessVersion: version}
}

describe('HarnessContributor (system-prompt wrapper)', () => {
  const contributor = new HarnessContributor()

  it('1. default id and priority match the Phase 5 Task 5.4 registration contract', () => {
    expect(contributor.id).to.equal('harness')
    expect(contributor.priority).to.equal(18)
  })

  it('2. constructor accepts custom id + priority', () => {
    const custom = new HarnessContributor('custom-id', 42)
    expect(custom.id).to.equal('custom-id')
    expect(custom.priority).to.equal(42)
  })

  it('3. returns empty string when harnessMode is undefined', async () => {
    const out = await contributor.getContent(ctxWith(undefined, makeVersion()))
    expect(out).to.equal('')
  })

  it('4. returns empty string when harnessVersion is undefined', async () => {
    const out = await contributor.getContent(ctxWith('assisted'))
    expect(out).to.equal('')
  })

  it('5. returns empty string when BOTH are undefined', async () => {
    const out = await contributor.getContent(ctxWith())
    expect(out).to.equal('')
  })

  it('6. renders the assisted prompt when mode+version present', async () => {
    const out = await contributor.getContent(ctxWith('assisted', makeVersion()))
    expect(out).to.include('<harness-v2 mode="assisted"')
    expect(out).to.include('version="v-test-contrib"')
    expect(out).to.include('harness.curate(')
  })

  it('7. renders the filter prompt (harness-first framing) when mode=filter', async () => {
    const out = await contributor.getContent(ctxWith('filter', makeVersion()))
    expect(out).to.include('<harness-v2 mode="filter"')
    expect(out).to.match(/invoke|obtain|call/i)
    expect(out).to.match(/result|proposal|returned/i)
  })

  it('8. renders the policy prompt (forbids own orchestration) when mode=policy', async () => {
    const out = await contributor.getContent(ctxWith('policy', makeVersion()))
    expect(out).to.include('<harness-v2 mode="policy"')
    expect(out).to.match(/do not|don['’]t/i)
  })
})
