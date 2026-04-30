/* eslint-disable n/no-unsupported-features/node-builtins --
   Node engines.node is >=20; this test uses Web stream APIs (toWeb / WritableStream / ReadableStream)
   that are stable in 22.x and match what the SDK's own examples ship. */
import type {Readable as NodeReadable, Writable as NodeWritable} from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'
import {expect} from 'chai'
import {type ChildProcessByStdio, spawn} from 'node:child_process'
import {Readable, Writable} from 'node:stream'
import {fileURLToPath} from 'node:url'

/**
 * BRV-208 smoke test — spawns the fixture as a real subprocess, drives it
 * via the SDK's `ClientSideConnection`, and verifies the ACP wire shape.
 *
 * This is the only Phase 1 production-code path that touches the SDK at
 * runtime; the orchestrator uses the in-tree `MockChannelAgentDriver`.
 * Phase 2's BRV-209 ACP driver class will reuse the spawn-and-connect
 * pattern from this test.
 */

const FIXTURE_PATH = fileURLToPath(new URL('../../../helpers/mock-acp-server.mjs', import.meta.url))

interface UpdateRecord {
  sessionId: string
  update: acp.SessionNotification['update']
}

// eslint-disable-next-line import/namespace -- Client is exported via SDK's `export *` re-export; eslint plugin can't trace it
class CapturingClient implements acp.Client {
  public readonly updates: UpdateRecord[] = []

  async readTextFile(): Promise<acp.ReadTextFileResponse> {
    throw new Error('not implemented')
  }

  async requestPermission(_params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    return {outcome: {optionId: 'allow', outcome: 'selected'}}
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updates.push({sessionId: params.sessionId, update: params.update})
  }

  async writeTextFile(): Promise<acp.WriteTextFileResponse> {
    return {}
  }
}

function spawnFixture(scenario: string): ChildProcessByStdio<NodeWritable, NodeReadable, null> {
  return spawn(
    process.execPath,
    ['--no-warnings', FIXTURE_PATH],
    {
      env: {...process.env, MOCK_ACP_SCENARIO: scenario},
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )
}

async function connect(child: ChildProcessByStdio<NodeWritable, NodeReadable, null>): Promise<{client: CapturingClient; conn: acp.ClientSideConnection}> {
  const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  const stream = acp.ndJsonStream(input, output)
  const client = new CapturingClient()
  const conn = new acp.ClientSideConnection(() => client, stream)
  return {client, conn}
}

describe('mock ACP server fixture (BRV-208)', () => {
  it('echo scenario: completes a prompt with one message chunk', async () => {
    const child = spawnFixture('echo')
    try {
      const {client, conn} = await connect(child)

      await conn.initialize({clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}}, protocolVersion: acp.PROTOCOL_VERSION})
      const session = await conn.newSession({cwd: process.cwd(), mcpServers: []})

      const response = await conn.prompt({
        prompt: [{text: 'hello', type: 'text'}],
        sessionId: session.sessionId,
      })

      expect(response.stopReason).to.equal('end_turn')
      expect(client.updates.length).to.be.greaterThan(0)
      const chunk = client.updates[0].update
      expect(chunk.sessionUpdate).to.equal('agent_message_chunk')
      if (chunk.sessionUpdate === 'agent_message_chunk' && chunk.content.type === 'text') {
        expect(chunk.content.text).to.match(/^mock echo: hello$/)
      }
    } finally {
      child.kill('SIGTERM')
    }
  }).timeout(10_000)

  it('stream-50 scenario: streams 50 chunks before completing', async () => {
    const child = spawnFixture('stream-50')
    try {
      const {client, conn} = await connect(child)

      await conn.initialize({clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}}, protocolVersion: acp.PROTOCOL_VERSION})
      const session = await conn.newSession({cwd: process.cwd(), mcpServers: []})
      const response = await conn.prompt({prompt: [{text: 'go', type: 'text'}], sessionId: session.sessionId})

      expect(response.stopReason).to.equal('end_turn')
      expect(client.updates).to.have.length(50)
    } finally {
      child.kill('SIGTERM')
    }
  }).timeout(10_000)

  it('permission-required scenario: routes the requestPermission roundtrip and echoes the outcome', async () => {
    // Capture the client's permission decision so the agent's echo is checked end-to-end.
    class DenyingClient extends CapturingClient {
      override async requestPermission(_params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
        return {outcome: {optionId: 'deny', outcome: 'selected'}}
      }
    }
    const child = spawnFixture('permission-required')
    try {
      const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
      const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
      const stream = acp.ndJsonStream(input, output)
      const client = new DenyingClient()
      const conn = new acp.ClientSideConnection(() => client, stream)

      await conn.initialize({clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}}, protocolVersion: acp.PROTOCOL_VERSION})
      const session = await conn.newSession({cwd: process.cwd(), mcpServers: []})
      const response = await conn.prompt({prompt: [{text: 'go', type: 'text'}], sessionId: session.sessionId})

      expect(response.stopReason).to.equal('end_turn')
      const final = client.updates.at(-1)?.update
      if (final?.sessionUpdate === 'agent_message_chunk' && final.content.type === 'text') {
        expect(final.content.text).to.match(/permission denied/)
      }
    } finally {
      child.kill('SIGTERM')
    }
  }).timeout(10_000)

  it('fail-after-100ms scenario: surfaces an error to the client', async () => {
    const child = spawnFixture('fail-after-100ms')
    try {
      const {conn} = await connect(child)

      await conn.initialize({clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}}, protocolVersion: acp.PROTOCOL_VERSION})
      const session = await conn.newSession({cwd: process.cwd(), mcpServers: []})

      let threw = false
      try {
        await conn.prompt({prompt: [{text: 'go', type: 'text'}], sessionId: session.sessionId})
      } catch {
        threw = true
      }

      expect(threw).to.equal(true)
    } finally {
      child.kill('SIGTERM')
    }
  }).timeout(10_000)
})
