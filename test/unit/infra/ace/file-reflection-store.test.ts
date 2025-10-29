import {expect} from 'chai'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ReflectorOutput} from '../../../../src/core/domain/entities/reflector-output.js'
import {FileReflectionStore} from '../../../../src/infra/ace/file-reflection-store.js'

describe('FileReflectionStore', () => {
  let store: FileReflectionStore
  let testDir: string

  beforeEach(() => {
    store = new FileReflectionStore()
    testDir = join(tmpdir(), `byterover-test-${Date.now()}`)
  })

  describe('save', () => {
    it('should save reflection output with hint', async () => {
      const reflection = new ReflectorOutput({
        bulletTags: [{id: 'bullet-1', tag: 'tested'}],
        correctApproach: 'Used TDD',
        errorIdentification: 'No errors',
        hint: 'test-approach',
        keyInsight: 'TDD improves code quality',
        reasoning: 'Analysis shows benefits',
        rootCauseAnalysis: 'N/A',
      })

      const filePath = await store.save(reflection, testDir)

      // Verify file path structure
      expect(filePath).to.include('.br/ace/reflections')
      expect(filePath).to.include('reflection-test-approach-')
      expect(filePath).to.include('.json')

      // Verify file contents
      const content = await readFile(filePath, 'utf8')
      const saved = JSON.parse(content)

      expect(saved.hint).to.equal('test-approach')
      expect(saved.keyInsight).to.equal('TDD improves code quality')
      expect(saved.bulletTags).to.have.lengthOf(1)
    })

    it('should save reflection without hint', async () => {
      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Test',
        errorIdentification: 'None',
        hint: '',
        keyInsight: 'Test insight',
        reasoning: 'Test',
        rootCauseAnalysis: 'N/A',
      })

      const filePath = await store.save(reflection, testDir)

      expect(filePath).to.include('.br/ace/reflections/reflection-')
      expect(filePath).to.not.include('reflection--')
    })

    it('should create directory if it does not exist', async () => {
      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Test',
        errorIdentification: 'None',
        hint: 'test',
        keyInsight: 'Test',
        reasoning: 'Test',
        rootCauseAnalysis: 'N/A',
      })

      // Should not throw when directory doesn't exist
      const filePath = await store.save(reflection, testDir)
      expect(filePath).to.exist
    })
  })

  describe('loadRecent', () => {
    it('should load most recent reflections', async () => {
      // Create test reflections directory
      const reflectionsDir = join(testDir, '.br', 'ace', 'reflections')
      await mkdir(reflectionsDir, {recursive: true})

      // Create test reflection files with timestamps
      const reflection1 = {
        bulletTags: [],
        correctApproach: 'Approach 1',
        errorIdentification: 'None',
        hint: 'first',
        keyInsight: 'Insight 1',
        reasoning: 'Reasoning 1',
        rootCauseAnalysis: 'N/A',
      }

      const reflection2 = {
        bulletTags: [],
        correctApproach: 'Approach 2',
        errorIdentification: 'None',
        hint: 'second',
        keyInsight: 'Insight 2',
        reasoning: 'Reasoning 2',
        rootCauseAnalysis: 'N/A',
      }

      await writeFile(join(reflectionsDir, 'reflection-2024-01-01T00-00-00.000Z.json'), JSON.stringify(reflection1))
      await writeFile(join(reflectionsDir, 'reflection-2024-01-02T00-00-00.000Z.json'), JSON.stringify(reflection2))

      // Load recent reflections
      const reflections = await store.loadRecent(testDir, 2)

      expect(reflections).to.have.lengthOf(2)
      // Should be sorted most recent first
      expect(reflections[0].hint).to.equal('second')
      expect(reflections[1].hint).to.equal('first')
    })

    it('should limit number of reflections returned', async () => {
      const reflectionsDir = join(testDir, '.br', 'ace', 'reflections')
      await mkdir(reflectionsDir, {recursive: true})

      // Create 5 test reflections
      const writePromises: Promise<void>[] = []
      for (let i = 0; i < 5; i++) {
        const reflection = {
          bulletTags: [],
          correctApproach: `Approach ${i}`,
          errorIdentification: 'None',
          hint: `reflection-${i}`,
          keyInsight: `Insight ${i}`,
          reasoning: `Reasoning ${i}`,
          rootCauseAnalysis: 'N/A',
        }
        writePromises.push(
          writeFile(
            join(reflectionsDir, `reflection-2024-01-0${i + 1}T00-00-00.000Z.json`),
            JSON.stringify(reflection),
          ),
        )
      }

      await Promise.all(writePromises)

      // Load only 3 most recent
      const reflections = await store.loadRecent(testDir, 3)

      expect(reflections).to.have.lengthOf(3)
    })

    it('should return empty array if directory does not exist', async () => {
      const reflections = await store.loadRecent(testDir, 3)

      expect(reflections).to.be.an('array').that.is.empty
    })

    it('should return empty array if directory is empty', async () => {
      const reflectionsDir = join(testDir, '.br', 'ace', 'reflections')
      await mkdir(reflectionsDir, {recursive: true})

      const reflections = await store.loadRecent(testDir, 3)

      expect(reflections).to.be.an('array').that.is.empty
    })

    it('should default to loading 3 reflections', async () => {
      const reflectionsDir = join(testDir, '.br', 'ace', 'reflections')
      await mkdir(reflectionsDir, {recursive: true})

      // Create 5 test reflections
      const writePromises: Promise<void>[] = []
      for (let i = 0; i < 5; i++) {
        const reflection = {
          bulletTags: [],
          correctApproach: `Approach ${i}`,
          errorIdentification: 'None',
          hint: `reflection-${i}`,
          keyInsight: `Insight ${i}`,
          reasoning: `Reasoning ${i}`,
          rootCauseAnalysis: 'N/A',
        }
        writePromises.push(
          writeFile(
            join(reflectionsDir, `reflection-2024-01-0${i + 1}T00-00-00.000Z.json`),
            JSON.stringify(reflection),
          ),
        )
      }

      await Promise.all(writePromises)

      // Load with default count
      const reflections = await store.loadRecent(testDir)

      expect(reflections).to.have.lengthOf(3)
    })
  })
})
