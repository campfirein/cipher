import {expect} from 'chai'

import type {HarnessNode} from '../../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {
  buildTemplatePrompt,
  buildTemplateStreamOptions,
  TEMPLATE_MAX_ITERATIONS,
} from '../../../../../src/server/infra/harness/curation/curation-template-executor.js'

function createNode(overrides: Partial<HarnessNode> = {}): HarnessNode {
  return {
    alpha: 1,
    beta: 1,
    childIds: [],
    createdAt: Date.now(),
    heuristic: 0.5,
    id: 'test-node',
    metadata: {},
    parentId: null,
    templateContent: 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication',
    visitCount: 0,
    ...overrides,
  }
}

describe('curation-template-executor', () => {
  describe('buildTemplatePrompt', () => {
    it('should prepend template strategy before the base prompt', () => {
      const node = createNode()
      const basePrompt = 'Curate using RLM approach.\nContext variable: __curate_ctx'

      const result = buildTemplatePrompt(node, basePrompt)

      expect(result).to.include('## Curation Strategy (learned)')
      expect(result).to.include(node.templateContent)
      expect(result).to.include(basePrompt)
      // Template should come BEFORE the base prompt
      const templateIdx = result.indexOf('## Curation Strategy (learned)')
      const baseIdx = result.indexOf(basePrompt)
      expect(templateIdx).to.be.lessThan(baseIdx)
    })

    it('should include full YAML content from the template node', () => {
      const yamlContent = [
        'domainRouting:',
        '  - keywords: [api, endpoint]',
        '    domain: architecture/api',
        '  - keywords: [auth, jwt]',
        '    domain: security/authentication',
        'operationRules:',
        '  - condition: "existing entry found"',
        '    operation: UPDATE',
      ].join('\n')

      const node = createNode({templateContent: yamlContent})
      const result = buildTemplatePrompt(node, 'base prompt')

      expect(result).to.include(yamlContent)
    })

    it('should handle empty template content gracefully', () => {
      const node = createNode({templateContent: ''})
      const result = buildTemplatePrompt(node, 'base prompt')

      expect(result).to.include('## Curation Strategy (learned)')
      expect(result).to.include('base prompt')
    })
  })

  describe('buildTemplateStreamOptions', () => {
    it('should set maxIterations to TEMPLATE_MAX_ITERATIONS', () => {
      const options = buildTemplateStreamOptions('session-123', 'task-456')

      expect(options.executionContext!.maxIterations).to.equal(TEMPLATE_MAX_ITERATIONS)
      expect(TEMPLATE_MAX_ITERATIONS).to.equal(10)
    })

    it('should set commandType to curate', () => {
      const options = buildTemplateStreamOptions('session-123', 'task-456')

      expect(options.executionContext!.commandType).to.equal('curate')
    })

    it('should set clearHistory to true', () => {
      const options = buildTemplateStreamOptions('session-123', 'task-456')

      expect(options.executionContext!.clearHistory).to.be.true
    })

    it('should pass through sessionId and taskId', () => {
      const options = buildTemplateStreamOptions('my-session', 'my-task')

      expect(options.sessionId).to.equal('my-session')
      expect(options.taskId).to.equal('my-task')
    })
  })

  describe('TEMPLATE_MAX_ITERATIONS', () => {
    it('should be significantly less than the full agent loop (50)', () => {
      expect(TEMPLATE_MAX_ITERATIONS).to.be.lessThan(50)
      expect(TEMPLATE_MAX_ITERATIONS).to.be.greaterThan(0)
    })
  })
})
