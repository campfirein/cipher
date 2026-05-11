import {expect} from 'chai'
import {promises as fs} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {ChannelTestHarness, parseJson} from '../helpers/channel-test-harness.js'
import {makeTempContextTree} from '../helpers/temp-context-tree.js'
import {makeTempDir, removeTempDir} from '../helpers/temp-dir.js'

// Slice 2.1: capability-gated lookback rendering. The host MUST choose the
// block shape based on `agentCapabilities.promptCapabilities.embeddedContext`
// (CHANNEL_PROTOCOL.md §5.2) and MUST honour the §8.4 user-prompt placement
// precedence (lookback first, then normalised prompt blocks as-is, with a
// trailing text block synthesised ONLY when the request supplied `prompt: string`).

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const MOCK_ACP_PATH = resolve(HARNESS_DIR, '..', 'fixtures', 'mock-acp.js')
const MOCK_EMBEDDED_PATH = resolve(HARNESS_DIR, '..', 'fixtures', 'mock-acp-embedded-context.js')

type CapturedPrompt = {
  prompt: Array<{text?: string; type: string; uri?: string}>
}

const readCapture = async (path: string): Promise<CapturedPrompt[]> => {
  const raw = await fs.readFile(path, 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as CapturedPrompt)
}

describe('Channel Phase 2 — capability-gated lookback', function () {
  this.timeout(120_000)

  let harness: ChannelTestHarness
  let projectDir: string
  let captureFile: string

  beforeEach(async () => {
    projectDir = await makeTempContextTree()
    const captureDir = await makeTempDir('brv-mock-acp-capture-')
    captureFile = join(captureDir, 'prompts.jsonl')
    harness = await ChannelTestHarness.boot({projectDir})
  })

  afterEach(async () => {
    await harness.shutdown()
    await removeTempDir(projectDir)
  })

  it('baseline agent: lookback rendered as text block; user prompt is the trailing text', async () => {
    expect((await harness.run('channel new pi-test')).exitCode).to.equal(0)
    expect(
      (await harness.run(`channel invite pi-test @mock -- node ${MOCK_ACP_PATH}`, {
        env: {MOCK_ACP_CAPTURE_FILE: captureFile},
      })).exitCode,
    ).to.equal(0)

    // First, a passive post to give the channel some prior history.
    expect((await harness.run('channel post pi-test "first message"')).exitCode).to.equal(0)

    const mention = await harness.run('channel mention pi-test "@mock hello" --no-wait --json', {
      env: {MOCK_ACP_CAPTURE_FILE: captureFile},
    })
    expect(mention.exitCode, mention.stderr).to.equal(0)
    const accepted = parseJson<{turn: {turnId: string}}>(mention.stdout)
    await harness.pollForTerminal('pi-test', accepted.turn.turnId)

    const captures = await readCapture(captureFile)
    expect(captures.length).to.be.greaterThan(0)
    const {prompt} = (captures.at(-1)!)

    // Baseline: prior turns → first block is a text block carrying `## brv channel lookback`.
    expect(prompt[0].type).to.equal('text')
    expect(prompt[0].text).to.match(/## brv channel lookback/)
    // §8.4: when prompt: string was supplied, host appends a trailing text block.
    expect(prompt.at(-1)?.type).to.equal('text')
    expect(prompt.at(-1)?.text).to.equal('@mock hello')
  })

  it('embeddedContext agent: lookback rendered as resource block', async () => {
    expect((await harness.run('channel new pi-test')).exitCode).to.equal(0)
    expect(
      (await harness.run(`channel invite pi-test @mock -- node ${MOCK_EMBEDDED_PATH}`, {
        env: {MOCK_ACP_CAPTURE_FILE: captureFile},
      })).exitCode,
    ).to.equal(0)

    expect((await harness.run('channel post pi-test "first message"')).exitCode).to.equal(0)

    const mention = await harness.run('channel mention pi-test "@mock hello" --no-wait --json', {
      env: {MOCK_ACP_CAPTURE_FILE: captureFile},
    })
    expect(mention.exitCode).to.equal(0)
    const accepted = parseJson<{turn: {turnId: string}}>(mention.stdout)
    await harness.pollForTerminal('pi-test', accepted.turn.turnId)

    const captures = await readCapture(captureFile)
    const {prompt} = (captures.at(-1)!)
    expect(prompt[0].type).to.equal('resource')
    expect(prompt.at(-1)?.type).to.equal('text')
    expect(prompt.at(-1)?.text).to.equal('@mock hello')
  })
})
