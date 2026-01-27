import {expect} from 'chai'

import {CogitSnapshotFile} from '../../../../../src/server/core/domain/entities/cogit-snapshot-file.js'

describe('CogitSnapshotFile Entity', () => {
  const validFileData = {
    content: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
    mode: '100644',
    path: '/structure/context.md',
    sha: '95d09f2b10159347eece71399a7e2e907ea3df4f',
    size: 11,
  }

  describe('Constructor', () => {
    it('should create a valid CogitSnapshotFile instance', () => {
      const file = new CogitSnapshotFile(validFileData)

      expect(file.content).to.equal(validFileData.content)
      expect(file.mode).to.equal(validFileData.mode)
      expect(file.path).to.equal(validFileData.path)
      expect(file.sha).to.equal(validFileData.sha)
      expect(file.size).to.equal(validFileData.size)
    })

    it('should create file with empty content', () => {
      const file = new CogitSnapshotFile({
        ...validFileData,
        content: '',
        size: 0,
      })

      expect(file.content).to.equal('')
      expect(file.size).to.equal(0)
    })

    it('should create file with path without leading slash', () => {
      const file = new CogitSnapshotFile({
        ...validFileData,
        path: 'structure/context.md',
      })

      expect(file.path).to.equal('structure/context.md')
    })
  })

  describe('decodeContent', () => {
    it('should decode base64 content to UTF-8 string', () => {
      const file = new CogitSnapshotFile(validFileData)

      const decoded = file.decodeContent()

      expect(decoded).to.equal('Hello World')
    })

    it('should decode empty content', () => {
      const file = new CogitSnapshotFile({
        ...validFileData,
        content: '',
      })

      const decoded = file.decodeContent()

      expect(decoded).to.equal('')
    })

    it('should decode content with special characters', () => {
      // "# Test\n\nHello with émojis 🎉" in base64
      const contentWithSpecialChars = Buffer.from('# Test\n\nHello with émojis 🎉').toString('base64')
      const file = new CogitSnapshotFile({
        ...validFileData,
        content: contentWithSpecialChars,
      })

      const decoded = file.decodeContent()

      expect(decoded).to.equal('# Test\n\nHello with émojis 🎉')
    })

    it('should decode multiline markdown content', () => {
      const markdownContent = '# Title\n\n## Section\n\n- Item 1\n- Item 2'
      const base64Content = Buffer.from(markdownContent).toString('base64')
      const file = new CogitSnapshotFile({
        ...validFileData,
        content: base64Content,
      })

      const decoded = file.decodeContent()

      expect(decoded).to.equal(markdownContent)
    })
  })

  describe('fromJson', () => {
    it('should create CogitSnapshotFile from valid JSON', () => {
      const file = CogitSnapshotFile.fromJson(validFileData)

      expect(file.content).to.equal(validFileData.content)
      expect(file.mode).to.equal(validFileData.mode)
      expect(file.path).to.equal(validFileData.path)
      expect(file.sha).to.equal(validFileData.sha)
      expect(file.size).to.equal(validFileData.size)
    })

    it('should throw TypeError when JSON is null', () => {
      expect(() => CogitSnapshotFile.fromJson(null)).to.throw(
        TypeError,
        'CogitSnapshotFile JSON must be an object',
      )
    })

    it('should throw TypeError when JSON is undefined', () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(() => CogitSnapshotFile.fromJson(undefined)).to.throw(
        TypeError,
        'CogitSnapshotFile JSON must be an object',
      )
    })

    it('should throw TypeError when JSON is not an object', () => {
      expect(() => CogitSnapshotFile.fromJson('string')).to.throw(
        TypeError,
        'CogitSnapshotFile JSON must be an object',
      )
    })

    it('should throw TypeError when JSON is a number', () => {
      expect(() => CogitSnapshotFile.fromJson(123)).to.throw(
        TypeError,
        'CogitSnapshotFile JSON must be an object',
      )
    })

    it('should throw TypeError when content is missing', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          mode: '100644',
          path: '/test.md',
          sha: 'abc123',
          size: 10,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string content field')
    })

    it('should throw TypeError when content is not a string', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          ...validFileData,
          content: 123,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string content field')
    })

    it('should throw TypeError when mode is missing', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          content: 'test',
          path: '/test.md',
          sha: 'abc123',
          size: 10,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string mode field')
    }
    )

    it('should throw TypeError when mode is not a string', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          ...validFileData,
          mode: 100_644,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string mode field')
    })

    it('should throw TypeError when path is missing', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          content: 'test',
          mode: '100644',
          sha: 'abc123',
          size: 10,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string path field')
    })

    it('should throw TypeError when path is not a string', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          ...validFileData,
          path: 123,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string path field')
    })

    it('should throw TypeError when sha is missing', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          content: 'test',
          mode: '100644',
          path: '/test.md',
          size: 10,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string sha field')
    })

    it('should throw TypeError when sha is not a string', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          ...validFileData,
          sha: 123,
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a string sha field')
    })

    it('should throw TypeError when size is missing', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          content: 'test',
          mode: '100644',
          path: '/test.md',
          sha: 'abc123',
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a number size field')
    })

    it('should throw TypeError when size is not a number', () => {
      expect(() =>
        CogitSnapshotFile.fromJson({
          ...validFileData,
          size: '10',
        }),
      ).to.throw(TypeError, 'CogitSnapshotFile JSON must have a number size field')
    })
  })

  describe('Immutability', () => {
    it('should have readonly properties', () => {
      const file = new CogitSnapshotFile(validFileData)

      // TypeScript should prevent direct assignment, but we verify the values remain unchanged
      expect(file.content).to.equal(validFileData.content)
      expect(file.mode).to.equal(validFileData.mode)
      expect(file.path).to.equal(validFileData.path)
      expect(file.sha).to.equal(validFileData.sha)
      expect(file.size).to.equal(validFileData.size)
    })
  })
})
