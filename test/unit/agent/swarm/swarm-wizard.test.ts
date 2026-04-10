/// <reference types="mocha" />

import {expect} from 'chai'

import type {WizardPrompts} from '../../../../src/agent/infra/swarm/swarm-wizard.js'

import {runWizard} from '../../../../src/agent/infra/swarm/swarm-wizard.js'

// ─── Mock prompt helpers ───

function makeAbortError(): Error {
  const err = new Error('AbortPromptError')
  err.name = 'AbortPromptError'
  return err
}

function makeCancelError(): Error {
  const err = new Error('CancelPromptError')
  err.name = 'CancelPromptError'
  return err
}

type AnswerQueue = Array<boolean | string | string[]>

function createMockPrompts(answers: AnswerQueue): WizardPrompts {
  let idx = 0
  const next = () => {
    if (idx >= answers.length) throw new Error(`Mock prompt exhausted at index ${idx}`)
    return answers[idx++]
  }

  return {
    async checkbox() {
      return next() as string[]
    },
    async confirm() {
      return next() as boolean
    },
    async input(_msg: string, opts?: {default?: string}) {
      const val = next() as string
      return val === '' && opts?.default ? opts.default : val
    },
    async select() {
      return next() as string
    },
  }
}

describe('runWizard', () => {
  it('should return complete ScaffoldInput on happy path', async () => {
    const prompts = createMockPrompts([
      // Step 1: Identity
      'Code Review',      // name
      'code-review',      // slug
      'A review pipeline', // description
      'Find bugs, Ship safe', // goals
      // Step 2: Agents
      'Analyzer',         // agent 1 name
      'analyzer',         // agent 1 slug
      'Code analysis',    // agent 1 description
      'claude_code',      // agent 1 adapter
      true,               // add another?
      'Synthesizer',      // agent 2 name
      'synthesizer',      // agent 2 slug
      'Merge findings',   // agent 2 description
      'process',          // agent 2 adapter
      false,              // add another?
      // Step 3: Edges
      ['synthesizer'],    // analyzer outputs to synthesizer
      [],                 // synthesizer outputs to nobody
      // Step 4: Output
      'synthesizer',      // output node
    ])

    const result = await runWizard(prompts)

    expect(result).to.not.be.null
    expect(result!.name).to.equal('Code Review')
    expect(result!.slug).to.equal('code-review')
    expect(result!.goals).to.deep.equal(['Find bugs', 'Ship safe'])
    expect(result!.agents).to.have.lengthOf(2)
    expect(result!.agents[0].slug).to.equal('analyzer')
    expect(result!.agents[1].adapterType).to.equal('process')
    expect(result!.edges).to.deep.equal([{from: 'analyzer', to: 'synthesizer'}])
    expect(result!.outputNodeSlug).to.equal('synthesizer')
  })

  it('should return null when user cancels (CancelPromptError)', async () => {
    let callCount = 0
    const prompts: WizardPrompts = {
      async checkbox() { throw makeCancelError() },
      async confirm() { throw makeCancelError() },
      async input() {
        callCount++
        if (callCount === 1) return 'Test'
        throw makeCancelError()
      },
      async select() { throw makeCancelError() },
    }

    const result = await runWizard(prompts)
    expect(result).to.be.null
  })

  it('should return null when ESC on first step', async () => {
    const prompts: WizardPrompts = {
      async checkbox() { throw makeAbortError() },
      async confirm() { throw makeAbortError() },
      async input() { throw makeAbortError() },
      async select() { throw makeAbortError() },
    }

    const result = await runWizard(prompts)
    expect(result).to.be.null
  })

  it('should go back to previous step on ESC (AbortPromptError)', async () => {
    const stepsCalled: number[] = []
    let step2CallCount = 0

    const prompts = createMockPrompts([
      // Step 1: Identity (first pass)
      'Test Swarm',
      'test-swarm',
      'Description',
      'Goal one',
    ])

    // Override to track step transitions and simulate ESC on step 2 first time
    const originalInput = prompts.input.bind(prompts)
    let inputCallCount = 0
    prompts.input = async (msg, opts) => {
      inputCallCount++
      // Step 1 calls input 4 times (name, slug, desc, goals)
      // After step 1 completes, step 2 starts and calls input for agent name
      if (inputCallCount === 5) {
        // First time entering step 2 — throw ESC to go back
        step2CallCount++
        stepsCalled.push(2)
        throw makeAbortError()
      }

      if (inputCallCount >= 6 && inputCallCount <= 9) {
        // Step 1 again (re-prompted after back)
        stepsCalled.push(1)
        // Return same identity values
        const defaults = ['Test Swarm', 'test-swarm', 'Description', 'Goal one']
        return defaults[inputCallCount - 6]
      }

      if (inputCallCount >= 10) {
        // Step 2 second attempt — provide agent answers
        const agentAnswers = ['Solo', 'solo', 'Solo agent']
        const agentIdx = inputCallCount - 10
        if (agentIdx < agentAnswers.length) return agentAnswers[agentIdx]
      }

      return originalInput(msg, opts)
    }

    let selectCount = 0
    prompts.select = async () => {
      selectCount++
      if (selectCount === 1) return 'process' // agent adapter
      return 'solo' // output node
    }

    prompts.confirm = async () => false // don't add more agents

    prompts.checkbox = async () => [] // no edges

    const result = await runWizard(prompts)

    expect(result).to.not.be.null
    expect(step2CallCount).to.equal(1) // ESC was hit once on step 2
    expect(result!.name).to.equal('Test Swarm') // identity preserved from first pass
  })

  it('should produce 1 agent when user says no to add another', async () => {
    const prompts = createMockPrompts([
      // Step 1
      'Solo', 'solo', 'One agent', 'Test',
      // Step 2
      'Agent', 'agent', 'The agent', 'process',
      false,              // don't add another
      // Step 3 — no edges for single agent (checkbox not called since no targets)
      // Step 4
      'agent',            // output
    ])

    const result = await runWizard(prompts)

    expect(result).to.not.be.null
    expect(result!.agents).to.have.lengthOf(1)
  })

  it('should produce correct edges from checkbox selections', async () => {
    const prompts = createMockPrompts([
      // Step 1
      'Test', 'test', 'Desc', 'Goal',
      // Step 2: 3 agents
      'A', 'a', 'Agent A', 'process', true,
      'B', 'b', 'Agent B', 'process', true,
      'C', 'c', 'Agent C', 'process', false,
      // Step 3: edges
      ['b', 'c'],    // A → B, A → C
      ['c'],          // B → C
      [],             // C → nobody
      // Step 4
      'c',
    ])

    const result = await runWizard(prompts)

    expect(result).to.not.be.null
    expect(result!.edges).to.deep.equal([
      {from: 'a', to: 'b'},
      {from: 'a', to: 'c'},
      {from: 'b', to: 'c'},
    ])
  })
})
