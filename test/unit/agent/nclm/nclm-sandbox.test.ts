import {expect} from 'chai'

import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'
import {NCLMSandbox} from '../../../../src/agent/infra/nclm/nclm-sandbox.js'

describe('NCLMSandbox', () => {
  let store: MemoryStore
  let sandbox: NCLMSandbox

  beforeEach(() => {
    store = new MemoryStore()
    sandbox = new NCLMSandbox(store)
  })

  describe('basic execution', () => {
    it('executes code and returns result', () => {
      const result = sandbox.execute('1 + 2')
      expect(result.returnValue).to.equal(3)
    })

    it('captures console.log in stdout', () => {
      const result = sandbox.execute('console.log("hello world")')
      expect(result.stdout).to.include('hello world')
    })

    it('captures errors in stderr', () => {
      const result = sandbox.execute('throw new Error("test error")')
      expect(result.stderr).to.include('test error')
    })

    it('returns returnValue from last expression', () => {
      const result = sandbox.execute('const x = 42; x')
      expect(result.returnValue).to.equal(42)
    })
  })

  describe('memory operations', () => {
    it('memory_write creates entry in MemoryStore', () => {
      sandbox.execute('memory_write("Test title", "Test content", ["tag1"], 70)')
      expect(store.stats().active_count).to.equal(1)
      const entries = store.list()
      expect(entries[0].title).to.equal('Test title')
      expect(entries[0].importance).to.equal(70)
    })

    it('memory_search returns results', () => {
      store.write({content: 'Token rotation', tags: ['auth'], title: 'JWT policy'})
      const result = sandbox.execute('memory_search("JWT policy")')
      expect(result.returnValue).to.be.an('array')
      const results = result.returnValue as unknown[]
      expect(results.length).to.be.greaterThan(0)
    })

    it('memory_read returns entry by id', () => {
      const entry = store.write({content: 'Content', title: 'Readable'})
      const result = sandbox.execute(`memory_read("${entry.id}")`)
      expect(result.returnValue).to.have.property('title', 'Readable')
    })

    it('memory_update modifies entry', () => {
      const entry = store.write({content: 'Old', title: 'Original'})
      sandbox.execute(`memory_update("${entry.id}", { content: "New" })`)
      expect(entry.content).to.equal('New')
    })

    it('memory_list returns entries', () => {
      store.write({content: 'x', title: 'A'})
      store.write({content: 'y', title: 'B'})
      const result = sandbox.execute('memory_list()')
      expect(result.returnValue).to.be.an('array').with.length(2)
    })

    it('memory_latest returns most recent entry', () => {
      store.write({content: 'x', title: 'Old'})
      store.write({content: 'y', title: 'New'})
      const result = sandbox.execute('memory_latest()')
      expect(result.returnValue).to.have.property('title', 'New')
    })

    it('memory_free deletes entry', () => {
      const entry = store.write({content: 'x', title: 'Gone'})
      sandbox.execute(`memory_free("${entry.id}")`)
      expect(store.read(entry.id)).to.be.null
    })

    it('memory_archive archives entry with stub', () => {
      const entry = store.write({content: 'Old info', title: 'Archived'})
      sandbox.execute(`memory_archive("${entry.id}")`)
      expect(entry.status).to.equal('archived')
      expect(entry.stub).to.be.a('string')
    })

    it('memory_stats returns stats', () => {
      store.write({content: 'x', title: 'A'})
      const result = sandbox.execute('memory_stats()')
      expect(result.returnValue).to.have.property('active_count', 1)
    })
  })

  describe('FINAL / FINAL_VAR', () => {
    it('FINAL sets finalAnswer directly', () => {
      const result = sandbox.execute('FINAL("the answer is 42")')
      expect(result.finalAnswer).to.equal('the answer is 42')
    })

    it('FINAL_VAR reads variable and sets finalAnswer', () => {
      // Use var or direct assignment — const/let are block-scoped in vm and
      // not accessible on the context object
      const result = sandbox.execute('var answer = "computed result"; FINAL_VAR("answer")')
      expect(result.finalAnswer).to.equal('computed result')
    })

    it('FINAL_VAR throws for non-existent variable', () => {
      const result = sandbox.execute('FINAL_VAR("nonexistent")')
      expect(result.stderr).to.include('nonexistent')
    })
  })

  describe('namespace restoration', () => {
    it('memory_write is restored after overwrite attempt', () => {
      sandbox.execute('memory_write = "broken"')
      // Next call should still work
      sandbox.execute('memory_write("After overwrite", "Content")')
      expect(store.stats().active_count).to.equal(1)
    })

    it('FINAL is restored after overwrite attempt', () => {
      sandbox.execute('FINAL = 123')
      const result = sandbox.execute('FINAL("works")')
      expect(result.finalAnswer).to.equal('works')
    })
  })

  describe('state persistence', () => {
    it('variables persist across execute calls', () => {
      sandbox.execute('const myVar = 42')
      const result = sandbox.execute('myVar')
      expect(result.returnValue).to.equal(42)
    })

    it('memory entries persist across execute calls', () => {
      sandbox.execute('memory_write("Persistent", "Content")')
      const result = sandbox.execute('memory_search("persistent")')
      const results = result.returnValue as unknown[]
      expect(results.length).to.be.greaterThan(0)
    })
  })

  describe('llm_query / nclm_query', () => {
    it('llm_query calls provided callback', async () => {
      const sandboxWithLlm = new NCLMSandbox(store, {
        llmQuery: async (prompt: string) => `Response to: ${prompt}`,
      })
      // llm_query is async — need to handle the promise
      const result = sandboxWithLlm.execute('llm_query("hello")')
      // The result should be a Promise since llm_query is async
      const resolved = await (result.returnValue as Promise<string>)
      expect(resolved).to.equal('Response to: hello')
    })

    it('llm_query throws when no callback provided', () => {
      const result = sandbox.execute('llm_query("hello")')
      expect(result.stderr).to.include('not available')
    })
  })
})
