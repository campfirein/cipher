/* eslint-disable camelcase */
import {expect} from 'chai'
import * as sinon from 'sinon'

import {ByteRoverLlmHttpService} from '../../../../../src/agent/infra/http/internal-llm-http-service.js'
import {ByteRoverContentGenerator} from '../../../../../src/agent/infra/llm/generators/byterover-content-generator.js'

function buildHttpService(): ByteRoverLlmHttpService {
  return new ByteRoverLlmHttpService({
    apiBaseUrl: 'http://localhost:3000',
    sessionKey: 'test-session-key',
    spaceId: 'test-space-id',
    teamId: 'test-team-id',
  })
}

function makeMockClaudeResponse() {
  return {
    content: [{text: 'ok', type: 'text'}],
    id: 'msg_test',
    model: 'claude-test',
    role: 'assistant',
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {input_tokens: 1, output_tokens: 1},
  }
}

describe('ByteRoverContentGenerator sampling-parameter gating', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('omits `temperature` from the Claude payload for claude-opus-4-7', async () => {
    const httpService = buildHttpService()
    const stub = sandbox
      .stub(httpService, 'generateContent')
      .resolves(makeMockClaudeResponse() as never)

    const generator = new ByteRoverContentGenerator(httpService, {
      model: 'claude-opus-4-7',
      temperature: 0.7,
    })

    await generator.generateContent({
      config: {maxTokens: 16},
      contents: [{content: 'hi', role: 'user'}],
      model: 'claude-opus-4-7',
      taskId: 'test-task',
    })

    expect(stub.calledOnce).to.equal(true)
    const payload = stub.firstCall.args[0] as unknown as Record<string, unknown>
    expect(payload).to.not.have.property('temperature')
    expect(payload.model).to.equal('claude-opus-4-7')
  })

  it('passes `temperature` through for claude-opus-4-6 (regression)', async () => {
    const httpService = buildHttpService()
    const stub = sandbox
      .stub(httpService, 'generateContent')
      .resolves(makeMockClaudeResponse() as never)

    const generator = new ByteRoverContentGenerator(httpService, {
      model: 'claude-opus-4-6',
      temperature: 0.7,
    })

    await generator.generateContent({
      config: {maxTokens: 16},
      contents: [{content: 'hi', role: 'user'}],
      model: 'claude-opus-4-6',
      taskId: 'test-task',
    })

    const payload = stub.firstCall.args[0] as unknown as Record<string, unknown>
    expect(payload.temperature).to.equal(0.7)
  })
})
