import {expect} from 'chai'

import {ChannelClient, ChannelClientError, type ChannelMentionStreamAck, type ChannelMentionSyncResponse} from '@brv/channel-client'

import * as doctorTool from '../src/tools/doctor.js'
import * as listTool from '../src/tools/list.js'
import * as mentionTool from '../src/tools/mention.js'
import * as showTool from '../src/tools/show.js'

// Slice 8.1 — unit tests for the four MCP tools that wrap the
// channel-client. Each tool is a pure function taking (input, deps);
// the MCP server (src/server.ts) wires them via `server.registerTool`.

type StubRequestRecord = {readonly event: string; readonly data: unknown}

const makeStubClient = (config: {
  readonly canned?: Map<string, unknown>
  readonly failures?: Map<string, Error>
}): {readonly client: ChannelClient; readonly requests: StubRequestRecord[]} => {
  const requests: StubRequestRecord[] = []
  const canned = config.canned ?? new Map()
  const failures = config.failures ?? new Map()
  const fake = {
    async request<TReq, TRes>(event: string, data: TReq): Promise<TRes> {
      requests.push({data, event})
      const failure = failures.get(event)
      if (failure !== undefined) throw failure
      return (canned.get(event) ?? {}) as TRes
    },
  }
  return {client: fake as unknown as ChannelClient, requests}
}

