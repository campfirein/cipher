#!/usr/bin/env node
/* eslint-disable n/no-unsupported-features/node-builtins, no-new, no-await-in-loop --
   Node engines.node is >=20 but this fixture targets the >=22 stack we ship with
   (Writable.toWeb / Readable.toWeb / global crypto are stable in 22.x); the SDK's own
   examples use the same patterns. The streaming loop is intentionally sequential.
   `new acp.AgentSideConnection(...)` is the SDK entrypoint pattern. */
/**
 * BRV-208 — Spawnable mock ACP server fixture (plain ESM JS, no TypeScript).
 *
 * Spawned by tests via `child_process.spawn`. We use plain JS rather than
 * a `.ts` file under `ts-node/esm` because the SDK's Web Stream typings
 * trip on a Node lib type mismatch under ts-node's loader.
 *
 * The TypeScript companion module (`mock-acp-server.ts`) re-exports
 * `MockAcpAgent` for unit-test imports; this `.mjs` entry just wires the
 * agent class to stdio.
 *
 * Scenarios — selected via `MOCK_ACP_SCENARIO` env var:
 *  - `echo` (default)         : one agent_message_chunk + end_turn.
 *  - `stream-50`              : 50 chunks + end_turn.
 *  - `fail-after-100ms`       : sessionUpdates ~100ms then throws.
 *  - `permission-required`    : requests permission → echoes outcome.
 */

import * as acp from '@agentclientprotocol/sdk'
import {Readable, Writable} from 'node:stream'

const SCENARIO = process.env.MOCK_ACP_SCENARIO ?? 'echo'

class MockAcpAgent {
  constructor(connection) {
    this.connection = connection
    this.sessions = new Map()
  }

  async authenticate() {
    return {}
  }

  async cancel(params) {
    const session = this.sessions.get(params.sessionId)
    if (session?.pendingPrompt) session.pendingPrompt.abort()
  }

  async initialize() {
    return {
      agentCapabilities: {loadSession: false},
      protocolVersion: acp.PROTOCOL_VERSION,
    }
  }

  async newSession() {
    const sessionId = randomHex(16)
    this.sessions.set(sessionId, {pendingPrompt: null})
    return {sessionId}
  }

  async prompt(params) {
    const session = this.sessions.get(params.sessionId)
    if (!session) throw new Error(`Session ${params.sessionId} not found`)
    session.pendingPrompt?.abort()
    const abort = new AbortController()
    session.pendingPrompt = abort

    try {
      await this.runScenario(params, abort.signal)
    } catch (error) {
      if (abort.signal.aborted) return {stopReason: 'cancelled'}
      throw error
    } finally {
      session.pendingPrompt = null
    }

    return {stopReason: 'end_turn'}
  }

  async runScenario(params, signal) {
    if (SCENARIO === 'echo') {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          content: {text: `mock echo: ${flattenPrompt(params)}`, type: 'text'},
          sessionUpdate: 'agent_message_chunk',
        },
      })
      return
    }

    if (SCENARIO === 'fail-after-100ms') {
      await sleep(100, signal)
      throw new Error('mock-acp-server: fail-after-100ms')
    }

    if (SCENARIO === 'permission-required') {
      const decision = await this.connection.requestPermission({
        options: [
          {kind: 'allow_once', name: 'Allow', optionId: 'allow'},
          {kind: 'reject_once', name: 'Deny', optionId: 'deny'},
        ],
        sessionId: params.sessionId,
        toolCall: {
          kind: 'edit',
          rawInput: {},
          status: 'pending',
          title: 'Mock permission request',
          toolCallId: `tool-${randomHex(4)}`,
        },
      })
      const granted = decision.outcome.outcome === 'selected' && decision.outcome.optionId === 'allow'
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          content: {
            text: granted ? 'permission granted; proceeding' : 'permission denied; stopping',
            type: 'text',
          },
          sessionUpdate: 'agent_message_chunk',
        },
      })
      return
    }

    if (SCENARIO === 'stream-50') {
      for (let i = 0; i < 50; i++) {
        if (signal.aborted) return
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            content: {text: `chunk-${i} `, type: 'text'},
            sessionUpdate: 'agent_message_chunk',
          },
        })
      }
    }
  }

  async setSessionMode() {
    return {}
  }
}

function flattenPrompt(req) {
  return req.prompt
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('')
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }

    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      {once: true},
    )
  })
}

const input = Writable.toWeb(process.stdout)
const output = Readable.toWeb(process.stdin)
const stream = acp.ndJsonStream(input, output)
new acp.AgentSideConnection((conn) => new MockAcpAgent(conn), stream)
