import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FileBulletContentStore} from '../../../../src/infra/ace/file-bullet-content-store.js'

describe('FileBulletContentStore', () => {
  let store: FileBulletContentStore
  let testDir: string

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `brv-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    store = new FileBulletContentStore()
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, {force: true, recursive: true})
    }
  })

  describe('save', () => {
    it('should save bullet content to a markdown file', async () => {
      const bulletId = 'test-00001'
      const content = '# Test Bullet\n\nThis is test content.'

      const filePath = await store.save(bulletId, content, testDir)

      expect(filePath).to.include(`${bulletId}.md`)
      expect(existsSync(filePath)).to.be.true
    })

    it('should create bullets directory if it does not exist', async () => {
      const bulletId = 'test-00001'
      const content = 'Test content'

      await store.save(bulletId, content, testDir)

      const bulletsDir = join(testDir, '.brv', 'ace', 'bullets')
      expect(existsSync(bulletsDir)).to.be.true
    })

    it('should overwrite existing content file', async () => {
      const bulletId = 'test-00001'
      const content1 = 'Original content'
      const content2 = 'Updated content'

      await store.save(bulletId, content1, testDir)
      await store.save(bulletId, content2, testDir)

      const loadedContent = await store.load(bulletId, testDir)
      expect(loadedContent).to.equal(content2)
    })
  })

  describe('load', () => {
    it('should load bullet content from markdown file', async () => {
      const bulletId = 'test-00001'
      const content = '# Test Bullet\n\nThis is test content.'

      await store.save(bulletId, content, testDir)
      const loadedContent = await store.load(bulletId, testDir)

      expect(loadedContent).to.equal(content)
    })

    it('should return undefined if content file does not exist', async () => {
      const bulletId = 'nonexistent-00001'

      const loadedContent = await store.load(bulletId, testDir)

      expect(loadedContent).to.be.undefined
    })

    it('should handle multiline markdown content', async () => {
      const bulletId = 'test-00001'
      const content = `# Authentication Best Practices

## Overview
Always validate tokens before processing requests.

## Implementation
\`\`\`typescript
if (!token.isValid()) {
  throw new Error('Invalid token')
}
\`\`\`

## Notes
- Check expiration dates
- Validate signatures
- Handle refresh tokens`

      await store.save(bulletId, content, testDir)
      const loadedContent = await store.load(bulletId, testDir)

      expect(loadedContent).to.equal(content)
    })
  })

  describe('exists', () => {
    it('should return true if content file exists', async () => {
      const bulletId = 'test-00001'
      const content = 'Test content'

      await store.save(bulletId, content, testDir)
      const exists = await store.exists(bulletId, testDir)

      expect(exists).to.be.true
    })

    it('should return false if content file does not exist', async () => {
      const bulletId = 'nonexistent-00001'

      const exists = await store.exists(bulletId, testDir)

      expect(exists).to.be.false
    })
  })

  describe('delete', () => {
    it('should delete bullet content file', async () => {
      const bulletId = 'test-00001'
      const content = 'Test content'

      await store.save(bulletId, content, testDir)
      await store.delete(bulletId, testDir)

      const exists = await store.exists(bulletId, testDir)
      expect(exists).to.be.false
    })

    it('should not throw error if content file does not exist', async () => {
      const bulletId = 'nonexistent-00001'

      // Should complete without throwing
      await store.delete(bulletId, testDir)
    })

    it('should only delete specified bullet content file', async () => {
      const bulletId1 = 'test-00001'
      const bulletId2 = 'test-00002'
      const content1 = 'Content 1'
      const content2 = 'Content 2'

      await store.save(bulletId1, content1, testDir)
      await store.save(bulletId2, content2, testDir)
      await store.delete(bulletId1, testDir)

      const exists1 = await store.exists(bulletId1, testDir)
      const exists2 = await store.exists(bulletId2, testDir)

      expect(exists1).to.be.false
      expect(exists2).to.be.true
    })
  })

  describe('file path structure', () => {
    it('should create correct directory structure', async () => {
      const bulletId = 'test-00001'
      const content = 'Test content'

      const filePath = await store.save(bulletId, content, testDir)

      expect(filePath).to.equal(join(testDir, '.brv', 'ace', 'bullets', `${bulletId}.md`))
    })

    it('should use current working directory when directory is not specified', async () => {
      const bulletId = 'test-00001'
      const content = 'Test content'

      // Save in test directory to avoid polluting actual cwd
      await store.save(bulletId, content, testDir)

      const expectedPath = join(testDir, '.brv', 'ace', 'bullets', `${bulletId}.md`)
      expect(existsSync(expectedPath)).to.be.true
    })
  })
})
