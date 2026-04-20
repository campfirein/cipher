import {expect} from 'chai'
import sinon from 'sinon'

import {MarkdownWriter, validateSemanticFrontmatter} from '../../../../src/server/core/domain/knowledge/markdown-writer.js'

function filterBulletLines(lines: string[] | undefined): string[] {
  return (lines ?? []).filter((line) => line.trim().startsWith('-'))
}

function filterNonEmpty(lines: string[] | undefined): string[] {
  return (lines ?? []).filter((line) => line.trim() !== '')
}

function findLineIndex(lines: string[] | undefined, text: string): number {
  return (lines ?? []).findIndex((line) => line.includes(text))
}

/**
 * Unit tests for markdown-writer.
 */
describe('markdown-writer', () => {
  describe('generateContext', () => {
    describe('newline normalization', () => {
      it(String.raw`should convert literal \n to actual newlines in narrative dependencies`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          narrative: {
            dependencies: String.raw`- update-notifier: Used for checking pm registry for updates\n- @oclif/core: Provides the 'init' hook mechanism`,
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('### Dependencies')
        expect(result).to.include('- update-notifier: Used for checking pm registry for updates')
        expect(result).to.include("- @oclif/core: Provides the 'init' hook mechanism")
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const dependenciesSection = result.match(new RegExp(String.raw`### Dependencies\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        expect(dependenciesSection).to.exist
        const bulletPoints = filterBulletLines(dependenciesSection?.split('\n'))
        expect(bulletPoints).to.have.lengthOf(2)
      })

      it(String.raw`should convert literal \n to actual newlines in narrative structure`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          narrative: {
            structure: String.raw`First line\nSecond line\nThird line`,
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('### Structure')
        expect(result).to.include('First line')
        expect(result).to.include('Second line')
        expect(result).to.include('Third line')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const structureSection = result.match(new RegExp(String.raw`### Structure\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const lines = filterNonEmpty(structureSection?.split('\n'))
        expect(lines).to.have.lengthOf(3)
      })

      it(String.raw`should convert literal \n to actual newlines in narrative highlights`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          narrative: {
            highlights: String.raw`Highlight 1\nHighlight 2\nHighlight 3`,
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('### Highlights')
        expect(result).to.include('Highlight 1')
        expect(result).to.include('Highlight 2')
        expect(result).to.include('Highlight 3')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const highlightsSection = result.match(new RegExp(String.raw`### Highlights\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const lines = filterNonEmpty(highlightsSection?.split('\n'))
        expect(lines).to.have.lengthOf(3)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept task`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          rawConcept: {
            task: String.raw`Task line 1\nTask line 2`,
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('**Task:**')
        expect(result).to.include('Task line 1')
        expect(result).to.include('Task line 2')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const taskMatch = result.match(new RegExp(String.raw`\*\*Task:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const lines = filterNonEmpty(taskMatch?.split('\n'))
        expect(lines).to.have.lengthOf(2)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept changes`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          rawConcept: {
            changes: [String.raw`Change 1\nwith multiple lines`, 'Change 2'],
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('**Changes:**')
        expect(result).to.include('- Change 1')
        expect(result).to.include('with multiple lines')
        expect(result).to.include('- Change 2')
        // Verify Change 1 has multiple lines
        // eslint-disable-next-line prefer-regex-literals
        const changesSection = result.match(new RegExp(String.raw`\*\*Changes:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const changeLines = changesSection?.split('\n')
        const change1Index = findLineIndex(changeLines, 'Change 1')
        const change2Index = findLineIndex(changeLines, 'Change 2')
        expect(change2Index).to.be.greaterThan(change1Index + 1)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept files`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          rawConcept: {
            files: [String.raw`file1.ts\nwith description`, 'file2.ts'],
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('**Files:**')
        expect(result).to.include('- file1.ts')
        expect(result).to.include('with description')
        expect(result).to.include('- file2.ts')
        // Verify file1 has multiple lines
        // eslint-disable-next-line prefer-regex-literals
        const filesSection = result.match(new RegExp(String.raw`\*\*Files:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const fileLines = filesSection?.split('\n')
        const file1Index = findLineIndex(fileLines, 'file1.ts')
        const file2Index = findLineIndex(fileLines, 'file2.ts')
        expect(file2Index).to.be.greaterThan(file1Index + 1)
      })

      it(String.raw`should convert literal \n to actual newlines in rawConcept flow`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          rawConcept: {
            flow: String.raw`Step 1\nStep 2\nStep 3`,
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('**Flow:**')
        expect(result).to.include('Step 1')
        expect(result).to.include('Step 2')
        expect(result).to.include('Step 3')
        // Verify they are on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const flowMatch = result.match(new RegExp(String.raw`\*\*Flow:\*\*\n([\s\S]*?)(?=\n\*\*|\n##|$)`))?.[1]
        const lines = filterNonEmpty(flowMatch?.split('\n'))
        expect(lines).to.have.lengthOf(3)
      })

      it(String.raw`should handle mixed literal \n and actual newlines correctly`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          narrative: {
            dependencies: String.raw`- item1\n- item2` + '\n- item3',
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('- item1')
        expect(result).to.include('- item2')
        expect(result).to.include('- item3')
        // All should be on separate lines
        // eslint-disable-next-line prefer-regex-literals
        const dependenciesSection = result.match(new RegExp(String.raw`### Dependencies\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const bulletPoints = filterBulletLines(dependenciesSection?.split('\n'))
        expect(bulletPoints).to.have.lengthOf(3)
      })

      it(String.raw`should not affect content without literal \n`, () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          narrative: {
            dependencies: '- item1\n- item2',
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('- item1')
        expect(result).to.include('- item2')
        // eslint-disable-next-line prefer-regex-literals
        const dependenciesSection = result.match(new RegExp(String.raw`### Dependencies\n([\s\S]*?)(?=\n###|\n##|$)`))?.[1]
        const bulletPoints = filterBulletLines(dependenciesSection?.split('\n'))
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
          keywords: [],
          name: 'test',
          narrative: {
            highlights: 'Some highlights',
          },
          snippets: [],
          tags: [],
        })

        expect(result).to.include('### Highlights')
        expect(result).not.to.include('### Features')
      })
    })

    describe('integration with parseContent', () => {
      it('should round-trip content with normalized newlines', () => {
        const original = {
          keywords: [],
          name: 'test',
          narrative: {
            dependencies: String.raw`- item1\n- item2`,
          },
          rawConcept: {
            task: String.raw`Task with\nmultiple lines`,
          },
          snippets: [],
          tags: [],
        }

        const generated = MarkdownWriter.generateContext(original)
        const parsed = MarkdownWriter.parseContent(generated, original.name)

        expect(parsed.narrative?.dependencies).to.include('- item1')
        expect(parsed.narrative?.dependencies).to.include('- item2')
        expect(parsed.rawConcept?.task).to.include('Task with')
        expect(parsed.rawConcept?.task).to.include('multiple lines')
      })
    })

    describe('frontmatter', () => {
      it('should generate YAML frontmatter with title', () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'My Context Title',
          snippets: ['Some content'],
          tags: [],
        })

        expect(result).to.match(/^---\n/)
        expect(result).to.include('title: My Context Title')
        expect(result).to.include('\n---\n')
      })

      it('should generate frontmatter with tags and keywords', () => {
        const result = MarkdownWriter.generateContext({
          keywords: ['jwt', 'refresh_token'],
          name: 'Token Handling',
          snippets: ['content'],
          tags: ['authentication', 'security'],
        })

        expect(result).to.include('title: Token Handling')
        expect(result).to.include('tags: [authentication, security]')
        expect(result).to.include('keywords: [jwt, refresh_token]')
      })

      it('should generate frontmatter with related (normalized relations)', () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'Overview',
          relations: ['Architecture/Agents/Overview.md', 'code_style/error-handling/guide'],
          snippets: ['content'],
          tags: [],
        })

        expect(result).to.include('architecture/agents/overview.md')
        expect(result).to.include('code_style/error-handling/guide.md')
        // Should NOT have old-style ## Relations section
        expect(result).not.to.include('## Relations')
        expect(result).not.to.include('@architecture')
      })

      it('should generate frontmatter with all fields', () => {
        const result = MarkdownWriter.generateContext({
          keywords: ['abc', 'xyz'],
          name: 'CNI API Management',
          relations: ['cni/configuration.md'],
          snippets: ['content'],
          tags: ['cni', 'api'],
        })

        expect(result).to.match(/^---\n/)
        expect(result).to.include('title: CNI API Management')
        expect(result).to.include('tags: [cni, api]')
        expect(result).to.include('related: [cni/configuration.md]')
        expect(result).to.include('keywords: [abc, xyz]')
        expect(result).to.include('\n---\n')
      })

      it('should always generate frontmatter even with empty tags/keywords', () => {
        const result = MarkdownWriter.generateContext({
          keywords: [],
          name: 'test',
          snippets: ['content'],
          tags: [],
        })

        expect(result).to.match(/^---\n/)
        expect(result).to.include('tags: []')
        expect(result).to.include('keywords: []')
      })
    })
  })

  describe('parseContent', () => {
    describe('frontmatter parsing', () => {
      it('should parse frontmatter title, tags, related, keywords', () => {
        const content = `---
title: My Title
tags: [auth, security]
related: [domain/topic/file.md]
keywords: [jwt, token]
---
Some body content`

        const parsed = MarkdownWriter.parseContent(content)

        expect(parsed.name).to.equal('My Title')
        expect(parsed.tags).to.deep.equal(['auth', 'security'])
        expect(parsed.relations).to.deep.equal(['domain/topic/file.md'])
        expect(parsed.keywords).to.deep.equal(['jwt', 'token'])
      })

      it('should parse frontmatter with body sections', () => {
        const content = `---
title: Test
tags: [test]
---

## Raw Concept
**Task:**
Do something

## Narrative
### Structure
Some structure`

        const parsed = MarkdownWriter.parseContent(content)

        expect(parsed.name).to.equal('Test')
        expect(parsed.tags).to.deep.equal(['test'])
        expect(parsed.rawConcept?.task).to.equal('Do something')
        expect(parsed.narrative?.structure).to.equal('Some structure')
      })

      it('should fall back to legacy format when no frontmatter', () => {
        const content = `## Relations
@code_style/error-handling/overview.md
@structure/api/guide.md

## Raw Concept
**Task:**
Some task`

        const parsed = MarkdownWriter.parseContent(content, 'fallback-name')

        expect(parsed.name).to.equal('fallback-name')
        expect(parsed.relations).to.have.members(['code_style/error-handling/overview.md', 'structure/api/guide.md'])
        expect(parsed.rawConcept?.task).to.equal('Some task')
        expect(parsed.tags).to.deep.equal([])
        expect(parsed.keywords).to.deep.equal([])
      })

      it('should round-trip content with frontmatter', () => {
        const original = {
          keywords: ['kw1', 'kw2'],
          name: 'Round Trip Test',
          narrative: { structure: 'Some structure' },
          rawConcept: { task: 'A task' },
          relations: ['domain/topic/file.md'],
          snippets: ['snippet content'],
          tags: ['tag1', 'tag2'],
        }

        const generated = MarkdownWriter.generateContext(original)
        const parsed = MarkdownWriter.parseContent(generated)

        expect(parsed.name).to.equal('Round Trip Test')
        expect(parsed.tags).to.deep.equal(['tag1', 'tag2'])
        expect(parsed.keywords).to.deep.equal(['kw1', 'kw2'])
        expect(parsed.relations).to.deep.equal(['domain/topic/file.md'])
        expect(parsed.narrative?.structure).to.equal('Some structure')
        expect(parsed.rawConcept?.task).to.equal('A task')
        expect(parsed.snippets).to.deep.equal(['snippet content'])
      })
    })
  })

  describe('mergeContexts', () => {
    it('should merge tags and keywords from both sources', () => {
      const source = `---
title: Source
tags: [tag1, tag2]
keywords: [kw1]
---
Some source content`

      const target = `---
title: Target
tags: [tag2, tag3]
keywords: [kw2]
---
Some target content`

      const merged = MarkdownWriter.mergeContexts(source, target)
      const parsed = MarkdownWriter.parseContent(merged)

      expect(parsed.tags).to.have.members(['tag1', 'tag2', 'tag3'])
      expect(parsed.keywords).to.have.members(['kw1', 'kw2'])
    })

    it('should merge frontmatter and legacy format', () => {
      const source = `---
title: New Format
tags: [newtag]
related: [domain/new/file.md]
---
Some content`

      const target = `## Relations
@domain/old/file.md

Some old content`

      const merged = MarkdownWriter.mergeContexts(source, target)
      const parsed = MarkdownWriter.parseContent(merged)

      expect(parsed.relations).to.have.members(['domain/new/file.md', 'domain/old/file.md'])
      expect(parsed.tags).to.deep.equal(['newtag'])
    })

    describe('timestamp merge', () => {
      it('preserves the earliest createdAt from either input', () => {
        const source = `---
title: Source
tags: []
keywords: []
createdAt: '2026-03-10T00:00:00.000Z'
updatedAt: '2026-04-01T00:00:00.000Z'
---
Source body`

        const target = `---
title: Target
tags: []
keywords: []
createdAt: '2026-01-15T00:00:00.000Z'
updatedAt: '2026-02-20T00:00:00.000Z'
---
Target body`

        const merged = MarkdownWriter.mergeContexts(source, target)
        const parsed = MarkdownWriter.parseContent(merged)

        // Earliest createdAt wins (target's 2026-01-15 is earlier than source's 2026-03-10).
        expect(parsed.timestamps?.createdAt).to.equal('2026-01-15T00:00:00.000Z')
      })

      it('stamps a fresh updatedAt on merge', () => {
        const source = `---
title: Source
tags: []
keywords: []
createdAt: '2026-01-01T00:00:00.000Z'
updatedAt: '2026-01-01T00:00:00.000Z'
---
Source`

        const target = `---
title: Target
tags: []
keywords: []
createdAt: '2026-01-01T00:00:00.000Z'
updatedAt: '2026-01-01T00:00:00.000Z'
---
Target`

        const before = Date.now()
        const merged = MarkdownWriter.mergeContexts(source, target)
        const after = Date.now()
        const parsed = MarkdownWriter.parseContent(merged)

        expect(parsed.timestamps?.updatedAt).to.exist
        const updatedAtMs = new Date(parsed.timestamps!.updatedAt!).getTime()
        expect(updatedAtMs).to.be.at.least(before)
        expect(updatedAtMs).to.be.at.most(after)
      })

      it('falls back to the single available createdAt when only one input has it', () => {
        const source = `---
title: Source
tags: []
keywords: []
createdAt: '2026-05-01T00:00:00.000Z'
---
Source`

        const target = `---
title: Target
tags: []
keywords: []
---
Target`

        const merged = MarkdownWriter.mergeContexts(source, target)
        const parsed = MarkdownWriter.parseContent(merged)

        expect(parsed.timestamps?.createdAt).to.equal('2026-05-01T00:00:00.000Z')
      })

      it('produces a fresh createdAt when neither input carries it', () => {
        const source = `---
title: Source
tags: []
keywords: []
---
Source`

        const target = `---
title: Target
tags: []
keywords: []
---
Target`

        const before = Date.now()
        const merged = MarkdownWriter.mergeContexts(source, target)
        const after = Date.now()
        const parsed = MarkdownWriter.parseContent(merged)

        // Writer now always emits createdAt; when neither input had it,
        // mergeTimestamps omits createdAt from its return, but
        // generateFrontmatter fills in a default timestamp.
        expect(parsed.timestamps?.createdAt).to.exist
        const createdMs = new Date(parsed.timestamps!.createdAt!).getTime()
        expect(createdMs).to.be.at.least(before)
        expect(createdMs).to.be.at.most(after)
        // updatedAt is always stamped on merge since content changed.
        expect(parsed.timestamps?.updatedAt).to.exist
      })
    })
  })

  describe('generateFrontmatter unconditional emission', () => {
    it('emits all 7 fields even when no optional values provided', () => {
      const result = MarkdownWriter.generateContext({
        keywords: [],
        name: '',
        snippets: ['content'],
        tags: [],
      })

      expect(result).to.include('title:')
      expect(result).to.include('summary:')
      expect(result).to.include('tags:')
      expect(result).to.include('related:')
      expect(result).to.include('keywords:')
      expect(result).to.include('createdAt:')
      expect(result).to.include('updatedAt:')
    })

    it('emits empty string defaults for title and summary when absent', () => {
      const result = MarkdownWriter.generateContext({
        keywords: [],
        name: '',
        snippets: ['content'],
        tags: [],
      })

      // title and summary should be present as empty strings
      expect(result).to.match(/title: (''+|""+)/)
      expect(result).to.match(/summary: (''+|""+)/)
    })

    it('emits empty array for related when no relations provided', () => {
      const result = MarkdownWriter.generateContext({
        keywords: [],
        name: 'Test',
        snippets: ['content'],
        tags: [],
      })

      expect(result).to.include('related: []')
    })

    it('emits createdAt and updatedAt defaults when no timestamps provided', () => {
      const before = Date.now()
      const result = MarkdownWriter.generateContext({
        keywords: [],
        name: 'Test',
        snippets: ['content'],
        tags: [],
      })
      const after = Date.now()

      const parsed = MarkdownWriter.parseContent(result)
      expect(parsed.timestamps?.createdAt).to.exist
      expect(parsed.timestamps?.updatedAt).to.exist

      const createdMs = new Date(parsed.timestamps!.createdAt!).getTime()
      expect(createdMs).to.be.at.least(before)
      expect(createdMs).to.be.at.most(after)
    })

    it('uses provided timestamps instead of defaults', () => {
      const result = MarkdownWriter.generateContext({
        keywords: [],
        name: 'Test',
        snippets: ['content'],
        tags: [],
        timestamps: {createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'},
      })

      expect(result).to.include("createdAt: '2026-01-01T00:00:00.000Z'")
      expect(result).to.include("updatedAt: '2026-01-02T00:00:00.000Z'")
    })

    it('emits updatedAt same as createdAt for new files when only createdAt given', () => {
      const result = MarkdownWriter.generateContext({
        keywords: [],
        name: 'Test',
        snippets: ['content'],
        tags: [],
        timestamps: {createdAt: '2026-01-01T00:00:00.000Z'},
      })

      expect(result).to.include("createdAt: '2026-01-01T00:00:00.000Z'")
      expect(result).to.include("updatedAt: '2026-01-01T00:00:00.000Z'")
    })

    it('preserves field order: title, summary, tags, related, keywords, createdAt, updatedAt', () => {
      const result = MarkdownWriter.generateContext({
        keywords: ['kw'],
        name: 'Title',
        relations: ['domain/file.md'],
        snippets: ['content'],
        summary: 'A summary',
        tags: ['tag'],
        timestamps: {createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'},
      })

      const titleIdx = result.indexOf('title:')
      const summaryIdx = result.indexOf('summary:')
      const tagsIdx = result.indexOf('tags:')
      const relatedIdx = result.indexOf('related:')
      const keywordsIdx = result.indexOf('keywords:')
      const createdIdx = result.indexOf('createdAt:')
      const updatedIdx = result.indexOf('updatedAt:')

      expect(titleIdx).to.be.lessThan(summaryIdx)
      expect(summaryIdx).to.be.lessThan(tagsIdx)
      expect(tagsIdx).to.be.lessThan(relatedIdx)
      expect(relatedIdx).to.be.lessThan(keywordsIdx)
      expect(keywordsIdx).to.be.lessThan(createdIdx)
      expect(createdIdx).to.be.lessThan(updatedIdx)
    })
  })

  describe('validateSemanticFrontmatter', () => {
    afterEach(() => {
      sinon.restore()
    })

    describe('strict mode', () => {
      it('passes when all required fields are present', () => {
        const frontmatter = {
          createdAt: '2026-01-01T00:00:00.000Z',
          keywords: ['kw'],
          related: ['domain/file.md'],
          summary: 'Summary',
          tags: ['tag'],
          title: 'Title',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }

        expect(() => validateSemanticFrontmatter(frontmatter, 'strict', 'test.md')).to.not.throw()
      })

      it('passes when optional string fields are empty strings', () => {
        const frontmatter = {
          createdAt: '2026-01-01T00:00:00.000Z',
          keywords: [],
          related: [],
          summary: '',
          tags: [],
          title: '',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }

        expect(() => validateSemanticFrontmatter(frontmatter, 'strict', 'test.md')).to.not.throw()
      })

      it('throws when title is missing', () => {
        const frontmatter = {
          createdAt: '2026-01-01T00:00:00.000Z',
          keywords: [],
          related: [],
          summary: '',
          tags: [],
          updatedAt: '2026-01-02T00:00:00.000Z',
        }

        expect(() => validateSemanticFrontmatter(frontmatter, 'strict', 'test.md'))
          .to.throw(/test\.md.*title/)
      })

      it('throws when createdAt is missing', () => {
        const frontmatter = {
          keywords: [],
          related: [],
          summary: '',
          tags: [],
          title: 'Title',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }

        expect(() => validateSemanticFrontmatter(frontmatter, 'strict', 'test.md'))
          .to.throw(/test\.md.*createdAt/)
      })

      it('throws listing all missing fields', () => {
        const frontmatter = {
          keywords: [],
          tags: [],
        }

        expect(() => validateSemanticFrontmatter(frontmatter, 'strict', 'path/to/file.md'))
          .to.throw(/path\/to\/file\.md.*title.*summary.*related.*createdAt.*updatedAt/)
      })
    })

    describe('lenient mode', () => {
      it('returns the frontmatter unchanged when all fields are present', () => {
        const frontmatter = {
          createdAt: '2026-01-01T00:00:00.000Z',
          keywords: ['kw'],
          related: ['domain/file.md'],
          summary: 'Summary',
          tags: ['tag'],
          title: 'Title',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }

        const result = validateSemanticFrontmatter(frontmatter, 'lenient', 'test.md')
        expect(result).to.deep.equal(frontmatter)
      })

      it('synthesises defaults for missing fields', () => {
        const frontmatter = {
          keywords: ['kw'],
          tags: ['tag'],
        }

        const result = validateSemanticFrontmatter(frontmatter, 'lenient', 'test.md')

        expect(result.title).to.equal('')
        expect(result.summary).to.equal('')
        expect(result.related).to.deep.equal([])
        expect(result.createdAt).to.be.a('string')
        expect(result.updatedAt).to.be.a('string')
        // Original fields preserved
        expect(result.keywords).to.deep.equal(['kw'])
        expect(result.tags).to.deep.equal(['tag'])
      })

      it('logs a warning when fields are missing', () => {
        const warnSpy = sinon.spy(console, 'warn')
        const frontmatter = {
          keywords: [],
          tags: [],
        }

        validateSemanticFrontmatter(frontmatter, 'lenient', 'domain/test.md')

        expect(warnSpy.calledOnce).to.be.true
        expect(warnSpy.firstCall.args[0]).to.include('domain/test.md')
        expect(warnSpy.firstCall.args[0]).to.include('title')
      })

      it('does not log a warning when all fields are present', () => {
        const warnSpy = sinon.spy(console, 'warn')
        const frontmatter = {
          createdAt: '2026-01-01T00:00:00.000Z',
          keywords: [],
          related: [],
          summary: '',
          tags: [],
          title: '',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }

        validateSemanticFrontmatter(frontmatter, 'lenient', 'test.md')

        expect(warnSpy.called).to.be.false
      })
    })
  })
})
