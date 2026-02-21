/**
 * FolderPackExecutor variable naming regression test
 *
 * Reproduces and verifies the fix for: UUID hyphens in instructionsVar cause
 * ReferenceError when the LLM calls instructionsVar.slice(...) in code-exec.
 *
 * Root cause: folder-pack-executor used raw taskId to name the instructionsVar
 * sandbox variable (e.g. "__curate_instructions_8cd8e2d8-a7fc-..."). The LLM
 * writes underscores when generating code-exec calls, causing a variable name
 * mismatch → ReferenceError.
 *
 * Fix: taskIdSafe = taskId.replaceAll('-', '_') before constructing instructionsVar.
 */

import {expect} from 'chai'

import {LocalSandbox} from '../../../../src/agent/infra/sandbox/local-sandbox.js'

describe('FolderPackExecutor - instructionsVar naming (regression)', () => {
  const taskId = '8cd8e2d8-a7fc-4371-89ca-59460687c12d'
  const llmGeneratedVarName = '__curate_instructions_8cd8e2d8_a7fc_4371_89ca_59460687c12d'
  const instructions = 'Step 1: read files. Step 2: curate topics.'

  describe('bug: hyphenated taskId causes ReferenceError on .slice()', () => {
    it('should fail when instructionsVar stored with hyphens and LLM calls .slice()', async () => {
      const sandbox = new LocalSandbox()

      // Old (buggy) behavior: variable name contains hyphens
      const buggyVar = `__curate_instructions_${taskId}`
      sandbox.updateContext({[buggyVar]: instructions})

      // LLM writes: __curate_instructions_8cd8e2d8_a7fc_....slice(0, 5000)
      // JS parses hyphens as subtraction → ReferenceError on the identifier
      const result = await sandbox.execute(`${llmGeneratedVarName}.slice(0, 5)`)

      expect(result.stderr).to.include('ReferenceError')
    })
  })

  describe('fix: taskIdSafe with underscores matches LLM output', () => {
    it('should succeed when instructionsVar stored with underscores', async () => {
      const sandbox = new LocalSandbox()

      const taskIdSafe = taskId.replaceAll('-', '_')
      const fixedVar = `__curate_instructions_${taskIdSafe}`
      sandbox.updateContext({[fixedVar]: instructions})

      const result = await sandbox.execute(`${llmGeneratedVarName}.slice(0, 4)`)

      expect(result.stderr).to.equal('')
      expect(result.returnValue).to.equal('Step')
    })

    it('should correctly transform all UUID segments', () => {
      const taskIdSafe = taskId.replaceAll('-', '_')

      expect(taskIdSafe).to.not.include('-')
      expect(taskIdSafe).to.equal('8cd8e2d8_a7fc_4371_89ca_59460687c12d')

      const instructionsVar = `__curate_instructions_${taskIdSafe}`
      expect(instructionsVar).to.equal(llmGeneratedVarName)
    })
  })
})
