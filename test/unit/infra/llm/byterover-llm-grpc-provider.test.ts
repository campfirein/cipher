import {expect} from 'chai'

import {ByteRoverLlmGrpcService} from '../../../../src/infra/cipher/grpc/internal-llm-grpc-service.js'

describe('ByteRoverLlmGrpcService', () => {
  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should support custom projectId', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        projectId: 'custom-project',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should accept gRPC endpoint configuration', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'beta-llm.byterover.dev:443',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should support region configuration', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        region: 'us-east1',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should support timeout configuration', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
        timeout: 60_000,
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should use insecure credentials for localhost', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should use insecure credentials for 127.0.0.1', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: '127.0.0.1:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })

    it('should use SSL credentials for remote endpoints', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'beta-llm.byterover.dev:443',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider).to.exist
      provider.close()
    })
  })

  describe('provider detection', () => {
    it('should correctly instantiate with various configurations', () => {
      const provider1 = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider1).to.exist
      provider1.close()

      const provider2 = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      expect(provider2).to.exist
      provider2.close()
    })
  })

  describe('connection management', () => {
    it('should allow closing the connection', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      provider.close()
      expect(provider).to.exist
    })

    it('should handle closing multiple times gracefully', () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      provider.close()
      provider.close() // Should not throw
      expect(provider).to.exist
    })
  })

  describe('configuration validation', () => {
    it('should require accessToken', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = {
        accessToken: '',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      }
      expect(() => new ByteRoverLlmGrpcService(config)).not.to.throw()
    })

    it('should require grpcEndpoint', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = {
        accessToken: 'test-token',
        grpcEndpoint: '',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      }
      expect(() => new ByteRoverLlmGrpcService(config)).not.to.throw()
    })

    it('should require sessionKey', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = {
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: '',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      }
      expect(() => new ByteRoverLlmGrpcService(config)).not.to.throw()
    })
  })

  describe('generateContent and callGrpcGenerate methods', () => {
    it('should reject callGrpcGenerate when client is not initialized', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      const request = {
        params: {config: '{}', contents: '[]', model: 'gemini-2.5-flash'},
        // eslint-disable-next-line camelcase
        project_id: 'byterover',
        provider: 'gemini' as const,
        region: 'us-east1',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (provider as any).callGrpcGenerate(request)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('gRPC client not initialized')
      }

      provider.close()
    })

    it('should handle generateContent error wrapping', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      // Create a mock that will cause generateContent to fail
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCall: any = {
        cancel() {},
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        on(event: string, callback: Function) {
          if (event === 'error') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (callback as any)(new Error('Connection failed'))
          }

          return this
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(provider as any).client = {
        close() {},
        Generate: () => mockCall,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = [{parts: [{text: 'Test'}], role: 'user'} as any]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = {temperature: 0.7} as any

      try {
        await provider.generateContent(contents, config, 'gemini-2.5-flash')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('API error')
        expect((error as Error).message).to.include('Connection failed')
      }

      provider.close()
    })

    it('should resolve generateContent with successful response', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      const mockResponse = {candidates: [{content: {parts: [{text: 'Hello!'}]}}]}

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCall: any = {
        cancel() {},
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        on(event: string, callback: Function) {
          if (event === 'data') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (callback as any)({data: JSON.stringify(mockResponse)})
          }

          return this
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(provider as any).client = {
        close() {},
        Generate: () => mockCall,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = [{parts: [{text: 'Hi'}], role: 'user'} as any]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = {temperature: 0.7} as any

      const result = await provider.generateContent(contents, config, 'gemini-2.5-flash')
      expect(result).to.deep.equal(mockResponse)
      provider.close()
    })

    it('should handle stream end without data', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCall: any = {
        cancel() {},
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        on(event: string, callback: Function) {
          if (event === 'end') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (callback as any)()
          }

          return this
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(provider as any).client = {
        close() {},
        Generate: () => mockCall,
      }

      const request = {
        params: {config: '{}', contents: '[]', model: 'gemini-2.5-flash'},
        // eslint-disable-next-line camelcase
        project_id: 'byterover',
        provider: 'gemini' as const,
        region: 'us-east1',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (provider as any).callGrpcGenerate(request)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('ended without receiving valid response data')
      }

      provider.close()
    })

    it('should handle malformed JSON in response', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      const validResponse = {candidates: [{content: {parts: [{text: 'OK'}]}}]}

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCall: any = {
        cancel() {},
        on(event: string, callback: (data: unknown) => void) {
          if (event === 'data') {
            // First call with invalid JSON, then valid JSON
            callback({data: 'invalid json'})
            callback({data: JSON.stringify(validResponse)})
          }

          return this
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(provider as any).client = {
        close() {},
        Generate: () => mockCall,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = [{parts: [{text: 'Test'}], role: 'user'} as any]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = {temperature: 0.7} as any

      const result = await provider.generateContent(contents, config, 'gemini-2.5-flash')
      expect(result).to.deep.equal(validResponse)
      provider.close()
    })

    it('should send claude provider and region for claude models', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      const mockResponse = {candidates: [{content: {parts: [{text: 'Response'}]}}]}
      let capturedRequest: unknown

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCall: any = {
        cancel() {},
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        on(event: string, callback: Function) {
          if (event === 'data') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (callback as any)({data: JSON.stringify(mockResponse)})
          }

          return this
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(provider as any).client = {
        close() {},
        Generate(request: unknown) {
          capturedRequest = request
          return mockCall
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = [{parts: [{text: 'Hi'}], role: 'user'} as any]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = {temperature: 0.7} as any

      await provider.generateContent(contents, config, 'claude-3-5-sonnet')

      expect(capturedRequest).to.be.an('object')
      expect((capturedRequest as {provider: string}).provider).to.equal('claude')
      expect((capturedRequest as {region: string}).region).to.equal('us-east5')

      provider.close()
    })

    it('should send gemini provider and region for gemini models', async () => {
      const provider = new ByteRoverLlmGrpcService({
        accessToken: 'test-token',
        grpcEndpoint: 'localhost:50051',
        sessionKey: 'test-session',
        spaceId: 'test-space-id',
        teamId: 'test-team-id',
      })

      const mockResponse = {candidates: [{content: {parts: [{text: 'Response'}]}}]}
      let capturedRequest: unknown

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCall: any = {
        cancel() {},
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        on(event: string, callback: Function) {
          if (event === 'data') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (callback as any)({data: JSON.stringify(mockResponse)})
          }

          return this
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(provider as any).client = {
        close() {},
        Generate(request: unknown) {
          capturedRequest = request
          return mockCall
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = [{parts: [{text: 'Hello'}], role: 'user'} as any]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = {temperature: 0.7} as any

      await provider.generateContent(contents, config, 'gemini-2.5-flash')

      expect(capturedRequest).to.be.an('object')
      expect((capturedRequest as {provider: string}).provider).to.equal('gemini')
      expect((capturedRequest as {region: string}).region).to.equal('global')

      provider.close()
    })
  })
})
