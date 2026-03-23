/* eslint-disable camelcase */
import {isAxiosError} from 'axios'
import {expect} from 'chai'
import nock from 'nock'
import {createSandbox, type SinonSandbox} from 'sinon'

import {
  ByteRoverHttpConfig,
  ByteRoverLlmHttpService,
} from '../../../../src/agent/infra/http/internal-llm-http-service.js'

// Helper functions to verify request body - extracted to reduce callback nesting
function verifyProjectId(expectedProjectId: string) {
  return (body: Record<string, unknown>) => {
    expect(body.project_id).to.equal(expectedProjectId)
    return true
  }
}

function verifyGeminiRequest() {
  return (body: Record<string, unknown>) => {
    expect(body.provider).to.equal('gemini')
    expect(body.region).to.equal('global')
    expect((body.params as Record<string, unknown>).model).to.equal('gemini-2.5-flash')
    return true
  }
}

function verifyContentsAndConfig(contents: unknown, config: unknown) {
  return (body: Record<string, unknown>) => {
    expect((body.params as Record<string, unknown>).contents).to.deep.equal(contents)
    expect((body.params as Record<string, unknown>).config).to.deep.equal(config)
    return true
  }
}

function verifyTeamAndSpace(teamId: string, spaceId: string) {
  return (body: Record<string, unknown>) => {
    expect(body.teamId).to.equal(teamId)
    expect(body.spaceId).to.equal(spaceId)
    return true
  }
}

function verifyClaudeRequest() {
  return (body: Record<string, unknown>) => {
    expect(body.provider).to.equal('claude')
    expect(body.region).to.equal('us-east5')
    expect((body.params as Record<string, unknown>).model).to.equal('claude-3-5-sonnet')
    return true
  }
}

function verifyProvider(expectedProvider: string) {
  return (body: Record<string, unknown>) => {
    expect(body.provider).to.equal(expectedProvider)
    return true
  }
}

function verifyExecutionMetadata(expectedMetadata: string) {
  return (body: Record<string, unknown>) => {
    expect(body.executionMetadata).to.equal(expectedMetadata)
    return true
  }
}

function verifyProviderOnly(expectedProvider: string) {
  return (body: Record<string, unknown>) => body.provider === expectedProvider
}

function verifyRegionOnly(expectedRegion: string) {
  return (body: Record<string, unknown>) => body.region === expectedRegion
}

// Helper to create mock response
function createMockResponse(data: unknown) {
  return {data}
}

