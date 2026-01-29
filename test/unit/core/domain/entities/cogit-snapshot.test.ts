/* eslint-disable camelcase */
/* eslint-disable mocha/max-top-level-suites */
import {expect} from 'chai'

import {CogitSnapshotAuthor} from '../../../../../src/server/core/domain/entities/cogit-snapshot-author.js'
import {CogitSnapshotFile} from '../../../../../src/server/core/domain/entities/cogit-snapshot-file.js'
import {CogitSnapshot} from '../../../../../src/server/core/domain/entities/cogit-snapshot.js'

describe('CogitSnapshotAuthor Entity', () => {
  const validAuthorData = {
    email: 'john@example.com',
    name: 'John Doe',
    when: '2025-11-17T10:00:00Z',
  }

  describe('Constructor', () => {
    it('should create a valid CogitSnapshotAuthor instance', () => {
      const author = new CogitSnapshotAuthor(validAuthorData)

      expect(author.email).to.equal(validAuthorData.email)
      expect(author.name).to.equal(validAuthorData.name)
      expect(author.when).to.be.instanceOf(Date)
      expect(author.when.toISOString()).to.equal('2025-11-17T10:00:00.000Z')
    })

    it('should parse ISO date string correctly', () => {
      const author = new CogitSnapshotAuthor({
        ...validAuthorData,
        when: '2024-06-15T14:30:00.000Z',
      })

      expect(author.when.getFullYear()).to.equal(2024)
      expect(author.when.getMonth()).to.equal(5) // June is month 5 (0-indexed)
      expect(author.when.getDate()).to.equal(15)
    })
  })

  describe('fromJson', () => {
    it('should create CogitSnapshotAuthor from valid JSON', () => {
      const author = CogitSnapshotAuthor.fromJson(validAuthorData)

      expect(author.email).to.equal(validAuthorData.email)
      expect(author.name).to.equal(validAuthorData.name)
      expect(author.when.toISOString()).to.equal('2025-11-17T10:00:00.000Z')
    })

    it('should throw TypeError when JSON is null', () => {
      expect(() => CogitSnapshotAuthor.fromJson(null)).to.throw(
        TypeError,
        'CogitSnapshotAuthor JSON must be an object',
      )
    })

    it('should throw TypeError when JSON is not an object', () => {
      expect(() => CogitSnapshotAuthor.fromJson('string')).to.throw(
        TypeError,
        'CogitSnapshotAuthor JSON must be an object',
      )
    })

    it('should throw TypeError when email is missing', () => {
      expect(() =>
        CogitSnapshotAuthor.fromJson({
          name: 'John Doe',
          when: '2025-11-17T10:00:00Z',
        }),
      ).to.throw(TypeError, 'CogitSnapshotAuthor JSON must have a string email field')
    })

    it('should throw TypeError when name is missing', () => {
      expect(() =>
        CogitSnapshotAuthor.fromJson({
          email: 'john@example.com',
          when: '2025-11-17T10:00:00Z',
        }),
      ).to.throw(TypeError, 'CogitSnapshotAuthor JSON must have a string name field')
    })

    it('should throw TypeError when when is missing', () => {
      expect(() =>
        CogitSnapshotAuthor.fromJson({
          email: 'john@example.com',
          name: 'John Doe',
        }),
      ).to.throw(TypeError, 'CogitSnapshotAuthor JSON must have a string when field')
    })
  })
})

