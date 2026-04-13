import {expect} from 'chai'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {DreamOperation} from '../../../../../src/server/infra/dream/dream-log-schema.js'

import {synthesize, type SynthesizeDeps} from '../../../../../src/server/infra/dream/operations/synthesize.js'

/** Helper: create a markdown file with optional frontmatter */
async function createMdFile(dir: string, relativePath: string, body: string, frontmatter?: Record<string, unknown>): Promise<void> {
  const fullPath = join(dir, relativePath)
  await mkdir(join(fullPath, '..'), {recursive: true})
  let content = body
  if (frontmatter) {
    const {dump} = await import('js-yaml')
    const yaml = dump(frontmatter, {flowLevel: 1, lineWidth: -1, sortKeys: true}).trimEnd()
    content = `---\n${yaml}\n---\n${body}`
  }

  await writeFile(fullPath, content, 'utf8')
}

/** Build a canned LLM response */
function llmResponse(syntheses: Array<{claim: string; confidence?: number; evidence: Array<{domain: string; fact: string}>; placement: string; title: string}>): string {
  return '```json\n' + JSON.stringify({syntheses}) + '\n```'
}

/** Narrow DreamOperation to SYNTHESIZE variant */
function asSynthesize(op: DreamOperation) {
  expect(op.type).to.equal('SYNTHESIZE')
  return op as Extract<DreamOperation, {type: 'SYNTHESIZE'}>
}

