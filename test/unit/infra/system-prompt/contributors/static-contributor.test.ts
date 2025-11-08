import {expect} from 'chai'

import type {SystemPromptContext} from '../../../../../src/core/domain/system-prompt/types.js'

import {StaticContributor} from '../../../../../src/infra/system-prompt/contributors/static-contributor.js'

describe('StaticContributor', () => {
  describe('constructor', () => {
    it('should create a static contributor with all properties', () => {
      const contributor = new StaticContributor('base-instructions', 1, 'You are a helpful assistant.')

      expect(contributor.id).to.equal('base-instructions')
      expect(contributor.priority).to.equal(1)
    })

    it('should create a contributor with different priorities', () => {
      const highPriority = new StaticContributor('high', 0, 'High priority content')
      const lowPriority = new StaticContributor('low', 100, 'Low priority content')

      expect(highPriority.priority).to.equal(0)
      expect(lowPriority.priority).to.equal(100)
    })

    it('should create a contributor with empty content', () => {
      const contributor = new StaticContributor('empty', 1, '')

      expect(contributor.id).to.equal('empty')
      expect(contributor.priority).to.equal(1)
    })
  })

  describe('getContent', () => {
    it('should return the static content', async () => {
      const content = 'You are a helpful AI assistant.'
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
    })

    it('should return the same content on multiple calls', async () => {
      const content = 'Consistent content'
      const contributor = new StaticContributor('test', 1, content)

      const result1 = await contributor.getContent({})
      const result2 = await contributor.getContent({})
      const result3 = await contributor.getContent({})

      expect(result1).to.equal(content)
      expect(result2).to.equal(content)
      expect(result3).to.equal(content)
    })

    it('should ignore context parameter', async () => {
      const content = 'Static content'
      const contributor = new StaticContributor('test', 1, content)

      const context: SystemPromptContext = {
        anotherKey: 123,
        someKey: 'someValue',
      }

      const result = await contributor.getContent(context)

      expect(result).to.equal(content)
    })

    it('should handle multiline content', async () => {
      const content = `You are a helpful AI assistant.
You should always:
- Be concise
- Be accurate
- Be helpful`
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
      expect(result).to.include('You are a helpful AI assistant.')
      expect(result).to.include('- Be concise')
    })

    it('should handle content with special characters', async () => {
      const content = 'Content with "quotes", \'apostrophes\', and $pecial ch@rs!'
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
    })

    it('should handle content with unicode characters', async () => {
      const content = '你好世界 🌍 مرحبا العالم Привет мир'
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
    })

    it('should return empty string for empty content', async () => {
      const contributor = new StaticContributor('test', 1, '')

      const result = await contributor.getContent({})

      expect(result).to.equal('')
    })

    it('should handle very long content', async () => {
      const content = 'x'.repeat(100_000)
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
      expect(result.length).to.equal(100_000)
    })

    it('should preserve whitespace in content', async () => {
      const content = '  Leading spaces\n\tTabs here\n  Trailing spaces  '
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
    })

    it('should handle JSON-like content', async () => {
      const content = '{"key": "value", "nested": {"foo": "bar"}}'
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
    })

    it('should handle markdown content', async () => {
      const content = `# Heading 1
## Heading 2

**Bold text** and *italic text*

- List item 1
- List item 2

\`\`\`typescript
const code = 'example';
\`\`\``
      const contributor = new StaticContributor('test', 1, content)

      const result = await contributor.getContent({})

      expect(result).to.equal(content)
      expect(result).to.include('# Heading 1')
      expect(result).to.include('```typescript')
    })
  })

  describe('interface compliance', () => {
    it('should implement ISystemPromptContributor interface', async () => {
      const contributor = new StaticContributor('test', 1, 'content')

      expect(contributor).to.have.property('id')
      expect(contributor).to.have.property('priority')
      expect(contributor).to.have.property('getContent')
      expect(contributor.getContent).to.be.a('function')
    })

    it('should return a Promise from getContent', () => {
      const contributor = new StaticContributor('test', 1, 'content')

      const result = contributor.getContent({})

      expect(result).to.be.instanceOf(Promise)
    })
  })

  describe('immutability', () => {
    it('should have id and priority properties', () => {
      const contributor = new StaticContributor('test-id', 42, 'content')

      expect(contributor.id).to.equal('test-id')
      expect(contributor.priority).to.equal(42)
    })

    it('should return the same content even if context is modified', async () => {
      const content = 'Original content'
      const contributor = new StaticContributor('test', 1, content)

      const context: SystemPromptContext = {modifiable: 'value'}
      const result1 = await contributor.getContent(context)

      // Modify context
      context.modifiable = 'changed'
      context.newKey = 'newValue'

      const result2 = await contributor.getContent(context)

      expect(result1).to.equal(content)
      expect(result2).to.equal(content)
    })
  })
})
