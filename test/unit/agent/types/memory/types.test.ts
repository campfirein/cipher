import {expectTypeOf} from 'expect-type'

import type {
  Attachment,
  CreateMemoryInput,
  ListMemoriesOptions,
  Memory,
  MemoryConfig,
  MemorySource,
  UpdateMemoryInput,
} from '../../../../../src/agent/core/domain/memory/types.js'

describe('cipher/memory', () => {
  describe('Type Safety - MemorySource', () => {
    it('should enforce MemorySource union type', () => {
      const agentSource: MemorySource = 'agent'
      const systemSource: MemorySource = 'system'
      const userSource: MemorySource = 'user'

      expectTypeOf<MemorySource>(agentSource)
      expectTypeOf<MemorySource>(systemSource)
      expectTypeOf<MemorySource>(userSource)
    })
  })

  describe('Type Safety - Attachment', () => {
    it('should enforce Attachment interface structure', () => {
      const attachment: Attachment = {
        blobKey: 'blob-key-123',
        createdAt: Date.now(),
        name: 'file.txt',
        size: 1024,
        type: 'text/plain',
      }

      expectTypeOf<string>(attachment.blobKey)
      expectTypeOf<number>(attachment.createdAt)
      expectTypeOf<string | undefined>(attachment.name)
      expectTypeOf<number>(attachment.size)
      expectTypeOf<string>(attachment.type)
    })

    it('should allow optional name field', () => {
      const withoutName: Attachment = {
        blobKey: 'blob-key-123',
        createdAt: Date.now(),
        size: 1024,
        type: 'application/json',
      }

      expectTypeOf<Attachment>(withoutName)
      expectTypeOf<string | undefined>(withoutName.name)
    })

    it('should enforce number types for timestamps and size', () => {
      const attachment: Attachment = {
        blobKey: 'blob-key',
        createdAt: 1_700_000_000_000,
        size: 0,
        type: 'image/png',
      }

      expectTypeOf<number>(attachment.createdAt)
      expectTypeOf<number>(attachment.size)
    })
  })

  describe('Type Safety - Memory', () => {
    it('should enforce Memory interface structure', () => {
      const memory: Memory = {
        content: 'Memory content',
        createdAt: Date.now(),
        id: 'memory-123',
        metadata: {
          custom: 'data',
          pinned: true,
          source: 'agent',
        },
        tags: ['tag1', 'tag2'],
        updatedAt: Date.now(),
      }

      expectTypeOf<string>(memory.content)
      expectTypeOf<number>(memory.createdAt)
      expectTypeOf<string>(memory.id)
      expectTypeOf<number>(memory.updatedAt)
    })

    it('should allow optional metadata and tags fields', () => {
      const minimalMemory: Memory = {
        content: 'Minimal memory',
        createdAt: Date.now(),
        id: 'memory-123',
        updatedAt: Date.now(),
      }

      expectTypeOf<Memory>(minimalMemory)
      expectTypeOf<undefined | {[key: string]: unknown; pinned?: boolean; source?: MemorySource}>(
        minimalMemory.metadata,
      )
      expectTypeOf<string[] | undefined>(minimalMemory.tags)
    })

    it('should enforce metadata structure when present', () => {
      const withMetadata: Memory = {
        content: 'Memory',
        createdAt: Date.now(),
        id: 'memory-123',
        metadata: {
          custom: 'value',
          pinned: true,
          source: 'user',
        },
        updatedAt: Date.now(),
      }

      if (withMetadata.metadata) {
        expectTypeOf<boolean | undefined>(withMetadata.metadata.pinned)
        expectTypeOf<MemorySource | undefined>(withMetadata.metadata.source)
        expectTypeOf<unknown>(withMetadata.metadata.custom)
      }
    })

    it('should allow custom metadata fields', () => {
      const memory: Memory = {
        content: 'Memory',
        createdAt: Date.now(),
        id: 'memory-123',
        metadata: {
          customField1: 'value1',
          customField2: 123,
          customField3: {nested: 'object'},
          pinned: false,
        },
        updatedAt: Date.now(),
      }

      expectTypeOf<Memory>(memory)
    })

    it('should enforce tags as string array', () => {
      const withTags: Memory = {
        content: 'Memory',
        createdAt: Date.now(),
        id: 'memory-123',
        tags: ['tag1', 'tag2', 'tag3'],
        updatedAt: Date.now(),
      }

      expectTypeOf<string[] | undefined>(withTags.tags)
    })
  })

  describe('Type Safety - CreateMemoryInput', () => {
    it('should enforce CreateMemoryInput structure', () => {
      const input: CreateMemoryInput = {
        content: 'New memory content',
        metadata: {
          custom: 'data',
          source: 'agent',
        },
        tags: ['tag1', 'tag2'],
      }

      expectTypeOf<string>(input.content)
      expectTypeOf<undefined | {[key: string]: unknown; source?: MemorySource}>(input.metadata)
      expectTypeOf<string[] | undefined>(input.tags)
    })

    it('should allow minimal input with only content', () => {
      const minimalInput: CreateMemoryInput = {
        content: 'Just content',
      }

      expectTypeOf<CreateMemoryInput>(minimalInput)
    })

    it('should allow metadata with source', () => {
      const withSource: CreateMemoryInput = {
        content: 'Content',
        metadata: {
          source: 'user',
        },
      }

      expectTypeOf<CreateMemoryInput>(withSource)

      if (withSource.metadata) {
        expectTypeOf<MemorySource | undefined>(withSource.metadata.source)
      }
    })

    it('should allow custom metadata fields', () => {
      const withCustomMetadata: CreateMemoryInput = {
        content: 'Content',
        metadata: {
          customField: 'value',
          source: 'system',
        },
      }

      expectTypeOf<CreateMemoryInput>(withCustomMetadata)
    })
  })

  describe('Type Safety - UpdateMemoryInput', () => {
    it('should make all fields optional', () => {
      const fullUpdate: UpdateMemoryInput = {
        content: 'Updated content',
        metadata: {
          pinned: true,
          source: 'agent',
        },
        tags: ['newTag'],
      }

      expectTypeOf<string | undefined>(fullUpdate.content)
      expectTypeOf<undefined | {[key: string]: unknown; pinned?: boolean; source?: MemorySource}>(fullUpdate.metadata)
      expectTypeOf<string[] | undefined>(fullUpdate.tags)

      // Empty update is valid
      const emptyUpdate: UpdateMemoryInput = {}
      expectTypeOf<UpdateMemoryInput>(emptyUpdate)
    })

    it('should allow partial updates', () => {
      const contentOnly: UpdateMemoryInput = {
        content: 'New content',
      }

      const metadataOnly: UpdateMemoryInput = {
        metadata: {
          pinned: true,
        },
      }

      const tagsOnly: UpdateMemoryInput = {
        tags: ['tag1', 'tag2'],
      }

      expectTypeOf<UpdateMemoryInput>(contentOnly)
      expectTypeOf<UpdateMemoryInput>(metadataOnly)
      expectTypeOf<UpdateMemoryInput>(tagsOnly)
    })

    it('should enforce metadata structure when present', () => {
      const withMetadata: UpdateMemoryInput = {
        metadata: {
          custom: 'value',
          pinned: false,
          source: 'user',
        },
      }

      if (withMetadata.metadata) {
        expectTypeOf<boolean | undefined>(withMetadata.metadata.pinned)
        expectTypeOf<MemorySource | undefined>(withMetadata.metadata.source)
        expectTypeOf<unknown>(withMetadata.metadata.custom)
      }
    })
  })

  describe('Type Safety - ListMemoriesOptions', () => {
    it('should make all fields optional', () => {
      const fullOptions: ListMemoriesOptions = {
        limit: 10,
        offset: 0,
        pinned: true,
        source: 'agent',
        tags: ['tag1', 'tag2'],
      }

      expectTypeOf<number | undefined>(fullOptions.limit)
      expectTypeOf<number | undefined>(fullOptions.offset)
      expectTypeOf<boolean | undefined>(fullOptions.pinned)
      expectTypeOf<MemorySource | undefined>(fullOptions.source)
      expectTypeOf<string[] | undefined>(fullOptions.tags)

      // Empty options is valid
      const emptyOptions: ListMemoriesOptions = {}
      expectTypeOf<ListMemoriesOptions>(emptyOptions)
    })

    it('should allow partial filter options', () => {
      const limitOnly: ListMemoriesOptions = {limit: 5}
      const sourceOnly: ListMemoriesOptions = {source: 'user'}
      const tagsOnly: ListMemoriesOptions = {tags: ['important']}
      const pinnedOnly: ListMemoriesOptions = {pinned: true}

      expectTypeOf<ListMemoriesOptions>(limitOnly)
      expectTypeOf<ListMemoriesOptions>(sourceOnly)
      expectTypeOf<ListMemoriesOptions>(tagsOnly)
      expectTypeOf<ListMemoriesOptions>(pinnedOnly)
    })

    it('should enforce correct types for each field', () => {
      const options: ListMemoriesOptions = {
        limit: 20,
        offset: 10,
        pinned: false,
        source: 'system',
        tags: ['tag1'],
      }

      expectTypeOf<number | undefined>(options.limit)
      expectTypeOf<number | undefined>(options.offset)
      expectTypeOf<boolean | undefined>(options.pinned)
      expectTypeOf<MemorySource | undefined>(options.source)
      expectTypeOf<string[] | undefined>(options.tags)
    })
  })

  describe('Type Safety - MemoryConfig', () => {
    it('should make all fields optional', () => {
      const fullConfig: MemoryConfig = {
        defaultTags: ['default1', 'default2'],
        maxMemories: 1000,
        storageDir: '/path/to/memories',
      }

      expectTypeOf<string[] | undefined>(fullConfig.defaultTags)
      expectTypeOf<number | undefined>(fullConfig.maxMemories)
      expectTypeOf<string | undefined>(fullConfig.storageDir)

      // Empty config is valid
      const emptyConfig: MemoryConfig = {}
      expectTypeOf<MemoryConfig>(emptyConfig)
    })

    it('should allow partial configuration', () => {
      const tagsOnly: MemoryConfig = {
        defaultTags: ['tag1'],
      }

      const maxOnly: MemoryConfig = {
        maxMemories: 500,
      }

      const dirOnly: MemoryConfig = {
        storageDir: '.byterover/memories',
      }

      expectTypeOf<MemoryConfig>(tagsOnly)
      expectTypeOf<MemoryConfig>(maxOnly)
      expectTypeOf<MemoryConfig>(dirOnly)
    })

    it('should enforce correct types for each field', () => {
      const config: MemoryConfig = {
        defaultTags: ['tag1', 'tag2'],
        maxMemories: 100,
        storageDir: '/custom/path',
      }

      expectTypeOf<string[] | undefined>(config.defaultTags)
      expectTypeOf<number | undefined>(config.maxMemories)
      expectTypeOf<string | undefined>(config.storageDir)
    })
  })
})
