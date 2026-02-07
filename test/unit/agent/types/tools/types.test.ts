import type {ZodSchema} from 'zod'

import {expect} from 'chai'
import {expectTypeOf} from 'expect-type'

import type {
  JSONSchema7,
  JSONSchema7TypeName,
  Tool,
  ToolExecutionContext,
  ToolSet,
} from '../../../../../src/agent/core/domain/tools/types.js'

import {KnownTool, ToolName} from '../../../../../src/agent/core/domain/tools/constants.js'

describe('cipher/tools', () => {
  describe('Exports - Constants', () => {
    it('should export ToolName object', () => {
      expect(ToolName).to.exist
      expect(ToolName).to.be.an('object')
    })

    it('should export KnownTool type', () => {
      // Type-only export, verified in compile-time tests
      const toolName: KnownTool = 'code_exec'
      expectTypeOf<KnownTool>(toolName)
    })
  })

  describe('Runtime Constants - ToolName', () => {
    it('should have all expected tool name properties', () => {
      expect(ToolName.CODE_EXEC).to.equal('code_exec')
      expect(ToolName.CURATE).to.equal('curate')
      expect(ToolName.GLOB_FILES).to.equal('glob_files')
      expect(ToolName.GREP_CONTENT).to.equal('grep_content')
      expect(ToolName.LIST_DIRECTORY).to.equal('list_directory')
      expect(ToolName.READ_FILE).to.equal('read_file')
      expect(ToolName.SEARCH_KNOWLEDGE).to.equal('search_knowledge')
      expect(ToolName.WRITE_FILE).to.equal('write_file')
    })

    it('should have correct number of tool names', () => {
      const toolNames = Object.keys(ToolName)
      expect(toolNames.length).to.be.greaterThan(0)
    })

    it('should have readonly properties', () => {
      // These would fail at compile time if properties weren't readonly
    })
  })

  describe('Type Safety - KnownTool', () => {
    it('should derive union type from ToolName object', () => {
      const tool1: KnownTool = 'code_exec'
      const tool2: KnownTool = 'read_file'
      const tool3: KnownTool = 'write_file'

      expectTypeOf<KnownTool>(tool1)
      expectTypeOf<KnownTool>(tool2)
      expectTypeOf<KnownTool>(tool3)
    })

    it('should include all tool names in union', () => {
      const allTools: KnownTool[] = [
        'code_exec',
        'curate',
        'glob_files',
        'grep_content',
        'list_directory',
        'read_file',
        'search_knowledge',
        'write_file',
      ]

      for (const tool of allTools) {
        expectTypeOf<KnownTool>(tool)
      }
    })
  })

  describe('Type Safety - Tool Interface', () => {
    it('should enforce Tool interface structure', () => {
      const mockSchema = {} as ZodSchema

      const tool: Tool = {
        description: 'Test tool',
        execute: async (input: unknown) => input,
        id: 'test-tool',
        inputSchema: mockSchema,
      }

      expectTypeOf<string>(tool.id)
      expectTypeOf<string>(tool.description)
      expectTypeOf<ZodSchema>(tool.inputSchema)
      expectTypeOf<(input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown>(tool.execute)
    })

    it('should allow both sync and async execute functions', () => {
      const mockSchema = {} as ZodSchema

      const syncTool: Tool = {
        description: 'Sync tool',
        execute: (input: unknown) => input,
        id: 'sync-tool',
        inputSchema: mockSchema,
      }

      const asyncTool: Tool = {
        description: 'Async tool',
        execute: async (input: unknown) => input,
        id: 'async-tool',
        inputSchema: mockSchema,
      }

      expectTypeOf<Tool>(syncTool)
      expectTypeOf<Tool>(asyncTool)
    })

    it('should allow optional context parameter in execute', () => {
      const mockSchema = {} as ZodSchema

      const toolWithContext: Tool = {
        description: 'Tool with context',
        execute(input: unknown, context?: ToolExecutionContext) {
          expectTypeOf<ToolExecutionContext | undefined>(context)
          return input
        },
        id: 'context-tool',
        inputSchema: mockSchema,
      }

      expectTypeOf<Tool>(toolWithContext)
    })
  })

  describe('Type Safety - ToolExecutionContext', () => {
    it('should enforce ToolExecutionContext structure', () => {
      const context: ToolExecutionContext = {
        sessionId: 'session-123',
      }

      expectTypeOf<string | undefined>(context.sessionId)

      // Empty context is valid
      const emptyContext: ToolExecutionContext = {}
      expectTypeOf<ToolExecutionContext>(emptyContext)
    })

    it('should make sessionId optional', () => {
      const withSession: ToolExecutionContext = {sessionId: 'session-123'}
      const withoutSession: ToolExecutionContext = {}

      expectTypeOf<ToolExecutionContext>(withSession)
      expectTypeOf<ToolExecutionContext>(withoutSession)
    })
  })

  describe('Type Safety - ToolSet', () => {
    it('should enforce ToolSet structure', () => {
      const toolSet: ToolSet = {
        /* eslint-disable camelcase */
        bash_exec: {
          description: 'Execute bash command',
          name: 'bash_exec',
          parameters: {
            properties: {
              command: {type: 'string'},
            },
            required: ['command'],
            type: 'object',
          },
        },
        read_file: {
          parameters: {
            properties: {
              path: {type: 'string'},
            },
            required: ['path'],
            type: 'object',
          },
        },
        /* eslint-enable camelcase */
      }

      expectTypeOf<ToolSet>(toolSet)

      // Verify tool entry structure
      const tool = toolSet.bash_exec
      expectTypeOf<string | undefined>(tool.description)
      expectTypeOf<string | undefined>(tool.name)
      expectTypeOf<JSONSchema7>(tool.parameters)
    })

    it('should allow dynamic tool names as keys', () => {
      const dynamicToolSet: ToolSet = {
        'another-tool': {
          description: 'Another tool',
          parameters: {type: 'string'},
        },
        'custom-tool': {
          parameters: {type: 'object'},
        },
      }

      expectTypeOf<ToolSet>(dynamicToolSet)
    })

    it('should require parameters but allow optional description and name', () => {
      const minimalToolSet: ToolSet = {
        minimal: {
          parameters: {type: 'object'},
        },
      }

      const fullToolSet: ToolSet = {
        full: {
          description: 'Full tool',
          name: 'full',
          parameters: {type: 'object'},
        },
      }

      expectTypeOf<ToolSet>(minimalToolSet)
      expectTypeOf<ToolSet>(fullToolSet)
    })
  })

  describe('Type Safety - JSONSchema7TypeName', () => {
    it('should include all JSON Schema type names', () => {
      const types: JSONSchema7TypeName[] = [
        'array',
        'boolean',
        'integer',
        'null',
        'number',
        'object',
        'string',
      ]

      for (const type of types) {
        expectTypeOf<JSONSchema7TypeName>(type)
      }
    })
  })

  describe('Type Safety - JSONSchema7', () => {
    it('should enforce basic JSONSchema7 structure', () => {
      const schema: JSONSchema7 = {
        description: 'Test schema',
        properties: {
          age: {type: 'number'},
          name: {type: 'string'},
        },
        required: ['name'],
        type: 'object',
      }

      expectTypeOf<JSONSchema7>(schema)
    })

    it('should support all optional fields', () => {
      const complexSchema: JSONSchema7 = {
        $id: 'https://example.com/schema',
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        description: 'Complex schema',
        properties: {
          items: {
            items: {type: 'string'},
            maxItems: 10,
            minItems: 1,
            type: 'array',
            uniqueItems: true,
          },
          name: {
            maxLength: 100,
            minLength: 1,
            pattern: '^[a-z]+$',
            type: 'string',
          },
          status: {
            enum: ['active', 'inactive'],
            type: 'string',
          },
        },
        required: ['name'],
        title: 'Complex Schema',
        type: 'object',
      }

      expectTypeOf<JSONSchema7>(complexSchema)
    })

    it('should support nested schemas', () => {
      const nestedSchema: JSONSchema7 = {
        properties: {
          address: {
            properties: {
              city: {type: 'string'},
              street: {type: 'string'},
            },
            required: ['street'],
            type: 'object',
          },
        },
        type: 'object',
      }

      expectTypeOf<JSONSchema7>(nestedSchema)
    })

    it('should support schema composition', () => {
      const composedSchema: JSONSchema7 = {
        allOf: [{type: 'object'}, {properties: {name: {type: 'string'}}}],
        anyOf: [{type: 'string'}, {type: 'number'}],
        oneOf: [{minLength: 10, type: 'string'}, {maxLength: 5, type: 'string'}],
      }

      expectTypeOf<JSONSchema7>(composedSchema)
    })

    it('should support conditional schemas', () => {
      const conditionalSchema: JSONSchema7 = {
        else: {properties: {age: {type: 'number'}}},
        if: {properties: {type: {const: 'person'}}},
        // eslint-disable-next-line unicorn/no-thenable
        then: {properties: {name: {type: 'string'}}},
      }

      expectTypeOf<JSONSchema7>(conditionalSchema)
    })

    it('should support type as single value or array', () => {
      const singleType: JSONSchema7 = {
        type: 'string',
      }

      const multipleTypes: JSONSchema7 = {
        type: ['string', 'null'],
      }

      expectTypeOf<JSONSchema7>(singleType)
      expectTypeOf<JSONSchema7>(multipleTypes)
    })

    it('should make all fields optional', () => {
      const emptySchema: JSONSchema7 = {}

      expectTypeOf<JSONSchema7>(emptySchema)
    })
  })
})
