import {expect} from 'chai'
import fs from 'node:fs/promises'
import {createSandbox} from 'sinon'

import {createGitignoreFilter, GitignoreFilter} from '../../../../../src/infra/cipher/file-system/gitignore-filter.js'

describe('GitignoreFilter', () => {
  const sandbox = createSandbox()

  afterEach(() => {
    sandbox.restore()
  })

  describe('initialize', () => {
    it('should initialize successfully without .gitignore', async () => {
      sandbox.stub(fs, 'readFile').rejects(new Error('ENOENT'))

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      expect(filter.isInitialized()).to.be.true
    })

    it('should load .gitignore rules', async () => {
      sandbox.stub(fs, 'readFile').resolves('node_modules\n*.log\nbuild/')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      expect(filter.isInitialized()).to.be.true
      expect(filter.isIgnored('node_modules/package.json')).to.be.true
      expect(filter.isIgnored('src/index.ts')).to.be.false
    })

    it('should not re-initialize if already initialized', async () => {
      const readStub = sandbox.stub(fs, 'readFile').resolves('*.log')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()
      await filter.initialize()

      // Should only read once
      expect(readStub.callCount).to.equal(1)
    })

    it('should always ignore .git directory', async () => {
      sandbox.stub(fs, 'readFile').rejects(new Error('ENOENT'))

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      expect(filter.isIgnored('.git/config')).to.be.true
      expect(filter.isIgnored('.git/objects/abc123')).to.be.true
    })
  })

  describe('isIgnored', () => {
    it('should throw if not initialized', () => {
      const filter = new GitignoreFilter('/project')

      expect(() => filter.isIgnored('file.ts')).to.throw('not initialized')
    })

    it('should match files by extension', async () => {
      sandbox.stub(fs, 'readFile').resolves('*.log\n*.tmp')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      expect(filter.isIgnored('debug.log')).to.be.true
      expect(filter.isIgnored('temp.tmp')).to.be.true
      expect(filter.isIgnored('main.ts')).to.be.false
    })

    it('should match directories', async () => {
      sandbox.stub(fs, 'readFile').resolves('node_modules/\nbuild/')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      expect(filter.isIgnored('node_modules/lodash/index.js')).to.be.true
      expect(filter.isIgnored('build/output.js')).to.be.true
      expect(filter.isIgnored('src/build.ts')).to.be.false
    })

    it('should handle negation patterns', async () => {
      sandbox.stub(fs, 'readFile').resolves('*.log\n!important.log')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      expect(filter.isIgnored('debug.log')).to.be.true
      expect(filter.isIgnored('important.log')).to.be.false
    })

    it('should normalize path separators', async () => {
      sandbox.stub(fs, 'readFile').resolves('dist/')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      // Both forward and back slashes should work
      expect(filter.isIgnored('dist/bundle.js')).to.be.true
    })
  })

  describe('filterPaths', () => {
    it('should throw if not initialized', () => {
      const filter = new GitignoreFilter('/project')

      expect(() => filter.filterPaths(['file.ts'])).to.throw('not initialized')
    })

    it('should filter out ignored paths', async () => {
      sandbox.stub(fs, 'readFile').resolves('*.log\nnode_modules/')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      const result = filter.filterPaths([
        'src/index.ts',
        'debug.log',
        'node_modules/lodash/index.js',
        'package.json',
      ])

      expect(result.filtered).to.deep.equal(['src/index.ts', 'package.json'])
      expect(result.ignoredCount).to.equal(2)
    })

    it('should return all paths if none are ignored', async () => {
      sandbox.stub(fs, 'readFile').resolves('*.log')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      const result = filter.filterPaths(['src/index.ts', 'src/utils.ts'])

      expect(result.filtered).to.deep.equal(['src/index.ts', 'src/utils.ts'])
      expect(result.ignoredCount).to.equal(0)
    })

    it('should handle empty input', async () => {
      sandbox.stub(fs, 'readFile').resolves('*.log')

      const filter = new GitignoreFilter('/project')
      await filter.initialize()

      const result = filter.filterPaths([])

      expect(result.filtered).to.deep.equal([])
      expect(result.ignoredCount).to.equal(0)
    })
  })

  describe('createGitignoreFilter', () => {
    it('should create and initialize filter', async () => {
      sandbox.stub(fs, 'readFile').resolves('*.log')

      const filter = await createGitignoreFilter('/project')

      expect(filter.isInitialized()).to.be.true
      expect(filter.isIgnored('test.log')).to.be.true
    })
  })
})
