import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../src/server/constants.js'
import {FileContextFileReader} from '../../../../src/server/infra/context-tree/file-context-file-reader.js'

describe('FileContextFileReader', () => {
  let testDir: string
  let contextTreeDir: string
  let reader: FileContextFileReader

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})
    reader = new FileContextFileReader({baseDirectory: testDir})
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('constructor', () => {
    it('should use process.cwd() when no baseDirectory provided', async () => {
      const defaultReader = new FileContextFileReader()
      // Should not throw when calling methods (will use cwd)
      const result = await defaultReader.read('nonexistent/context.md')
      expect(result).to.be.undefined
    })

    it('should use provided baseDirectory', async () => {
      const domainDir = join(contextTreeDir, 'test')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Test')

      const result = await reader.read('test/context.md')
      expect(result).to.not.be.undefined
      expect(result!.title).to.equal('Test')
    })
  })

  describe('read', () => {
    describe('title extraction', () => {
      it('should extract title from first level-1 heading', async () => {
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), '# My Title\n\nSome content here')

        const result = await reader.read('design/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('My Title')
      })

      it('should trim whitespace from extracted title', async () => {
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), '#   Spaced Title   \n\nContent')

        const result = await reader.read('design/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('Spaced Title')
      })

      it('should use first heading even if not on first line', async () => {
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), 'Some preamble text\n\n# First Heading\n\n## Second Heading')

        const result = await reader.read('design/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('First Heading')
      })

      it('should ignore level-2 headings when extracting title', async () => {
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), '## Level 2 Heading\n\nContent')

        const result = await reader.read('design/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('design/context.md')
      })

      it('should fall back to relative path when no heading found', async () => {
        const domainDir = join(contextTreeDir, 'structure')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), 'Just plain text without any heading')

        const result = await reader.read('structure/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('structure/context.md')
      })

      it('should fall back to relative path for empty file', async () => {
        const domainDir = join(contextTreeDir, 'empty')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), '')

        const result = await reader.read('empty/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('empty/context.md')
      })

      it('should handle nested paths in title fallback', async () => {
        const nestedDir = join(contextTreeDir, 'domain', 'topic', 'subtopic')
        await mkdir(nestedDir, {recursive: true})
        await writeFile(join(nestedDir, 'context.md'), 'No heading here')

        const result = await reader.read('domain/topic/subtopic/context.md')

        expect(result).to.not.be.undefined
        expect(result!.title).to.equal('domain/topic/subtopic/context.md')
      })
    })

    describe('content reading', () => {
      it('should return the full file content', async () => {
        const content = '# Title\n\nParagraph 1\n\nParagraph 2'
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), content)

        const result = await reader.read('design/context.md')

        expect(result).to.not.be.undefined
        expect(result!.content).to.equal(content)
      })

      it('should preserve newlines and formatting', async () => {
        const content = '# Title\n\n- Item 1\n- Item 2\n\n```typescript\nconst x = 1;\n```'
        const domainDir = join(contextTreeDir, 'code')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), content)

        const result = await reader.read('code/context.md')

        expect(result).to.not.be.undefined
        expect(result!.content).to.equal(content)
      })
    })

    describe('path handling', () => {
      it('should return the path as-is from input', async () => {
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), '# Test')

        const result = await reader.read('design/context.md')

        expect(result).to.not.be.undefined
        expect(result!.path).to.equal('design/context.md')
      })

      it('should preserve nested path structure', async () => {
        const nestedDir = join(contextTreeDir, 'a', 'b', 'c')
        await mkdir(nestedDir, {recursive: true})
        await writeFile(join(nestedDir, 'context.md'), '# Nested')

        const result = await reader.read('a/b/c/context.md')

        expect(result).to.not.be.undefined
        expect(result!.path).to.equal('a/b/c/context.md')
      })
    })

    describe('error handling', () => {
      it('should return undefined for non-existent file', async () => {
        const result = await reader.read('nonexistent/context.md')

        expect(result).to.be.undefined
      })

      it('should return undefined for non-existent directory', async () => {
        const result = await reader.read('missing/deeply/nested/context.md')

        expect(result).to.be.undefined
      })

      it('should return undefined when reading a directory instead of file', async () => {
        const domainDir = join(contextTreeDir, 'design')
        await mkdir(domainDir, {recursive: true})

        const result = await reader.read('design')

        expect(result).to.be.undefined
      })
    })

    describe('directory parameter', () => {
      it('should use directory parameter over baseDirectory', async () => {
        const otherDir = join(tmpdir(), `brv-other-${Date.now()}`)
        const otherContextDir = join(otherDir, BRV_DIR, CONTEXT_TREE_DIR, 'design')
        await mkdir(otherContextDir, {recursive: true})
        await writeFile(join(otherContextDir, 'context.md'), '# Other Dir')

        try {
          // File only exists in otherDir, not in testDir
          const resultInBase = await reader.read('design/context.md')
          expect(resultInBase).to.be.undefined

          const resultInOther = await reader.read('design/context.md', otherDir)
          expect(resultInOther).to.not.be.undefined
          expect(resultInOther!.title).to.equal('Other Dir')
        } finally {
          await rm(otherDir, {force: true, recursive: true})
        }
      })
    })
  })

  describe('readMany', () => {
    it('should read multiple files', async () => {
      const designDir = join(contextTreeDir, 'design')
      const codeDir = join(contextTreeDir, 'code')
      await mkdir(designDir, {recursive: true})
      await mkdir(codeDir, {recursive: true})
      await writeFile(join(designDir, 'context.md'), '# Design')
      await writeFile(join(codeDir, 'context.md'), '# Code')

      const results = await reader.readMany(['design/context.md', 'code/context.md'])

      expect(results).to.have.length(2)
      expect(results.map((r) => r.title)).to.include.members(['Design', 'Code'])
    })

    it('should return empty array for empty input', async () => {
      const results = await reader.readMany([])

      expect(results).to.be.an('array').that.is.empty
    })

    it('should skip files that cannot be read', async () => {
      const designDir = join(contextTreeDir, 'design')
      await mkdir(designDir, {recursive: true})
      await writeFile(join(designDir, 'context.md'), '# Design')

      const results = await reader.readMany(['design/context.md', 'nonexistent/context.md', 'also-missing/context.md'])

      expect(results).to.have.length(1)
      expect(results[0].title).to.equal('Design')
    })

    it('should return empty array when all files are missing', async () => {
      const results = await reader.readMany(['missing1/context.md', 'missing2/context.md'])

      expect(results).to.be.an('array').that.is.empty
    })

    it('should preserve order of successfully read files', async () => {
      const aDir = join(contextTreeDir, 'a')
      const bDir = join(contextTreeDir, 'b')
      const cDir = join(contextTreeDir, 'c')
      await mkdir(aDir, {recursive: true})
      await mkdir(bDir, {recursive: true})
      await mkdir(cDir, {recursive: true})
      await writeFile(join(aDir, 'context.md'), '# A')
      await writeFile(join(bDir, 'context.md'), '# B')
      await writeFile(join(cDir, 'context.md'), '# C')

      const results = await reader.readMany(['a/context.md', 'b/context.md', 'c/context.md'])

      expect(results).to.have.length(3)
      expect(results[0].title).to.equal('A')
      expect(results[1].title).to.equal('B')
      expect(results[2].title).to.equal('C')
    })

    it('should use directory parameter', async () => {
      const otherDir = join(tmpdir(), `brv-other-${Date.now()}`)
      const otherContextDir = join(otherDir, BRV_DIR, CONTEXT_TREE_DIR, 'design')
      await mkdir(otherContextDir, {recursive: true})
      await writeFile(join(otherContextDir, 'context.md'), '# Other Dir')

      try {
        const results = await reader.readMany(['design/context.md'], otherDir)

        expect(results).to.have.length(1)
        expect(results[0].title).to.equal('Other Dir')
      } finally {
        await rm(otherDir, {force: true, recursive: true})
      }
    })

    it('should read files concurrently', async () => {
      // Create multiple files
      const dirs = ['dir1', 'dir2', 'dir3', 'dir4', 'dir5']
      for (const dir of dirs) {
        const fullDir = join(contextTreeDir, dir)
        // eslint-disable-next-line no-await-in-loop
        await mkdir(fullDir, {recursive: true})
        // eslint-disable-next-line no-await-in-loop
        await writeFile(join(fullDir, 'context.md'), `# ${dir}`)
      }

      const paths = dirs.map((d) => `${d}/context.md`)
      const results = await reader.readMany(paths)

      expect(results).to.have.length(5)
    })
  })
})
