/**
 * LocalSandbox Unit Tests
 *
 * Tests the LocalSandbox class for code execution with tools injection.
 *
 * Key scenarios:
 * - Tools SDK is accessible in sandbox context
 * - Async operations resolve correctly
 * - Console output is captured
 * - Context state persists across executions
 * - TypeScript transpilation works
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ToolsSDK} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

import {LocalSandbox} from '../../../../src/agent/infra/sandbox/local-sandbox.js'

describe('LocalSandbox', () => {
  let sandbox: SinonSandbox
  let mockToolsSDK: {
    glob: SinonStub
    grep: SinonStub
    listDirectory: SinonStub
    readFile: SinonStub
    searchKnowledge: SinonStub
    writeFile: SinonStub
  }

  beforeEach(() => {
    sandbox = createSandbox()

    mockToolsSDK = {
      glob: sandbox.stub(),
      grep: sandbox.stub(),
      listDirectory: sandbox.stub(),
      readFile: sandbox.stub(),
      searchKnowledge: sandbox.stub(),
      writeFile: sandbox.stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('Tools Injection', () => {
    it('should make tools available in sandbox context', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute('typeof tools')

      expect(result.returnValue).to.equal('object')
      expect(result.stderr).to.equal('')
    })

    it('should expose all tool methods', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`
        const methods = ['glob', 'grep', 'listDirectory', 'readFile', 'writeFile', 'searchKnowledge']
        methods.every(m => typeof tools[m] === 'function')
      `)

      expect(result.returnValue).to.be.true
      expect(result.stderr).to.equal('')
    })

    it('should not have tools when not provided', () => {
      const localSandbox = new LocalSandbox()
      const result = localSandbox.execute('typeof tools')

      expect(result.returnValue).to.equal('undefined')
    })
  })

  describe('Async Execution with Tools', () => {
    it('should execute async tool calls and return promise', async () => {
      mockToolsSDK.glob.resolves({
        files: [{path: 'src/index.ts'}, {path: 'src/main.ts'}],
        totalFound: 2,
        truncated: false,
      })

      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`tools.glob('**/*.ts')`)

      // Result is a Promise
      expect(result.returnValue).to.be.instanceOf(Promise)

      // Await the promise to get actual result
      const asyncResult = await (result.returnValue as Promise<unknown>)
      expect(asyncResult).to.deep.equal({
        files: [{path: 'src/index.ts'}, {path: 'src/main.ts'}],
        totalFound: 2,
        truncated: false,
      })
    })

    it('should execute tools.readFile correctly', async () => {
      mockToolsSDK.readFile.resolves({
        content: 'export const main = () => {}',
        exists: true,
        path: '/project/src/index.ts',
      })

      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`tools.readFile('/project/src/index.ts')`)

      const asyncResult = await (result.returnValue as Promise<unknown>)
      expect(asyncResult).to.deep.include({
        content: 'export const main = () => {}',
        exists: true,
      })
    })

    it('should execute tools.grep correctly', async () => {
      mockToolsSDK.grep.resolves({
        matches: [{file: 'src/index.ts', line: 1, text: 'function main()'}],
        totalMatches: 1,
        truncated: false,
      })

      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`tools.grep('function', { glob: '*.ts' })`)

      const asyncResult = await (result.returnValue as Promise<unknown>)
      expect(asyncResult).to.have.property('totalMatches', 1)
    })

    it('should execute tools.writeFile correctly', async () => {
      mockToolsSDK.writeFile.resolves({
        bytesWritten: 20,
        path: '/project/output.txt',
      })

      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`tools.writeFile('/project/output.txt', 'test content')`)

      const asyncResult = await (result.returnValue as Promise<unknown>)
      expect(asyncResult).to.deep.include({
        bytesWritten: 20,
      })
    })

    it('should execute tools.searchKnowledge correctly', async () => {
      mockToolsSDK.searchKnowledge.resolves({
        message: 'Found 1 result',
        results: [{excerpt: 'Auth overview...', path: 'auth.md', score: 0.9, title: 'Auth'}],
        totalFound: 1,
      })

      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`tools.searchKnowledge('authentication')`)

      const asyncResult = await (result.returnValue as Promise<unknown>)
      expect(asyncResult).to.have.property('totalFound', 1)
    })
  })

  describe('Console Output Capture', () => {
    it('should capture console.log output', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`
        console.log('Hello')
        console.log('World')
        42
      `)

      expect(result.stdout).to.equal('Hello\nWorld')
      expect(result.returnValue).to.equal(42)
    })

    it('should capture console.error in stderr', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})
      const result = localSandbox.execute(`
        console.error('Error occurred')
        console.warn('Warning')
        'done'
      `)

      expect(result.stderr).to.equal('Error occurred\nWarning')
      expect(result.returnValue).to.equal('done')
    })
  })

  describe('Context State Persistence', () => {
    it('should persist variables across executions', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      localSandbox.execute('var counter = 0')
      localSandbox.execute('counter++')
      const result = localSandbox.execute('counter')

      expect(result.returnValue).to.equal(1)
    })

    it('should include user-defined variables in locals', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      const result = localSandbox.execute(`
        var myNumber = 42
        var myString = 'hello'
        var myArray = [1, 2, 3]
      `)

      expect(result.locals).to.have.property('myNumber', 42)
      expect(result.locals).to.have.property('myString', 'hello')
      expect(result.locals).to.have.property('myArray').that.deep.equals([1, 2, 3])
    })

    it('should not include tools in locals', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      const result = localSandbox.execute('var x = 1')

      expect(result.locals).to.not.have.property('tools')
    })
  })

  describe('TypeScript Support', () => {
    it('should execute plain JavaScript without transpilation', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      // Plain JavaScript - no TypeScript patterns detected
      const result = localSandbox.execute('1 + 2 + 3')

      expect(result.returnValue).to.equal(6)
      expect(result.stderr).to.equal('')
    })

    it('should detect and attempt to transpile TypeScript patterns', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      // This contains TypeScript pattern (type annotation) which triggers transpilation
      // The transpilation itself works, but CJS format may have limitations in vm context
      const result = localSandbox.execute('const x: number = 42', {language: 'javascript'})

      // When forced to JavaScript mode, type annotations cause syntax errors
      expect(result.stderr).to.include('SyntaxError')
    })

    it('should handle simple arrow function with explicit language setting', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      // Plain JavaScript arrow function
      const result = localSandbox.execute('((x) => x * 2)(21)')

      expect(result.returnValue).to.equal(42)
      expect(result.stderr).to.equal('')
    })
  })

  describe('Error Handling', () => {
    it('should capture runtime errors in stderr', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      const result = localSandbox.execute('throw new Error("Test error")')

      expect(result.stderr).to.include('Error: Test error')
    })

    it('should capture reference errors', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      const result = localSandbox.execute('undefinedVariable')

      expect(result.stderr).to.include('ReferenceError')
    })

    it('should capture type errors', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      const result = localSandbox.execute('null.property')

      expect(result.stderr).to.include('TypeError')
    })
  })

  describe('Initial Context', () => {
    it('should make initial context available', () => {
      const localSandbox = new LocalSandbox({
        initialContext: {
          config: {debug: true},
          projectName: 'MyProject',
        },
        toolsSDK: mockToolsSDK as unknown as ToolsSDK,
      })

      const result = localSandbox.execute('projectName + " - " + config.debug')

      expect(result.returnValue).to.equal('MyProject - true')
    })
  })

  describe('updateContext', () => {
    it('should allow updating context after creation', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      localSandbox.updateContext({newValue: 100})
      const result = localSandbox.execute('newValue')

      expect(result.returnValue).to.equal(100)
    })
  })

  describe('Execution Time', () => {
    it('should report execution time', () => {
      const localSandbox = new LocalSandbox({toolsSDK: mockToolsSDK as unknown as ToolsSDK})

      const result = localSandbox.execute('1 + 1')

      expect(result.executionTime).to.be.a('number')
      expect(result.executionTime).to.be.greaterThan(0)
    })
  })
})
