import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {AbstractGenerationQueue} from '../../../../src/agent/infra/map/abstract-queue.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFailingGenerator(sandbox: SinonSandbox): IContentGenerator {
  return {
    estimateTokensSync: () => 10,
    generateContent: sandbox.stub().rejects(new Error('LLM unavailable')),
    generateContentStream: sandbox.stub().rejects(new Error('LLM unavailable')),
  } as unknown as IContentGenerator
}

/**
 * Stream stub that responds in the XML format expected by H3's batched generator.
 * Sniffs the request's user content for `<file path="..."` tokens and emits one
 * `<file path="X"><abstract|overview>generated text</...></file>` per detected
 * path. The L0 vs L1 branch is detected from the system prompt.
 */
function makeSuccessfulGenerator(sandbox: SinonSandbox): IContentGenerator {
  return {
    estimateTokensSync: () => 10,
    generateContent: sandbox.stub().rejects(new Error('n/a')),
    generateContentStream: sandbox.stub().callsFake(async function *(request: {contents?: Array<{content?: string}>; systemPrompt?: string}) {
      const userContent = request.contents?.[0]?.content ?? ''
      const isAbstract = (request.systemPrompt ?? '').includes('one-line')
      const innerTag = isAbstract ? 'abstract' : 'overview'
      const pathMatches = [...userContent.matchAll(/<file\s+path="([^"]+)"/g)]
      const paths = pathMatches.length > 0 ? pathMatches.map((m) => m[1]) : ['unknown']
      const xml = paths.map((p) => `<file path="${p}"><${innerTag}>generated text</${innerTag}></file>`).join('\n')
      yield {content: xml, isComplete: false}
      yield {isComplete: true}
    }),
  } as unknown as IContentGenerator
}

/**
 * Returns a generator whose first generateContent call is frozen until
 * `rejectNextCall` is invoked. Useful for inspecting mid-flight queue state.
 */