describe('synthesize', () => {
  let ctxDir: string
  let agent: {
    createTaskSession: SinonStub
    deleteTaskSession: SinonStub
    executeOnSession: SinonStub
    setSandboxVariableOnSession: SinonStub
  }
  let searchService: {search: SinonStub}
  let deps: SynthesizeDeps

  beforeEach(async () => {
    ctxDir = join(tmpdir(), `brv-synthesize-test-${Date.now()}`)
    await mkdir(ctxDir, {recursive: true})

    agent = {
      createTaskSession: stub().resolves('session-1'),
      deleteTaskSession: stub().resolves(),
      executeOnSession: stub().resolves('```json\n{"syntheses":[]}\n```'),
      setSandboxVariableOnSession: stub(),
    }

    searchService = {
      search: stub().resolves({results: [], totalFound: 0}),
    }

    deps = {agent: agent as unknown as ICipherAgent, contextTreeDir: ctxDir, searchService, taskId: 'test-task'}
  })

  afterEach(() => {
    restore()
  })

  // ── Preconditions ─────────────────────────────────────────────────────────

  it('returns empty array when < 2 domains have _index.md', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth Summary', {type: 'summary'})

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  it('returns empty array for empty context tree', async () => {
    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
  })

  it('skips directories starting with _ or .', async () => {
    await createMdFile(ctxDir, '_archived/_index.md', '# Archived', {type: 'summary'})
    await createMdFile(ctxDir, '.hidden/_index.md', '# Hidden', {type: 'summary'})
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })

  // ── LLM interaction ───────────────────────────────────────────────────────

  it('creates session and passes domain summaries to LLM', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth Summary', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API Summary', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([]))

    await synthesize(deps)

    expect(agent.createTaskSession.calledOnce).to.be.true
    expect(agent.setSandboxVariableOnSession.called).to.be.true
    expect(agent.deleteTaskSession.calledOnce).to.be.true
  })

  it('returns empty array when LLM finds nothing', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([]))

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
  })

  it('returns empty array on LLM failure', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.rejects(new Error('LLM timeout'))

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
    expect(agent.deleteTaskSession.calledOnce).to.be.true
  })

  // ── Synthesis file creation ───────────────────────────────────────────────

  it('creates synthesis file in placement domain', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth Summary', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API Summary', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Both auth and API share token validation logic.',
      confidence: 0.85,
      evidence: [{domain: 'auth', fact: 'JWT validation'}, {domain: 'api', fact: 'Token middleware'}],
      placement: 'auth',
      title: 'Shared Token Validation',
    }]))

    const results = await synthesize(deps)

    expect(results).to.have.lengthOf(1)
    const op = asSynthesize(results[0])
    expect(op.action).to.equal('CREATE')
    expect(op.outputFile).to.equal('auth/shared-token-validation.md')
    expect(op.confidence).to.equal(0.85)
    expect(op.sources).to.include('auth/_index.md')
    expect(op.sources).to.include('api/_index.md')

    const content = await readFile(join(ctxDir, 'auth/shared-token-validation.md'), 'utf8')
    expect(content).to.include('type: synthesis')
    expect(content).to.include('maturity: draft')
    expect(content).to.include('Shared Token Validation')
    expect(content).to.include('Both auth and API share token validation logic.')
  })

  it('writes correct frontmatter fields', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Test claim.',
      confidence: 0.7,
      evidence: [{domain: 'auth', fact: 'Fact A'}, {domain: 'api', fact: 'Fact B'}],
      placement: 'api',
      title: 'Test Synthesis',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)

    const content = await readFile(join(ctxDir, 'api/test-synthesis.md'), 'utf8')
    expect(content).to.include('confidence:')
    expect(content).to.include('sources:')
    expect(content).to.include('synthesized_at:')
    expect(content).to.include('auth/_index.md')
    expect(content).to.include('api/_index.md')
  })

  it('writes evidence section in body', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'infra/_index.md', '# Infra', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Cross-cutting concern.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'Uses Redis sessions'}, {domain: 'infra', fact: 'Redis cluster config'}],
      placement: 'infra',
      title: 'Redis Dependency',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)

    const content = await readFile(join(ctxDir, 'infra/redis-dependency.md'), 'utf8')
    expect(content).to.include('## Evidence')
    expect(content).to.include('**auth**')
    expect(content).to.include('Uses Redis sessions')
    expect(content).to.include('**infra**')
    expect(content).to.include('Redis cluster config')
  })

  // ── Deduplication ─────────────────────────────────────────────────────────

  it('skips candidate when existing synthesis scores > 0.5', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})
    // Existing synthesis file — dedup only matches against these
    await createMdFile(ctxDir, 'auth/existing-synthesis.md', '# Existing', {type: 'synthesis'})

    searchService.search.resolves({
      results: [{path: 'auth/existing-synthesis.md', score: 0.9, title: 'Existing'}],
      totalFound: 1,
    })

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Already documented.',
      confidence: 0.8,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'Existing Pattern',
    }]))

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
  })

  it('creates file when no existing synthesis files exist (dedup skipped)', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    // High score but against non-synthesis files — should NOT dedup
    searchService.search.resolves({
      results: [{path: 'auth/regular-doc.md', score: 0.9, title: 'Regular Doc'}],
      totalFound: 1,
    })

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Novel insight.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'New Pattern',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)
  })

  it('creates file when search hits non-synthesis files only', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})
    await createMdFile(ctxDir, 'auth/existing-synthesis.md', '# Existing', {type: 'synthesis'})

    // High score but path doesn't match any synthesis file
    searchService.search.resolves({
      results: [{path: 'auth/unrelated.md', score: 0.95, title: 'Unrelated'}],
      totalFound: 1,
    })

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Novel insight.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'New Pattern',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)
  })

  // ── Existing synthesis & collision ────────────────────────────────────────

  it('lists existing synthesis files in LLM prompt', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})
    await createMdFile(ctxDir, 'auth/existing-synthesis.md', '# Existing', {type: 'synthesis'})

    agent.executeOnSession.resolves(llmResponse([]))

    await synthesize(deps)

    const prompt = agent.executeOnSession.firstCall.args[1]
    expect(prompt).to.include('auth/existing-synthesis.md')
  })

  it('skips file creation on name collision', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})
    // Pre-create a file that would collide
    await createMdFile(ctxDir, 'auth/shared-pattern.md', '# Pre-existing content')

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'This would collide.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'Shared Pattern',
    }]))

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])

    // Original file unchanged
    const content = await readFile(join(ctxDir, 'auth/shared-pattern.md'), 'utf8')
    expect(content).to.include('Pre-existing content')
  })

  // ── Multiple candidates ───────────────────────────────────────────────────

  it('creates multiple synthesis files from one LLM call', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})
    await createMdFile(ctxDir, 'infra/_index.md', '# Infra', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([
      {
        claim: 'First insight.',
        confidence: 0.85,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: 'auth',
        title: 'Pattern One',
      },
      {
        claim: 'Second insight.',
        confidence: 0.7,
        evidence: [{domain: 'api', fact: 'C'}, {domain: 'infra', fact: 'D'}],
        placement: 'infra',
        title: 'Pattern Two',
      },
    ]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(2)
    expect(results.map((r) => asSynthesize(r).outputFile)).to.include('auth/pattern-one.md')
    expect(results.map((r) => asSynthesize(r).outputFile)).to.include('infra/pattern-two.md')
  })

  // ── Slugify ───────────────────────────────────────────────────────────────

  it('slugifies title for filename (special chars, max 80 chars)', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Test.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'Complex Title: With Special (Characters) & More!',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)
    const op = asSynthesize(results[0])
    expect(op.outputFile).to.match(/^auth\/[a-z0-9-]+\.md$/)
    expect(op.outputFile.length).to.be.lessThanOrEqual(80 + 'auth/'.length + '.md'.length)
  })

  // ── needsReview ───────────────────────────────────────────────────────────

  it('sets needsReview=true when confidence < 0.7', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Low confidence.',
      confidence: 0.5,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'Uncertain Pattern',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)
    expect(results[0].needsReview).to.be.true
  })

  it('sets needsReview=false when confidence >= 0.7', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'High confidence.',
      confidence: 0.85,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: 'auth',
      title: 'Confident Pattern',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)
    expect(results[0].needsReview).to.be.false
  })

  // ── Signal abort ──────────────────────────────────────────────────────────

  it('respects abort signal', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    const controller = new AbortController()
    controller.abort()

    const results = await synthesize({...deps, signal: controller.signal})
    expect(results).to.deep.equal([])
    expect(agent.createTaskSession.called).to.be.false
  })
})
