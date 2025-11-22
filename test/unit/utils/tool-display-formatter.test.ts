import { expect } from 'chai'

import { formatToolCall, formatToolResult } from '../../../src/utils/tool-display-formatter.js'

describe('tool-display-formatter', () => {
    describe('formatToolCall()', () => {
        describe('basic formatting', () => {
            it('should format a simple tool call with string arguments', () => {
                const result = formatToolCall('read_file', { filePath: 'test.ts' })
                expect(result).to.equal('read_file(filePath: "test.ts")')
            })

            it('should format a tool call with number arguments', () => {
                const result = formatToolCall('read_file', { filePath: 'test.ts', limit: 100 })
                expect(result).to.equal('read_file(filePath: "test.ts", limit: 100)')
            })

            it('should format a tool call with boolean arguments', () => {
                const result = formatToolCall('write_file', {
                    content: 'test',
                    createDirs: true,
                    filePath: 'test.ts',
                })
                expect(result).to.equal('write_file(content: "test", createDirs: true, filePath: "test.ts")')
            })

            it('should format a tool call with no arguments', () => {
                const result = formatToolCall('some_tool', {})
                expect(result).to.equal('some_tool()')
            })
        })

        describe('argument filtering', () => {
            it('should filter out undefined values', () => {
                const result = formatToolCall('test_tool', {
                    defined: 'value',
                    undefined,
                })
                expect(result).to.equal('test_tool(defined: "value")')
            })

            it('should filter out null values', () => {
                const result = formatToolCall('test_tool', {
                    defined: 'value',
                    null: null,
                })
                expect(result).to.equal('test_tool(defined: "value")')
            })

            it('should handle all undefined arguments', () => {
                const result = formatToolCall('test_tool', {
                    arg1: undefined,
                    arg2: null,
                })
                expect(result).to.equal('test_tool()')
            })
        })

        describe('path formatting', () => {
            it('should show basename for long absolute paths', () => {
                const longPath = '/very/long/path/to/some/deeply/nested/directory/file.ts'
                const result = formatToolCall('read_file', { filePath: longPath })
                expect(result).to.equal('read_file(filePath: "file.ts")')
            })

            it('should preserve short paths as-is', () => {
                const result = formatToolCall('read_file', { filePath: 'short/path.ts' })
                expect(result).to.equal('read_file(filePath: "short/path.ts")')
            })

            it('should handle Windows-style paths', () => {
                // Test with Windows-style path using backslashes
                const windowsPath = String.raw`C:\Users\Someone\Documents\file.ts`
                const result = formatToolCall('read_file', { filePath: windowsPath })

                // The formatter should detect this as a path (contains backslashes)
                // and extract the filename
                expect(result).to.include('filePath:')
                expect(result).to.include('file.ts')
            })

            it('should handle Unix-style paths consistently', () => {
                // Unix-style paths should work on all platforms
                const unixPath = '/home/user/documents/project/src/index.ts'
                const result = formatToolCall('read_file', { filePath: unixPath })
                // Path is 43 chars, under MAX_STRING_LENGTH (50), so it's preserved
                expect(result).to.equal('read_file(filePath: "/home/user/documents/project/src/index.ts")')
            })

            it('should handle mixed path separators', () => {
                // Some Windows tools generate mixed separators
                const mixedPath = String.raw`C:/Users/Someone\Documents/file.ts`
                const result = formatToolCall('read_file', { filePath: mixedPath })

                // Should detect as path and extract filename
                expect(result).to.include('filePath:')
                expect(result).to.include('file.ts')
            })

            it('should handle Windows UNC paths', () => {
                const uncPath = String.raw`\\server\share\folder\file.ts`
                const result = formatToolCall('read_file', { filePath: uncPath })

                // Should detect as path and extract filename
                expect(result).to.include('filePath:')
                expect(result).to.include('file.ts')
            })

            it('should handle relative paths with forward slashes', () => {
                const relativePath = './src/utils/file.ts'
                const result = formatToolCall('read_file', { filePath: relativePath })
                expect(result).to.equal('read_file(filePath: "./src/utils/file.ts")')
            })

            it('should handle relative paths with backslashes', () => {
                const relativePath = String.raw`..\config\settings.json`
                const result = formatToolCall('read_file', { filePath: relativePath })

                // Should detect as path
                expect(result).to.include('filePath:')
                expect(result).to.include('settings.json')
            })

            it('should truncate very long filenames', () => {
                const veryLongFilename = 'this_is_a_very_long_filename_that_exceeds_the_maximum_allowed_length_for_display.ts'
                const result = formatToolCall('read_file', { filePath: veryLongFilename })
                expect(result).to.include('...')
            })
        })

        describe('string truncation', () => {
            it('should truncate long string values', () => {
                const longString = 'a'.repeat(100)
                const result = formatToolCall('test_tool', { content: longString })
                expect(result).to.include('...')
                expect(result.length).to.be.lessThan(longString.length + 50)
            })

            it('should not truncate strings within the limit', () => {
                const shortString = 'short content'
                const result = formatToolCall('test_tool', { content: shortString })
                expect(result).to.equal('test_tool(content: "short content")')
            })
        })

        describe('array formatting', () => {
            it('should show array item count', () => {
                const result = formatToolCall('test_tool', { items: [1, 2, 3, 4, 5] })
                expect(result).to.equal('test_tool(items: [5 items])')
            })

            it('should handle empty arrays', () => {
                const result = formatToolCall('test_tool', { items: [] })
                expect(result).to.equal('test_tool(items: [0 items])')
            })

            it('should handle arrays with various types', () => {
                const result = formatToolCall('test_tool', { items: [1, 'two', { three: 3 }, [4]] })
                expect(result).to.equal('test_tool(items: [4 items])')
            })
        })

        describe('object formatting', () => {
            it('should show object field count', () => {
                const result = formatToolCall('test_tool', {
                    config: { key1: 'value1', key2: 'value2', key3: 'value3' },
                })
                expect(result).to.equal('test_tool(config: {3 fields})')
            })

            it('should handle empty objects', () => {
                const result = formatToolCall('test_tool', { config: {} })
                expect(result).to.equal('test_tool(config: {0 fields})')
            })

            it('should handle nested objects', () => {
                const result = formatToolCall('test_tool', {
                    config: { nested: { deeply: { value: 'test' } } },
                })
                expect(result).to.equal('test_tool(config: {1 fields})')
            })
        })

        describe('line length truncation', () => {
            it('should truncate very long output', () => {
                const args: Record<string, unknown> = {}
                for (let i = 0; i < 20; i++) {
                    args[`arg${i}`] = `value${i}`
                }

                const result = formatToolCall('test_tool', args)
                expect(result).to.include('...')
                expect(result.length).to.be.at.most(103) // MAX_LINE_LENGTH (100) + '...' (3)
            })

            it('should not truncate output within limit', () => {
                const result = formatToolCall('short_tool', { a: '1', b: '2' })
                expect(result).to.not.include('...')
            })
        })

        describe('mixed argument types', () => {
            it('should handle mix of all types', () => {
                const result = formatToolCall('complex_tool', {
                    array: [1, 2, 3],
                    boolean: true,
                    number: 42,
                    object: { a: 1, b: 2 },
                    string: 'test',
                })
                expect(result).to.include('string: "test"')
                expect(result).to.include('number: 42')
                expect(result).to.include('boolean: true')
                expect(result).to.include('array: [3 items]')
                expect(result).to.include('object: {2 fields}')
            })
        })
    })

    describe('formatToolResult()', () => {
        describe('error handling', () => {
            it('should format error messages', () => {
                const result = formatToolResult('read_file', false, undefined, 'ENOENT: no such file or directory')
                expect(result).to.equal('ENOENT: no such file or directory')
            })

            it('should truncate long error messages', () => {
                const longError = 'e'.repeat(100)
                const result = formatToolResult('read_file', false, undefined, longError)
                expect(result).to.include('...')
                expect(result.length).to.be.at.most(83) // 80 + '...'
            })

            it('should handle missing error message', () => {
                const result = formatToolResult('read_file', false)
                expect(result).to.equal('Unknown error')
            })

            it('should handle undefined error', () => {
                const result = formatToolResult('read_file', false)
                expect(result).to.equal('Unknown error')
            })
        })

        describe('read_file results', () => {
            it('should format result with line count in object', () => {
                const result = formatToolResult('read_file', true, { lines: 150 })
                expect(result).to.equal('Read 150 lines')
            })

            it('should format string result with line and byte count', () => {
                const content = 'line 1\nline 2\nline 3'
                const result = formatToolResult('read_file', true, content)
                expect(result).to.include('Read 3 lines')
                expect(result).to.include('bytes')
            })

            it('should handle single-line content', () => {
                const content = 'single line'
                const result = formatToolResult('read_file', true, content)
                expect(result).to.equal('Read 1 lines (11 bytes)')
            })

            it('should handle empty file', () => {
                const result = formatToolResult('read_file', true, '')
                expect(result).to.equal('Read 1 lines (0 bytes)')
            })

            it('should fallback for unknown result format', () => {
                const result = formatToolResult('read_file', true, { somethingElse: 'value' })
                expect(result).to.equal('File read successfully')
            })
        })

        describe('write_file results', () => {
            it('should format result with bytes written', () => {
                const result = formatToolResult('write_file', true, { bytesWritten: 245 })
                expect(result).to.equal('File written (245 bytes)')
            })

            it('should handle zero bytes', () => {
                const result = formatToolResult('write_file', true, { bytesWritten: 0 })
                expect(result).to.equal('File written (0 bytes)')
            })

            it('should fallback for unknown result format', () => {
                const result = formatToolResult('write_file', true, { somethingElse: 'value' })
                expect(result).to.equal('File written successfully')
            })

            it('should handle missing result', () => {
                const result = formatToolResult('write_file', true)
                expect(result).to.equal('File written successfully')
            })
        })

        describe('edit_file results', () => {
            it('should format result with change count', () => {
                const result = formatToolResult('edit_file', true, { changes: 5 })
                expect(result).to.equal('File edited (5 changes)')
            })

            it('should handle single change', () => {
                const result = formatToolResult('edit_file', true, { changes: 1 })
                expect(result).to.equal('File edited (1 changes)')
            })

            it('should handle zero changes', () => {
                const result = formatToolResult('edit_file', true, { changes: 0 })
                expect(result).to.equal('File edited (0 changes)')
            })

            it('should fallback for unknown result format', () => {
                const result = formatToolResult('edit_file', true, { somethingElse: 'value' })
                expect(result).to.equal('File edited successfully')
            })
        })

        describe('glob_files results', () => {
            it('should format array result', () => {
                const result = formatToolResult('glob_files', true, ['file1.ts', 'file2.ts', 'file3.ts'])
                expect(result).to.equal('Found 3 files')
            })

            it('should format object result with files array', () => {
                const result = formatToolResult('glob_files', true, {
                    files: ['file1.ts', 'file2.ts'],
                })
                expect(result).to.equal('Found 2 files')
            })

            it('should handle empty results', () => {
                const result = formatToolResult('glob_files', true, [])
                expect(result).to.equal('Found 0 files')
            })

            it('should handle empty files array in object', () => {
                const result = formatToolResult('glob_files', true, { files: [] })
                expect(result).to.equal('Found 0 files')
            })

            it('should fallback for unknown result format', () => {
                const result = formatToolResult('glob_files', true, { count: 5 })
                expect(result).to.equal('Files found')
            })
        })

        describe('grep_content results', () => {
            it('should format array result', () => {
                const result = formatToolResult('grep_content', true, [
                    { line: 1, text: 'match1' },
                    { line: 2, text: 'match2' },
                ])
                expect(result).to.equal('Found 2 matches')
            })

            it('should format object result with matches array', () => {
                const result = formatToolResult('grep_content', true, {
                    matches: [{ line: 1 }, { line: 2 }, { line: 3 }],
                })
                expect(result).to.equal('Found 3 matches')
            })

            it('should format object result with matchCount', () => {
                const result = formatToolResult('grep_content', true, { matchCount: 10 })
                expect(result).to.equal('Found 10 matches')
            })

            it('should handle zero matches', () => {
                const result = formatToolResult('grep_content', true, [])
                expect(result).to.equal('Found 0 matches')
            })

            it('should fallback for unknown result format', () => {
                const result = formatToolResult('grep_content', true, { somethingElse: 'value' })
                expect(result).to.equal('Matches found')
            })
        })

        describe('search_history results', () => {
            it('should format array result', () => {
                const result = formatToolResult('search_history', true, [
                    { command: 'cmd1', id: 1 },
                    { command: 'cmd2', id: 2 },
                ])
                expect(result).to.equal('Found 2 history items')
            })

            it('should format object result with items array', () => {
                const result = formatToolResult('search_history', true, {
                    items: [{ id: 1 }, { id: 2 }],
                })
                expect(result).to.equal('Found 2 history items')
            })

            it('should handle empty results', () => {
                const result = formatToolResult('search_history', true, [])
                expect(result).to.equal('Found 0 history items')
            })

            it('should fallback for unknown result format', () => {
                const result = formatToolResult('search_history', true, { count: 5 })
                expect(result).to.equal('History searched')
            })
        })

        describe('generic results', () => {
            it('should format null result', () => {
                const result = formatToolResult('unknown_tool', true, null)
                expect(result).to.equal('Success')
            })

            it('should format undefined result', () => {
                const result = formatToolResult('unknown_tool', true)
                expect(result).to.equal('Success')
            })

            it('should format string result', () => {
                const result = formatToolResult('unknown_tool', true, 'Operation completed')
                expect(result).to.equal('Operation completed')
            })

            it('should truncate long string result', () => {
                const longString = 's'.repeat(100)
                const result = formatToolResult('unknown_tool', true, longString)
                expect(result).to.include('...')
                expect(result.length).to.be.at.most(63) // 60 + '...'
            })

            it('should format number result', () => {
                const result = formatToolResult('unknown_tool', true, 42)
                expect(result).to.equal('42')
            })

            it('should format boolean result', () => {
                const resultTrue = formatToolResult('unknown_tool', true, true)
                expect(resultTrue).to.equal('true')

                const resultFalse = formatToolResult('unknown_tool', true, false)
                expect(resultFalse).to.equal('false')
            })

            it('should format array result', () => {
                const result = formatToolResult('unknown_tool', true, [1, 2, 3])
                expect(result).to.equal('Returned 3 items')
            })

            it('should format object result', () => {
                const result = formatToolResult('unknown_tool', true, { a: 1, b: 2 })
                expect(result).to.equal('Success')
            })
        })

        describe('edge cases', () => {
            it('should handle very large numbers', () => {
                const result = formatToolResult('write_file', true, {
                    bytesWritten: 999_999_999,
                })
                expect(result).to.equal('File written (999999999 bytes)')
            })

            it('should handle deeply nested objects', () => {
                const deepObject = {
                    level1: {
                        level2: {
                            level3: {
                                level4: 'value',
                            },
                        },
                    },
                }
                const result = formatToolResult('unknown_tool', true, deepObject)
                expect(result).to.equal('Success')
            })

            it('should handle mixed content in arrays', () => {
                const result = formatToolResult('unknown_tool', true, [1, 'two', { three: 3 }, [4, 5]])
                expect(result).to.equal('Returned 4 items')
            })

            it('should handle special characters in strings', () => {
                const result = formatToolResult('unknown_tool', true, 'File with special chars: <>"\'&')
                expect(result).to.equal('File with special chars: <>"\'&')
            })

            it('should handle unicode characters', () => {
                const result = formatToolResult('unknown_tool', true, '你好世界 🌍')
                expect(result).to.equal('你好世界 🌍')
            })

            it('should handle newlines in string results', () => {
                const result = formatToolResult('unknown_tool', true, 'line1\nline2\nline3')
                expect(result).to.equal('line1\nline2\nline3')
            })
        })
    })
})
