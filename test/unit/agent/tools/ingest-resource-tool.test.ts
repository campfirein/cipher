import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {createIngestResourceTool} from '../../../../src/agent/infra/tools/implementations/ingest-resource-tool.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileSystem(sandbox: SinonSandbox): {fs: IFileSystem; globFilesStub: SinonStub; readFileStub: SinonStub} {
  const globFilesStub = sandbox.stub()
  const readFileStub = sandbox.stub()

  return {
    fs: {
      editFile: sandbox.stub(),
      globFiles: globFilesStub,
      initialize: sandbox.stub(),
      listDirectory: sandbox.stub(),
      readFile: readFileStub,
      searchContent: sandbox.stub(),
      writeFile: sandbox.stub(),
    } as unknown as IFileSystem,
    globFilesStub,
    readFileStub,
  }
}

function makeGenerator(sandbox: SinonSandbox, factsJson = '[]'): IContentGenerator {
  return {
    estimateTokensSync: () => 10,
    generateContent: sandbox.stub().resolves({content: factsJson, finishReason: 'stop'}),
    generateContentStream: sandbox.stub().rejects(new Error('n/a')),
  } as unknown as IContentGenerator
}

const EMPTY_GLOB = {files: [], ignoredCount: 0, message: '', totalFound: 0, truncated: false}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ingest_resource Tool', () => {
  const sandbox = createSandbox()

  afterEach(() => {
    sandbox.restore()
  })

  // ── Tool properties ────────────────────────────────────────────────────────

  describe('Tool Properties', () => {
    it('has the correct id', () => {
      const {fs: fileSystem} = makeFileSystem(sandbox)
      const tool = createIngestResourceTool({contentGenerator: makeGenerator(sandbox), fileSystem})
      expect(tool.id).to.equal('ingest_resource')
    })

    it('has an input schema', () => {
      const tool = createIngestResourceTool()
      expect(tool.inputSchema).to.exist
    })
  })

  // ── Service validation ─────────────────────────────────────────────────────

  describe('Missing services', () => {
    it('throws when fileSystem is missing', async () => {
      const tool = createIngestResourceTool({contentGenerator: makeGenerator(sandbox)})
      try {
        await tool.execute({path: '/some/path'})
        expect.fail('Expected an error to be thrown')
      } catch (error) {
        expect((error as Error).message).to.include('fileSystem')
      }
    })

    it('throws when contentGenerator is missing', async () => {
      const {fs: fileSystem} = makeFileSystem(sandbox)
      const tool = createIngestResourceTool({fileSystem})
      try {
        await tool.execute({path: '/some/path'})
        expect.fail('Expected an error to be thrown')
      } catch (error) {
        expect((error as Error).message).to.include('contentGenerator')
      }
    })
  })

  // ── Path resolution ────────────────────────────────────────────────────────

  describe('Path resolution', () => {
    it('resolves relative paths against baseDirectory', async () => {
      const baseDir = '/workspace/project'
      const {fs: fileSystem, globFilesStub} = makeFileSystem(sandbox)
      globFilesStub.resolves(EMPTY_GLOB)

      const tool = createIngestResourceTool({baseDirectory: baseDir, contentGenerator: makeGenerator(sandbox), fileSystem})
      await tool.execute({path: './src'})

      expect(globFilesStub.called).to.be.true
      const {cwd} = (globFilesStub.firstCall.args[1] as {cwd: string})
      expect(cwd).to.equal(resolve(baseDir, './src'))
    })

    it('falls back to process.cwd() when baseDirectory is not provided', async () => {
      const {fs: fileSystem, globFilesStub} = makeFileSystem(sandbox)
      globFilesStub.resolves(EMPTY_GLOB)

      const tool = createIngestResourceTool({contentGenerator: makeGenerator(sandbox), fileSystem})
      await tool.execute({path: './src'})

      const {cwd} = (globFilesStub.firstCall.args[1] as {cwd: string})
      expect(cwd).to.equal(resolve(process.cwd(), './src'))
    })

    it('handles absolute paths unchanged', async () => {
      const {fs: fileSystem, globFilesStub} = makeFileSystem(sandbox)
      globFilesStub.resolves(EMPTY_GLOB)

      const tool = createIngestResourceTool({
        baseDirectory: '/workspace',
        contentGenerator: makeGenerator(sandbox),
        fileSystem,
      })
      await tool.execute({path: '/absolute/path'})

      const {cwd} = (globFilesStub.firstCall.args[1] as {cwd: string})
      expect(cwd).to.equal('/absolute/path')
    })
  })

  // ── Empty results ──────────────────────────────────────────────────────────

  describe('Empty results', () => {
    it('returns zero counts when glob finds no files', async () => {
      const {fs: fileSystem, globFilesStub} = makeFileSystem(sandbox)
      globFilesStub.resolves(EMPTY_GLOB)

      const tool = createIngestResourceTool({
        baseDirectory: '/workspace',
        contentGenerator: makeGenerator(sandbox),
        fileSystem,
      })
      const result = await tool.execute({path: '/workspace/src'}) as {
        domains: string[]
        failed: number
        ingested: number
        queued: number
      }

      expect(result.ingested).to.equal(0)
      expect(result.failed).to.equal(0)
      expect(result.queued).to.equal(0)
      expect(result.domains).to.include('src') // inferred from path
    })

    it('returns zero ingested when files are empty', async () => {
      const {fs: fileSystem, globFilesStub, readFileStub} = makeFileSystem(sandbox)
      globFilesStub.resolves({
        files: [{isDirectory: false, modified: new Date(), path: '/workspace/src/index.ts', size: 10}],
        ignoredCount: 0,
        message: '',
        totalFound: 1,
        truncated: false,
      })
      // Return empty content — file is skipped
      readFileStub.resolves({content: '   ', encoding: 'utf8', lines: 0, size: 3, totalLines: 0, truncated: false})

      const tool = createIngestResourceTool({
        baseDirectory: '/workspace',
        contentGenerator: makeGenerator(sandbox),
        fileSystem,
      })
      const result = await tool.execute({path: '/workspace/src'}) as {ingested: number}
      expect(result.ingested).to.equal(0)
    })
  })

  // ── Depth filtering ────────────────────────────────────────────────────────

  describe('Depth filtering', () => {
    it('excludes files deeper than the depth parameter', async () => {
      const {fs: fileSystem, globFilesStub, readFileStub} = makeFileSystem(sandbox)

      // Files at varying depths relative to /workspace/src
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date(), path: '/workspace/src/a.ts', size: 100},      // directory depth 0 ✓
          {isDirectory: false, modified: new Date(), path: '/workspace/src/a/b.ts', size: 100},    // directory depth 1 ✓
          {isDirectory: false, modified: new Date(), path: '/workspace/src/a/b/c.ts', size: 100},  // directory depth 2 ✓
          {isDirectory: false, modified: new Date(), path: '/workspace/src/a/b/c/d.ts', size: 100}, // directory depth 3 ✗
        ],
        ignoredCount: 0,
        message: '',
        totalFound: 4,
        truncated: false,
      })
      // Return empty content — stops before LLM step
      readFileStub.resolves({content: '', encoding: 'utf8', lines: 0, size: 0, totalLines: 0, truncated: false})

      const tool = createIngestResourceTool({
        baseDirectory: '/workspace',
        contentGenerator: makeGenerator(sandbox),
        fileSystem,
      })
      await tool.execute({depth: 2, path: '/workspace/src'})

      // readFile is called only for files that survived the depth filter.
      // DEFAULT_INCLUDE has 7 patterns; seenPaths deduplicates across all pattern calls.
      // Only files at directory depth ≤ 2 survive → readFile called at most 3 times.
      expect(readFileStub.callCount).to.be.at.most(3)

      const readPaths = readFileStub.getCalls().map((call) => call.args[0] as string).sort()
      expect(readPaths).to.deep.equal([
        '/workspace/src/a.ts',
        '/workspace/src/a/b.ts',
        '/workspace/src/a/b/c.ts',
      ])
    })
  })

  describe('Exclude matching', () => {
    it('applies exclude patterns without substring false positives', async () => {
      const {fs: fileSystem, globFilesStub, readFileStub} = makeFileSystem(sandbox)
      globFilesStub.resolves({
        files: [
          {isDirectory: false, modified: new Date(), path: '/workspace/src/service.test.ts', size: 100},
          {isDirectory: false, modified: new Date(), path: '/workspace/src/distributed.ts', size: 100},
          {isDirectory: false, modified: new Date(), path: '/workspace/src/rebuilder.ts', size: 100},
          {isDirectory: false, modified: new Date(), path: '/workspace/src/dist/index.ts', size: 100},
          {isDirectory: false, modified: new Date(), path: '/workspace/src/build/output.ts', size: 100},
        ],
        ignoredCount: 0,
        message: '',
        totalFound: 5,
        truncated: false,
      })
      readFileStub.resolves({
        content: 'export const ok = true',
        encoding: 'utf8',
        lines: 1,
        size: 22,
        totalLines: 1,
        truncated: false,
      })

      const tool = createIngestResourceTool({
        baseDirectory: '/workspace',
        contentGenerator: makeGenerator(sandbox),
        fileSystem,
      })
      await tool.execute({path: '/workspace/src'})

      const readPaths = readFileStub.getCalls().map((call) => call.args[0] as string).sort()
      expect(readPaths).to.deep.equal([
        '/workspace/src/distributed.ts',
        '/workspace/src/rebuilder.ts',
      ])
    })
  })

  // ── Integration: curate writes to .brv/context-tree ───────────────────────

  describe('Curate path integration', () => {
    it('curated files land in .brv/context-tree, not the workspace root', async function () {
      this.timeout(10_000)

      const tmpProject = join(tmpdir(), `ingest-test-${Date.now()}`)
      await fs.mkdir(join(tmpProject, '.brv', 'context-tree'), {recursive: true})

      const {fs: fileSystem, globFilesStub, readFileStub} = makeFileSystem(sandbox)

      globFilesStub.resolves({
        files: [{isDirectory: false, modified: new Date(), path: join(tmpProject, 'src', 'index.ts'), size: 50}],
        ignoredCount: 0,
        message: '',
        totalFound: 1,
        truncated: false,
      })

      readFileStub.resolves({
        content: 'export function init() { return true }',
        encoding: 'utf8',
        lines: 1,
        size: 38,
        totalLines: 1,
        truncated: false,
      })

      // Generator returns one valid CurationFact so executeCurate is reached
      const generator = makeGenerator(
        sandbox,
        '[{"statement": "init() bootstraps the module.", "subject": "init"}]',
      )

      const tool = createIngestResourceTool({
        baseDirectory: tmpProject,
        contentGenerator: generator,
        fileSystem,
      })

      const result = await tool.execute({domain: 'testdomain', path: join(tmpProject, 'src')}) as {
        ingested: number
      }

      // File should have been written inside .brv/context-tree
      const contextTreeEntries = await fs.readdir(join(tmpProject, '.brv', 'context-tree'), {recursive: true})
      expect(contextTreeEntries.length).to.be.greaterThan(0)

      // The workspace root itself should NOT have domain directories written at top level
      const rootEntries = await fs.readdir(tmpProject)
      expect(rootEntries).to.include('.brv')
      expect(rootEntries).to.not.include('testdomain')

      expect(result.ingested).to.be.greaterThan(0)

      await fs.rm(tmpProject, {force: true, recursive: true}).catch(() => {})
    })
  })
})
