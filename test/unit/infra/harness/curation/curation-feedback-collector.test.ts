import {expect} from 'chai'

import type {GenerateResponse} from '../../../../../src/agent/core/domain/streaming/types.js'
import type {CurateLogOperation} from '../../../../../src/server/core/domain/entities/curate-log-entry.js'

import {
  buildCurationFeedback,
  extractOperationsFromResponse,
  extractPredictionsFromTemplate,
  scoreShadow,
} from '../../../../../src/server/infra/harness/curation/curation-feedback-collector.js'

function createMockGenResponse(toolCalls: GenerateResponse['toolCalls'] = []): GenerateResponse {
  return {
    content: 'Curation complete.',
    sessionId: 'mock-session',
    toolCalls,
    usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
  }
}

function createOp(overrides: Partial<CurateLogOperation> = {}): CurateLogOperation {
  return {
    path: 'test/domain/topic.md',
    status: 'success',
    type: 'ADD',
    ...overrides,
  }
}

describe('curation-feedback-collector', () => {
  describe('extractOperationsFromResponse', () => {
    it('should return empty array for response with no tool calls', () => {
      const response = createMockGenResponse([])
      expect(extractOperationsFromResponse(response)).to.deep.equal([])
    })

    it('should extract operations from curate tool calls', () => {
      const response = createMockGenResponse([
        {
          args: {},
          callId: 'call-1',
          result: {
            data: JSON.stringify({applied: [{path: 'a/b.md', status: 'success', type: 'ADD'}]}),
            success: true,
          },
          toolName: 'curate',
        },
      ])

      const ops = extractOperationsFromResponse(response)
      expect(ops).to.have.length(1)
      expect(ops[0].path).to.equal('a/b.md')
    })

    it('should extract operations from code_exec tool calls', () => {
      const response = createMockGenResponse([
        {
          args: {},
          callId: 'call-1',
          result: {
            data: JSON.stringify({
              curateResults: [{applied: [{path: 'x/y.md', status: 'success', type: 'UPSERT'}]}],
            }),
            success: true,
          },
          toolName: 'code_exec',
        },
      ])

      const ops = extractOperationsFromResponse(response)
      expect(ops).to.have.length(1)
      expect(ops[0].type).to.equal('UPSERT')
    })

    it('should skip non-curate/non-code_exec tools', () => {
      const response = createMockGenResponse([
        {
          args: {},
          callId: 'call-1',
          result: {data: 'file content', success: true},
          toolName: 'read_file',
        },
      ])

      expect(extractOperationsFromResponse(response)).to.deep.equal([])
    })
  })

  describe('buildCurationFeedback', () => {
    it('should return null for empty operations', () => {
      expect(buildCurationFeedback('node-1', [])).to.be.null
    })

    it('should return success feedback when all ops succeed', () => {
      const ops = [createOp(), createOp({path: 'b/c.md'})]
      const feedback = buildCurationFeedback('node-1', ops)

      expect(feedback).to.not.be.null
      expect(feedback!.success).to.be.true
      expect(feedback!.nodeId).to.equal('node-1')
      expect(feedback!.details).to.deep.include({failures: 0, successes: 2, total: 2})
    })

    it('should return failure feedback when any op fails', () => {
      const ops = [createOp(), createOp({status: 'failed'})]
      const feedback = buildCurationFeedback('node-1', ops)

      expect(feedback).to.not.be.null
      expect(feedback!.success).to.be.false
      expect(feedback!.details).to.deep.include({failures: 1, successes: 1, total: 2})
    })
  })

  describe('scoreShadow', () => {
    it('should return null for empty actuals', () => {
      expect(scoreShadow(['a/b.md'], [])).to.be.null
    })

    it('should return null for all-failed actuals', () => {
      expect(scoreShadow(['a/b.md'], [createOp({status: 'failed'})])).to.be.null
    })

    it('should return null for empty predictions', () => {
      expect(scoreShadow([], [createOp()])).to.be.null
    })

    it('should return f1=1 for perfect match', () => {
      const result = scoreShadow(['test/domain/topic.md'], [createOp()])

      expect(result).to.not.be.null
      expect(result!.alpha).to.be.closeTo(1, 0.001)
      expect(result!.beta).to.be.closeTo(0, 0.001)
    })

    it('should not give prefix credit — broad domain routes must match exactly', () => {
      const result = scoreShadow(
        ['security/authentication'],
        [createOp({path: '/security/authentication/jwt.md'})],
      )

      // Exact match only: "security/authentication" !== "security/authentication/jwt"
      expect(result).to.not.be.null
      expect(result!.alpha).to.equal(0)
      expect(result!.beta).to.equal(1)
    })

    it('should return f1=0 for complete miss', () => {
      const result = scoreShadow(['wrong/path.md'], [createOp()])

      expect(result).to.not.be.null
      expect(result!.alpha).to.equal(0)
      expect(result!.beta).to.equal(1)
    })

    it('should penalize under-prediction (low recall)', () => {
      const actuals = [
        createOp({path: 'a/1.md'}),
        createOp({path: 'a/2.md'}),
        createOp({path: 'a/3.md'}),
        createOp({path: 'a/4.md'}),
        createOp({path: 'a/5.md'}),
        createOp({path: 'a/6.md'}),
      ]
      // Predict only 1 of 6
      const result = scoreShadow(['a/1.md'], actuals)

      expect(result).to.not.be.null
      // precision = 1/1 = 1, recall = 1/6 = 0.167, F1 ~ 0.286
      expect(result!.alpha).to.be.lessThan(0.3)
    })

    it('should penalize over-prediction (low precision)', () => {
      const actuals = [createOp({path: 'a/1.md'})]
      // Predict 6, only 1 correct
      const result = scoreShadow(['a/1.md', 'a/2.md', 'a/3.md', 'a/4.md', 'a/5.md', 'a/6.md'], actuals)

      expect(result).to.not.be.null
      // precision = 1/6 = 0.167, recall = 1/1 = 1, F1 ~ 0.286
      expect(result!.alpha).to.be.lessThan(0.3)
    })

    it('should normalize path separators and case for matching', () => {
      const result = scoreShadow(
        [String.raw`Security\Authentication`],
        [createOp({path: '/security/authentication.md'})],
      )

      expect(result).to.not.be.null
      // After normalization both become "security/authentication"
      expect(result!.alpha).to.be.closeTo(1, 0.001)
    })

    it('should handle multiple actuals with mixed success/failure', () => {
      const actuals = [
        createOp({path: 'a/1.md', status: 'success'}),
        createOp({path: 'a/2.md', status: 'failed'}),
        createOp({path: 'a/3.md', status: 'success'}),
      ]
      // Only successful actuals are considered
      const result = scoreShadow(['a/1.md', 'a/3.md'], actuals)

      expect(result).to.not.be.null
      // Both predictions match successful actuals: perfect F1
      expect(result!.alpha).to.be.closeTo(1, 0.001)
    })
  })

  describe('extractPredictionsFromTemplate', () => {
    it('should extract domains matching keywords in the context', () => {
      const template = 'domainRouting:\n  - keywords: [auth, jwt]\n    domain: security/authentication'
      const predictions = extractPredictionsFromTemplate(template, 'how to set up jwt tokens')

      expect(predictions).to.have.length(1)
      expect(predictions[0]).to.equal('security/authentication')
    })

    it('should return empty for context not matching any keywords', () => {
      const template = 'domainRouting:\n  - keywords: [auth, jwt]\n    domain: security/authentication'
      const predictions = extractPredictionsFromTemplate(template, 'deploying kubernetes pods')

      expect(predictions).to.have.length(0)
    })

    it('should match multiple domains when context has multiple keyword matches', () => {
      const template = [
        'domainRouting:',
        '  - keywords: [auth, jwt]',
        '    domain: security/authentication',
        '  - keywords: [deploy, kubernetes]',
        '    domain: infrastructure/deployment',
      ].join('\n')
      const predictions = extractPredictionsFromTemplate(
        template,
        'deploy the auth service to kubernetes',
      )

      expect(predictions).to.have.length(2)
      expect(predictions).to.include('security/authentication')
      expect(predictions).to.include('infrastructure/deployment')
    })

    it('should return empty for invalid YAML', () => {
      const predictions = extractPredictionsFromTemplate(': : invalid : yaml :', 'auth')
      expect(predictions).to.have.length(0)
    })

    it('should return empty when template has no domainRouting', () => {
      const template = 'operationRules:\n  - condition: test\n    operation: ADD'
      const predictions = extractPredictionsFromTemplate(template, 'auth')

      expect(predictions).to.have.length(0)
    })

    it('should be case-insensitive for keyword matching', () => {
      const template = 'domainRouting:\n  - keywords: [JWT]\n    domain: security/authentication'
      const predictions = extractPredictionsFromTemplate(template, 'setting up jwt tokens')

      expect(predictions).to.have.length(1)
    })
  })
})