describe('ByteRoverLlmHttpService', () => {
  let sandbox: SinonSandbox
  let service: ByteRoverLlmHttpService
  const baseUrl = 'http://localhost:3333'

  const defaultConfig: ByteRoverHttpConfig = {
    apiBaseUrl: baseUrl,
    sessionKey: 'test-session-key',
    spaceId: 'test-space-id',
    teamId: 'test-team-id',
  }

  beforeEach(() => {
    sandbox = createSandbox()
    nock.cleanAll()
  })

  afterEach(() => {
    sandbox.restore()
    nock.cleanAll()
  })

  describe('constructor', () => {
    it('should create instance with required config', () => {
      service = new ByteRoverLlmHttpService(defaultConfig)

      expect(service).to.be.instanceOf(ByteRoverLlmHttpService)
    })

    it('should use default projectId when not provided', () => {
      service = new ByteRoverLlmHttpService(defaultConfig)
      const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Hello'}]}}]})

      nock(baseUrl).post('/api/llm/generate', verifyProjectId('byterover')).reply(200, mockResponse)

      return service.generateContent([{parts: [{text: 'Hi'}], role: 'user'}], {}, 'gemini-2.5-flash').then(() => {
        expect(nock.isDone()).to.be.true
      })
    })

    it('should use custom projectId when provided', () => {
      const customConfig: ByteRoverHttpConfig = {
        ...defaultConfig,
        projectId: 'custom-project',
      }
      service = new ByteRoverLlmHttpService(customConfig)
      const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Hello'}]}}]})

      nock(baseUrl).post('/api/llm/generate', verifyProjectId('custom-project')).reply(200, mockResponse)

      return service.generateContent([{parts: [{text: 'Hi'}], role: 'user'}], {}, 'gemini-2.5-flash').then(() => {
        expect(nock.isDone()).to.be.true
      })
    })

    it('should use default timeout of 60 seconds when not provided', () => {
      service = new ByteRoverLlmHttpService(defaultConfig)
      expect(service).to.exist
    })

    it('should use custom timeout when provided', () => {
      const customConfig: ByteRoverHttpConfig = {
        ...defaultConfig,
        timeout: 120_000,
      }
      service = new ByteRoverLlmHttpService(customConfig)
      expect(service).to.exist
    })
  })

  describe('generateContent', () => {
    beforeEach(() => {
      service = new ByteRoverLlmHttpService(defaultConfig)
    })

    describe('with Gemini model', () => {
      it('should send request with correct provider and region for Gemini', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Hello from Gemini'}]}}]})

        nock(baseUrl).post('/api/llm/generate', verifyGeminiRequest()).reply(200, mockResponse)

        const result = await service.generateContent(
          [{parts: [{text: 'Hello'}], role: 'user'}],
          {maxOutputTokens: 1000},
          'gemini-2.5-flash',
        )

        expect(result).to.deep.equal({candidates: [{content: {parts: [{text: 'Hello from Gemini'}]}}]})
        expect(nock.isDone()).to.be.true
      })

      it('should send contents and config as JSON strings', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Response'}]}}]})
        const contents = [{parts: [{text: 'Test message'}], role: 'user'}]
        const config = {maxOutputTokens: 500, temperature: 0.7}

        nock(baseUrl).post('/api/llm/generate', verifyContentsAndConfig(contents, config)).reply(200, mockResponse)

        await service.generateContent(contents, config, 'gemini-2.5-flash')
        expect(nock.isDone()).to.be.true
      })

      it('should include teamId and spaceId in request', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Response'}]}}]})

        nock(baseUrl)
          .post('/api/llm/generate', verifyTeamAndSpace('test-team-id', 'test-space-id'))
          .reply(200, mockResponse)

        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect(nock.isDone()).to.be.true
      })
    })

    describe('with Claude model', () => {
      it('should send request with correct provider and region for Claude', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Hello from Claude'}]}}]})

        nock(baseUrl).post('/api/llm/generate', verifyClaudeRequest()).reply(200, mockResponse)

        const result = await service.generateContent(
          {max_tokens: 1000, messages: [{content: 'Hello', role: 'user'}], model: 'claude-3-5-sonnet'},
          {},
          'claude-3-5-sonnet',
        )

        expect(result).to.deep.equal({candidates: [{content: {parts: [{text: 'Hello from Claude'}]}}]})
        expect(nock.isDone()).to.be.true
      })

      it('should detect Claude from model name variations', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Response'}]}}]})

        nock(baseUrl).post('/api/llm/generate', verifyProvider('claude')).reply(200, mockResponse)

        await service.generateContent({max_tokens: 100, messages: [], model: 'Claude-3-opus'}, {}, 'Claude-3-opus')
        expect(nock.isDone()).to.be.true
      })
    })

    describe('with execution metadata', () => {
      it('should include execution metadata when provided', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Response'}]}}]})
        const metadata = {executionContext: 'cipher-agent', mode: 'agent'}

        nock(baseUrl)
          .post('/api/llm/generate', verifyExecutionMetadata(JSON.stringify(metadata)))
          .reply(200, mockResponse)

        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash', metadata)
        expect(nock.isDone()).to.be.true
      })

      it('should send empty object when execution metadata not provided', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Response'}]}}]})

        nock(baseUrl).post('/api/llm/generate', verifyExecutionMetadata('{}')).reply(200, mockResponse)

        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect(nock.isDone()).to.be.true
      })
    })

    describe('authentication headers', () => {
      it('should send x-byterover-session-id header', async () => {
        const mockResponse = createMockResponse({candidates: [{content: {parts: [{text: 'Response'}]}}]})

        nock(baseUrl)
          .post('/api/llm/generate')
          .matchHeader('x-byterover-session-id', 'test-session-key')
          .reply(200, mockResponse)

        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect(nock.isDone()).to.be.true
      })
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      service = new ByteRoverLlmHttpService(defaultConfig)
    })

    it('should throw error with standardized message on API error', async () => {
      const errorResponse = {
        code: 'BILLING_TEAM_ID_REQUIRED',
        message: 'Team ID is required. Please select a team using "brv init" or "brv space switch".',
        statusCode: 400,
        timestamp: new Date().toISOString(),
      }

      nock(baseUrl).post('/api/llm/generate').reply(400, errorResponse)

      try {
        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal(errorResponse.message)
      }
    })

    it('should throw error with message from response body on non-standardized error', async () => {
      nock(baseUrl).post('/api/llm/generate').reply(500, {error: 'Internal Server Error'})

      try {
        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Internal Server Error')
      }
    })

    it('should throw error on 401 Unauthorized', async () => {
      const errorResponse = {
        code: 'AUTH_INVALID_TOKEN',
        message: 'Your authentication token is invalid. Please login again.',
        statusCode: 401,
        timestamp: new Date().toISOString(),
      }

      nock(baseUrl).post('/api/llm/generate').reply(401, errorResponse)

      try {
        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        // 401 errors are returned as raw AxiosError to allow callers to distinguish from network errors
        expect(isAxiosError(error)).to.be.true
        if (isAxiosError(error)) {
          expect(error.response?.status).to.equal(401)
        }
      }
    })

    it('should throw error on 403 Forbidden (billing error)', async () => {
      const errorResponse = {
        code: 'BILLING_INSUFFICIENT_CREDITS',
        message: 'Insufficient credits. Please add credits to continue using the service.',
        statusCode: 403,
        timestamp: new Date().toISOString(),
      }

      nock(baseUrl).post('/api/llm/generate').reply(403, errorResponse)

      try {
        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal(errorResponse.message)
      }
    })

    it('should handle network errors', async () => {
      nock(baseUrl).post('/api/llm/generate').replyWithError('Network connection failed')

      try {
        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
      }
    })

    it('should handle timeout errors', async () => {
      const shortTimeoutConfig: ByteRoverHttpConfig = {
        ...defaultConfig,
        timeout: 50,
      }
      service = new ByteRoverLlmHttpService(shortTimeoutConfig)

      nock(baseUrl).post('/api/llm/generate').delay(200).reply(200, {data: '{}'})

      try {
        await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message.toLowerCase()).to.include('connection failed')
      }
    })
  })

  describe('detectProviderFromModel (tested indirectly)', () => {
    beforeEach(() => {
      service = new ByteRoverLlmHttpService(defaultConfig)
    })

    it('should detect gemini provider for gemini-2.5-flash', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyProviderOnly('gemini')).reply(200, mockResponse)

      await service.generateContent([], {}, 'gemini-2.5-flash')
      expect(nock.isDone()).to.be.true
    })

    it('should detect gemini provider for gemini-2.5-pro', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyProviderOnly('gemini')).reply(200, mockResponse)

      await service.generateContent([], {}, 'gemini-2.5-pro')
      expect(nock.isDone()).to.be.true
    })

    it('should detect claude provider for claude-3-5-sonnet', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyProviderOnly('claude')).reply(200, mockResponse)

      await service.generateContent({max_tokens: 100, messages: [], model: ''}, {}, 'claude-3-5-sonnet')
      expect(nock.isDone()).to.be.true
    })

    it('should detect claude provider for claude-3-opus (case insensitive)', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyProviderOnly('claude')).reply(200, mockResponse)

      await service.generateContent({max_tokens: 100, messages: [], model: ''}, {}, 'CLAUDE-3-opus')
      expect(nock.isDone()).to.be.true
    })

    it('should default to gemini for unknown model names', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyProviderOnly('gemini')).reply(200, mockResponse)

      await service.generateContent([], {}, 'unknown-model')
      expect(nock.isDone()).to.be.true
    })
  })

  describe('detectRegionFromModel (tested indirectly)', () => {
    beforeEach(() => {
      service = new ByteRoverLlmHttpService(defaultConfig)
    })

    it('should use global region for Gemini models', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyRegionOnly('global')).reply(200, mockResponse)

      await service.generateContent([], {}, 'gemini-2.5-flash')
      expect(nock.isDone()).to.be.true
    })

    it('should use us-east5 region for Claude models', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyRegionOnly('us-east5')).reply(200, mockResponse)

      await service.generateContent({max_tokens: 100, messages: [], model: ''}, {}, 'claude-3-5-sonnet')
      expect(nock.isDone()).to.be.true
    })

    it('should use global region for unknown models (defaults to gemini)', async () => {
      const mockResponse = createMockResponse({candidates: []})

      nock(baseUrl).post('/api/llm/generate', verifyRegionOnly('global')).reply(200, mockResponse)

      await service.generateContent([], {}, 'some-other-model')
      expect(nock.isDone()).to.be.true
    })
  })

  describe('response parsing', () => {
    beforeEach(() => {
      service = new ByteRoverLlmHttpService(defaultConfig)
    })

    it('should parse JSON response from data field', async () => {
      const expectedResponse = {
        candidates: [
          {
            content: {
              parts: [{text: 'This is the response'}],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          candidatesTokenCount: 10,
          promptTokenCount: 5,
          totalTokenCount: 15,
        },
      }

      nock(baseUrl).post('/api/llm/generate').reply(200, createMockResponse(expectedResponse))

      const result = await service.generateContent([{parts: [{text: 'Hello'}], role: 'user'}], {}, 'gemini-2.5-flash')

      expect(result).to.deep.equal(expectedResponse)
    })

    it('should handle complex nested response structures', async () => {
      const expectedResponse = {
        candidates: [
          {
            content: {
              parts: [
                {text: 'First part'},
                {
                  functionCall: {
                    args: {path: '/test'},
                    name: 'view_file',
                  },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
      }

      nock(baseUrl).post('/api/llm/generate').reply(200, createMockResponse(expectedResponse))

      const result = await service.generateContent(
        [{parts: [{text: 'View file'}], role: 'user'}],
        {},
        'gemini-2.5-flash',
      )

      expect(result).to.deep.equal(expectedResponse)
    })
  })
})
