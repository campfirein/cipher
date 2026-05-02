import {expect} from 'chai'

import type {ToolSet as InternalToolSet} from '../../../../../src/agent/core/domain/tools/types.js'

import {toAiSdkTools} from '../../../../../src/agent/infra/llm/generators/ai-sdk-message-converter.js'

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
