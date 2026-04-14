import {expect} from 'chai'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {createMemoryStoreService} from '../../../../src/agent/infra/nclm/memory-store-service.js'
import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'

const notImplemented = (): never => {
  throw new Error('Not implemented in stub')
}

/**
 * Minimal IFileSystem stub — only needed so SandboxService.buildToolsSDK() doesn't
 * return undefined. Memory tests never call file system methods.
 */
function createStubFileSystem(): IFileSystem {
  return {
    editFile: notImplemented,
    globFiles: notImplemented,
    async initialize() {},
    listDirectory: notImplemented,
    readFile: notImplemented,
    searchContent: notImplemented,
    writeFile: notImplemented,
  } as unknown as IFileSystem
}

/** Wrap code in async IIFE — sandbox vm.runInContext doesn't support top-level await */
function async_(code: string): string {
  return `(async () => { ${code} })()`
}

describe('NCLM Sandbox Integration', () => {
  let sandboxService: SandboxService
  let memoryStore: MemoryStore
  const sessionId = 'test-nclm-session'

  beforeEach(async () => {
    memoryStore = new MemoryStore()
    sandboxService = new SandboxService()
    sandboxService.setFileSystem(createStubFileSystem())
    sandboxService.setMemoryStoreService(createMemoryStoreService(memoryStore))
  })

  afterEach(async () => {
    await sandboxService.cleanup()
  })

  describe('tools.memory availability', () => {
    it('tools.memory is available in sandbox when service is injected', async () => {
      const result = await sandboxService.executeCode('typeof tools.memory', sessionId)
      expect(result.returnValue).to.equal('object')
    })

    it('tools.memory is undefined when no service is injected', async () => {
      const cleanSandbox = new SandboxService()
      cleanSandbox.setFileSystem(createStubFileSystem())

      const result = await cleanSandbox.executeCode('typeof tools.memory', 'no-memory-session')
      expect(result.returnValue).to.equal('undefined')
      await cleanSandbox.cleanup()
    })
  })

  describe('tools.memory.write', () => {
    it('creates an entry in the shared MemoryStore', async () => {
      const result = await sandboxService.executeCode(
        async_('await tools.memory.write("JWT policy", "Tokens rotate every 24h", ["auth"], 70)'),
        sessionId,
      )
      expect(result.stderr).to.equal('')
      expect(memoryStore.stats().active_count).to.equal(1)
      const entries = memoryStore.list()
      expect(entries[0].title).to.equal('JWT policy')
      expect(entries[0].tags).to.deep.equal(['auth'])
      expect(entries[0].importance).to.equal(70)
    })

    it('returns the created entry', async () => {
      const result = await sandboxService.executeCode(
        async_('const entry = await tools.memory.write("Test", "Content"); return entry.title'),
        sessionId,
      )
      expect(result.returnValue).to.equal('Test')
    })
  })

  describe('tools.memory.search', () => {
    it('finds entries by query', async () => {
      memoryStore.write({content: 'Tokens rotate every 24 hours', tags: ['auth'], title: 'JWT refresh pattern'})

      const result = await sandboxService.executeCode(
        async_('const results = await tools.memory.search("JWT refresh"); return results.length'),
        sessionId,
      )
      expect(result.returnValue).to.be.greaterThan(0)
    })

    it('returns empty array for no matches', async () => {
      const result = await sandboxService.executeCode(
        async_('const results = await tools.memory.search("nonexistent"); return results.length'),
        sessionId,
      )
      expect(result.returnValue).to.equal(0)
    })
  })

  describe('tools.memory.read', () => {
    it('reads an entry by id', async () => {
      const entry = memoryStore.write({content: 'Content here', title: 'Readable'})

      const result = await sandboxService.executeCode(
        async_(`const entry = await tools.memory.read("${entry.id}"); return entry.title`),
        sessionId,
      )
      expect(result.returnValue).to.equal('Readable')
    })
  })

  describe('tools.memory.update', () => {
    it('updates an existing entry', async () => {
      const entry = memoryStore.write({content: 'Old content', title: 'Original'})

      await sandboxService.executeCode(
        async_(`await tools.memory.update("${entry.id}", { content: "New content" })`),
        sessionId,
      )
      expect(entry.content).to.equal('New content')
    })
  })

  describe('tools.memory.list', () => {
    it('lists entries with filtering', async () => {
      memoryStore.write({content: 'Auth stuff', tags: ['auth'], title: 'Auth entry'})
      memoryStore.write({content: 'Cache stuff', tags: ['cache'], title: 'Cache entry'})

      const result = await sandboxService.executeCode(
        async_('const entries = await tools.memory.list({ tags: ["auth"] }); return entries.length'),
        sessionId,
      )
      expect(result.returnValue).to.equal(1)
    })
  })

  describe('tools.memory.latest', () => {
    it('returns the most recently written entry', async () => {
      memoryStore.write({content: 'First', title: 'Old'})
      memoryStore.write({content: 'Second', title: 'New'})

      const result = await sandboxService.executeCode(
        async_('const entry = await tools.memory.latest(); return entry.title'),
        sessionId,
      )
      expect(result.returnValue).to.equal('New')
    })
  })

  describe('tools.memory.stats', () => {
    it('returns memory statistics', async () => {
      memoryStore.write({content: 'Content 1', title: 'Entry 1'})
      memoryStore.write({content: 'Content 2', title: 'Entry 2'})

      const result = await sandboxService.executeCode(
        async_('const stats = await tools.memory.stats(); return stats.active_count'),
        sessionId,
      )
      expect(result.returnValue).to.equal(2)
    })
  })

  describe('tools.memory.free', () => {
    it('removes an entry from the store', async () => {
      const entry = memoryStore.write({content: 'Gone', title: 'To delete'})

      await sandboxService.executeCode(
        async_(`await tools.memory.free("${entry.id}")`),
        sessionId,
      )
      expect(memoryStore.read(entry.id)).to.be.null
    })
  })

  describe('tools.memory.archive', () => {
    it('archives an entry with a ghost cue', async () => {
      const entry = memoryStore.write({content: 'Important old info', title: 'To archive'})

      await sandboxService.executeCode(
        async_(`await tools.memory.archive("${entry.id}")`),
        sessionId,
      )
      expect(entry.status).to.equal('archived')
      expect(entry.stub).to.be.a('string')
    })
  })

  describe('cross-call state persistence', () => {
    it('memory written in one code_exec call is readable in the next', async () => {
      await sandboxService.executeCode(
        async_('await tools.memory.write("Persisted", "Survives across calls", ["test"])'),
        sessionId,
      )

      const result = await sandboxService.executeCode(
        async_('const results = await tools.memory.search("persisted"); return results.length'),
        sessionId,
      )
      expect(result.returnValue).to.be.greaterThan(0)
    })

    it('memory written in one session is visible in another session', async () => {
      await sandboxService.executeCode(
        async_('await tools.memory.write("Cross session", "Shared memory", ["shared"])'),
        'session-1',
      )

      const result = await sandboxService.executeCode(
        async_('const results = await tools.memory.search("cross session"); return results.length'),
        'session-2',
      )
      expect(result.returnValue).to.be.greaterThan(0)
    })
  })

  describe('command type compatibility', () => {
    it('tools.memory works in curate mode', async () => {
      const result = await sandboxService.executeCode(
        async_('await tools.memory.write("Curate note", "From curate", ["curate"])'),
        sessionId,
        {commandType: 'curate'},
      )
      expect(result.stderr).to.equal('')
      expect(memoryStore.stats().active_count).to.equal(1)
    })

    it('tools.memory works in query mode (write not gated by isReadOnly)', async () => {
      const result = await sandboxService.executeCode(
        async_('await tools.memory.write("Query note", "From query", ["query"])'),
        sessionId,
        {commandType: 'query'},
      )
      expect(result.stderr).to.equal('')
      expect(memoryStore.stats().active_count).to.equal(1)
    })
  })
})
