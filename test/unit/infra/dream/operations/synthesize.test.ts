import {expect} from 'chai'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, type SinonStub, stub} from 'sinon'

import type {ICipherAgent} from '../../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IRuntimeSignalStore} from '../../../../../src/server/core/interfaces/storage/i-runtime-signal-store.js'
import type {DreamOperation} from '../../../../../src/server/infra/dream/dream-log-schema.js'

import {synthesize, type SynthesizeDeps} from '../../../../../src/server/infra/dream/operations/synthesize.js'
import {createMockRuntimeSignalStore} from '../../../../helpers/mock-factories.js'

/** Helper: create a markdown file with optional frontmatter */
async function createMdFile(dir: string, relativePath: string, body: string, frontmatter?: Record<string, unknown>): Promise<void> {
  const fullPath = join(dir, relativePath)
  await mkdir(join(fullPath, '..'), {recursive: true})
  let content = body
  if (frontmatter) {
    const {dump} = await import('js-yaml')
    const yaml = dump(frontmatter, {flowLevel: 1, lineWidth: -1, sortKeys: false}).trimEnd()
    content = `---\n${yaml}\n---\n${body}`
  }

  await writeFile(fullPath, content, 'utf8')
}

/**
 * Build a canned LLM response. Tests only need to specify what they're
 * exercising — summary/tags/keywords default to placeholders so the zod
 * schema parses without forcing every test to repeat them.
 */
