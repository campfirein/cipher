 
import {expect} from 'chai'
import {z} from 'zod'

import {ALL_EVENT_SCHEMAS} from '../../../../src/shared/analytics/events/index.js'

const FORBIDDEN_FIELD_NAMES: ReadonlySet<string> = new Set([
  'argv',
  'content',
  'cwd',
  'email',
  'error_message',
  'file_path',
  'folder_path',
  'goal',
  'home_dir',
  'hostname',
  'ip',
  'mac',
  'output',
  'path',
  'project_path',
  'prompt',
  'query',
  'result',
  'stack',
  'worktree_root',
])

function getShapeFieldNames(schema: z.ZodTypeAny): string[] {
  // Zod object schemas expose `.shape`. Strip ZodOptional / ZodDefault wrappers
  // are irrelevant for field-name auditing; we only care about top-level keys.
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape as Record<string, unknown>)
  }

  return []
}

describe('analytics privacy fixture (smoke)', () => {
  it('should not declare any field name on the forbidden PII list across all event schemas', () => {
    const violations: Array<{eventName: string; field: string}> = []

    for (const [eventName, schema] of Object.entries(ALL_EVENT_SCHEMAS)) {
      for (const field of getShapeFieldNames(schema)) {
        if (FORBIDDEN_FIELD_NAMES.has(field)) {
          violations.push({eventName, field})
        }
      }
    }

    expect(violations, `forbidden PII fields detected: ${JSON.stringify(violations)}`).to.deep.equal([])
  })

  it('should expose every shipped event name under ALL_EVENT_SCHEMAS', () => {
    expect(Object.keys(ALL_EVENT_SCHEMAS).sort()).to.deep.equal([
      'cli_invocation',
      'daemon_start',
      'mcp_session_start',
      'mcp_tool_called',
      'task_completed',
      'task_created',
      'task_failed',
    ])
  })
})