function makeControlledGenerator(sandbox: SinonSandbox): {
  generator: IContentGenerator
  rejectNextCall: (err: Error) => void
} {
  let capturedReject: ((err: Error) => void) | undefined

  return {
    generator: {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().rejects(new Error('n/a')),
      generateContentStream: sandbox.stub().callsFake(async function *() {
        await new Promise<never>((_, rej) => { capturedReject = rej })
        yield {content: '', isComplete: true}
      }),
    } as unknown as IContentGenerator,
    rejectNextCall: (err: Error) => capturedReject?.(err),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AbstractGenerationQueue', () => {
  const sandbox = createSandbox()
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    // .brv directory must exist for status-file writes
    await fs.mkdir(join(tmpDir, '.brv'), {recursive: true})
  })

  afterEach(async () => {
    sandbox.restore()
    await fs.rm(tmpDir, {force: true, recursive: true}).catch(() => {})
  })

  // ── getStatus() ────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('reports correct empty initial state', () => {
      const q = new AbstractGenerationQueue(tmpDir)
      expect(q.getStatus()).to.deep.equal({failed: 0, pending: 0, processed: 0, processing: false})
    })

    it('increments pending immediately when no generator is set', () => {
      const q = new AbstractGenerationQueue(tmpDir)
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})
      expect(q.getStatus().pending).to.equal(1)
    })

    it('ignores helper files that should never generate abstracts', () => {
      const q = new AbstractGenerationQueue(tmpDir)
      q.enqueue({contextPath: join(tmpDir, 'context.md'), fullContent: 'helper'})
      q.enqueue({contextPath: join(tmpDir, '_index.md'), fullContent: 'summary'})
      expect(q.getStatus().pending).to.equal(0)
    })

    it('includes items in retry backoff in the pending count', async () => {
      const {generator, rejectNextCall} = makeControlledGenerator(sandbox)
      const q = new AbstractGenerationQueue(tmpDir, 2) // maxAttempts=2 → one retry

      q.setGenerator(generator)
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})

      // scheduleNext fires via setImmediate; processNext is now awaiting generateFileAbstracts
      await new Promise<void>((r) => { setImmediate(r) })
      expect(q.getStatus().processing).to.equal(true)

      // Trigger failure — processNext catch fires: retrying++, setTimeout(500ms backoff)
      rejectNextCall(new Error('deliberate failure'))
      // Two setImmediate ticks: one for the catch block, one for the finally block
      await new Promise<void>((r) => { setImmediate(r) })
      await new Promise<void>((r) => { setImmediate(r) })

      // Item is now in retry backoff: retrying=1, pending=[]
      // Before fix: getStatus().pending was 0 (retrying items invisible)
      // After fix:  getStatus().pending is 1 (retrying items folded into pending)
      const status = q.getStatus()
      expect(status.processing).to.equal(false)
      expect(status.pending).to.equal(1)
      expect(status.failed).to.equal(0)
    })
  })

  // ── drain() ────────────────────────────────────────────────────────────────

  describe('drain()', () => {
    it('resolves immediately when the queue is empty', async () => {
      const q = new AbstractGenerationQueue(tmpDir)
      await q.drain() // must not hang
    })

    it('fails open when onBeforeProcess throws and still processes the item', async () => {
      const q = new AbstractGenerationQueue(tmpDir)
      const contextPath = join(tmpDir, 'file.md')
      const onBeforeProcess = sandbox.stub().rejects(new Error('refresh unavailable'))

      q.setGenerator(makeSuccessfulGenerator(sandbox))
      q.setBeforeProcess(onBeforeProcess)
      q.enqueue({contextPath, fullContent: 'content'})

      await q.drain()

      expect(onBeforeProcess.calledOnce).to.be.true
      expect(q.getStatus()).to.deep.equal({failed: 0, pending: 0, processed: 1, processing: false})
      expect(await fs.readFile(contextPath.replace(/\.md$/, '.abstract.md'), 'utf8')).to.equal('generated text')
      expect(await fs.readFile(contextPath.replace(/\.md$/, '.overview.md'), 'utf8')).to.equal('generated text')
    })

    it('resolves after maxAttempts exhausted with no retry (maxAttempts=1)', async function () {
      this.timeout(3000)

      const q = new AbstractGenerationQueue(tmpDir, 1) // fail once, then done
      q.setGenerator(makeFailingGenerator(sandbox))
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})

      await q.drain()

      expect(q.getStatus().failed).to.equal(1)
      expect(q.getStatus().pending).to.equal(0)
      expect(q.getStatus().processing).to.equal(false)
    })

    it('does not resolve while items are in retry backoff', async () => {
      const {generator, rejectNextCall} = makeControlledGenerator(sandbox)
      const q = new AbstractGenerationQueue(tmpDir, 2)

      q.setGenerator(generator)
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})

      // Let processNext start
      await new Promise<void>((r) => { setImmediate(r) })
      // Trigger failure → item enters retry backoff
      rejectNextCall(new Error('fail'))
      await new Promise<void>((r) => { setImmediate(r) })
      await new Promise<void>((r) => { setImmediate(r) })

      // drain() must not resolve while retrying=1
      let drainResolved = false
      const drainPromise = q.drain().then(() => { drainResolved = true })

      await new Promise<void>((r) => { setImmediate(r) })
      expect(drainResolved).to.equal(false)

      // Suppress unhandled rejection; test passes if drainResolved stayed false
      drainPromise.catch(() => {})
    })
  })

  // ── status file ────────────────────────────────────────────────────────────

  describe('status file', () => {
    it('writes _queue_status.json on enqueue', async () => {
      const q = new AbstractGenerationQueue(tmpDir)
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})

      // Status file is written via fire-and-forget writeFile; give it time to flush to disk
      await new Promise<void>((r) => { setTimeout(r, 50) })

      const statusPath = join(tmpDir, '.brv', '_queue_status.json')
      const raw = await fs.readFile(statusPath, 'utf8')
      const written = JSON.parse(raw) as {pending: number}
      expect(written.pending).to.equal(1)
    })

    it('creates the .brv directory on first status write', async () => {
      await fs.rm(join(tmpDir, '.brv'), {force: true, recursive: true})

      const q = new AbstractGenerationQueue(tmpDir)
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})

      await new Promise<void>((r) => { setTimeout(r, 50) })

      const raw = await fs.readFile(join(tmpDir, '.brv', '_queue_status.json'), 'utf8')
      const written = JSON.parse(raw) as {pending: number}
      expect(written.pending).to.equal(1)
    })

    it('processes up to BATCH_SIZE_CAP items in a single LLM cycle', async () => {
      const successfulGenerator = makeSuccessfulGenerator(sandbox)
      const q = new AbstractGenerationQueue(tmpDir)
      q.setGenerator(successfulGenerator)

      const N = 5
      for (let i = 0; i < N; i++) {
        q.enqueue({contextPath: join(tmpDir, `f${i}.md`), fullContent: `content ${i}`})
      }

      await q.drain()

      // 1 batch * 2 LLM calls (L0 + L1) = exactly 2 stream calls for N=5
      const stub = successfulGenerator.generateContentStream as ReturnType<typeof sandbox.stub>
      expect(stub.callCount).to.equal(2, 'Expected exactly 2 LLM stream calls for a 5-item batch (1×L0 + 1×L1)')
      expect(q.getStatus()).to.deep.equal({failed: 0, pending: 0, processed: N, processing: false})

      // Every file gets its abstract.md and overview.md written
      const fileChecks = Array.from({length: N}, async (_, i) => {
        const abstractPath = join(tmpDir, `f${i}.abstract.md`)
        const overviewPath = join(tmpDir, `f${i}.overview.md`)
        const [abstractText, overviewText] = await Promise.all([
          fs.readFile(abstractPath, 'utf8'),
          fs.readFile(overviewPath, 'utf8'),
        ])
        expect(abstractText).to.equal('generated text')
        expect(overviewText).to.equal('generated text')
      })
      await Promise.all(fileChecks)
    })

    it('splits oversized backlogs into multiple batches', async () => {
      const successfulGenerator = makeSuccessfulGenerator(sandbox)
      const q = new AbstractGenerationQueue(tmpDir)
      q.setGenerator(successfulGenerator)

      const N = 7  // > BATCH_SIZE_CAP=5 → expect 2 batches (5 + 2)
      for (let i = 0; i < N; i++) {
        q.enqueue({contextPath: join(tmpDir, `f${i}.md`), fullContent: `content ${i}`})
      }

      await q.drain()

      const stub = successfulGenerator.generateContentStream as ReturnType<typeof sandbox.stub>
      // 2 batches × 2 LLM calls each = 4 stream calls
      expect(stub.callCount).to.equal(4, 'Expected 4 stream calls for 7 items split into batches of 5+2')
      expect(q.getStatus().processed).to.equal(N)
    })

    it('status file reflects retrying items in pending count', async () => {
      const {generator, rejectNextCall} = makeControlledGenerator(sandbox)
      const q = new AbstractGenerationQueue(tmpDir, 2)

      q.setGenerator(generator)
      q.enqueue({contextPath: join(tmpDir, 'file.md'), fullContent: 'content'})

      await new Promise<void>((r) => { setImmediate(r) })
      rejectNextCall(new Error('fail'))
      await new Promise<void>((r) => { setImmediate(r) })
      await new Promise<void>((r) => { setImmediate(r) })

      // Status file is written during retrying++ branch — wait for disk I/O to flush
      await new Promise<void>((r) => { setTimeout(r, 50) })

      const statusPath = join(tmpDir, '.brv', '_queue_status.json')
      const raw = await fs.readFile(statusPath, 'utf8')
      const written = JSON.parse(raw) as {pending: number; processing: boolean}
      expect(written.pending).to.equal(1) // retrying item must appear in status file
      expect(written.processing).to.equal(false)
    })
  })
})
