import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {SearchKnowledgeService} from '../../../../src/agent/infra/tools/implementations/search-knowledge-service.js'

function createProjectWithContextTree(dir: string): void {
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
}

function writeKnowledgeLinks(projectRoot: string, links: unknown): void {
  writeFileSync(join(projectRoot, '.brv', 'knowledge-links.json'), JSON.stringify(links, null, 2))
}

function makeFileSystem(sandbox: SinonSandbox): IFileSystem & {
  globFiles: SinonStub
  listDirectory: SinonStub
  readFile: SinonStub
} {
  return {
    editFile: sandbox.stub().resolves({bytesWritten: 0, replacements: 0}),
    globFiles: sandbox.stub().resolves({files: [], totalFound: 0}),
    initialize: sandbox.stub().resolves(),
    listDirectory: sandbox.stub().resolves({entries: [], tree: ''}),
    readFile: sandbox.stub().resolves({content: '', lines: 0, truncated: false}),
    searchContent: sandbox.stub().resolves({matches: [], totalMatches: 0}),
    writeFile: sandbox.stub().resolves({bytesWritten: 0, path: ''}),
  }
}

function makeDocContent(title: string, body: string): string {
  return `# ${title}\n\n${body}`
}

describe('SearchKnowledgeService multi-source', () => {
  let projectA: string
  let projectB: string
  let sandbox: SinonSandbox
  let fileSystem: ReturnType<typeof makeFileSystem>

  beforeEach(() => {
    sandbox = createSandbox()
    fileSystem = makeFileSystem(sandbox)

    const testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-kl-search-')))
    projectA = join(testDir, 'project-a')
    projectB = join(testDir, 'project-b')

    createProjectWithContextTree(projectA)
    createProjectWithContextTree(projectB)
    writeKnowledgeLinks(projectA, {
      links: [{addedAt: '2026-01-01', alias: 'shared-lib', projectRoot: projectB, readOnly: true}],
      version: 1,
    })

    const localContextTree = join(projectA, '.brv', 'context-tree')
    const linkedContextTree = join(projectB, '.brv', 'context-tree')

    fileSystem.listDirectory.resolves({entries: [], tree: ''})
    fileSystem.globFiles.callsFake(async (_pattern: string, options?: {cwd?: string}) => {
      if (options?.cwd === localContextTree) {
        return {
          files: [{
            isDirectory: false,
            modified: new Date('2026-01-01'),
            path: join(localContextTree, 'billing', 'invoice.md'),
            size: 100,
          }],
          totalFound: 1,
        }
      }

      if (options?.cwd === linkedContextTree) {
        return {
          files: [{
            isDirectory: false,
            modified: new Date('2026-01-02'),
            path: join(linkedContextTree, 'auth', 'jwt.md'),
            size: 100,
          }],
          totalFound: 1,
        }
      }

      return {files: [], totalFound: 0}
    })

    fileSystem.readFile.callsFake(async (filePath: string) => {
      if (filePath === join(localContextTree, 'billing', 'invoice.md')) {
        return {
          content: makeDocContent('Invoice Flow', 'Invoice processing stays in the local billing project.'),
          lines: 3,
          truncated: false,
        }
      }

      if (filePath === join(linkedContextTree, 'auth', 'jwt.md')) {
        return {
          content: makeDocContent('JWT Auth', 'Shared gateway JWT refresh tokens are validated in the linked project.'),
          lines: 3,
          truncated: false,
        }
      }

      return {content: '', lines: 0, truncated: false}
    })
  })

  afterEach(() => {
    sandbox.restore()
    rmSync(join(projectA, '..'), {force: true, recursive: true})
  })

  it('returns linked results with source metadata', async () => {
    const service = new SearchKnowledgeService(fileSystem, {
      baseDirectory: projectA,
      cacheTtlMs: 0,
    })

    const result = await service.search('gateway refresh tokens')

    expect(result.results).to.have.length.greaterThan(0)
    expect(result.results[0]).to.include({
      path: 'auth/jwt.md',
      sourceAlias: 'shared-lib',
      sourceType: 'linked',
    })
    expect(result.results[0].sourceContextTreeRoot).to.equal(join(projectB, '.brv', 'context-tree'))
  })

  it('includes linked namespaces in overview mode', async () => {
    const service = new SearchKnowledgeService(fileSystem, {
      baseDirectory: projectA,
      cacheTtlMs: 0,
    })

    const result = await service.search('overview', {overview: true})
    const linkedEntry = result.results.find((entry) => entry.path === '[shared-lib]:auth')

    expect(linkedEntry).to.not.be.undefined
    expect(linkedEntry?.symbolPath).to.equal('[shared-lib]:auth')
  })

  it('supports symbolic search into linked namespaces', async () => {
    const service = new SearchKnowledgeService(fileSystem, {
      baseDirectory: projectA,
      cacheTtlMs: 0,
    })

    const result = await service.search('[shared-lib]:auth')

    expect(result.results).to.have.length(1)
    expect(result.results[0]).to.include({
      path: 'auth/jwt.md',
      sourceAlias: 'shared-lib',
      sourceType: 'linked',
    })
    expect(result.message).to.include('[shared-lib]:auth')
  })

  it('applies scoped text search to linked namespaces', async () => {
    const service = new SearchKnowledgeService(fileSystem, {
      baseDirectory: projectA,
      cacheTtlMs: 0,
    })

    const result = await service.search('refresh', {scope: '[shared-lib]:auth'})

    expect(result.results).to.have.length(1)
    expect(result.results[0].sourceAlias).to.equal('shared-lib')
  })
})
