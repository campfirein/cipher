import {expect} from 'chai'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {streamToText} from '../../../../src/agent/infra/llm/stream-to-text.js'

describe('streamToText', () => {
  it('accumulates streamed text chunks and ignores empty chunks', async () => {
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: async () => ({content: '', finishReason: 'stop' as const}),
      async *generateContentStream() {
        yield {content: 'Hello', isComplete: false}
        yield {isComplete: false}
        yield {content: ' world', isComplete: false}
        yield {isComplete: true}
      },
    } as unknown as IContentGenerator

    const result = await streamToText(generator, {
      config: {maxTokens: 10, temperature: 0},
      contents: [{content: 'test', role: 'user'}],
      model: 'default',
      taskId: 'task-1',
    })

    expect(result).to.equal('Hello world')
  })
})
