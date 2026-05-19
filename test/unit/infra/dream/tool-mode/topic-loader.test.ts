import {expect} from 'chai'
import {mkdir, rm, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createDefaultRuntimeSignals} from '../../../../../src/server/core/domain/knowledge/runtime-signals-schema.js'
import {loadToolModeTopics} from '../../../../../src/server/infra/dream/tool-mode/topic-loader.js'
import {createMockRuntimeSignalStore} from '../../../../helpers/mock-factories.js'

describe('loadToolModeTopics', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `brv-topic-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, {recursive: true})
  })

  afterEach(async () => {
    await rm(dir, {force: true, recursive: true})
  })

  it('returns empty when the context tree is empty', async () => {
    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })
    expect(result).to.deep.equal([])
  })

  it('parses title, summary, and related from a topic file', async () => {
    await writeFile(
      join(dir, 'jwt.html'),
      '<bv-topic path="security/jwt" title="JWT signing" summary="RS256 over HS256" related="security/oauth,billing/stripe">x</bv-topic>',
      'utf8',
    )

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    expect(result).to.have.length(1)
    expect(result[0].path).to.equal('jwt.html')
    expect(result[0].title).to.equal('JWT signing')
    expect(result[0].summary).to.equal('RS256 over HS256')
    expect(result[0].related).to.deep.equal(['security/oauth', 'billing/stripe'])
  })

  it('treats missing optional attrs as empty / undefined', async () => {
    await writeFile(
      join(dir, 'minimal.html'),
      '<bv-topic path="x" title="Minimal">body</bv-topic>',
      'utf8',
    )

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    expect(result[0].summary).to.equal('')
    expect(result[0].related).to.deep.equal([])
  })

  it('walks nested directories', async () => {
    await mkdir(join(dir, 'security'), {recursive: true})
    await mkdir(join(dir, 'deploy', 'envs'), {recursive: true})
    await writeFile(join(dir, 'security', 'a.html'), '<bv-topic path="security/a" title="A"/>', 'utf8')
    await writeFile(join(dir, 'deploy', 'envs', 'b.html'), '<bv-topic path="deploy/envs/b" title="B"/>', 'utf8')

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    expect(result.map((t) => t.path).sort()).to.deep.equal([
      'deploy/envs/b.html',
      'security/a.html',
    ])
  })

  it('skips non-.html files and hidden dot-dirs (.git, .archive)', async () => {
    await mkdir(join(dir, '.git'), {recursive: true})
    await writeFile(join(dir, 'topic.html'), '<bv-topic path="t" title="T"/>', 'utf8')
    await writeFile(join(dir, 'notes.md'), 'markdown', 'utf8')
    await writeFile(join(dir, '.git', 'hidden.html'), '<bv-topic path="hidden" title="H"/>', 'utf8')

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    expect(result.map((t) => t.path)).to.deep.equal(['topic.html'])
  })

  it('attaches sidecar signals when available, falls back to defaults', async () => {
    await writeFile(join(dir, 'a.html'), '<bv-topic path="a" title="A"/>', 'utf8')
    await writeFile(join(dir, 'b.html'), '<bv-topic path="b" title="B"/>', 'utf8')

    const store = createMockRuntimeSignalStore()
    await store.set('a.html', {...createDefaultRuntimeSignals(), importance: 80, maturity: 'core'})

    const result = await loadToolModeTopics({contextTreeRoot: dir, runtimeSignalStore: store})

    const a = result.find((t) => t.path === 'a.html')
    const b = result.find((t) => t.path === 'b.html')
    expect(a?.signals.importance).to.equal(80)
    expect(a?.signals.maturity).to.equal('core')
    expect(b?.signals).to.deep.equal(createDefaultRuntimeSignals())
  })

  it('captures mtime in milliseconds', async () => {
    const filePath = join(dir, 't.html')
    await writeFile(filePath, '<bv-topic path="t" title="T"/>', 'utf8')
    // Force a specific mtime well in the past
    const pastMs = Date.now() - 5 * 24 * 60 * 60 * 1000
    await utimes(filePath, new Date(pastMs), new Date(pastMs))

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    expect(result[0].mtimeMs).to.be.closeTo(pastMs, 1500) // 1.5s tolerance for fs jitter
  })

  it('preserves the full HTML on each topic', async () => {
    const html = '<bv-topic path="x" title="X">body content</bv-topic>'
    await writeFile(join(dir, 'x.html'), html, 'utf8')

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    expect(result[0].html).to.equal(html)
  })

  it('handles empty/malformed HTML gracefully (skips, never throws)', async () => {
    await writeFile(join(dir, 'good.html'), '<bv-topic path="g" title="G"/>', 'utf8')
    await writeFile(join(dir, 'empty.html'), '', 'utf8')
    await writeFile(join(dir, 'malformed.html'), '<not-a-bv-topic>x</not-a-bv-topic>', 'utf8')

    const result = await loadToolModeTopics({
      contextTreeRoot: dir,
      runtimeSignalStore: createMockRuntimeSignalStore(),
    })

    // Only the good topic survives
    expect(result.map((t) => t.path)).to.deep.equal(['good.html'])
  })
})
