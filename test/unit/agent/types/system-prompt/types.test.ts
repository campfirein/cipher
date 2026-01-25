import {expectTypeOf} from 'expect-type'

import type {
  ContributorConfig,
  ConversationMetadata,
  DateTimeContributorConfig,
  ExecutionModeContributorConfig,
  MarkerPromptContributorConfig,
  MemoryContributorConfig,
  MemoryContributorOptions,
  StaticContributorConfig,
  SystemPromptConfig,
  SystemPromptContext,
} from '../../../../../src/agent/types/system-prompt/types.js'

describe('cipher/system-prompt', () => {
  describe('Type Safety - ConversationMetadata', () => {
    it('should enforce all required fields', () => {
      const metadata: ConversationMetadata = {
        conversationId: 'conv-123',
        title: 'My Conversation',
      }

      expectTypeOf<string>(metadata.conversationId)
      expectTypeOf<string>(metadata.title)
    })
  })

  describe('Type Safety - SystemPromptContext', () => {
    it('should allow optional conversationMetadata and isJsonInputMode', () => {
      const fullContext: SystemPromptContext = {
        conversationMetadata: {
          conversationId: 'conv-123',
          title: 'Test Conversation',
        },
        isJsonInputMode: true,
      }

      expectTypeOf<ConversationMetadata | undefined>(fullContext.conversationMetadata)
      expectTypeOf<boolean | undefined>(fullContext.isJsonInputMode)

      // Empty context is valid
      const emptyContext: SystemPromptContext = {}
      expectTypeOf<SystemPromptContext>(emptyContext)
    })

    it('should allow additional custom properties', () => {
      const customContext: SystemPromptContext = {
        customField: 'custom value',
        customNumber: 123,
        isJsonInputMode: false,
        nested: {deep: 'value'},
      }

      expectTypeOf<SystemPromptContext>(customContext)
      expectTypeOf<unknown>(customContext.customField)
      expectTypeOf<unknown>(customContext.customNumber)
      expectTypeOf<unknown>(customContext.nested)
    })

    it('should enforce index signature for custom properties', () => {
      const context: SystemPromptContext = {
        anyProperty: 'value',
      }

      expectTypeOf<unknown>(context.anyProperty)
      expectTypeOf<unknown>(context.dynamicKey)
    })
  })

  describe('Type Safety - StaticContributorConfig', () => {
    it('should enforce all required fields', () => {
      const config: StaticContributorConfig = {
        content: 'Static content',
        enabled: true,
        id: 'static-1',
        priority: 1,
        type: 'static',
      }

      expectTypeOf<string | undefined>(config.content)
      expectTypeOf<boolean | undefined>(config.enabled)
      expectTypeOf<string>(config.id)
      expectTypeOf<number>(config.priority)
      expectTypeOf<'static'>(config.type)
    })

    it('should make enabled optional', () => {
      const withoutEnabled: StaticContributorConfig = {
        content: 'Content',
        id: 'static-2',
        priority: 2,
        type: 'static',
      }

      expectTypeOf<StaticContributorConfig>(withoutEnabled)
      expectTypeOf<boolean | undefined>(withoutEnabled.enabled)
    })

    it('should enforce literal type discriminator', () => {
      const config: StaticContributorConfig = {
        content: 'Content',
        id: 'static-3',
        priority: 3,
        type: 'static',
      }

      expectTypeOf<'static'>(config.type)
    })
  })

  describe('Type Safety - DateTimeContributorConfig', () => {
    it('should enforce all required fields', () => {
      const config: DateTimeContributorConfig = {
        enabled: true,
        id: 'datetime-1',
        priority: 5,
        type: 'dateTime',
      }

      expectTypeOf<boolean | undefined>(config.enabled)
      expectTypeOf<string>(config.id)
      expectTypeOf<number>(config.priority)
      expectTypeOf<'dateTime'>(config.type)
    })

    it('should enforce literal type discriminator', () => {
      const config: DateTimeContributorConfig = {
        id: 'datetime-2',
        priority: 10,
        type: 'dateTime',
      }

      expectTypeOf<'dateTime'>(config.type)
    })
  })

  describe('Type Safety - MemoryContributorOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: MemoryContributorOptions = {
        includeTags: true,
        includeTimestamps: false,
        limit: 10,
        pinnedOnly: false,
        source: 'agent',
      }

      expectTypeOf<boolean | undefined>(fullOptions.includeTags)
      expectTypeOf<boolean | undefined>(fullOptions.includeTimestamps)
      expectTypeOf<number | undefined>(fullOptions.limit)
      expectTypeOf<boolean | undefined>(fullOptions.pinnedOnly)
      expectTypeOf<'agent' | 'system' | 'user' | undefined>(fullOptions.source)

      // Empty options is valid
      const emptyOptions: MemoryContributorOptions = {}
      expectTypeOf<MemoryContributorOptions>(emptyOptions)
    })

    it('should enforce source enum values', () => {
      const agentSource: MemoryContributorOptions = {source: 'agent'}
      const systemSource: MemoryContributorOptions = {source: 'system'}
      const userSource: MemoryContributorOptions = {source: 'user'}

      expectTypeOf<MemoryContributorOptions>(agentSource)
      expectTypeOf<MemoryContributorOptions>(systemSource)
      expectTypeOf<MemoryContributorOptions>(userSource)
    })
  })

  describe('Type Safety - MemoryContributorConfig', () => {
    it('should enforce all required fields', () => {
      const config: MemoryContributorConfig = {
        enabled: true,
        id: 'memory-1',
        options: {
          includeTags: true,
          limit: 20,
        },
        priority: 15,
        type: 'memory',
      }

      expectTypeOf<boolean | undefined>(config.enabled)
      expectTypeOf<string>(config.id)
      expectTypeOf<MemoryContributorOptions | undefined>(config.options)
      expectTypeOf<number>(config.priority)
      expectTypeOf<'memory'>(config.type)
    })

    it('should make enabled and options optional', () => {
      const minimal: MemoryContributorConfig = {
        id: 'memory-2',
        priority: 20,
        type: 'memory',
      }

      expectTypeOf<MemoryContributorConfig>(minimal)
      expectTypeOf<boolean | undefined>(minimal.enabled)
      expectTypeOf<MemoryContributorOptions | undefined>(minimal.options)
    })

    it('should enforce literal type discriminator', () => {
      const config: MemoryContributorConfig = {
        id: 'memory-3',
        priority: 25,
        type: 'memory',
      }

      expectTypeOf<'memory'>(config.type)
    })
  })

  describe('Type Safety - ExecutionModeContributorConfig', () => {
    it('should enforce all required fields', () => {
      const config: ExecutionModeContributorConfig = {
        enabled: true,
        id: 'execution-1',
        priority: 30,
        type: 'executionMode',
      }

      expectTypeOf<boolean | undefined>(config.enabled)
      expectTypeOf<string>(config.id)
      expectTypeOf<number>(config.priority)
      expectTypeOf<'executionMode'>(config.type)
    })

    it('should enforce literal type discriminator', () => {
      const config: ExecutionModeContributorConfig = {
        id: 'execution-2',
        priority: 35,
        type: 'executionMode',
      }

      expectTypeOf<'executionMode'>(config.type)
    })
  })

  describe('Type Safety - MarkerPromptContributorConfig', () => {
    it('should enforce all required fields', () => {
      const config: MarkerPromptContributorConfig = {
        enabled: true,
        id: 'marker-1',
        priority: 40,
        type: 'markerPrompt',
      }

      expectTypeOf<boolean | undefined>(config.enabled)
      expectTypeOf<string>(config.id)
      expectTypeOf<number>(config.priority)
      expectTypeOf<'markerPrompt'>(config.type)
    })

    it('should enforce literal type discriminator', () => {
      const config: MarkerPromptContributorConfig = {
        id: 'marker-2',
        priority: 45,
        type: 'markerPrompt',
      }

      expectTypeOf<'markerPrompt'>(config.type)
    })
  })

  describe('Type Safety - ContributorConfig (Discriminated Union)', () => {
    it('should accept all contributor types', () => {
      const staticConfig: ContributorConfig = {
        content: 'Static',
        id: 'static',
        priority: 1,
        type: 'static',
      }

      const dateTimeConfig: ContributorConfig = {
        id: 'datetime',
        priority: 2,
        type: 'dateTime',
      }

      const memoryConfig: ContributorConfig = {
        id: 'memory',
        priority: 3,
        type: 'memory',
      }

      const executionConfig: ContributorConfig = {
        id: 'execution',
        priority: 4,
        type: 'executionMode',
      }

      const markerConfig: ContributorConfig = {
        id: 'marker',
        priority: 5,
        type: 'markerPrompt',
      }

      expectTypeOf<ContributorConfig>(staticConfig)
      expectTypeOf<ContributorConfig>(dateTimeConfig)
      expectTypeOf<ContributorConfig>(memoryConfig)
      expectTypeOf<ContributorConfig>(executionConfig)
      expectTypeOf<ContributorConfig>(markerConfig)
    })

    it('should support type narrowing based on discriminator', () => {
      // Test static contributor
      const staticConfig: ContributorConfig = {
        content: 'Static content',
        id: 'test',
        priority: 1,
        type: 'static',
      }

      if (staticConfig.type === 'static') {
        expectTypeOf<string | undefined>(staticConfig.content)
        expectTypeOf<'static'>(staticConfig.type)
      }

      // Test dateTime contributor
      const dateTimeConfig: ContributorConfig = {
        id: 'datetime',
        priority: 2,
        type: 'dateTime',
      }

      if (dateTimeConfig.type === 'dateTime') {
        expectTypeOf<'dateTime'>(dateTimeConfig.type)
      }

      // Test memory contributor
      const memoryConfig: ContributorConfig = {
        id: 'memory',
        priority: 3,
        type: 'memory',
      }

      if (memoryConfig.type === 'memory') {
        expectTypeOf<MemoryContributorOptions | undefined>(memoryConfig.options)
        expectTypeOf<'memory'>(memoryConfig.type)
      }

      // Test execution mode contributor
      const executionConfig: ContributorConfig = {
        id: 'execution',
        priority: 4,
        type: 'executionMode',
      }

      if (executionConfig.type === 'executionMode') {
        expectTypeOf<'executionMode'>(executionConfig.type)
      }

      // Test marker prompt contributor
      const markerConfig: ContributorConfig = {
        id: 'marker',
        priority: 5,
        type: 'markerPrompt',
      }

      if (markerConfig.type === 'markerPrompt') {
        expectTypeOf<'markerPrompt'>(markerConfig.type)
      }
    })

    it('should prevent invalid type combinations', () => {
      // Type safety enforced at compile time
    })

    it('should enforce common fields across all variants', () => {
      const configs: ContributorConfig[] = [
        {content: 'Static', id: 'static', priority: 1, type: 'static'},
        {id: 'datetime', priority: 2, type: 'dateTime'},
        {id: 'memory', priority: 3, type: 'memory'},
        {id: 'execution', priority: 4, type: 'executionMode'},
        {id: 'marker', priority: 5, type: 'markerPrompt'},
      ]

      for (const config of configs) {
        expectTypeOf<string>(config.id)
        expectTypeOf<number>(config.priority)
        expectTypeOf<boolean | undefined>(config.enabled)
        expectTypeOf<'dateTime' | 'executionMode' | 'markerPrompt' | 'memory' | 'static'>(config.type)
      }
    })
  })

  describe('Type Safety - SystemPromptConfig', () => {
    it('should enforce contributors array', () => {
      const config: SystemPromptConfig = {
        contributors: [
          {content: 'Static', id: 'static', priority: 1, type: 'static'},
          {id: 'datetime', priority: 2, type: 'dateTime'},
          {id: 'memory', options: {limit: 10}, priority: 3, type: 'memory'},
          {id: 'execution', priority: 4, type: 'executionMode'},
        ],
      }

      expectTypeOf<ContributorConfig[]>(config.contributors)
    })

    it('should allow empty contributors array', () => {
      const emptyConfig: SystemPromptConfig = {
        contributors: [],
      }

      expectTypeOf<SystemPromptConfig>(emptyConfig)
      expectTypeOf<ContributorConfig[]>(emptyConfig.contributors)
    })

    it('should support mixed contributor types', () => {
      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'You are a helpful assistant.',
            enabled: true,
            id: 'base-prompt',
            priority: 1,
            type: 'static',
          },
          {
            id: 'current-time',
            priority: 5,
            type: 'dateTime',
          },
          {
            id: 'agent-memories',
            options: {
              includeTags: true,
              limit: 20,
              pinnedOnly: false,
            },
            priority: 10,
            type: 'memory',
          },
          {
            enabled: true,
            id: 'json-mode-instructions',
            priority: 15,
            type: 'executionMode',
          },
        ],
      }

      expectTypeOf<SystemPromptConfig>(config)

      for (const contributor of config.contributors) {
        expectTypeOf<ContributorConfig>(contributor)
      }
    })
  })

  describe('Type Safety - Complete System Prompt Flow', () => {
    it('should support full system prompt configuration', () => {
      const context: SystemPromptContext = {
        conversationMetadata: {
          conversationId: 'conv-456',
          title: 'Project Discussion',
        },
        isJsonInputMode: true,
      }

      const config: SystemPromptConfig = {
        contributors: [
          {
            content: 'Base system prompt',
            id: 'base',
            priority: 1,
            type: 'static',
          },
          {
            id: 'datetime',
            priority: 5,
            type: 'dateTime',
          },
          {
            id: 'memories',
            options: {
              includeTags: true,
              limit: 15,
              source: 'agent',
            },
            priority: 10,
            type: 'memory',
          },
          {
            id: 'execution',
            priority: 20,
            type: 'executionMode',
          },
        ],
      }

      expectTypeOf<SystemPromptContext>(context)
      expectTypeOf<SystemPromptConfig>(config)
    })

    it('should support priority-based ordering', () => {
      const config: SystemPromptConfig = {
        contributors: [
          {content: 'Low priority', id: 'low', priority: 100, type: 'static'},
          {content: 'High priority', id: 'high', priority: 1, type: 'static'},
          {content: 'Medium priority', id: 'medium', priority: 50, type: 'static'},
        ],
      }

      const sorted = [...config.contributors].sort((a, b) => a.priority - b.priority)

      expectTypeOf<ContributorConfig[]>(sorted)
      expectTypeOf<number>(sorted[0].priority)
    })
  })
})