describe('CogitSnapshot Entity', () => {
  const validAuthor = new CogitSnapshotAuthor({
    email: 'john@example.com',
    name: 'John Doe',
    when: '2025-11-17T10:00:00Z',
  })

  const validFile = new CogitSnapshotFile({
    content: 'SGVsbG8gV29ybGQ=',
    mode: '100644',
    path: '/structure/context.md',
    sha: '95d09f2b10159347eece71399a7e2e907ea3df4f',
    size: 11,
  })

  const validSnapshotParams = {
    author: validAuthor,
    branch: 'main',
    commitSha: 'abc123def456',
    files: [validFile],
    message: 'Latest commit message',
  }

  // API response format with snake_case
  const validApiResponse = {
    author: {
      email: 'john@example.com',
      name: 'John Doe',
      when: '2025-11-17T10:00:00Z',
    },
    branch: 'main',
    commit_sha: 'abc123def456',
    files: [
      {
        content: 'SGVsbG8gV29ybGQ=',
        mode: '100644',
        path: '/structure/context.md',
        sha: '95d09f2b10159347eece71399a7e2e907ea3df4f',
        size: 11,
      },
    ],
    message: 'Latest commit message',
  }

  describe('Constructor', () => {
    it('should create a valid CogitSnapshot instance', () => {
      const snapshot = new CogitSnapshot(validSnapshotParams)

      expect(snapshot.author).to.equal(validAuthor)
      expect(snapshot.branch).to.equal('main')
      expect(snapshot.commitSha).to.equal('abc123def456')
      expect(snapshot.files).to.have.lengthOf(1)
      expect(snapshot.message).to.equal('Latest commit message')
    })

    it('should create snapshot with empty files array', () => {
      const snapshot = new CogitSnapshot({
        ...validSnapshotParams,
        files: [],
      })

      expect(snapshot.files).to.have.lengthOf(0)
    })

    it('should create snapshot with multiple files', () => {
      const file2 = new CogitSnapshotFile({
        content: 'dGVzdA==',
        mode: '100644',
        path: '/design/context.md',
        sha: 'def456',
        size: 4,
      })

      const snapshot = new CogitSnapshot({
        ...validSnapshotParams,
        files: [validFile, file2],
      })

      expect(snapshot.files).to.have.lengthOf(2)
    })
  })

  describe('Immutability', () => {
    it('should create defensive copy of files array', () => {
      const files = [validFile]
      const snapshot = new CogitSnapshot({
        ...validSnapshotParams,
        files,
      })

      // Mutating original array should not affect snapshot
      files.push(
        new CogitSnapshotFile({
          content: 'dGVzdA==',
          mode: '100644',
          path: '/design/context.md',
          sha: 'def456',
          size: 4,
        }),
      )

      expect(snapshot.files).to.have.lengthOf(1)
    })

    it('should not expose mutable reference to original files array', () => {
      const files = [validFile]
      const snapshot = new CogitSnapshot({
        ...validSnapshotParams,
        files,
      })

      // The files array in snapshot should be a different reference
      expect(snapshot.files).to.not.equal(files)
    })
  })

  describe('fromJson', () => {
    it('should create CogitSnapshot from valid API response with snake_case', () => {
      const snapshot = CogitSnapshot.fromJson(validApiResponse)

      expect(snapshot.branch).to.equal('main')
      expect(snapshot.commitSha).to.equal('abc123def456')
      expect(snapshot.message).to.equal('Latest commit message')
      expect(snapshot.files).to.have.lengthOf(1)
      expect(snapshot.author.email).to.equal('john@example.com')
      expect(snapshot.author.name).to.equal('John Doe')
    })

    it('should correctly map commit_sha to commitSha', () => {
      const snapshot = CogitSnapshot.fromJson(validApiResponse)

      expect(snapshot.commitSha).to.equal('abc123def456')
    })

    it('should parse files array correctly', () => {
      const snapshot = CogitSnapshot.fromJson(validApiResponse)

      expect(snapshot.files[0].path).to.equal('/structure/context.md')
      expect(snapshot.files[0].content).to.equal('SGVsbG8gV29ybGQ=')
      expect(snapshot.files[0].decodeContent()).to.equal('Hello World')
    })

    it('should parse author correctly', () => {
      const snapshot = CogitSnapshot.fromJson(validApiResponse)

      expect(snapshot.author.email).to.equal('john@example.com')
      expect(snapshot.author.name).to.equal('John Doe')
      expect(snapshot.author.when.toISOString()).to.equal('2025-11-17T10:00:00.000Z')
    })

    it('should handle empty files array', () => {
      const snapshot = CogitSnapshot.fromJson({
        ...validApiResponse,
        files: [],
      })

      expect(snapshot.files).to.have.lengthOf(0)
    })

    it('should handle multiple files', () => {
      const snapshot = CogitSnapshot.fromJson({
        ...validApiResponse,
        files: [
          validApiResponse.files[0],
          {
            content: 'dGVzdA==',
            mode: '100644',
            path: '/design/context.md',
            sha: 'def456',
            size: 4,
          },
        ],
      })

      expect(snapshot.files).to.have.lengthOf(2)
      expect(snapshot.files[0].path).to.equal('/structure/context.md')
      expect(snapshot.files[1].path).to.equal('/design/context.md')
    })

    it('should throw TypeError when JSON is null', () => {
      expect(() => CogitSnapshot.fromJson(null)).to.throw(
        TypeError,
        'CogitSnapshot JSON must be an object',
      )
    })

    it('should throw TypeError when JSON is not an object', () => {
      expect(() => CogitSnapshot.fromJson('string')).to.throw(
        TypeError,
        'CogitSnapshot JSON must be an object',
      )
    })

    it('should throw TypeError when branch is missing', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          branch: undefined,
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a string branch field')
    })

    it('should throw TypeError when branch is not a string', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          branch: 123,
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a string branch field')
    })

    it('should throw TypeError when commit_sha is missing', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          author: validApiResponse.author,
          branch: 'main',
          files: [],
          message: 'test',
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a string commit_sha field')
    })

    it('should throw TypeError when commit_sha is not a string', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          commit_sha: 123,
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a string commit_sha field')
    })

    it('should throw TypeError when message is missing', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          author: validApiResponse.author,
          branch: 'main',
          commit_sha: 'abc123',
          files: [],
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a string message field')
    })

    it('should throw TypeError when files is missing', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          author: validApiResponse.author,
          branch: 'main',
          commit_sha: 'abc123',
          message: 'test',
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a files array')
    })

    it('should throw TypeError when files is not an array', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          files: 'not-array',
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have a files array')
    })

    it('should throw TypeError when author is missing', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          branch: 'main',
          commit_sha: 'abc123',
          files: [],
          message: 'test',
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have an author object')
    })

    it('should throw TypeError when author is not an object', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          author: 'not-object',
        }),
      ).to.throw(TypeError, 'CogitSnapshot JSON must have an author object')
    })

    it('should propagate TypeError from invalid file in files array', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          files: [{invalid: 'file'}],
        }),
      ).to.throw(TypeError)
    })

    it('should propagate TypeError from invalid author', () => {
      expect(() =>
        CogitSnapshot.fromJson({
          ...validApiResponse,
          author: {invalid: 'author'},
        }),
      ).to.throw(TypeError)
    })
  })
})
