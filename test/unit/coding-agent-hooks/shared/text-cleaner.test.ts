import {expect} from 'chai'

import {METADATA_TAGS} from '../../../../src/coding-agent-hooks/claude/constants.js'
import {MAX_PROMPT_LENGTH} from '../../../../src/coding-agent-hooks/shared/constants.js'
import {cleanXmlTags, truncatePrompt} from '../../../../src/coding-agent-hooks/shared/text-cleaner.js'

describe('coding-agent-hooks/shared/text-cleaner', () => {
  describe('cleanXmlTags()', () => {
    describe('metadata tag removal (remove entire tag + content)', () => {
      it('should remove ide_opened_file tag and content', () => {
        const input = '<ide_opened_file>src/app.ts</ide_opened_file>Hello'
        expect(cleanXmlTags(input)).to.equal('Hello')
      })

      it('should remove system-reminder tag and content', () => {
        const input = 'Start<system-reminder>Some reminder</system-reminder>End'
        expect(cleanXmlTags(input)).to.equal('StartEnd')
      })

      it('should remove multiple metadata tags', () => {
        const input =
          '<ide_opened_file>file.ts</ide_opened_file>Text<system-reminder>reminder</system-reminder>More'
        expect(cleanXmlTags(input)).to.equal('TextMore')
      })

      it('should remove all METADATA_TAGS', () => {
        for (const tag of METADATA_TAGS) {
          const input = `Before<${tag}>Content to remove</${tag}>After`
          const result = cleanXmlTags(input)
          expect(result).to.equal('BeforeAfter')
        }
      })

      it('should handle metadata tags with attributes', () => {
        const input = '<ide_opened_file path="test.ts">content</ide_opened_file>Hello'
        expect(cleanXmlTags(input)).to.equal('Hello')
      })

      it('should handle metadata tags with newlines in content', () => {
        const input = '<system-reminder>\nLine 1\nLine 2\n</system-reminder>After'
        expect(cleanXmlTags(input)).to.equal('After')
      })
    })

    describe('generic tag removal (keep content)', () => {
      it('should keep content when removing generic tags', () => {
        const input = '<div>Hello</div>'
        expect(cleanXmlTags(input)).to.equal('Hello')
      })

      it('should remove nested generic tags but keep content', () => {
        const input = '<div><p>Hello <b>world</b></p></div>'
        expect(cleanXmlTags(input)).to.equal('Hello world')
      })

      it('should handle mixed metadata and generic tags', () => {
        const input = '<ide_opened_file>remove.ts</ide_opened_file><div>Keep this</div>'
        expect(cleanXmlTags(input)).to.equal('Keep this')
      })

      it('should handle tags with attributes', () => {
        const input = '<div class="test" id="main">Content</div>'
        expect(cleanXmlTags(input)).to.equal('Content')
      })
    })

    describe('self-closing tags', () => {
      it('should remove self-closing tags', () => {
        const input = 'Hello<br/>World'
        expect(cleanXmlTags(input)).to.equal('HelloWorld')
      })

      it('should remove self-closing tags with attributes', () => {
        const input = 'Hello<img src="test.png" />World'
        expect(cleanXmlTags(input)).to.equal('HelloWorld')
      })

      it('should remove self-closing tags with space before slash', () => {
        const input = 'Hello<br />World'
        expect(cleanXmlTags(input)).to.equal('HelloWorld')
      })
    })

    describe('whitespace handling', () => {
      it('should trim leading and trailing whitespace', () => {
        const input = '  Hello World  '
        expect(cleanXmlTags(input)).to.equal('Hello World')
      })

      it('should preserve internal whitespace', () => {
        const input = 'Hello   World'
        expect(cleanXmlTags(input)).to.equal('Hello   World')
      })

      it('should preserve newlines within content', () => {
        const input = 'Line 1\nLine 2\nLine 3'
        expect(cleanXmlTags(input)).to.equal('Line 1\nLine 2\nLine 3')
      })

      it('should preserve tabs within content', () => {
        const input = 'Hello\tWorld'
        expect(cleanXmlTags(input)).to.equal('Hello\tWorld')
      })
    })

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(cleanXmlTags('')).to.equal('')
      })

      it('should handle string with no tags', () => {
        const input = 'Plain text without any tags'
        expect(cleanXmlTags(input)).to.equal('Plain text without any tags')
      })

      it('should handle string with only metadata tags', () => {
        const input = '<ide_opened_file>test.ts</ide_opened_file>'
        expect(cleanXmlTags(input)).to.equal('')
      })

      it('should handle incomplete tags', () => {
        const input = '<div>Unclosed tag'
        expect(cleanXmlTags(input)).to.equal('Unclosed tag')
      })

      it('should handle malformed tags', () => {
        const input = '< div >Content</div>'
        expect(cleanXmlTags(input)).to.equal('< div >Content')
      })

      it('should be case-insensitive for tag removal', () => {
        const input = '<IDE_OPENED_FILE>test.ts</IDE_OPENED_FILE>Hello'
        expect(cleanXmlTags(input)).to.equal('Hello')
      })
    })

    describe('complex scenarios', () => {
      it('should handle deeply nested tags', () => {
        const input = '<div><p><span><b>Deep</b></span></p></div>'
        expect(cleanXmlTags(input)).to.equal('Deep')
      })

      it('should handle multiple occurrences of same tag', () => {
        const input = '<div>First</div> and <div>Second</div>'
        expect(cleanXmlTags(input)).to.equal('First and Second')
      })

      it('should handle tag-like content that is not a tag', () => {
        const input = 'Use the <Component> pattern'
        // Note: <Component> is treated as a self-closing tag, so it's removed
        expect(cleanXmlTags(input)).to.equal('Use the  pattern')
      })

      it('should handle real-world Claude Code input', () => {
        const input = `<ide_opened_file>
The user opened the file src/app.ts in the IDE.
</ide_opened_file>
<system-reminder>
This is a system reminder about context.
</system-reminder>
How do I implement authentication?`

        expect(cleanXmlTags(input)).to.equal('How do I implement authentication?')
      })
    })
  })

  describe('truncatePrompt()', () => {
    it('should not truncate text shorter than max length', () => {
      const text = 'Short text'
      expect(truncatePrompt(text)).to.equal(text)
    })

    it('should not truncate text exactly at max length', () => {
      const text = 'a'.repeat(MAX_PROMPT_LENGTH)
      expect(truncatePrompt(text)).to.equal(text)
    })

    it('should truncate text longer than max length', () => {
      const text = 'a'.repeat(MAX_PROMPT_LENGTH + 100)
      const result = truncatePrompt(text)

      expect(result.length).to.equal(MAX_PROMPT_LENGTH)
      expect(result.endsWith('...')).to.be.true
      expect(result.startsWith('aaa')).to.be.true
    })

    it('should add ellipsis when truncating', () => {
      const text = 'a'.repeat(MAX_PROMPT_LENGTH + 1)
      const result = truncatePrompt(text)

      expect(result.endsWith('...')).to.be.true
    })

    it('should respect custom max length', () => {
      const text = 'Hello World'
      const result = truncatePrompt(text, 8)

      expect(result).to.equal('Hello...')
      expect(result.length).to.equal(8)
    })

    it('should handle empty string', () => {
      expect(truncatePrompt('')).to.equal('')
    })

    it('should handle very short custom max length', () => {
      const text = 'Hello'
      const result = truncatePrompt(text, 3)

      expect(result).to.equal('...')
    })

    it('should preserve beginning of text when truncating', () => {
      const text = 'Important start' + 'x'.repeat(MAX_PROMPT_LENGTH)
      const result = truncatePrompt(text)

      expect(result.startsWith('Important start')).to.be.true
    })

    it('should handle text with newlines', () => {
      const text = 'Line 1\n'.repeat(MAX_PROMPT_LENGTH / 7 + 100)
      const result = truncatePrompt(text)

      expect(result.length).to.equal(MAX_PROMPT_LENGTH)
      expect(result.endsWith('...')).to.be.true
    })

    it('should handle unicode characters', () => {
      const text = '你好世界'.repeat(MAX_PROMPT_LENGTH / 4 + 100)
      const result = truncatePrompt(text)

      expect(result.length).to.equal(MAX_PROMPT_LENGTH)
      expect(result.endsWith('...')).to.be.true
    })
  })

  describe('MAX_PROMPT_LENGTH constant', () => {
    it('should be defined', () => {
      expect(MAX_PROMPT_LENGTH).to.be.a('number')
    })

    it('should be a positive number', () => {
      expect(MAX_PROMPT_LENGTH).to.be.greaterThan(0)
    })

    it('should be a reasonable value (25000)', () => {
      expect(MAX_PROMPT_LENGTH).to.equal(25_000)
    })
  })

  describe('METADATA_TAGS constant', () => {
    it('should be defined', () => {
      expect(METADATA_TAGS).to.be.an('array')
    })

    it('should contain expected tags', () => {
      const expectedTags = [
        'ide_opened_file',
        'ide_selection',
        'system-reminder',
        'system',
        'user-prompt-submit-hook',
        'antml:thinking',
        'antml:function_calls',
        'antml:invoke',
        'antml:parameter',
      ]

      for (const tag of expectedTags) {
        expect(METADATA_TAGS).to.include(tag)
      }
    })

    it('should have at least 9 tags', () => {
      expect(METADATA_TAGS.length).to.be.at.least(9)
    })
  })
})
