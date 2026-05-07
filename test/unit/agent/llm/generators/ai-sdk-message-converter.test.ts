import {expect} from 'chai'

import type {ToolSet as InternalToolSet} from '../../../../../src/agent/core/domain/tools/types.js'
import type {InternalMessage} from '../../../../../src/agent/core/interfaces/message-types.js'

import {toAiSdkTools, toModelMessages} from '../../../../../src/agent/infra/llm/generators/ai-sdk-message-converter.js'

function makeTool(description: string): InternalToolSet[string] {
  return {
    description,
    parameters: {properties: {}, type: 'object'},
  }
}

function getProviderOptions(tool: unknown): Record<string, unknown> | undefined {
  if (!tool || typeof tool !== 'object') return undefined
  return (tool as {providerOptions?: Record<string, unknown>}).providerOptions
}

const EPHEMERAL_CACHE_CONTROL = {anthropic: {cacheControl: {type: 'ephemeral'}}}

// File tests two unrelated exports (toAiSdkTools, toModelMessages); each
// gets its own top-level describe per the reviewer's structural feedback.
/* eslint-disable mocha/max-top-level-suites */

describe('toAiSdkTools — anthropic cache_control on last tool', () => {
  it('returns undefined when tools is undefined or empty', () => {
    expect(toAiSdkTools()).to.equal(undefined)
    expect(toAiSdkTools({})).to.equal(undefined)
  })

  it('attaches cache_control to the single tool when only one is registered', () => {
    const tools: InternalToolSet = {onlyTool: makeTool('the only one')}
    const result = toAiSdkTools(tools)
    expect(result).to.exist
    expect(getProviderOptions(result?.onlyTool)).to.deep.equal(EPHEMERAL_CACHE_CONTROL)
  })

  it('attaches cache_control to the LAST tool only when multiple are registered', () => {
    const tools: InternalToolSet = {
      firstTool: makeTool('first'),
      lastTool: makeTool('last'),
      middleTool: makeTool('middle'),
    }
    const result = toAiSdkTools(tools)
    expect(result).to.exist

    // The cache_control marker is attached to the LAST entry by insertion
    // order, NOT by name. In production, tool registration is deterministic
    // (driven by getToolNamesForCommand), so the "last" entry is stable.
    // In this test, the object literal is alphabetically sorted by the
    // sort-objects lint rule, so iteration order is
    // firstTool → lastTool → middleTool — and middleTool ends up last,
    // which is what should carry cacheControl. This test pins the
    // insertion-order contract, not an alphabetical or name-based one.
    expect(getProviderOptions(result?.firstTool)).to.equal(undefined)
    expect(getProviderOptions(result?.lastTool)).to.equal(undefined)
    expect(getProviderOptions(result?.middleTool)).to.deep.equal(EPHEMERAL_CACHE_CONTROL)
  })
})

describe('toModelMessages — reasoning round-trip', () => {
  // DeepSeek-R1 rejects with "The reasoning_content in the thinking mode
  // must be passed back to the API" if a prior assistant turn's reasoning
  // is not present when the conversation history is replayed.

  it('includes a reasoning part on the assistant message when msg.reasoning is set', () => {
    const messages: InternalMessage[] = [
      {content: 'hello', role: 'user'},
      {
        content: 'final answer',
        reasoning: 'Let me think... the answer must be X because Y.',
        role: 'assistant',
      },
    ]

    const result = toModelMessages(messages)
    const assistant = result.find((m) => m.role === 'assistant')
    expect(assistant).to.exist

    // Assistant content should be a parts array with reasoning ahead of text
    expect(Array.isArray(assistant?.content)).to.be.true
    const parts = assistant?.content as Array<{text?: string; type: string}>
    const types = parts.map((p) => p.type)
    expect(types).to.include('reasoning')
    expect(types).to.include('text')
    expect(types.indexOf('reasoning')).to.be.lessThan(types.indexOf('text'))

    const reasoningPart = parts.find((p) => p.type === 'reasoning')
    expect(reasoningPart?.text).to.equal('Let me think... the answer must be X because Y.')
  })

  it('keeps the simple text-only path when reasoning is absent', () => {
    const messages: InternalMessage[] = [
      {content: 'plain answer', role: 'assistant'},
    ]

    const result = toModelMessages(messages)
    const assistant = result.find((m) => m.role === 'assistant')
    // Pre-fix behavior preserved: no parts array, just a string
    expect(assistant?.content).to.equal('plain answer')
  })

  it('preserves reasoning-before-tool-call ordering when both are present', () => {
    const messages: InternalMessage[] = [
      {
        content: '',
        reasoning: 'I need to look up X',
        role: 'assistant',
        toolCalls: [
          {
            function: {arguments: '{"q":"hello"}', name: 'lookup'},
            id: 'call-1',
            type: 'function',
          },
        ],
      },
    ]

    const result = toModelMessages(messages)
    const assistant = result.find((m) => m.role === 'assistant')
    const parts = assistant?.content as Array<{type: string}>
    const types = parts.map((p) => p.type)
    // reasoning must precede tool-call so providers see it as a coherent turn
    expect(types[0]).to.equal('reasoning')
    expect(types).to.include('tool-call')
  })

  it('returns no message when both content/toolCalls/reasoning are empty', () => {
    const messages: InternalMessage[] = [
      {content: '', role: 'assistant'},
    ]

    const result = toModelMessages(messages)
    expect(result.find((m) => m.role === 'assistant')).to.equal(undefined)
  })

  it('emits a message with only a reasoning part when text and toolCalls are absent', () => {
    const messages: InternalMessage[] = [
      {content: null, reasoning: 'silent think', role: 'assistant'},
    ]
    const result = toModelMessages(messages)
    const assistant = result.find((m) => m.role === 'assistant')
    expect(assistant).to.exist
    const parts = assistant?.content as Array<{type: string}>
    expect(parts).to.have.length(1)
    expect(parts[0].type).to.equal('reasoning')
  })
})
