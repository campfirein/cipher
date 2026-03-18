import {expect} from 'chai'

import type {InternalMessage} from '../../../../../../src/agent/core/interfaces/message-types.js'

import {CompressionQualityEvaluator} from '../../../../../../src/agent/infra/llm/context/compression/compression-quality-evaluator.js'

function makeMessage(role: 'assistant' | 'system' | 'tool' | 'user', content: string, toolCalls?: Array<{function: {arguments: string; name: string}; id: string}>): InternalMessage {
  return {content, role, toolCalls} as InternalMessage
}

describe('CompressionQualityEvaluator', () => {
  describe('evaluate()', () => {
    it('should extract user intent from text parts in array content', () => {
      const evaluator = new CompressionQualityEvaluator()
      const original = [
        {
          content: [
            {text: 'Review the deployment config before release', type: 'text'},
          ],
          role: 'user',
        } as InternalMessage,
      ]
      const compressed = [makeMessage('system', '[Summary] Work completed.')]

      const snapshot = evaluator.evaluate(original, compressed)

      expect(snapshot.dimensions.userIntentClarity).to.equal(0)
    })

    it('should extract key decisions from assistant text parts in array content', () => {
      const evaluator = new CompressionQualityEvaluator()
      const original = [
        {
          content: [
            {text: 'I decided to cache the response locally for speed.', type: 'text'},
          ],
          role: 'assistant',
        } as InternalMessage,
      ]
      const compressed = [makeMessage('system', '[Summary] Some work was done.')]

      const snapshot = evaluator.evaluate(original, compressed)

      expect(snapshot.dimensions.factualCompleteness).to.equal(0)
    })

    it('should return perfect scores when all content is preserved', () => {
      const evaluator = new CompressionQualityEvaluator()
      const original = [
        makeMessage('user', 'Please read the config file'),
        makeMessage('assistant', 'I will use read_file to check the config', [
          {function: {arguments: '{}', name: 'read_file'}, id: '1'},
        ]),
      ]
      // Compressed keeps everything
      const compressed = [...original]

      const snapshot = evaluator.evaluate(original, compressed)

      expect(snapshot.overallScore).to.be.greaterThan(0.8)
      expect(snapshot.dimensions.toolContextPreservation).to.equal(1)
      expect(snapshot.dimensions.userIntentClarity).to.equal(1)
    })

    it('should detect loss of tool context', () => {
      const evaluator = new CompressionQualityEvaluator()
      const original = [
        makeMessage('user', 'Check the file'),
        makeMessage('assistant', 'Reading with read_file', [
          {function: {arguments: '{}', name: 'read_file'}, id: '1'},
        ]),
        makeMessage('assistant', 'Searching with grep_content', [
          {function: {arguments: '{}', name: 'grep_content'}, id: '2'},
        ]),
      ]
      // Compressed loses the grep_content tool call entirely
      const compressed = [
        makeMessage('system', '[Summary] User asked to check a file. Used read_file.'),
      ]

      const snapshot = evaluator.evaluate(original, compressed)

      // grep_content is missing from compressed
      expect(snapshot.dimensions.toolContextPreservation).to.be.lessThan(1)
    })

    it('should detect loss of user intent', () => {
      const evaluator = new CompressionQualityEvaluator()
      const original = [
        makeMessage('user', 'Deploy the application to production'),
        makeMessage('assistant', 'Starting deployment...'),
      ]
      // Compressed loses the user's request
      const compressed = [
        makeMessage('system', '[Summary] Task completed.'),
      ]

      const snapshot = evaluator.evaluate(original, compressed)

      expect(snapshot.dimensions.userIntentClarity).to.equal(0)
    })

    it('should return 1.0 for empty dimensions (nothing to check)', () => {
      const evaluator = new CompressionQualityEvaluator()
      // No tool calls, no user messages, no decisions
      const original = [makeMessage('system', 'You are a helpful assistant')]
      const compressed = [makeMessage('system', 'Summary')]

      const snapshot = evaluator.evaluate(original, compressed)

      // All dimensions should be 1.0 (nothing to lose)
      expect(snapshot.dimensions.factualCompleteness).to.equal(1)
      expect(snapshot.dimensions.toolContextPreservation).to.equal(1)
      expect(snapshot.dimensions.userIntentClarity).to.equal(1)
    })

    it('should detect loss of key decisions', () => {
      const evaluator = new CompressionQualityEvaluator()
      const original = [
        makeMessage('assistant', 'I decided to use the caching approach for better performance.'),
      ]
      const compressed = [
        makeMessage('system', '[Summary] Some work was done.'),
      ]

      const snapshot = evaluator.evaluate(original, compressed)

      expect(snapshot.dimensions.factualCompleteness).to.equal(0)
    })
  })

  describe('warningThreshold', () => {
    it('should default to 0.5', () => {
      const evaluator = new CompressionQualityEvaluator()

      expect(evaluator.warningThreshold).to.equal(0.5)
    })

    it('should accept custom threshold', () => {
      const evaluator = new CompressionQualityEvaluator({warningThreshold: 0.7})

      expect(evaluator.warningThreshold).to.equal(0.7)
    })
  })

  describe('overall score weighting', () => {
    it('should weight factual 0.4, tool 0.35, intent 0.25', () => {
      const evaluator = new CompressionQualityEvaluator()
      // Craft a case where all dimensions are 1.0
      const original = [makeMessage('system', 'hello')]
      const compressed = [...original]

      const snapshot = evaluator.evaluate(original, compressed)

      // 0.4*1 + 0.35*1 + 0.25*1 = 1.0
      expect(snapshot.overallScore).to.be.closeTo(1, 0.01)
    })
  })
})
