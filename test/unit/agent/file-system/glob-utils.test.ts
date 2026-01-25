import type {Stats} from 'node:fs'

import {expect} from 'chai'
import fs from 'node:fs/promises'
import {createSandbox} from 'sinon'

import {
  collectFileMetadata,
  escapeGlobCharacters,
  escapeIfExactMatch,
  extractPaths,
  type FileMetadata,
  RECENCY_THRESHOLD_MS,
  sortFilesByRecency,
} from '../../../../src/agent/file-system/glob-utils.js'

describe('glob-utils', () => {
  const sandbox = createSandbox()

  afterEach(() => {
    sandbox.restore()
  })

  describe('sortFilesByRecency', () => {
    it('should sort recent files by modification time (newest first)', () => {
      const now = Date.now()
      const files: FileMetadata[] = [
        {modifiedTime: new Date(now - 1000), path: 'older.ts', size: 100},
        {modifiedTime: new Date(now - 100), path: 'newest.ts', size: 100},
        {modifiedTime: new Date(now - 500), path: 'middle.ts', size: 100},
      ]

      const sorted = sortFilesByRecency(files)

      expect(sorted.map((f) => f.path)).to.deep.equal(['newest.ts', 'middle.ts', 'older.ts'])
    })

    it('should sort old files alphabetically', () => {
      const now = Date.now()
      const oldTime = now - RECENCY_THRESHOLD_MS - 1000 // Older than threshold
      const files: FileMetadata[] = [
        {modifiedTime: new Date(oldTime), path: 'zebra.ts', size: 100},
        {modifiedTime: new Date(oldTime - 1000), path: 'apple.ts', size: 100},
        {modifiedTime: new Date(oldTime - 500), path: 'middle.ts', size: 100},
      ]

      const sorted = sortFilesByRecency(files)

      expect(sorted.map((f) => f.path)).to.deep.equal(['apple.ts', 'middle.ts', 'zebra.ts'])
    })

    it('should put recent files before old files', () => {
      const now = Date.now()
      const recentTime = now - 1000 // Within threshold
      const oldTime = now - RECENCY_THRESHOLD_MS - 1000 // Older than threshold
      const files: FileMetadata[] = [
        {modifiedTime: new Date(oldTime), path: 'apple.ts', size: 100},
        {modifiedTime: new Date(recentTime), path: 'recent.ts', size: 100},
        {modifiedTime: new Date(oldTime - 1000), path: 'banana.ts', size: 100},
      ]

      const sorted = sortFilesByRecency(files)

      // Recent files first, then old files alphabetically
      expect(sorted.map((f) => f.path)).to.deep.equal(['recent.ts', 'apple.ts', 'banana.ts'])
    })

    it('should handle empty array', () => {
      const sorted = sortFilesByRecency([])
      expect(sorted).to.deep.equal([])
    })

    it('should handle custom recency threshold', () => {
      const now = Date.now()
      const customThreshold = 60 * 1000 // 1 minute
      const files: FileMetadata[] = [
        {modifiedTime: new Date(now - 30 * 1000), path: 'within-threshold.ts', size: 100},
        {modifiedTime: new Date(now - 90 * 1000), path: 'outside-threshold.ts', size: 100},
      ]

      const sorted = sortFilesByRecency(files, customThreshold)

      // within-threshold is recent, outside-threshold is old
      expect(sorted.map((f) => f.path)).to.deep.equal(['within-threshold.ts', 'outside-threshold.ts'])
    })
  })

  describe('escapeGlobCharacters', () => {
    it('should escape asterisk', () => {
      expect(escapeGlobCharacters('file*.txt')).to.equal(String.raw`file\*.txt`)
    })

    it('should escape question mark', () => {
      expect(escapeGlobCharacters('file?.txt')).to.equal(String.raw`file\?.txt`)
    })

    it('should escape square brackets', () => {
      expect(escapeGlobCharacters('[test]')).to.equal(String.raw`\[test\]`)
    })

    it('should escape curly braces', () => {
      expect(escapeGlobCharacters('{a,b}')).to.equal(String.raw`\{a,b\}`)
    })

    it('should escape parentheses', () => {
      expect(escapeGlobCharacters('(dashboard)')).to.equal(String.raw`\(dashboard\)`)
    })

    it('should escape multiple special characters', () => {
      expect(escapeGlobCharacters('[test]/(dashboard)/*.ts')).to.equal(String.raw`\[test\]/\(dashboard\)/\*.ts`)
    })

    it('should not modify strings without special characters', () => {
      expect(escapeGlobCharacters('normal-file.ts')).to.equal('normal-file.ts')
    })
  })

  describe('escapeIfExactMatch', () => {
    it('should not escape pattern without special characters', async () => {
      const result = await escapeIfExactMatch('normal-file.ts', '/tmp')
      expect(result).to.equal('normal-file.ts')
    })

    it('should escape pattern if file exists', async () => {
      sandbox.stub(fs, 'access').resolves()

      const result = await escapeIfExactMatch('[test].ts', '/tmp')

      expect(result).to.equal(String.raw`\[test\].ts`)
    })

    it('should not escape pattern if file does not exist', async () => {
      sandbox.stub(fs, 'access').rejects(new Error('ENOENT'))

      const result = await escapeIfExactMatch('[ab]*.ts', '/tmp')

      // File doesn't exist, treat as glob pattern
      expect(result).to.equal('[ab]*.ts')
    })
  })

  describe('collectFileMetadata', () => {
    it('should collect metadata for files', async () => {
      const mockStats = {
        mtime: new Date('2024-01-01'),
        size: 1234,
      }
      sandbox.stub(fs, 'stat').resolves(mockStats as unknown as Stats)

      const result = await collectFileMetadata(['file1.ts', 'file2.ts'], '/base')

      expect(result).to.have.lengthOf(2)
      expect(result[0]).to.deep.include({
        path: 'file1.ts',
        size: 1234,
      })
      expect(result[0].modifiedTime).to.deep.equal(new Date('2024-01-01'))
    })

    it('should handle stat errors gracefully', async () => {
      sandbox.stub(fs, 'stat').rejects(new Error('ENOENT'))

      const result = await collectFileMetadata(['missing.ts'], '/base')

      expect(result).to.have.lengthOf(1)
      expect(result[0].path).to.equal('missing.ts')
      expect(result[0].size).to.equal(0)
      expect(result[0].modifiedTime.getTime()).to.equal(0)
    })

    it('should handle absolute paths', async () => {
      const statStub = sandbox.stub(fs, 'stat').resolves({
        mtime: new Date(),
        size: 100,
      } as unknown as Stats)

      await collectFileMetadata(['/absolute/path/file.ts'], '/base')

      // Should use absolute path directly, not join with base
      sandbox.assert.calledWith(statStub, '/absolute/path/file.ts')
    })
  })

  describe('extractPaths', () => {
    it('should extract paths from FileMetadata array', () => {
      const files: FileMetadata[] = [
        {modifiedTime: new Date(), path: 'file1.ts', size: 100},
        {modifiedTime: new Date(), path: 'file2.ts', size: 200},
      ]

      const paths = extractPaths(files)

      expect(paths).to.deep.equal(['file1.ts', 'file2.ts'])
    })

    it('should return empty array for empty input', () => {
      expect(extractPaths([])).to.deep.equal([])
    })
  })
})
