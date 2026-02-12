import {expect} from 'chai'

import {MarkdownWriter} from '../../../../src/server/core/domain/knowledge/markdown-writer.js'

/**
 * Unit tests for markdown-writer.
 */
describe('markdown-writer', () => {
  describe('generateContext', () => {
    describe('newline normalization', () => {
      it(String.raw`should convert literal \n to actual newlines in narrative dependencies`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          narrative: {
            dependencies: String.raw`- update-notifier: Used for checking pm registry for updates\n- @oclif/core: Provides the 'init' hook mechanism`,
          },
          snippets: [],
        })

        expect(result).to.include('### Dependencies')
        expect(result).to.include('- update-notifier: Used for checking pm registry for updates')
        expect(result).to.include("- @oclif/core: Provides the 'init' hook mechanism")
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const dependenciesSection = result.match(new RegExp(String.raw`### Dependencies\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        expect(dependenciesSection).to.exist
        const bulletPoints = dependenciesSection?.split('\n').filter(line => line.trim().startsWith('-'))
        expect(bulletPoints).to.have.lengthOf(2)
      })

      it(String.raw`should convert literal \n to actual newlines in narrative structure`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          narrative: {
            structure: String.raw`First line\nSecond line\nThird line`,
          },
          snippets: [],
        })

        expect(result).to.include('### Structure')
        expect(result).to.include('First line')
        expect(result).to.include('Second line')
        expect(result).to.include('Third line')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const structureSection = result.match(new RegExp(String.raw`### Structure\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const lines = structureSection?.split('\n').filter(line => line.trim())
        expect(lines).to.have.lengthOf(3)
      })

      it(String.raw`should convert literal \n to actual newlines in narrative highlights`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          narrative: {
            highlights: String.raw`Highlight 1\nHighlight 2\nHighlight 3`,
          },
          snippets: [],
        })

        expect(result).to.include('### Highlights')
        expect(result).to.include('Highlight 1')
        expect(result).to.include('Highlight 2')
        expect(result).to.include('Highlight 3')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const highlightsSection = result.match(new RegExp(String.raw`### Highlights\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const lines = highlightsSection?.split('\n').filter(line => line.trim())
        expect(lines).to.have.lengthOf(3)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept task`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          rawConcept: {
            task: String.raw`Task line 1\nTask line 2`,
          },
          snippets: [],
        })

        expect(result).to.include('**Task:**')
        expect(result).to.include('Task line 1')
        expect(result).to.include('Task line 2')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const taskMatch = result.match(new RegExp(String.raw`\*\*Task:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const lines = taskMatch?.split('\n').filter(line => line.trim())
        expect(lines).to.have.lengthOf(2)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept changes`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          rawConcept: {
            changes: [String.raw`Change 1\nwith multiple lines`, 'Change 2'],
          },
          snippets: [],
        })

        expect(result).to.include('**Changes:**')
        expect(result).to.include('- Change 1')
        expect(result).to.include('with multiple lines')
        expect(result).to.include('- Change 2')
        // Verify Change 1 has multiple lines
        // eslint-disable-next-line prefer-regex-literals
        const changesSection = result.match(new RegExp(String.raw`\*\*Changes:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const changeLines = changesSection?.split('\n')
        const change1Index = changeLines?.findIndex(line => line.includes('Change 1'))
        const change2Index = changeLines?.findIndex(line => line.includes('Change 2'))
        expect(change2Index).to.be.greaterThan(change1Index! + 1)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept files`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          rawConcept: {
            files: [String.raw`file1.ts\nwith description`, 'file2.ts'],
          },
          snippets: [],
        })

        expect(result).to.include('**Files:**')
        expect(result).to.include('- file1.ts')
        expect(result).to.include('with description')
        expect(result).to.include('- file2.ts')
        // Verify file1 has multiple lines
        // eslint-disable-next-line prefer-regex-literals
        const filesSection = result.match(new RegExp(String.raw`\*\*Files:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const fileLines = filesSection?.split('\n')
        const file1Index = fileLines?.findIndex(line => line.includes('file1.ts'))
        const file2Index = fileLines?.findIndex(line => line.includes('file2.ts'))
        expect(file2Index).to.be.greaterThan(file1Index! + 1)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept flow`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          rawConcept: {
            flow: String.raw`Step 1\nStep 2\nStep 3`,
          },
          snippets: [],
        })

        expect(result).to.include('**Flow:**')
        expect(result).to.include('Step 1')
        expect(result).to.include('Step 2')
        expect(result).to.include('Step 3')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const flowMatch = result.match(new RegExp(String.raw`\*\*Flow:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const lines = flowMatch?.split('\n').filter(line => line.trim())
        expect(lines).to.have.lengthOf(3)
      })

      it(String.raw`should handle mixed literal \n and actual newlines correctly`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          narrative: {
            dependencies: String.raw`- item1\n- item2` + '\n- item3',
          },
          snippets: [],
        })

        expect(result).to.include('- item1')
        expect(result).to.include('- item2')
        expect(result).to.include('- item3')
        // All should be on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const dependenciesSection = result.match(new RegExp(String.raw`### Dependencies\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const bulletPoints = dependenciesSection?.split('\n').filter(line => line.trim().startsWith('-'))
        expect(bulletPoints).to.have.lengthOf(3)
      })

      it(String.raw`should not affect content without literal \n`, () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          narrative: {
            dependencies: '- item1\n- item2',
          },
          snippets: [],
        })

        expect(result).to.include('- item1')
        expect(result).to.include('- item2')
        // eslint-disable-next-line prefer-regex-literals
        const dependenciesSection = result.match(new RegExp(String.raw`### Dependencies\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const bulletPoints = dependenciesSection?.split('\n').filter(line => line.trim().startsWith('-'))
        expect(bulletPoints).to.have.lengthOf(2)
      })
    })

    describe('backward compatibility', () => {
      it('should parse old ### Features heading into highlights field', () => {
        const oldMarkdown = `## Narrative\n### Features\nOld feature content here`
        const parsed = MarkdownWriter.parseContent(oldMarkdown, 'test')

        expect(parsed.narrative?.highlights).to.equal('Old feature content here')
      })

      it('should parse new ### Highlights heading into highlights field', () => {
        const newMarkdown = `## Narrative\n### Highlights\nNew highlights content here`
        const parsed = MarkdownWriter.parseContent(newMarkdown, 'test')

        expect(parsed.narrative?.highlights).to.equal('New highlights content here')
      })

      it('should generate ### Highlights heading for new content', () => {
        const result = MarkdownWriter.generateContext({
          name: 'test',
          narrative: {
            highlights: 'Some highlights',
          },
          snippets: [],
        })

        expect(result).to.include('### Highlights')
        expect(result).not.to.include('### Features')
      })
    })

    describe('integration with parseContent', () => {
      it('should round-trip content with normalized newlines', () => {
        const original = {
          name: 'test',
          narrative: {
            dependencies: String.raw`- item1\n- item2`,
          },
          rawConcept: {
            task: String.raw`Task with\nmultiple lines`,
          },
          snippets: [],
        }

        const generated = MarkdownWriter.generateContext(original)
        const parsed = MarkdownWriter.parseContent(generated, original.name)

        expect(parsed.narrative?.dependencies).to.include('- item1')
        expect(parsed.narrative?.dependencies).to.include('- item2')
        expect(parsed.rawConcept?.task).to.include('Task with')
        expect(parsed.rawConcept?.task).to.include('multiple lines')
      })
    })
  })
})
