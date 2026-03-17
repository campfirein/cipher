import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {ProgressSnapshot} from '../../../../../src/agent/infra/llm/context/session-progress-tracker.js'

import {ProgressTrajectoryContributor} from '../../../../../src/agent/infra/system-prompt/contributors/progress-trajectory-contributor.js'

function makeTracker(snapshot: Partial<ProgressSnapshot>) {
  const full: ProgressSnapshot = {
    compressionCount: 0,
    doomLoopCount: 0,
    errorCount: 0,
    iterationCount: 0,
    tokenUtilizationHistory: [],
    toolCallCount: 0,
    toolFailureCount: 0,
    toolSuccessCount: 0,
    topTools: [],
    ...snapshot,
  }

  return {
    attach() {},
    detach() {},
    getSnapshot: () => full,
    recordIteration() {},
  }
}

describe('ProgressTrajectoryContributor', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should return empty string when iterationCount is 0', async () => {
    const tracker = makeTracker({iterationCount: 0})
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content).to.equal('')
  })

  it('should return formatted progress table when iterations > 0', async () => {
    const tracker = makeTracker({
      iterationCount: 5,
      toolCallCount: 10,
      toolFailureCount: 2,
      toolSuccessCount: 8,
    })
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content).to.include('<sessionProgress>')
    expect(content).to.include('</sessionProgress>')
    expect(content).to.include('Iterations')
    expect(content).to.include('5')
    expect(content).to.include('Tool calls')
    expect(content).to.include('10 (8 ok, 2 err)')
  })

  it('should include compression count when > 0', async () => {
    const tracker = makeTracker({compressionCount: 3, iterationCount: 5, toolCallCount: 0, toolSuccessCount: 0})
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content).to.include('Compressions')
    expect(content).to.include('3')
  })

  it('should include token utilization trend', async () => {
    const tracker = makeTracker({
      iterationCount: 3,
      tokenUtilizationHistory: [45, 62, 78],
      toolCallCount: 0,
      toolSuccessCount: 0,
    })
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content).to.include('Token trend')
    expect(content).to.include('45%')
    expect(content).to.include('78%')
  })

  it('should include top tools', async () => {
    const tracker = makeTracker({
      iterationCount: 3,
      toolCallCount: 5,
      toolSuccessCount: 5,
      topTools: [
        {count: 3, name: 'read_file'},
        {count: 2, name: 'grep_content'},
      ],
    })
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content).to.include('Top tools')
    expect(content).to.include('read_file(3)')
    expect(content).to.include('grep_content(2)')
  })

  it('should include doom loop count when > 0', async () => {
    const tracker = makeTracker({doomLoopCount: 1, iterationCount: 5, toolCallCount: 0, toolSuccessCount: 0})
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content).to.include('Doom loops')
  })

  it('should cap output at 800 characters', async () => {
    const tracker = makeTracker({
      compressionCount: 5,
      doomLoopCount: 2,
      errorCount: 3,
      iterationCount: 100,
      tokenUtilizationHistory: [10, 20, 30, 40, 50, 60, 70, 80, 90, 95],
      toolCallCount: 500,
      toolFailureCount: 50,
      toolSuccessCount: 450,
      topTools: [
        {count: 100, name: 'read_file'},
        {count: 80, name: 'grep_content'},
        {count: 60, name: 'write_file'},
        {count: 40, name: 'code_exec'},
        {count: 20, name: 'agentic_map'},
      ],
    })
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    const content = await contributor.getContent({})

    expect(content.length).to.be.at.most(800)
    expect(content).to.include('</sessionProgress>')
  })

  it('should have correct id and priority', () => {
    const tracker = makeTracker({})
    const contributor = new ProgressTrajectoryContributor('progress', 25, tracker as never)

    expect(contributor.id).to.equal('progress')
    expect(contributor.priority).to.equal(25)
  })
})
