/**
 * Regression guard: `rebindCurateTools` in cipher-agent.ts must thread
 * `runtimeSignalStore` through to the sandbox `CurateService`.
 *
 * Root cause of the original bug: `createCurateService(workingDirectory,
 * abstractQueue)` dropped the third optional arg, so agent-driven curate
 * (the real user flow via the LLM sandbox) silently skipped sidecar
 * seeds/bumps post-commit-5. The `tool-registry.ts` wiring at construction
 * time was correct; the session-start rebind replaced it with a broken one.
 *
 * Testing `rebindCurateTools` end-to-end requires bootstrapping a full
 * CipherAgent with an LLM config. We instead pin the wiring at the source
 * level — cheapest reliable guard against a future refactor re-dropping the
 * arg.
 */

import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {join} from 'node:path'

describe('cipher-agent.ts — rebindCurateTools sidecar wiring regression', () => {
  it('threads runtimeSignalStore into the sandbox CurateService at session start', async () => {
    const sourcePath = join(process.cwd(), 'src/agent/infra/agent/cipher-agent.ts')
    const source = await fs.readFile(sourcePath, 'utf8')

    // Anchor on the exact call-site token — unique, load-bearing, and
    // independent of surrounding comments. The 400-char window covers the
    // multi-line arg list.
    const anchor = source.indexOf('const newCurateService = createCurateService(')
    expect(anchor, 'newCurateService call in rebindCurateTools missing').to.be.greaterThan(-1)
    const window = source.slice(anchor, anchor + 400)

    expect(window, 'createCurateService must receive runtimeSignalStore').to.match(
      /createCurateService\([^)]*runtimeSignalStore/s,
    )
  })
})
