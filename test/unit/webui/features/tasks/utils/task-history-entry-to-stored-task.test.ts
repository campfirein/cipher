import {expect} from 'chai'

import {
  TASK_HISTORY_SCHEMA_VERSION,
  type TaskHistoryEntry,
} from '../../../../../../src/shared/transport/events/task-events.js'
import {taskHistoryEntryToStoredTask} from '../../../../../../src/webui/features/tasks/utils/task-history-entry-to-stored-task.js'

const baseEntry = {
  content: 'test content',
  createdAt: 1_700_000_000_000,
  id: 'storage-id-1',
  projectPath: '/foo/bar',
  schemaVersion: TASK_HISTORY_SCHEMA_VERSION,
  taskId: 'tsk-1',
  type: 'curate',
} as const

describe('taskHistoryEntryToStoredTask', () => {
  it('maps a created entry', () => {
    const entry: TaskHistoryEntry = {...baseEntry, status: 'created'}
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result).to.include({
      content: 'test content',
      createdAt: 1_700_000_000_000,
      projectPath: '/foo/bar',
      status: 'created',
      taskId: 'tsk-1',
      type: 'curate',
    })
  })

  it('maps a started entry with startedAt', () => {
    const entry: TaskHistoryEntry = {...baseEntry, startedAt: 1_700_000_001_000, status: 'started'}
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.startedAt).to.equal(1_700_000_001_000)
    expect(result.status).to.equal('started')
  })

  it('leaves rich detail fields undefined for a started entry without content', () => {
    const entry: TaskHistoryEntry = {...baseEntry, startedAt: 1_700_000_001_000, status: 'started'}
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.responseContent).to.equal(undefined)
    expect(result.toolCalls).to.equal(undefined)
    expect(result.reasoningContents).to.equal(undefined)
  })

  it('maps a completed entry with result + timestamps', () => {
    const entry: TaskHistoryEntry = {
      ...baseEntry,
      completedAt: 1_700_000_002_000,
      result: 'final answer',
      startedAt: 1_700_000_001_000,
      status: 'completed',
    }
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.result).to.equal('final answer')
    expect(result.completedAt).to.equal(1_700_000_002_000)
    expect(result.startedAt).to.equal(1_700_000_001_000)
    expect(result.status).to.equal('completed')
  })

  it('maps an error entry with error payload', () => {
    const entry: TaskHistoryEntry = {
      ...baseEntry,
      completedAt: 1_700_000_002_000,
      error: {code: 'TOOL_FAIL', message: 'tool exploded', name: 'TaskError'},
      status: 'error',
    }
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.error).to.deep.equal({code: 'TOOL_FAIL', message: 'tool exploded', name: 'TaskError'})
    expect(result.status).to.equal('error')
  })

  it('maps a cancelled entry', () => {
    const entry: TaskHistoryEntry = {...baseEntry, completedAt: 1_700_000_002_000, status: 'cancelled'}
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.status).to.equal('cancelled')
    expect(result.completedAt).to.equal(1_700_000_002_000)
  })

  it('preserves provider, model, sessionId, and rich detail arrays', () => {
    const entry: TaskHistoryEntry = {
      ...baseEntry,
      completedAt: 1_700_000_002_000,
      model: 'gpt-5-pro',
      provider: 'openai',
      reasoningContents: [{content: 'thinking…', timestamp: 1_700_000_001_500}],
      responseContent: 'hello',
      result: 'done',
      sessionId: 'sess-1',
      status: 'completed',
      toolCalls: [
        {
          args: {path: '/x'},
          callId: 'call-1',
          sessionId: 'sess-1',
          status: 'completed',
          timestamp: 1_700_000_001_700,
          toolName: 'read_file',
        },
      ],
    }
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.provider).to.equal('openai')
    expect(result.model).to.equal('gpt-5-pro')
    expect(result.sessionId).to.equal('sess-1')
    expect(result.responseContent).to.equal('hello')
    expect(result.toolCalls).to.have.lengthOf(1)
    expect(result.toolCalls?.[0]?.toolName).to.equal('read_file')
    expect(result.reasoningContents).to.have.lengthOf(1)
  })

  it('preserves files and folderPath attachments', () => {
    const entry: TaskHistoryEntry = {
      ...baseEntry,
      files: ['a.md', 'b.md'],
      folderPath: '/some/folder',
      status: 'created',
    }
    const result = taskHistoryEntryToStoredTask(entry)
    expect(result.files).to.deep.equal(['a.md', 'b.md'])
    expect(result.folderPath).to.equal('/some/folder')
  })
})
