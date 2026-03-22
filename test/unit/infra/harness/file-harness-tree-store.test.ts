import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import type {HarnessNode} from '../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {FileHarnessTreeStore} from '../../../../src/server/infra/harness/file-harness-tree-store.js'

function createNode(overrides: Partial<HarnessNode> = {}): HarnessNode {
  return {
    alpha: 1,
    beta: 1,
    childIds: [],
    createdAt: Date.now(),
    heuristic: 0.5,
    id: `node-${Math.random().toString(36).slice(2)}`,
    metadata: {},
    parentId: null,
    templateContent: 'domainRouting:\n  - keywords: [test]\n    domain: test/domain',
    visitCount: 0,
    ...overrides,
  }
}

describe('FileHarnessTreeStore', () => {
  let testDir: string
  let store: FileHarnessTreeStore

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-harness-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    store = new FileHarnessTreeStore({getBaseDir: () => testDir})
  })

  afterEach(async () => {
    restore()
    await rm(testDir, {force: true, recursive: true})
  })

  describe('saveNode and getNode', () => {
    it('should save and retrieve a node', async () => {
      const node = createNode({id: 'test-1'})
      await store.saveNode('curation', node)

      const retrieved = await store.getNode('curation', 'test-1')
      expect(retrieved).to.not.be.null
      expect(retrieved!.id).to.equal('test-1')
      expect(retrieved!.alpha).to.equal(node.alpha)
      expect(retrieved!.templateContent).to.equal(node.templateContent)
    })

    it('should return null for non-existent node', async () => {
      const result = await store.getNode('curation', 'nonexistent')
      expect(result).to.be.null
    })

    it('should update an existing node', async () => {
      const node = createNode({alpha: 1, id: 'test-update'})
      await store.saveNode('curation', node)

      const updated = {...node, alpha: 10, heuristic: 0.9}
      await store.saveNode('curation', updated)

      const retrieved = await store.getNode('curation', 'test-update')
      expect(retrieved!.alpha).to.equal(10)
      expect(retrieved!.heuristic).to.equal(0.9)
    })

    it('should serialize concurrent writes for different nodes in the same domain', async () => {
      const node1 = createNode({id: 'concurrent-1'})
      const node2 = createNode({id: 'concurrent-2'})
      const storeWithPrivates = store as unknown as {
        readTree: (domain: string) => Promise<unknown>
        writeTree: (domain: string, tree: unknown) => Promise<void>
      }
      const originalReadTree = storeWithPrivates.readTree.bind(store)
      const originalWriteTree = storeWithPrivates.writeTree.bind(store)
      const readTreeStub = stub(storeWithPrivates, 'readTree').callsFake((domain: string) => originalReadTree(domain))

      // eslint-disable-next-line unicorn/consistent-function-scoping -- reassigned by promise executor
      let releaseFirstWrite: () => void = () => {}
      const firstWriteStarted = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve
      })
      let hasBlockedFirstWrite = false
      stub(storeWithPrivates, 'writeTree').callsFake(async (domain: string, tree: unknown) => {
        if (!hasBlockedFirstWrite) {
          hasBlockedFirstWrite = true
          releaseFirstWrite()
          await new Promise<void>((resolve) => {
            releaseFirstWrite = resolve
          })
        }

        await originalWriteTree(domain, tree)
      })

      const firstSave = store.saveNode('curation', node1)
      await firstWriteStarted
      const secondSave = store.saveNode('curation', node2)
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })

      expect(readTreeStub.callCount).to.equal(1)

      releaseFirstWrite()
      await Promise.all([firstSave, secondSave])

      const nodes = await store.getAllNodes('curation')
      expect(nodes.map((node) => node.id).sort()).to.deep.equal(['concurrent-1', 'concurrent-2'])
    })
  })

  describe('getAllNodes', () => {
    it('should return empty array for empty domain', async () => {
      const nodes = await store.getAllNodes('curation')
      expect(nodes).to.deep.equal([])
    })

    it('should return all nodes in a domain', async () => {
      const node1 = createNode({id: 'n1'})
      const node2 = createNode({id: 'n2', parentId: 'n1'})
      await store.saveNode('curation', node1)
      await store.saveNode('curation', node2)

      const nodes = await store.getAllNodes('curation')
      expect(nodes).to.have.length(2)
      expect(nodes.map((n) => n.id).sort()).to.deep.equal(['n1', 'n2'])
    })

    it('should isolate domains', async () => {
      await store.saveNode('curation', createNode({id: 'c1'}))
      await store.saveNode('query/decompose', createNode({id: 'q1'}))

      const curationNodes = await store.getAllNodes('curation')
      const queryNodes = await store.getAllNodes('query/decompose')
      expect(curationNodes).to.have.length(1)
      expect(queryNodes).to.have.length(1)
      expect(curationNodes[0].id).to.equal('c1')
      expect(queryNodes[0].id).to.equal('q1')
    })
  })

  describe('getRootNode', () => {
    it('should return null for empty domain', async () => {
      const root = await store.getRootNode('curation')
      expect(root).to.be.null
    })

    it('should return the root node (parentId === null)', async () => {
      const root = createNode({id: 'root', parentId: null})
      const child = createNode({id: 'child', parentId: 'root'})
      await store.saveNode('curation', root)
      await store.saveNode('curation', child)

      const retrieved = await store.getRootNode('curation')
      expect(retrieved).to.not.be.null
      expect(retrieved!.id).to.equal('root')
    })
  })

  describe('deleteNode', () => {
    it('should delete a node', async () => {
      const node = createNode({id: 'to-delete'})
      await store.saveNode('curation', node)

      await store.deleteNode('curation', 'to-delete')

      const retrieved = await store.getNode('curation', 'to-delete')
      expect(retrieved).to.be.null
    })

    it('should remove deleted node from parent childIds', async () => {
      const parent = createNode({childIds: ['child-1', 'child-2'], id: 'parent'})
      const child1 = createNode({id: 'child-1', parentId: 'parent'})
      const child2 = createNode({id: 'child-2', parentId: 'parent'})

      await store.saveNode('curation', parent)
      await store.saveNode('curation', child1)
      await store.saveNode('curation', child2)

      await store.deleteNode('curation', 'child-1')

      const updatedParent = await store.getNode('curation', 'parent')
      expect(updatedParent!.childIds).to.deep.equal(['child-2'])
    })

    it('should handle deleting non-existent node gracefully', async () => {
      // Should not throw
      await store.deleteNode('curation', 'nonexistent')
    })
  })

  describe('file persistence', () => {
    it('should write tree metadata as JSON', async () => {
      const node = createNode({id: 'persist-test'})
      await store.saveNode('curation', node)

      const treePath = join(testDir, 'harness', 'curation', '_tree.json')
      const raw = await readFile(treePath, 'utf8')
      const parsed = JSON.parse(raw)

      expect(parsed.version).to.equal(1)
      expect(parsed.nodes).to.have.length(1)
      expect(parsed.nodes[0].id).to.equal('persist-test')
    })

    it('should write template content as separate .md file', async () => {
      const content = 'synonyms:\n  auth: [jwt, oauth]'
      const node = createNode({id: 'template-test', templateContent: content})
      await store.saveNode('curation', node)

      const templatePath = join(testDir, 'harness', 'curation', 'template-test.md')
      const raw = await readFile(templatePath, 'utf8')
      expect(raw).to.equal(content)
    })

    it('should handle corrupt tree file gracefully', async () => {
      const domainDir = join(testDir, 'harness', 'curation')
      await mkdir(domainDir, {recursive: true})

      const treePath = join(domainDir, '_tree.json')
      await writeFile(treePath, 'NOT VALID JSON', 'utf8')

      // Should return empty, not throw
      const nodes = await store.getAllNodes('curation')
      expect(nodes).to.deep.equal([])
    })

    it('should roll back a new template file when tree metadata write fails', async () => {
      const node = createNode({id: 'rollback-test'})
      stub(store as unknown as {writeTree: (domain: string, tree: unknown) => Promise<void>}, 'writeTree')
        .rejects(new Error('disk full'))

      try {
        await store.saveNode('curation', node)
        expect.fail('Expected saveNode to throw')
      } catch (error) {
        expect((error as Error).message).to.equal('disk full')
      }

      const templatePath = join(testDir, 'harness', 'curation', 'rollback-test.md')
      let templateExists = true
      try {
        await readFile(templatePath, 'utf8')
      } catch {
        templateExists = false
      }

      expect(templateExists).to.be.false
      expect(await store.getNode('curation', 'rollback-test')).to.be.null
    })

    it('should ignore nodes whose template file is missing', async () => {
      const domainDir = join(testDir, 'harness', 'curation')
      await mkdir(domainDir, {recursive: true})

      await writeFile(
        join(domainDir, '_tree.json'),
        JSON.stringify({
          nodes: [{
            alpha: 1,
            beta: 1,
            childIds: [],
            createdAt: Date.now(),
            heuristic: 0.5,
            id: 'orphan-node',
            metadata: {},
            parentId: null,
            visitCount: 0,
          }],
          version: 1,
        }),
        'utf8',
      )

      expect(await store.getNode('curation', 'orphan-node')).to.be.null
      expect(await store.getAllNodes('curation')).to.deep.equal([])
      expect(await store.getRootNode('curation')).to.be.null
    })
  })
})
