import {expect} from 'chai'

import {formatToolCall, formatToolResult} from '../../../src/utils/tool-display-formatter.js'

function testHelper() {
  // Empty function for testing
} 

describe('tool-display-formatter', () => {
  describe('formatToolCall', () => {
    it('should format simple tool calls', () => {
      const result = formatToolCall('read_file', {filePath: 'test.ts'})
      expect(result).to.equal('read_file(filePath: "test.ts")')
    })

    it('should truncate long file paths using formatPath', () => {
      const veryLongPath = '/very/long/path/to/a/file/with/very/long/path/name.ts'
      expect(veryLongPath.length).to.be.above(50)
      const result = formatToolCall('read_file', {filePath: veryLongPath})
      expect(result).to.include('name.ts')
      expect(result.length).to.be.at.most(100)
    })

    it('should truncate filename when filename itself is too long', () => {
      const longFilename = 'a'.repeat(60) + '.ts'
      const longPath = '/path/to/' + longFilename
      expect(longPath.length).to.be.above(50) 
      expect(longFilename.length).to.be.above(50) 
      const result = formatToolCall('read_file', {filePath: longPath})
      expect(result.length).to.be.at.most(100)
      expect(result).to.include('...')
    })

    it('should handle path with empty parts array', () => {
      const emptyPath = ''
      const result = formatToolCall('read_file', {filePath: emptyPath})
      expect(result).to.include('read_file')
    })

    it('should show relative path for short paths', () => {
      const shortPath = 'src/utils/test.ts'
      const result = formatToolCall('read_file', {filePath: shortPath})
      expect(result).to.include(shortPath)
    })

    it('should handle Windows paths', () => {
      const windowsPath = String.raw`C:\Users\test\file.ts`
      const result = formatToolCall('read_file', {filePath: windowsPath})
      expect(result).to.include('file.ts')
    })

    it('should omit undefined and null values', () => {
      const result = formatToolCall('read_file', {
        filePath: 'test.ts',
        limit: undefined,
        offset: null,
      })
      expect(result).to.equal('read_file(filePath: "test.ts")')
    })

    it('should handle symbol values in formatValue', () => {
      const sym = Symbol('test')
      const result = formatToolCall('test_tool', {symbol: sym})
      expect(result).to.include('test_tool')
      expect(result).to.include('symbol')
    })

    it('should truncate very long results', () => {
      const longString = 'a'.repeat(200)
      const result = formatToolCall('write_file', {
        content: longString,
        filePath: 'test.ts',
      })
      expect(result.length).to.be.at.most(100)
      expect(result).to.include('...')
    })
  })

  describe('formatToolResult', () => {
    describe('formatReadFileResult (via read_file)', () => {
      it('should format object with lines', () => {
        const result = formatToolResult('read_file', true, {lines: 42})
        expect(result).to.equal('Read 42 lines')
      })

      it('should format string result with line and byte count', () => {
        const content = 'line1\nline2\nline3'
        const result = formatToolResult('read_file', true, content)
        expect(result).to.include('Read 3 lines')
        expect(result).to.include('bytes')
      })

      it('should handle unknown format gracefully', () => {
        const result = formatToolResult('read_file', true, {unknown: 'data'})
        expect(result).to.equal('File read successfully')
      })

      it('should handle null result', () => {
        const result = formatToolResult('read_file', true, null)
        expect(result).to.equal('File read successfully')
      })
    })

    describe('formatWriteFileResult (via write_file)', () => {
      it('should format object with bytesWritten', () => {
        const result = formatToolResult('write_file', true, {bytesWritten: 1024})
        expect(result).to.equal('File written (1024 bytes)')
      })

      it('should format object with zero bytes', () => {
        const result = formatToolResult('write_file', true, {bytesWritten: 0})
        expect(result).to.equal('File written (0 bytes)')
      })

      it('should handle unknown format gracefully', () => {
        const result = formatToolResult('write_file', true, {unknown: 'data'})
        expect(result).to.equal('File written successfully')
      })

      it('should handle null result', () => {
        const result = formatToolResult('write_file', true, null)
        expect(result).to.equal('File written successfully')
      })
    })

    describe('formatEditFileResult (via edit_file)', () => {
      it('should format object with changes', () => {
        const result = formatToolResult('edit_file', true, {changes: 3})
        expect(result).to.equal('File edited (3 changes)')
      })

      it('should format object with zero changes', () => {
        const result = formatToolResult('edit_file', true, {changes: 0})
        expect(result).to.equal('File edited (0 changes)')
      })

      it('should handle unknown format gracefully', () => {
        const result = formatToolResult('edit_file', true, {unknown: 'data'})
        expect(result).to.equal('File edited successfully')
      })

      it('should handle null result', () => {
        const result = formatToolResult('edit_file', true, null)
        expect(result).to.equal('File edited successfully')
      })
    })

    describe('formatGlobFilesResult (via glob_files)', () => {
      it('should format array result', () => {
        const files = ['file1.ts', 'file2.ts', 'file3.ts']
        const result = formatToolResult('glob_files', true, files)
        expect(result).to.equal('Found 3 files')
      })

      it('should format object with files array', () => {
        const result = formatToolResult('glob_files', true, {files: ['a.ts', 'b.ts']})
        expect(result).to.equal('Found 2 files')
      })

      it('should handle empty array', () => {
        const result = formatToolResult('glob_files', true, [])
        expect(result).to.equal('Found 0 files')
      })

      it('should handle unknown format gracefully', () => {
        const result = formatToolResult('glob_files', true, {unknown: 'data'})
        expect(result).to.equal('Files found')
      })

      it('should handle null result', () => {
        const result = formatToolResult('glob_files', true, null)
        expect(result).to.equal('Files found')
      })
    })

    describe('formatGrepContentResult (via grep_content)', () => {
      it('should format array result', () => {
        const matches = [
          {file: 'test.ts', line: 1},
          {file: 'test.ts', line: 2},
        ]
        const result = formatToolResult('grep_content', true, matches)
        expect(result).to.equal('Found 2 matches')
      })

      it('should format object with matches array', () => {
        const result = formatToolResult('grep_content', true, {
          matches: [{file: 'a.ts'}, {file: 'b.ts'}],
        })
        expect(result).to.equal('Found 2 matches')
      })

      it('should format object with matchCount', () => {
        const result = formatToolResult('grep_content', true, {matchCount: 5})
        expect(result).to.equal('Found 5 matches')
      })

      it('should handle empty array', () => {
        const result = formatToolResult('grep_content', true, [])
        expect(result).to.equal('Found 0 matches')
      })

      it('should handle unknown format gracefully', () => {
        const result = formatToolResult('grep_content', true, {unknown: 'data'})
        expect(result).to.equal('Matches found')
      })

      it('should handle null result', () => {
        const result = formatToolResult('grep_content', true, null)
        expect(result).to.equal('Matches found')
      })
    })

    describe('formatSearchHistoryResult (via search_history)', () => {
      it('should format array result', () => {
        const items = [
          {query: 'test1', timestamp: '2024-01-01'},
          {query: 'test2', timestamp: '2024-01-02'},
        ]
        const result = formatToolResult('search_history', true, items)
        expect(result).to.equal('Found 2 history items')
      })

      it('should format object with items array', () => {
        const result = formatToolResult('search_history', true, {
          items: [{query: 'test1'}, {query: 'test2'}],
        })
        expect(result).to.equal('Found 2 history items')
      })

      it('should handle empty array', () => {
        const result = formatToolResult('search_history', true, [])
        expect(result).to.equal('Found 0 history items')
      })

      it('should handle unknown format gracefully', () => {
        const result = formatToolResult('search_history', true, {unknown: 'data'})
        expect(result).to.equal('History searched')
      })

      it('should handle null result', () => {
        const result = formatToolResult('search_history', true, null)
        expect(result).to.equal('History searched')
      })
    })

    describe('formatGenericResult (via unknown tool)', () => {
      it('should format null result', () => {
        const result = formatToolResult('unknown_tool', true, null)
        expect(result).to.equal('Success')
      })

      it('should format undefined result', () => {
        const result = formatToolResult('unknown_tool', true)
        expect(result).to.equal('Success')
      })

      it('should format string result with truncation', () => {
        const longString = 'a'.repeat(100)
        const result = formatToolResult('unknown_tool', true, longString)
        expect(result.length).to.be.at.most(60)
        expect(result).to.include('...')
      })

      it('should format number result', () => {
        const result = formatToolResult('unknown_tool', true, 42)
        expect(result).to.equal('42')
      })

      it('should format boolean result', () => {
        const result = formatToolResult('unknown_tool', true, true)
        expect(result).to.equal('true')
      })

      it('should format array result', () => {
        const result = formatToolResult('unknown_tool', true, [1, 2, 3])
        expect(result).to.equal('Returned 3 items')
      })

      it('should format object result', () => {
        const result = formatToolResult('unknown_tool', true, {key: 'value'})
        expect(result).to.equal('Success')
      })

      it('should handle function result', () => {
        const result = formatToolResult('unknown_tool', true, testHelper)
        expect(result).to.equal('Success')
      })

      it('should handle symbol result', () => {
        const sym = Symbol('test')
        const result = formatToolResult('unknown_tool', true, sym)
        expect(result).to.equal('Success')
      })
    })

    describe('error handling', () => {
      it('should format error results', () => {
        const result = formatToolResult('read_file', false, undefined, 'File not found')
        expect(result).to.equal('File not found')
      })

      it('should truncate long error messages', () => {
        const longError = 'a'.repeat(200)
        const result = formatToolResult('read_file', false, undefined, longError)
        expect(result.length).to.be.at.most(80)
        expect(result).to.include('...')
      })

      it('should handle unknown error', () => {
        const result = formatToolResult('read_file', false)
        expect(result).to.equal('Unknown error')
      })
    })
  })
})