describe('@brv/channel-mcp tools (Slice 8.1)', () => {
  describe('channel.list', () => {
    it('emits channel:list and returns the channels array', async () => {
      const {client, requests} = makeStubClient({
        canned: new Map([
          [
            'channel:list',
            {
              channels: [
                {channelId: 'pi-test', memberCount: 2, members: [], updatedAt: '2026-05-13T00:00:00Z'},
              ],
            },
          ],
        ]),
      })
      const out = await listTool.handler({}, {client})
      expect(requests).to.have.lengthOf(1)
      expect(requests[0]!.event).to.equal('channel:list')
      expect(out.channels).to.have.lengthOf(1)
      expect(out.channels[0]!.channelId).to.equal('pi-test')
    })

    it('exposes the canonical tool metadata', () => {
      expect(listTool.NAME).to.equal('channel.list')
      expect(listTool.DESCRIPTION).to.be.a('string').and.have.length.greaterThan(0)
      expect(listTool.inputSchema).to.be.an('object')
    })
  })

  describe('channel.mention', () => {
    it('forwards prompt + channelId, forces mode: sync + suppressThoughts defaults true', async () => {
      const sync: ChannelMentionSyncResponse = {
        channelId: 'pi-test',
        durationMs: 47_312,
        endedState: 'completed',
        finalAnswer: 'auth.py looks clean.',
        toolCalls: [],
        turnId: '01HX-xyz',
      }
      const {client, requests} = makeStubClient({
        canned: new Map([['channel:mention', sync]]),
      })
      const out = await mentionTool.handler(
        {channelId: 'pi-test', prompt: 'review src/auth.py'},
        {client},
      )
      expect(requests).to.have.lengthOf(1)
      expect(requests[0]!.event).to.equal('channel:mention')
      const payload = requests[0]!.data as {
        channelId: string
        mode: string
        prompt: string
        suppressThoughts: boolean
        timeout?: number
      }
      expect(payload.channelId).to.equal('pi-test')
      expect(payload.prompt).to.equal('review src/auth.py')
      expect(payload.mode).to.equal('sync')
      expect(payload.suppressThoughts).to.equal(true)
      expect(out.finalAnswer).to.equal('auth.py looks clean.')
      expect(out.endedState).to.equal('completed')
    })

    it('honours explicit suppressThoughts: false (debug mode)', async () => {
      const {client, requests} = makeStubClient({
        canned: new Map([['channel:mention', {
          channelId: 'pi-test',
          durationMs: 1,
          endedState: 'completed',
          finalAnswer: '',
          toolCalls: [],
          turnId: 't',
        } satisfies ChannelMentionSyncResponse]]),
      })
      await mentionTool.handler(
        {channelId: 'pi-test', prompt: 'x', suppressThoughts: false},
        {client},
      )
      const payload = requests[0]!.data as {suppressThoughts: boolean}
      expect(payload.suppressThoughts).to.equal(false)
    })

    it('honours per-call timeout (ms)', async () => {
      const {client, requests} = makeStubClient({
        canned: new Map([['channel:mention', {
          channelId: 'pi-test',
          durationMs: 1,
          endedState: 'completed',
          finalAnswer: '',
          toolCalls: [],
          turnId: 't',
        } satisfies ChannelMentionSyncResponse]]),
      })
      await mentionTool.handler(
        {channelId: 'pi-test', prompt: 'x', timeout: 5000},
        {client},
      )
      const payload = requests[0]!.data as {timeout?: number}
      expect(payload.timeout).to.equal(5000)
    })

    it('rejects accidental stream-mode payloads (the tool always sets mode: sync)', () => {
      // The mention tool's input schema does NOT expose `mode`. Callers
      // who want the stream surface should drop down to the SDK directly.
      const shape = mentionTool.inputSchema
      expect(shape).to.not.have.property('mode')
    })

    it('error mapping: ChannelClientError propagates with code preserved', async () => {
      const failure = new ChannelClientError(
        'CHANNEL_SYNC_TIMEOUT',
        'turn 01HX did not complete within 120000ms',
      )
      const {client} = makeStubClient({
        failures: new Map([['channel:mention', failure]]),
      })
      let caught: unknown
      try {
        await mentionTool.handler({channelId: 'pi-test', prompt: 'x'}, {client})
      } catch (error) {
        caught = error
      }

      expect(caught).to.be.instanceOf(ChannelClientError)
      expect((caught as ChannelClientError).code).to.equal('CHANNEL_SYNC_TIMEOUT')
    })
  })

  describe('channel.show', () => {
    it('emits channel:get-turn with channelId + turnId', async () => {
      const {client, requests} = makeStubClient({
        canned: new Map([['channel:get-turn', {
          events: [
            {channelId: 'pi-test', kind: 'message', seq: 0, turnId: '01HX'},
          ],
          turn: {turnId: '01HX'},
        }]]),
      })
      const out = await showTool.handler(
        {channelId: 'pi-test', turnId: '01HX'},
        {client},
      )
      expect(requests[0]!.event).to.equal('channel:get-turn')
      const data = requests[0]!.data as {channelId: string; turnId: string}
      expect(data.channelId).to.equal('pi-test')
      expect(data.turnId).to.equal('01HX')
      expect(out.events).to.have.lengthOf(1)
    })
  })

  describe('channel.doctor', () => {
    it('emits channel:doctor with no payload by default', async () => {
      const {client, requests} = makeStubClient({
        canned: new Map([['channel:doctor', {
          profiles: [{name: 'kimi', ok: true}],
        }]]),
      })
      const out = await doctorTool.handler({}, {client})
      expect(requests[0]!.event).to.equal('channel:doctor')
      expect(requests[0]!.data).to.deep.equal({})
      expect(out.profiles).to.have.lengthOf(1)
    })

    it('forwards profile filter when supplied', async () => {
      const {client, requests} = makeStubClient({
        canned: new Map([['channel:doctor', {profiles: []}]]),
      })
      await doctorTool.handler({profile: 'kimi'}, {client})
      expect(requests[0]!.data).to.deep.equal({profile: 'kimi'})
    })
  })

  describe('tool metadata exposed for MCP registration', () => {
    it('every tool exports NAME, DESCRIPTION, inputSchema, handler', () => {
      for (const tool of [listTool, mentionTool, showTool, doctorTool]) {
        expect(tool.NAME).to.be.a('string').and.have.length.greaterThan(0)
        expect(tool.DESCRIPTION).to.be.a('string').and.have.length.greaterThan(0)
        expect(tool.inputSchema).to.be.an('object')
        expect(tool.handler).to.be.a('function')
      }
    })

    it('NAMEs match the documented channel.* surface', () => {
      expect(listTool.NAME).to.equal('channel.list')
      expect(mentionTool.NAME).to.equal('channel.mention')
      expect(showTool.NAME).to.equal('channel.show')
      expect(doctorTool.NAME).to.equal('channel.doctor')
    })
  })
})

// Suppress unused-import warning: ChannelMentionStreamAck is exported for
// the satisfies-check on stream-mode payloads inside the mention tool.
type _U = ChannelMentionStreamAck
