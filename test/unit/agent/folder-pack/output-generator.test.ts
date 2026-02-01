import {expect} from 'chai'

import type {FolderPackResult} from '../../../../src/agent/core/domain/folder-pack/types.js'

import {
  generatePackedXml,
  generatePackedXmlCompact,
} from '../../../../src/agent/infra/folder-pack/output-generator.js'

function createMockResult(overrides: Partial<FolderPackResult> = {}): FolderPackResult {
  return {
    config: {
      extractPdfText: true,
      ignore: [],
      include: ['**/*'],
      includeTree: true,
      maxFileSize: 10 * 1024 * 1024,
      maxLinesPerFile: 10_000,
      useGitignore: true,
    },
    directoryTree: '',
    durationMs: 100,
    fileCount: 0,
    files: [],
    rootPath: '/test/project',
    skippedCount: 0,
    skippedFiles: [],
    totalCharacters: 0,
    totalLines: 0,
    ...overrides,
  }
}

describe('output-generator', () => {
  describe('generatePackedXml', () => {
    it('should generate valid XML structure', () => {
      const result = createMockResult()
      const xml = generatePackedXml(result)

      expect(xml).to.include('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).to.include('<packed_folder>')
      expect(xml).to.include('</packed_folder>')
      expect(xml).to.include('<metadata>')
      expect(xml).to.include('</metadata>')
      expect(xml).to.include('<config>')
      expect(xml).to.include('</config>')
      expect(xml).to.include('<files>')
      expect(xml).to.include('</files>')
      expect(xml).to.include('<summary>')
      expect(xml).to.include('</summary>')
    })

    it('should include metadata correctly', () => {
      const result = createMockResult({
        durationMs: 250,
        fileCount: 5,
        rootPath: '/my/project',
        skippedCount: 2,
        totalCharacters: 50_000,
        totalLines: 1000,
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('<root_path>/my/project</root_path>')
      expect(xml).to.include('<file_count>5</file_count>')
      expect(xml).to.include('<skipped_count>2</skipped_count>')
      expect(xml).to.include('<total_lines>1000</total_lines>')
      expect(xml).to.include('<total_characters>50000</total_characters>')
      expect(xml).to.include('<duration_ms>250</duration_ms>')
    })

    it('should include config information', () => {
      const result = createMockResult({
        config: {
          extractPdfText: true,
          ignore: ['*.log', '*.tmp'],
          include: ['**/*'],
          includeTree: false,
          maxFileSize: 5 * 1024 * 1024,
          maxLinesPerFile: 5000,
          useGitignore: false,
        },
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('<use_gitignore>false</use_gitignore>')
      expect(xml).to.include('<include_tree>false</include_tree>')
      expect(xml).to.include('<extract_pdf_text>true</extract_pdf_text>')
      expect(xml).to.include('<max_lines_per_file>5000</max_lines_per_file>')
      expect(xml).to.include('<custom_ignores>2 patterns</custom_ignores>')
    })

    it('should include directory tree in CDATA', () => {
      const result = createMockResult({
        directoryTree: 'src/\n├── index.ts\n└── utils.ts',
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('<directory_structure>')
      expect(xml).to.include('<![CDATA[src/')
      expect(xml).to.include('├── index.ts')
      expect(xml).to.include(']]>')
      expect(xml).to.include('</directory_structure>')
    })

    it('should not include directory_structure when empty', () => {
      const result = createMockResult({
        directoryTree: '',
      })
      const xml = generatePackedXml(result)

      expect(xml).to.not.include('<directory_structure>')
    })

    it('should include file content with attributes', () => {
      const result = createMockResult({
        fileCount: 1,
        files: [
          {
            content: 'const x = 1;',
            fileType: 'code',
            lineCount: 1,
            path: 'src/index.ts',
            size: 12,
            truncated: false,
          },
        ],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('path="src/index.ts"')
      expect(xml).to.include('lines="1"')
      expect(xml).to.include('size="12"')
      expect(xml).to.include('type="code"')
      expect(xml).to.include('const x = 1;')
    })

    it('should include truncated attribute when file is truncated', () => {
      const result = createMockResult({
        fileCount: 1,
        files: [
          {
            content: 'truncated...',
            lineCount: 10_000,
            path: 'large.ts',
            size: 1_000_000,
            truncated: true,
          },
        ],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('truncated="true"')
    })

    it('should escape XML special characters in content', () => {
      const result = createMockResult({
        fileCount: 1,
        files: [
          {
            content: 'const x = a < b && c > d;',
            lineCount: 1,
            path: 'test.ts',
            size: 25,
            truncated: false,
          },
        ],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('&lt;')
      expect(xml).to.include('&amp;&amp;')
      expect(xml).to.include('&gt;')
    })

    it('should escape XML special characters in file paths', () => {
      const result = createMockResult({
        fileCount: 1,
        files: [
          {
            content: 'content',
            lineCount: 1,
            path: 'src/test&file.ts',
            size: 7,
            truncated: false,
          },
        ],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('path="src/test&amp;file.ts"')
    })

    it('should include skipped files section when there are skipped files', () => {
      const result = createMockResult({
        skippedCount: 2,
        skippedFiles: [
          {path: 'binary.exe', reason: 'binary'},
          {message: 'File too large', path: 'huge.log', reason: 'size-limit'},
        ],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('<skipped_files>')
      expect(xml).to.include('path="binary.exe"')
      expect(xml).to.include('reason="binary"')
      expect(xml).to.include('path="huge.log"')
      expect(xml).to.include('reason="size-limit"')
      expect(xml).to.include('message="File too large"')
      expect(xml).to.include('</skipped_files>')
    })

    it('should not include skipped_files section when empty', () => {
      const result = createMockResult({
        skippedCount: 0,
        skippedFiles: [],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.not.include('<skipped_files>')
    })

    it('should include summary with file type breakdown', () => {
      const result = createMockResult({
        fileCount: 3,
        files: [
          {content: '', fileType: 'code', lineCount: 1, path: 'a.ts', size: 0, truncated: false},
          {content: '', fileType: 'code', lineCount: 1, path: 'b.ts', size: 0, truncated: false},
          {content: '', fileType: 'config', lineCount: 1, path: 'c.json', size: 0, truncated: false},
        ],
        totalLines: 3,
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('<description>')
      expect(xml).to.include('3 files')
      expect(xml).to.include('<file_types>')
      expect(xml).to.include('code: 2')
      expect(xml).to.include('config: 1')
    })

    it('should include skip reason breakdown in summary', () => {
      const result = createMockResult({
        skippedCount: 3,
        skippedFiles: [
          {path: 'a.exe', reason: 'binary'},
          {path: 'b.dll', reason: 'binary'},
          {path: 'c.log', reason: 'size-limit'},
        ],
      })
      const xml = generatePackedXml(result)

      expect(xml).to.include('<skip_reasons>')
      expect(xml).to.include('binary: 2')
      expect(xml).to.include('size-limit: 1')
    })

    it('should handle files without fileType', () => {
      const result = createMockResult({
        fileCount: 1,
        files: [
          {content: 'content', lineCount: 1, path: 'unknown.xyz', size: 7, truncated: false},
        ],
      })
      const xml = generatePackedXml(result)

      // Should not have type attribute
      expect(xml).to.include('path="unknown.xyz"')
      expect(xml).to.include('lines="1"')
      // Type should be categorized as 'unknown' in summary
      expect(xml).to.include('unknown: 1')
    })
  })

  describe('generatePackedXmlCompact', () => {
    it('should generate compact XML without extra whitespace', () => {
      const result = createMockResult({
        directoryTree: 'test.ts',
        fileCount: 1,
        files: [
          {content: 'const x = 1;', lineCount: 1, path: 'test.ts', size: 12, truncated: false},
        ],
      })

      const fullXml = generatePackedXml(result)
      const compactXml = generatePackedXmlCompact(result)

      // Compact version should have fewer characters due to trimmed lines
      expect(compactXml.length).to.be.lessThan(fullXml.length)

      // But still contain the essential elements
      expect(compactXml).to.include('<packed_folder>')
      expect(compactXml).to.include('<metadata>')
      expect(compactXml).to.include('<files>')
    })

    it('should still be valid XML structure', () => {
      const result = createMockResult({
        fileCount: 1,
        files: [
          {content: 'code', lineCount: 1, path: 'test.ts', size: 4, truncated: false},
        ],
      })
      const xml = generatePackedXmlCompact(result)

      expect(xml).to.include('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).to.include('</packed_folder>')
    })
  })
})
