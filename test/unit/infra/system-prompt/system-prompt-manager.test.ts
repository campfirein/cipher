import {expect} from 'chai'

import type {
  SystemPromptConfig,
  SystemPromptContext,
} from '../../../../src/core/domain/cipher/system-prompt/types.js'

import {SystemPromptManager} from '../../../../src/infra/cipher/system-prompt/system-prompt-manager.js'

describe('SystemPromptManager', () => {
  describe('constructor', () => {
    it('should create a manager with a single contributor', () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'You are a helpful assistant.',
            id: 'base',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)

      expect(manager).to.be.instanceOf(SystemPromptManager)
    })

    it('should create a manager with multiple contributors', () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'First instruction',
            id: 'first',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Second instruction',
            id: 'second',
            priority: 2,
            type: 'static',
          },
          {
            content: 'Third instruction',
            id: 'third',
            priority: 3,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)

      expect(manager).to.be.instanceOf(SystemPromptManager)
    })

    it('should create a manager with empty contributors array', () => {
      const config: SystemPromptConfig = {
        contributors: [],
      }

      const manager = new SystemPromptManager(config)

      expect(manager).to.be.instanceOf(SystemPromptManager)
    })

    it('should filter out disabled contributors', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Enabled content',
            enabled: true,
            id: 'enabled',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Disabled content',
            enabled: false,
            id: 'disabled',
            priority: 2,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('Enabled content')
      expect(result).to.not.include('Disabled content')
    })

    it('should treat contributors without enabled flag as enabled', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Default enabled content',
            id: 'default',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('Default enabled content')
    })
  })

  describe('build', () => {
    it('should build a system prompt from a single contributor', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'You are a helpful AI assistant.',
            id: 'base',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('You are a helpful AI assistant.')
    })

    it('should build a system prompt from multiple contributors in priority order', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Third priority content',
            id: 'third',
            priority: 3,
            type: 'static',
          },
          {
            content: 'First priority content',
            id: 'first',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Second priority content',
            id: 'second',
            priority: 2,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('First priority content\nSecond priority content\nThird priority content')
    })

    it('should handle contributors with the same priority', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Content A',
            id: 'a',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Content B',
            id: 'b',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('Content A')
      expect(result).to.include('Content B')
      expect(result).to.include('\n')
    })

    it('should use newline as separator between contributors', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Line 1',
            id: 'first',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Line 2',
            id: 'second',
            priority: 2,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('Line 1\nLine 2')
    })

    it('should return empty string for no contributors', async () => {
      const config: SystemPromptConfig = {
        contributors: [],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('')
    })

    it('should return empty string when all contributors are disabled', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Disabled 1',
            enabled: false,
            id: 'first',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Disabled 2',
            enabled: false,
            id: 'second',
            priority: 2,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('')
    })

    it('should pass context to contributors (even if unused)', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Content',
            id: 'test',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const context: SystemPromptContext = {
        customKey: 'customValue',
      }

      const result = await manager.build(context)

      expect(result).to.equal('Content')
    })

    it('should use empty context by default', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Content',
            id: 'test',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('Content')
    })

    it('should preserve multiline content in contributors', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: `You are a helpful assistant.
You should:
- Be concise
- Be accurate`,
            id: 'base',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('You are a helpful assistant.')
      expect(result).to.include('- Be concise')
      expect(result).to.include('- Be accurate')
    })

    it('should handle empty content contributors', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'First content',
            id: 'first',
            priority: 1,
            type: 'static',
          },
          {
            content: '',
            id: 'empty',
            priority: 2,
            type: 'static',
          },
          {
            content: 'Third content',
            id: 'third',
            priority: 3,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('First content\n\nThird content')
    })

    it('should execute multiple calls independently', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Static content',
            id: 'test',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)

      const result1 = await manager.build()
      const result2 = await manager.build()
      const result3 = await manager.build()

      expect(result1).to.equal('Static content')
      expect(result2).to.equal('Static content')
      expect(result3).to.equal('Static content')
    })
  })

  describe('priority ordering', () => {
    it('should order contributors by priority (lower = higher)', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Priority 100',
            id: 'low',
            priority: 100,
            type: 'static',
          },
          {
            content: 'Priority 0',
            id: 'high',
            priority: 0,
            type: 'static',
          },
          {
            content: 'Priority 50',
            id: 'medium',
            priority: 50,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('Priority 0\nPriority 50\nPriority 100')
    })

    it('should handle negative priorities', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Priority 0',
            id: 'zero',
            priority: 0,
            type: 'static',
          },
          {
            content: 'Priority -10',
            id: 'negative',
            priority: -10,
            type: 'static',
          },
          {
            content: 'Priority 10',
            id: 'positive',
            priority: 10,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.equal('Priority -10\nPriority 0\nPriority 10')
    })

    it('should maintain stable order for contributors with same priority', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'A',
            id: 'a',
            priority: 1,
            type: 'static',
          },
          {
            content: 'B',
            id: 'b',
            priority: 1,
            type: 'static',
          },
          {
            content: 'C',
            id: 'c',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      // Should maintain insertion order when priorities are equal
      const indexA = result.indexOf('A')
      const indexB = result.indexOf('B')
      const indexC = result.indexOf('C')

      expect(indexA).to.be.lessThan(indexB)
      expect(indexB).to.be.lessThan(indexC)
    })
  })

  describe('real-world scenarios', () => {
    it('should build a complete system prompt for an AI assistant', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'You are a helpful AI coding assistant named ByteRover.',
            id: 'identity',
            priority: 1,
            type: 'static',
          },
          {
            content: `Core capabilities:
- Code generation
- Bug fixing
- Code explanation`,
            id: 'capabilities',
            priority: 2,
            type: 'static',
          },
          {
            content: `Guidelines:
- Always write clean, maintainable code
- Follow best practices
- Explain your reasoning`,
            id: 'guidelines',
            priority: 3,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('ByteRover')
      expect(result).to.include('Code generation')
      expect(result).to.include('Always write clean')

      const lines = result.split('\n')
      expect(lines.length).to.be.greaterThan(5)
    })

    it('should handle conditional contributor enabling', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Base instruction',
            id: 'base',
            priority: 1,
            type: 'static',
          },
          {
            content: 'Advanced feature description',
            enabled: false, // Disabled for basic users
            id: 'advanced',
            priority: 2,
            type: 'static',
          },
          {
            content: 'Common guidelines',
            id: 'guidelines',
            priority: 3,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('Base instruction')
      expect(result).to.include('Common guidelines')
      expect(result).to.not.include('Advanced feature')
    })

    it('should support building different prompts from the same manager', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'You are a helpful assistant.',
            id: 'base',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)

      const context1: SystemPromptContext = {mode: 'coding'}
      const context2: SystemPromptContext = {mode: 'writing'}

      const result1 = await manager.build(context1)
      const result2 = await manager.build(context2)

      // For static contributors, context doesn't affect output
      expect(result1).to.equal(result2)
    })
  })

  describe('edge cases', () => {
    it('should handle very long content', async () => {
      const longContent = 'x'.repeat(100_000)
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: longContent,
            id: 'long',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result.length).to.equal(100_000)
    })

    it('should handle special characters in content', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Special chars: <>"&\n\t\r',
            id: 'special',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('<>"&')
    })

    it('should handle unicode characters', async () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: '你好 🌍 مرحبا Привет',
            id: 'unicode',
            priority: 1,
            type: 'static',
          },
        ],
      }

      const manager = new SystemPromptManager(config)
      const result = await manager.build()

      expect(result).to.include('你好')
      expect(result).to.include('🌍')
    })
  })
})
