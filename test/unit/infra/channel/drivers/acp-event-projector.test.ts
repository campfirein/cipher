import type {SessionNotification} from '@agentclientprotocol/sdk'

import {expect} from 'chai'
import {createHash} from 'node:crypto'
import {mkdtempSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {TurnEvent} from '../../../../../src/server/core/domain/channel/types.js'
import {AcpEventProjector} from '../../../../../src/server/infra/channel/drivers/acp-event-projector.js'

type Update = SessionNotification['update']

function asUpdate(value: unknown): Update {
  return value as Update
}

function project(update: Update, turnId = 't-001'): TurnEvent[] {
  const projector = new AcpEventProjector({turnId})
  return [...projector.project(update)]
}

function projectMany(updates: Update[], turnId = 't-001'): TurnEvent[] {
  const projector = new AcpEventProjector({turnId})
  const events: TurnEvent[] = []
  for (const update of updates) {
    for (const event of projector.project(update)) events.push(event)
  }

  return events
}

describe('AcpEventProjector', () => {
  describe('agent_message_chunk', () => {
    it('emits one token event per text chunk', () => {
      const events = project(asUpdate({
        content: {text: 'hello ', type: 'text'},
        sessionUpdate: 'agent_message_chunk',
      }))
      expect(events).to.have.length(1)
      expect(events[0]).to.deep.equal({delta: 'hello ', kind: 'token'})
    })

    it('drops non-text chunks', () => {
      const events = project(asUpdate({
        content: {data: 'aGVsbG8=', mimeType: 'image/png', type: 'image'},
        sessionUpdate: 'agent_message_chunk',
      }))
      expect(events).to.have.length(0)
    })
  })

  describe('tool_call (start)', () => {
    it('emits status:tool plus artifact_intent for edit kind with a path', () => {
      const events = project(asUpdate({
        kind: 'edit',
        locations: [{path: '/repo/src/auth.ts'}],
        rawInput: {content: 'export const x = 1\n'},
        sessionUpdate: 'tool_call',
        title: 'Edit src/auth.ts',
        toolCallId: 'tc-1',
      }))
      expect(events).to.have.length(2)
      expect(events[0]).to.deep.equal({kind: 'status', status: 'tool'})
      expect(events[1].kind).to.equal('artifact_intent')
      if (events[1].kind === 'artifact_intent') {
        expect(events[1].path).to.equal('/repo/src/auth.ts')
        expect(events[1].contentHash).to.equal(createHash('sha256').update('export const x = 1\n').digest('hex'))
        expect(events[1].bytesEstimate).to.equal(Buffer.byteLength('export const x = 1\n'))
      }
    })

    it('uses a deterministic placeholder hash when planned content is missing', () => {
      const events = project(asUpdate({
        kind: 'edit',
        locations: [{path: '/repo/src/auth.ts'}],
        rawInput: {},
        sessionUpdate: 'tool_call',
        title: 'Edit src/auth.ts',
        toolCallId: 'tc-2',
      }), 't-007')
      const intent = events.find((event) => event.kind === 'artifact_intent')
      expect(intent).to.exist
      if (intent?.kind === 'artifact_intent') {
        expect(intent.contentHash).to.equal(createHash('sha256').update('t-007:tc-2').digest('hex'))
        expect(intent.bytesEstimate).to.be.undefined
      }
    })

    it('emits only status:tool for non-edit kinds', () => {
      const events = project(asUpdate({
        kind: 'execute',
        sessionUpdate: 'tool_call',
        title: 'Run tests',
        toolCallId: 'tc-3',
      }))
      expect(events).to.have.length(1)
      expect(events[0]).to.deep.equal({kind: 'status', status: 'tool'})
    })
  })

  describe('tool_call_update (terminal)', () => {
    it('emits tool:ok=true on completed status', () => {
      const events = projectMany([
        asUpdate({kind: 'execute', sessionUpdate: 'tool_call', title: 'Run tests', toolCallId: 'tc-4'}),
        asUpdate({sessionUpdate: 'tool_call_update', status: 'completed', toolCallId: 'tc-4'}),
      ])
      const completed = events.find((event) => event.kind === 'tool')
      expect(completed).to.exist
      if (completed?.kind === 'tool') {
        expect(completed.ok).to.equal(true)
        expect(completed.name).to.equal('Run tests')
        expect(completed.latencyMs).to.be.greaterThanOrEqual(0)
      }
    })

    it('emits tool:ok=false plus error on failed status', () => {
      const events = projectMany([
        asUpdate({kind: 'execute', sessionUpdate: 'tool_call', title: 'Run tests', toolCallId: 'tc-5'}),
        asUpdate({error: {message: 'exit code 1'}, sessionUpdate: 'tool_call_update', status: 'failed', toolCallId: 'tc-5'}),
      ])
      const tool = events.find((event) => event.kind === 'tool')
      const error = events.find((event) => event.kind === 'error')
      expect(tool).to.exist
      expect(error).to.exist
      if (tool?.kind === 'tool') expect(tool.ok).to.equal(false)
      if (error?.kind === 'error') expect(error.message).to.equal('exit code 1')
    })

    it('emits artifact event with file bytes on completed edit', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'brv-projector-'))
      const filePath = path.join(dir, 'auth.ts')
      writeFileSync(filePath, 'export const x = 1\n')
      const events = projectMany([
        asUpdate({
          kind: 'edit',
          locations: [{path: filePath}],
          rawInput: {content: 'export const x = 1\n'},
          sessionUpdate: 'tool_call',
          title: 'Edit auth.ts',
          toolCallId: 'tc-6',
        }),
        asUpdate({
          kind: 'edit',
          locations: [{path: filePath}],
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          title: 'Edit auth.ts',
          toolCallId: 'tc-6',
        }),
      ])
      const artifact = events.find((event) => event.kind === 'artifact')
      expect(artifact).to.exist
      if (artifact?.kind === 'artifact') {
        expect(artifact.path).to.equal(filePath)
        expect(artifact.bytes).to.equal(Buffer.byteLength('export const x = 1\n'))
        expect(artifact.summary).to.equal('Edit auth.ts')
      }
    })

    it('ignores out-of-order completed (no matching tool_call)', () => {
      const events = project(asUpdate({sessionUpdate: 'tool_call_update', status: 'completed', toolCallId: 'unknown'}))
      expect(events).to.have.length(0)
    })

    it('drops non-terminal status updates (pending, in_progress)', () => {
      const events = projectMany([
        asUpdate({kind: 'execute', sessionUpdate: 'tool_call', title: 'X', toolCallId: 'tc-7'}),
        asUpdate({sessionUpdate: 'tool_call_update', status: 'in_progress', toolCallId: 'tc-7'}),
      ])
      // Only the start emits status:tool; in_progress emits nothing.
      expect(events).to.have.length(1)
      expect(events[0]).to.deep.equal({kind: 'status', status: 'tool'})
    })
  })

  describe('schema invariants', () => {
    it('every emitted event round-trips through TurnEvent zod schema', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'brv-projector-zod-'))
      const filePath = path.join(dir, 'plan.md')
      writeFileSync(filePath, '# plan')
      const events = projectMany([
        asUpdate({content: {text: 'hi', type: 'text'}, sessionUpdate: 'agent_message_chunk'}),
        asUpdate({
          kind: 'edit',
          locations: [{path: filePath}],
          rawInput: {content: '# plan'},
          sessionUpdate: 'tool_call',
          title: 'Edit plan',
          toolCallId: 'tc-zod',
        }),
        asUpdate({
          kind: 'edit',
          locations: [{path: filePath}],
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          title: 'Edit plan',
          toolCallId: 'tc-zod',
        }),
      ])
      for (const event of events) {
        expect(() => TurnEvent.parse(event)).to.not.throw()
      }
    })

    it('artifact events never include a `version` field', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'brv-projector-version-'))
      const filePath = path.join(dir, 'x.txt')
      writeFileSync(filePath, 'x')
      const events = projectMany([
        asUpdate({
          kind: 'edit',
          locations: [{path: filePath}],
          rawInput: {content: 'x'},
          sessionUpdate: 'tool_call',
          title: 'Edit x',
          toolCallId: 'tc-v',
        }),
        asUpdate({
          kind: 'edit',
          locations: [{path: filePath}],
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          title: 'Edit x',
          toolCallId: 'tc-v',
        }),
      ])
      const artifact = events.find((event) => event.kind === 'artifact')
      expect(artifact).to.exist
      if (artifact) expect((artifact as Record<string, unknown>).version).to.be.undefined
    })
  })
})
