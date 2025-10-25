import {expect} from 'chai'
import {rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {ReflectorOutputJson} from '../../../../src/core/domain/entities/reflector-output.js'

import {ParseReflectionUseCase} from '../../../../src/core/usecases/parse-reflection-use-case.js'

describe('ParseReflectionUseCase', () => {
  let useCase: ParseReflectionUseCase

  beforeEach(() => {
    useCase = new ParseReflectionUseCase()
  })

  afterEach(async () => {
    // Clean up test artifacts in project root
    await rm(join(process.cwd(), '.br'), {force: true, recursive: true})
    // Clean up test artifacts in custom test directory
    await rm('/tmp/test-ace', {force: true, recursive: true})
  })

  describe('execute', () => {
    it('should parse valid reflection JSON and save to file', async () => {
      const reflectionJson: ReflectorOutputJson = {
        bulletTags: [
          {id: 'common-00001', tag: 'helpful'},
          {id: 'practices-00002', tag: 'harmful'},
        ],
        correctApproach: 'Should have validated inputs first',
        errorIdentification: 'Missing input validation',
        hint: 'test-hint',
        keyInsight: 'Always validate user inputs before processing',
        reasoning: 'Analysis of the execution',
        rootCauseAnalysis: 'Lack of input validation framework',
      }

      const result = await useCase.execute(reflectionJson)

      expect(result.success).to.be.true
      expect(result.reflection).to.exist
      expect(result.reflection!.keyInsight).to.equal('Always validate user inputs before processing')
      expect(result.reflection!.bulletTags).to.have.lengthOf(2)
      expect(result.filePath).to.be.a('string')
      expect(result.filePath).to.include('.br/ace/reflections/reflection-')
    })

    it('should handle invalid reflection JSON', async () => {
      const invalidJson = {
        reasoning: 'Missing required fields',
      } as unknown as ReflectorOutputJson

      const result = await useCase.execute(invalidJson)

      expect(result.success).to.be.false
      expect(result.error).to.exist
      expect(result.reflection).to.be.undefined
    })

    it('should accept custom directory parameter', async () => {
      const customDir = '/tmp/test-ace'
      const reflectionJson: ReflectorOutputJson = {
        bulletTags: [],
        correctApproach: 'Correct approach',
        errorIdentification: 'Error identified',
        hint: '',
        keyInsight: 'Key insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      }

      const result = await useCase.execute(reflectionJson, customDir)

      expect(result.success).to.be.true
      expect(result.filePath).to.include('/tmp/test-ace')
      expect(result.filePath).to.include('.br/ace/reflections')
    })

    it('should generate unique timestamps for concurrent reflections', async () => {
      const reflectionJson: ReflectorOutputJson = {
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reason',
        rootCauseAnalysis: 'Root cause',
      }

      const result1 = await useCase.execute(reflectionJson)
      // Small delay to ensure different timestamp
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      const result2 = await useCase.execute(reflectionJson)

      expect(result1.success).to.be.true
      expect(result2.success).to.be.true
      expect(result1.filePath).to.not.equal(result2.filePath)
    })
  })
})