function llmResponse(syntheses: Array<{
  claim: string;
  confidence?: number;
  evidence: Array<{domain: string; fact: string}>;
  keywords?: string[];
  placement: string;
  summary?: string;
  tags?: string[];
  title: string;
}>): string {
  const withDefaults = syntheses.map((s) => ({
    keywords: ['test-keyword'],
    summary: 'Test summary.',
    tags: ['test-tag'],
    ...s,
  }))
  return '```json\n' + JSON.stringify({syntheses: withDefaults}) + '\n```'
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
    // Domain summaries are inlined directly in the prompt (no sandbox variable).
    const prompt = agent.executeOnSession.firstCall.args[1] as string
    expect(prompt).to.include('DOMAIN: auth')
    expect(prompt).to.include('# Auth Summary')
    expect(prompt).to.include('DOMAIN: api')
    expect(prompt).to.include('# API Summary')
    // The prompt must instruct the model to produce the semantic fields the
    // web UI's card-mode display needs (summary/tags/keywords); without
    // them, synthesized files render with empty preview slots.
    expect(prompt).to.match(/"summary"/)
    expect(prompt).to.match(/"tags"/)
    expect(prompt).to.match(/"keywords"/)
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
    expect(content).to.not.include('maturity:')
    expect(content).to.include('Shared Token Validation')
    expect(content).to.include('Both auth and API share token validation logic.')
  })

  it('writes the 7 semantic frontmatter fields plus synthesis markers', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Test claim.',
      confidence: 0.7,
      evidence: [{domain: 'auth', fact: 'Fact A'}, {domain: 'api', fact: 'Fact B'}],
      keywords: ['authentication', 'tokens'],
      placement: 'api',
      summary: 'Both auth and API share token validation logic.',
      tags: ['security', 'cross-cutting'],
      title: 'Test Synthesis',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)

    const content = await readFile(join(ctxDir, 'api/test-synthesis.md'), 'utf8')

    // Semantic fields — required by the web UI's card-mode display
    expect(content).to.include('title: Test Synthesis')
    expect(content).to.include('summary: Both auth and API share token validation logic.')
    // Arrays MUST render in flow style ([a, b, c]) so on-disk output matches
    // markdown-writer.ts; reverting flowLevel to 2 would fail this assertion.
    expect(content).to.match(/^tags: \[/m)
    expect(content).to.match(/^keywords: \[/m)
    expect(content).to.include('security')
    expect(content).to.include('cross-cutting')
    expect(content).to.include('authentication')
    expect(content).to.include('tokens')
    expect(content).to.include('related:')
    expect(content).to.include('createdAt:')
    expect(content).to.include('updatedAt:')

    // Synthesis markers — kept for traceability and review gating
    expect(content).to.include('confidence:')
    expect(content).to.include('sources:')
    expect(content).to.include('synthesized_at:')
    expect(content).to.include('type: synthesis')
    expect(content).to.include('auth/_index.md')
    expect(content).to.include('api/_index.md')

    // Sidecar fields must not bleed into markdown frontmatter
    expect(content).to.not.include('maturity:')
    expect(content).to.not.include('importance:')
  })

  it('normalizes tags to lowercase kebab-case', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Test.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      keywords: ['x'],
      placement: 'auth',
      summary: 'A summary.',
      // Mixed-case + multi-word tags — should be normalized at write time so
      // card chips and BM25 search see consistent labels regardless of
      // whether the model followed the prompt's "lowercase, kebab-case" rule.
      tags: ['Auth Service', 'JWT-Validation', '  cross-cutting  '],
      title: 'Tag Normalization Test',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)

    const content = await readFile(join(ctxDir, 'auth/tag-normalization-test.md'), 'utf8')
    expect(content).to.include('auth-service')
    expect(content).to.include('jwt-validation')
    expect(content).to.include('cross-cutting')
    expect(content).to.not.include('Auth Service')
    expect(content).to.not.include('JWT-Validation')
  })

  it('emits frontmatter parseable as the regular semantic shape', async () => {
    const {load: yamlLoad} = await import('js-yaml')

    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Test.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      keywords: ['x', 'y'],
      placement: 'auth',
      summary: 'A summary.',
      tags: ['z'],
      title: 'Strict Test',
    }]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)

    const content = await readFile(join(ctxDir, 'auth/strict-test.md'), 'utf8')
    const yamlBlock = content.match(/^---\n([\S\s]+?)\n---/)?.[1]
    expect(yamlBlock).to.be.a('string')
    const parsed = yamlLoad(yamlBlock ?? '')
    expect(parsed).to.be.an('object').and.not.null

    // Cogit's Go parser populates DtoV3MemoryCardResource fields from these
    // YAML keys (summary→short_description, related→relateds,
    // updatedAt→last_updated_at). All seven must be present and well-typed.
    expect(parsed).to.have.property('title').that.is.a('string')
    expect(parsed).to.have.property('summary').that.is.a('string')
    expect(parsed).to.have.property('tags').that.is.an('array')
    expect(parsed).to.have.property('keywords').that.is.an('array')
    expect(parsed).to.have.property('related').that.is.an('array')
    expect(parsed).to.have.property('createdAt').that.is.a('string')
    expect(parsed).to.have.property('updatedAt').that.is.a('string')
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

  // ── Path traversal ────────────────────────────────────────────────────────

  it('rejects candidate with path-traversal placement', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    agent.executeOnSession.resolves(llmResponse([{
      claim: 'Malicious placement.',
      confidence: 0.9,
      evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
      placement: '../../etc',
      title: 'Escape Attempt',
    }]))

    const results = await synthesize(deps)
    expect(results).to.deep.equal([])
  })

  // ── Partial write failure ────────────────────────────────────────────────

  it('preserves successful results when a later candidate fails to write', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    // First candidate writes to 'auth' (valid), second to path-traversal (rejected)
    agent.executeOnSession.resolves(llmResponse([
      {
        claim: 'Good insight.',
        confidence: 0.9,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: 'auth',
        title: 'Valid Pattern',
      },
      {
        claim: 'Bad placement.',
        confidence: 0.9,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: '../../tmp',
        title: 'Invalid Pattern',
      },
    ]))

    const results = await synthesize(deps)
    expect(results).to.have.lengthOf(1)
    expect(asSynthesize(results[0]).outputFile).to.equal('auth/valid-pattern.md')
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

  it('passes abort signal to executeOnSession', async () => {
    await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
    await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

    const controller = new AbortController()
    agent.executeOnSession.resolves(llmResponse([]))

    await synthesize({...deps, signal: controller.signal})

    expect(agent.executeOnSession.calledOnce).to.be.true
    const options = agent.executeOnSession.firstCall.args[2]
    expect(options).to.have.property('signal', controller.signal)
  })

  // ── Runtime-signal sidecar ──────────────────────────────────────────────

  describe('runtime-signal sidecar', () => {
    let signalStore: IRuntimeSignalStore

    beforeEach(() => {
      signalStore = createMockRuntimeSignalStore()
    })

    it('does not write maturity to markdown frontmatter', async () => {
      await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
      await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

      agent.executeOnSession.resolves(llmResponse([{
        claim: 'Cross-domain pattern.',
        confidence: 0.9,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: 'auth',
        title: 'Sidecar Test',
      }]))

      await synthesize({...deps, runtimeSignalStore: signalStore})

      const content = await readFile(join(ctxDir, 'auth/sidecar-test.md'), 'utf8')
      expect(content).to.not.include('maturity:')
      expect(content).to.not.include('importance:')
      expect(content).to.not.include('recency:')
      expect(content).to.not.include('accessCount:')
      expect(content).to.not.include('updateCount:')
    })

    it('seeds sidecar with default signals after writing synthesis file', async () => {
      await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
      await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

      agent.executeOnSession.resolves(llmResponse([{
        claim: 'Pattern.',
        confidence: 0.85,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: 'auth',
        title: 'Seeded Pattern',
      }]))

      const setSpy = stub(signalStore, 'set').callThrough()

      await synthesize({...deps, runtimeSignalStore: signalStore})

      expect(setSpy.calledOnce).to.be.true
      expect(setSpy.firstCall.args[0]).to.equal('auth/seeded-pattern.md')
      const signals = await signalStore.get('auth/seeded-pattern.md')
      expect(signals.importance).to.equal(50)
      expect(signals.maturity).to.equal('draft')
      expect(signals.accessCount).to.equal(0)
      expect(signals.updateCount).to.equal(0)
    })

    it('seeds sidecar for each created file in multi-candidate run', async () => {
      await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
      await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

      agent.executeOnSession.resolves(llmResponse([
        {
          claim: 'First.',
          confidence: 0.9,
          evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
          placement: 'auth',
          title: 'Multi One',
        },
        {
          claim: 'Second.',
          confidence: 0.8,
          evidence: [{domain: 'auth', fact: 'C'}, {domain: 'api', fact: 'D'}],
          placement: 'api',
          title: 'Multi Two',
        },
      ]))

      const setSpy = stub(signalStore, 'set').callThrough()

      await synthesize({...deps, runtimeSignalStore: signalStore})

      expect(setSpy.calledTwice).to.be.true
      expect(setSpy.firstCall.args[0]).to.equal('auth/multi-one.md')
      expect(setSpy.secondCall.args[0]).to.equal('api/multi-two.md')
    })

    it('creates file even when sidecar store.set throws (fail-open)', async () => {
      const brokenStore = createMockRuntimeSignalStore()
      stub(brokenStore, 'set').rejects(new Error('disk full'))

      await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
      await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

      agent.executeOnSession.resolves(llmResponse([{
        claim: 'Fail open.',
        confidence: 0.9,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: 'auth',
        title: 'Fail Open Pattern',
      }]))

      const results = await synthesize({...deps, runtimeSignalStore: brokenStore})
      expect(results).to.have.lengthOf(1)

      const content = await readFile(join(ctxDir, 'auth/fail-open-pattern.md'), 'utf8')
      expect(content).to.include('type: synthesis')
    })

    it('succeeds even when sidecar store is not provided', async () => {
      await createMdFile(ctxDir, 'auth/_index.md', '# Auth', {type: 'summary'})
      await createMdFile(ctxDir, 'api/_index.md', '# API', {type: 'summary'})

      agent.executeOnSession.resolves(llmResponse([{
        claim: 'No store.',
        confidence: 0.9,
        evidence: [{domain: 'auth', fact: 'A'}, {domain: 'api', fact: 'B'}],
        placement: 'auth',
        title: 'No Store Pattern',
      }]))

      // No runtimeSignalStore in deps — should still create the file
      const results = await synthesize(deps)
      expect(results).to.have.lengthOf(1)

      const content = await readFile(join(ctxDir, 'auth/no-store-pattern.md'), 'utf8')
      expect(content).to.include('type: synthesis')
    })
  })
})
