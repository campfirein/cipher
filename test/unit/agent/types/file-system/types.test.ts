import {expectTypeOf} from 'expect-type'

import type {
  BufferEncoding,
  EditFileOptions,
  EditOperation,
  EditResult,
  FileContent,
  FileMetadata,
  FileSystemConfig,
  GlobOptions,
  GlobResult,
  ReadFileOptions,
  SearchMatch,
  SearchOptions,
  SearchResult,
  ValidationResult,
  WriteFileOptions,
  WriteResult,
} from '../../../../../src/agent/core/domain/file-system/types.js'

describe('cipher/file-system', () => {
  describe('Type Safety - BufferEncoding', () => {
    it('should include all Node.js buffer encodings', () => {
      const encodings: BufferEncoding[] = [
        'ascii',
        'base64',
        'base64url',
        'binary',
        'hex',
        'latin1',
        'ucs2',
        'ucs-2',
        'utf8',
        'utf16le',
      ]

      for (const encoding of encodings) {
        expectTypeOf<BufferEncoding>(encoding)
      }
    })

    it('should enforce specific encoding values', () => {
      const utf8: BufferEncoding = 'utf8'
      const base64: BufferEncoding = 'base64'
      const hex: BufferEncoding = 'hex'

      expectTypeOf<BufferEncoding>(utf8)
      expectTypeOf<BufferEncoding>(base64)
      expectTypeOf<BufferEncoding>(hex)
    })
  })

  describe('Type Safety - FileSystemConfig', () => {
    it('should enforce all required fields', () => {
      const config: FileSystemConfig = {
        allowedPaths: ['src', 'test'],
        blockedExtensions: ['.exe', '.dll'],
        blockedPaths: ['.git', 'node_modules/.bin'],
        maxFileSize: 10_485_760,
        workingDirectory: '/path/to/project',
      }

      expectTypeOf<string[]>(config.allowedPaths)
      expectTypeOf<string[]>(config.blockedExtensions)
      expectTypeOf<string[]>(config.blockedPaths)
      expectTypeOf<number>(config.maxFileSize)
      expectTypeOf<string>(config.workingDirectory)
    })

    it('should enforce array types for path lists', () => {
      const config: FileSystemConfig = {
        allowedPaths: [],
        blockedExtensions: [],
        blockedPaths: [],
        maxFileSize: 1000,
        workingDirectory: '.',
      }

      expectTypeOf<string[]>(config.allowedPaths)
      expectTypeOf<string[]>(config.blockedExtensions)
      expectTypeOf<string[]>(config.blockedPaths)
    })
  })

  describe('Type Safety - ReadFileOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: ReadFileOptions = {
        encoding: 'utf8',
        limit: 100,
        offset: 1,
      }

      expectTypeOf<BufferEncoding | undefined>(fullOptions.encoding)
      expectTypeOf<number | undefined>(fullOptions.limit)
      expectTypeOf<number | undefined>(fullOptions.offset)

      // Empty options is valid
      const emptyOptions: ReadFileOptions = {}
      expectTypeOf<ReadFileOptions>(emptyOptions)
    })

    it('should allow partial options', () => {
      const encodingOnly: ReadFileOptions = {encoding: 'utf8'}
      const limitOnly: ReadFileOptions = {limit: 50}
      const offsetOnly: ReadFileOptions = {offset: 10}

      expectTypeOf<ReadFileOptions>(encodingOnly)
      expectTypeOf<ReadFileOptions>(limitOnly)
      expectTypeOf<ReadFileOptions>(offsetOnly)
    })
  })

  describe('Type Safety - WriteFileOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: WriteFileOptions = {
        createDirs: true,
        encoding: 'utf8',
      }

      expectTypeOf<boolean | undefined>(fullOptions.createDirs)
      expectTypeOf<BufferEncoding | undefined>(fullOptions.encoding)

      // Empty options is valid
      const emptyOptions: WriteFileOptions = {}
      expectTypeOf<WriteFileOptions>(emptyOptions)
    })
  })

  describe('Type Safety - EditFileOptions', () => {
    it('should make encoding optional', () => {
      const withEncoding: EditFileOptions = {encoding: 'utf8'}
      const withoutEncoding: EditFileOptions = {}

      expectTypeOf<EditFileOptions>(withEncoding)
      expectTypeOf<EditFileOptions>(withoutEncoding)
      expectTypeOf<BufferEncoding | undefined>(withEncoding.encoding)
    })
  })

  describe('Type Safety - GlobOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: GlobOptions = {
        cwd: '/path/to/dir',
        includeMetadata: true,
        maxResults: 100,
      }

      expectTypeOf<string | undefined>(fullOptions.cwd)
      expectTypeOf<boolean | undefined>(fullOptions.includeMetadata)
      expectTypeOf<number | undefined>(fullOptions.maxResults)

      // Empty options is valid
      const emptyOptions: GlobOptions = {}
      expectTypeOf<GlobOptions>(emptyOptions)
    })
  })

  describe('Type Safety - SearchOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: SearchOptions = {
        caseInsensitive: true,
        contextLines: 3,
        cwd: '/path/to/search',
        globPattern: '**/*.ts',
        maxResults: 50,
      }

      expectTypeOf<boolean | undefined>(fullOptions.caseInsensitive)
      expectTypeOf<number | undefined>(fullOptions.contextLines)
      expectTypeOf<string | undefined>(fullOptions.cwd)
      expectTypeOf<string | undefined>(fullOptions.globPattern)
      expectTypeOf<number | undefined>(fullOptions.maxResults)

      // Empty options is valid
      const emptyOptions: SearchOptions = {}
      expectTypeOf<SearchOptions>(emptyOptions)
    })
  })

  describe('Type Safety - FileContent', () => {
    it('should enforce FileContent structure', () => {
      const fileContent: FileContent = {
        content: 'file content',
        encoding: 'utf8',
        formattedContent: '00001| file content',
        lines: 10,
        message: 'File read successfully',
        size: 1024,
        totalLines: 10,
        truncated: false,
      }

      expectTypeOf<string>(fileContent.content)
      expectTypeOf<string>(fileContent.encoding)
      expectTypeOf<string>(fileContent.formattedContent)
      expectTypeOf<number>(fileContent.lines)
      expectTypeOf<string>(fileContent.message)
      expectTypeOf<number>(fileContent.size)
      expectTypeOf<number>(fileContent.totalLines)
      expectTypeOf<boolean>(fileContent.truncated)
    })
  })

  describe('Type Safety - WriteResult', () => {
    it('should enforce WriteResult structure', () => {
      const result: WriteResult = {
        bytesWritten: 1024,
        path: '/path/to/file.txt',
        success: true,
      }

      expectTypeOf<number>(result.bytesWritten)
      expectTypeOf<string>(result.path)
      expectTypeOf<boolean>(result.success)
    })
  })

  describe('Type Safety - EditResult', () => {
    it('should enforce EditResult structure', () => {
      const result: EditResult = {
        bytesWritten: 2048,
        path: '/path/to/file.txt',
        replacements: 5,
        success: true,
      }

      expectTypeOf<number>(result.bytesWritten)
      expectTypeOf<string>(result.path)
      expectTypeOf<number>(result.replacements)
      expectTypeOf<boolean>(result.success)
    })
  })

  describe('Type Safety - FileMetadata', () => {
    it('should enforce FileMetadata structure', () => {
      const metadata: FileMetadata = {
        isDirectory: false,
        modified: new Date(),
        path: '/path/to/file.txt',
        size: 1024,
      }

      expectTypeOf<boolean>(metadata.isDirectory)
      expectTypeOf<Date>(metadata.modified)
      expectTypeOf<string>(metadata.path)
      expectTypeOf<number>(metadata.size)
    })
  })

  describe('Type Safety - GlobResult', () => {
    it('should enforce GlobResult structure', () => {
      const result: GlobResult = {
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/file1.txt',
            size: 100,
          },
        ],
        ignoredCount: 0,
        totalFound: 10,
        truncated: true,
      }

      expectTypeOf<FileMetadata[]>(result.files)
      expectTypeOf<number>(result.totalFound)
      expectTypeOf<boolean>(result.truncated)
      expectTypeOf<number>(result.ignoredCount)
    })
  })

  describe('Type Safety - SearchMatch', () => {
    it('should enforce SearchMatch structure', () => {
      const match: SearchMatch = {
        context: {
          after: ['line after'],
          before: ['line before'],
        },
        file: '/path/to/file.txt',
        line: 'matching line',
        lineNumber: 42,
      }

      expectTypeOf<string>(match.file)
      expectTypeOf<string>(match.line)
      expectTypeOf<number>(match.lineNumber)
      expectTypeOf<undefined | {after: string[]; before: string[]}>(match.context)
    })

    it('should make context optional', () => {
      const withoutContext: SearchMatch = {
        file: '/path/to/file.txt',
        line: 'matching line',
        lineNumber: 10,
      }

      expectTypeOf<SearchMatch>(withoutContext)
      expectTypeOf<undefined | {after: string[]; before: string[]}>(withoutContext.context)
    })

    it('should enforce context structure when present', () => {
      const match: SearchMatch = {
        context: {
          after: ['line1', 'line2'],
          before: ['line3', 'line4'],
        },
        file: '/path',
        line: 'match',
        lineNumber: 5,
      }

      if (match.context) {
        expectTypeOf<string[]>(match.context.before)
        expectTypeOf<string[]>(match.context.after)
      }
    })
  })

  describe('Type Safety - SearchResult', () => {
    it('should enforce SearchResult structure', () => {
      const result: SearchResult = {
        filesSearched: 10,
        matches: [
          {
            file: '/file.txt',
            line: 'match',
            lineNumber: 1,
          },
        ],
        totalMatches: 5,
        truncated: false,
      }

      expectTypeOf<number>(result.filesSearched)
      expectTypeOf<SearchMatch[]>(result.matches)
      expectTypeOf<number>(result.totalMatches)
      expectTypeOf<boolean>(result.truncated)
    })
  })

  describe('Type Safety - EditOperation', () => {
    it('should enforce EditOperation structure', () => {
      const operation: EditOperation = {
        newString: 'new value',
        oldString: 'old value',
        replaceAll: true,
      }

      expectTypeOf<string>(operation.newString)
      expectTypeOf<string>(operation.oldString)
      expectTypeOf<boolean | undefined>(operation.replaceAll)
    })

    it('should make replaceAll optional', () => {
      const withReplaceAll: EditOperation = {
        newString: 'new',
        oldString: 'old',
        replaceAll: false,
      }

      const withoutReplaceAll: EditOperation = {
        newString: 'new',
        oldString: 'old',
      }

      expectTypeOf<EditOperation>(withReplaceAll)
      expectTypeOf<EditOperation>(withoutReplaceAll)
    })
  })

  describe('Type Safety - ValidationResult (Discriminated Union)', () => {
    it('should enforce valid variant structure', () => {
      const validResult: ValidationResult = {
        normalizedPath: '/absolute/path/to/file.txt',
        valid: true,
      }

      expectTypeOf<ValidationResult>(validResult)

      if (validResult.valid) {
        expectTypeOf<string>(validResult.normalizedPath)
        expectTypeOf<true>(validResult.valid)
      }
    })

    it('should enforce invalid variant structure', () => {
      const invalidResult: ValidationResult = {
        error: 'Path is outside allowed directory',
        valid: false,
      }

      expectTypeOf<ValidationResult>(invalidResult)

      if (!invalidResult.valid) {
        expectTypeOf<string>(invalidResult.error)
        expectTypeOf<false>(invalidResult.valid)
      }
    })

    it('should support type narrowing based on valid field', () => {
      // Test with valid result
      const validResult: ValidationResult = {
        normalizedPath: '/path',
        valid: true,
      }

      if (validResult.valid) {
        // Valid variant should have normalizedPath
        expectTypeOf<string>(validResult.normalizedPath)
      }

      // Test with invalid result
      const invalidResult: ValidationResult = {
        error: 'error message',
        valid: false,
      }

      if (!invalidResult.valid) {
        // Invalid variant should have error
        expectTypeOf<string>(invalidResult.error)
      }

      // Verify type-level properties using Extract
      type ValidResult = Extract<ValidationResult, {valid: true}>
      type HasError = 'error' extends keyof ValidResult ? true : false
      expectTypeOf<HasError>().toEqualTypeOf<false>()

      type InvalidResult = Extract<ValidationResult, {valid: false}>
      type HasNormalizedPath = 'normalizedPath' extends keyof InvalidResult ? true : false
      expectTypeOf<HasNormalizedPath>().toEqualTypeOf<false>()
    })

    it('should prevent mixed properties', () => {
      // Verify valid variant cannot have error property
      type ValidVariant = Extract<ValidationResult, {valid: true}>
      type ValidHasError = 'error' extends keyof ValidVariant ? true : false
      expectTypeOf<ValidHasError>().toEqualTypeOf<false>()

      // Verify invalid variant cannot have normalizedPath property
      type InvalidVariant = Extract<ValidationResult, {valid: false}>
      type InvalidHasPath = 'normalizedPath' extends keyof InvalidVariant ? true : false
      expectTypeOf<InvalidHasPath>().toEqualTypeOf<false>()
    })

    it('should require variant-specific property', () => {
      // Verify valid variant requires normalizedPath
      type ValidVariant = Extract<ValidationResult, {valid: true}>
      type ValidHasPath = 'normalizedPath' extends keyof ValidVariant ? true : false
      expectTypeOf<ValidHasPath>().toEqualTypeOf<true>()

      // Verify invalid variant requires error
      type InvalidVariant = Extract<ValidationResult, {valid: false}>
      type InvalidHasError = 'error' extends keyof InvalidVariant ? true : false
      expectTypeOf<InvalidHasError>().toEqualTypeOf<true>()
    })
  })

  describe('Type Safety - Complex Scenarios', () => {
    it('should support full read operation flow', () => {
      const options: ReadFileOptions = {
        encoding: 'utf8',
        limit: 100,
        offset: 1,
      }

      const result: FileContent = {
        content: 'file content',
        encoding: 'utf8',
        formattedContent: '00001| file content',
        lines: 50,
        message: 'File read successfully',
        size: 1024,
        totalLines: 50,
        truncated: false,
      }

      expectTypeOf<ReadFileOptions>(options)
      expectTypeOf<FileContent>(result)
    })

    it('should support full write operation flow', () => {
      const options: WriteFileOptions = {
        createDirs: true,
        encoding: 'utf8',
      }

      const result: WriteResult = {
        bytesWritten: 2048,
        path: '/absolute/path/to/file.txt',
        success: true,
      }

      expectTypeOf<WriteFileOptions>(options)
      expectTypeOf<WriteResult>(result)
    })

    it('should support full edit operation flow', () => {
      const operation: EditOperation = {
        newString: 'new text',
        oldString: 'old text',
        replaceAll: true,
      }

      const options: EditFileOptions = {
        encoding: 'utf8',
      }

      const result: EditResult = {
        bytesWritten: 1500,
        path: '/path/to/file.txt',
        replacements: 3,
        success: true,
      }

      expectTypeOf<EditOperation>(operation)
      expectTypeOf<EditFileOptions>(options)
      expectTypeOf<EditResult>(result)
    })

    it('should support full glob operation flow', () => {
      const options: GlobOptions = {
        cwd: '/project',
        includeMetadata: true,
        maxResults: 100,
      }

      const result: GlobResult = {
        files: [
          {
            isDirectory: false,
            modified: new Date(),
            path: '/file1.txt',
            size: 100,
          },
        ],
        ignoredCount: 5,
        totalFound: 150,
        truncated: true,
      }

      expectTypeOf<GlobOptions>(options)
      expectTypeOf<GlobResult>(result)
    })

    it('should support full search operation flow', () => {
      const options: SearchOptions = {
        caseInsensitive: true,
        contextLines: 2,
        cwd: '/project',
        globPattern: '**/*.ts',
        maxResults: 50,
      }

      const result: SearchResult = {
        filesSearched: 25,
        matches: [
          {
            context: {
              after: ['after line'],
              before: ['before line'],
            },
            file: '/file.ts',
            line: 'matching line',
            lineNumber: 10,
          },
        ],
        totalMatches: 15,
        truncated: false,
      }

      expectTypeOf<SearchOptions>(options)
      expectTypeOf<SearchResult>(result)
    })
  })
})
