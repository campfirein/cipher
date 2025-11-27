// @ts-expect-error - Internal SDK path not exported in package.json, but exists and works at runtime
import type {RequestOptions} from '@anthropic-ai/sdk/internal/request-options'
import type {MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages.js'
import type {Content, GenerateContentConfig, GenerateContentResponse} from '@google/genai'

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/* eslint-disable camelcase */

/**
 * gRPC call stream for receiving messages.
 */
interface ClientDuplexStream {
  cancel(): void
  on(event: 'data', listener: (message: unknown) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this
  on(event: 'status', listener: (status: grpc.StatusObject) => void): this
}

/**
 * ByteRover gRPC LLM service client interface.
 */
interface LLMServiceClient {
  close(): void
  Generate(request: GenerateRequest, metadata: grpc.Metadata): ClientDuplexStream
}

/**
 * Generation parameters sent to gRPC backend.
 * Note: contents and config are sent as JSON strings for proper gRPC serialization.
 */
type GenerateParams = {
  config: string
  contents: string
  model: string
}

/**
 * Generate request sent to ByteRover gRPC service.
 */
type GenerateRequest = {
  params: GenerateParams
  project_id: string
  provider: 'claude' | 'gemini'
  region: string
  spaceId: string
  teamId: string
}

/**
 * ByteRover gRPC LLM provider configuration.
 */
export interface ByteRoverGrpcConfig {
  accessToken: string
  grpcEndpoint: string,
  projectId?: string
  region?: string
  sessionKey: string
  spaceId: string
  teamId: string
  timeout?: number
}

/**
 * ByteRover gRPC LLM API client.
 *
 * Simple wrapper around ByteRover gRPC LLM service.
 * Delegates prompt building and formatting to service layer.
 *
 * Responsibilities:
 * - Call the remote gRPC service
 * - Stream and collect responses
 * - Convert to GenerateContentResponse format
 *
 * Does NOT:
 * - Build prompts or format inputs
 * - Parse or manipulate response content
 * - Handle tool call parsing from text
 */
export class ByteRoverLlmGrpcService {
  private client: LLMServiceClient | null = null
  private readonly config: Required<Omit<ByteRoverGrpcConfig, 'projectId'>> & {
    projectId: string
  }
  private credentials: grpc.ChannelCredentials

  /**
   * Initialize a new ByteRover gRPC LLM service client.
   *
   * Sets up configuration with sensible defaults:
   * - projectId defaults to 'byterover'
   * - region defaults to 'us-east1' (can be overridden per request)
   * - timeout defaults to 30 seconds
   *
   * Determines whether to use secure (TLS) or insecure connections based on
   * the endpoint hostname. The actual gRPC client is lazily initialized on first use.
   *
   * @param config - gRPC client configuration (accessToken, grpcEndpoint, sessionKey, optional: projectId, region, timeout)
   */
  public constructor(config: ByteRoverGrpcConfig) {
    this.config = {
      accessToken: config.accessToken,
      grpcEndpoint: config.grpcEndpoint,
      projectId: config.projectId ?? 'byterover',
      region: config.region ?? 'us-east1',
      sessionKey: config.sessionKey,
      spaceId: config.spaceId,
      teamId: config.teamId,
      timeout: config.timeout ?? 60_000,
    }

    // Determine if using secure (TLS) or insecure connection based on endpoint
    const isLocalhost = config.grpcEndpoint.includes('localhost') || config.grpcEndpoint.includes('127.0.0.1')
    this.credentials = isLocalhost ? grpc.credentials.createInsecure() : grpc.credentials.createSsl()
  }

  /**
   * Close the gRPC connection and cleanup resources.
   *
   * Safely closes the underlying gRPC client connection if it exists.
   * Can be called multiple times without error.
   */
  public close(): void {
    if (this.client) {
      this.client.close()
      this.client = null
    }
  }

  /**
   * Call ByteRover gRPC LLM service to generate content.
   *
   * Simple forward to remote gRPC service - delegates all formatting to backend.
   * Supports both Gemini and Claude formats - the correct format is determined
   * automatically based on the model name.
   *
   * Parameter structure differs by provider:
   * - Gemini: contents = Content[], config = GenerateContentConfig
   * - Claude: contents = MessageCreateParamsNonStreaming (complete body), config = RequestOptions (HTTP options)
   *
   * @param contents - For Gemini: Content[]. For Claude: MessageCreateParamsNonStreaming (complete body)
   * @param config - For Gemini: GenerateContentConfig. For Claude: RequestOptions (optional HTTP options)
   * @param model - Model to use (detects provider from model name)
   * @returns Response in GenerateContentResponse format
   */
  public async generateContent(
    contents: Content[] | MessageCreateParamsNonStreaming,
    config: GenerateContentConfig | RequestOptions,
    model: string,
  ): Promise<GenerateContentResponse> {
    await this.initializeClient()

    const request: GenerateRequest = {
      params: {
        config: JSON.stringify(config),
        contents: JSON.stringify(contents),
        model,
      },
      project_id: this.config.projectId,
      provider: this.detectProviderFromModel(model),
      region: this.detectRegionFromModel(model),
      spaceId: this.config.spaceId,
      teamId: this.config.teamId,
    }

    try {
      return await this.callGrpcGenerate(request)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`ByteRover gRPC LLM error: ${errorMessage}`)
    }
  }

  /**
   * Call the ByteRover gRPC Generate endpoint and collect streaming response.
   *
   * Handles authentication headers, streaming response collection, timeouts,
   * and error handling. Uses a timeout mechanism to prevent hanging when the
   * server closes the connection without proper cleanup.
   *
   * @param request - The gRPC generate request with model, provider, region, and params
   * @returns Promise resolving to the complete LLM response
   * @throws Error if client is not initialized, timeout occurs, or stream error happens
   */
  private callGrpcGenerate(request: GenerateRequest): Promise<GenerateContentResponse> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('gRPC client not initialized'))
        return
      }

      // Create metadata with authentication headers
      const metadata = new grpc.Metadata()
      metadata.add('authorization', `Bearer ${this.config.accessToken}`)
      metadata.add('x-byterover-session-id', this.config.sessionKey)

      // Call the gRPC Generate method
      // eslint-disable-next-line new-cap
      const call = this.client.Generate(request, metadata)

      let content: GenerateContentResponse | null = null
      let settled = false

      // Timeout to prevent hanging when server destroys stream without proper cleanup
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true
          call.cancel()
          reject(new Error('gRPC call timeout: server did not respond within 30 seconds'))
        }
      }, this.config.timeout)

      // Cleanup function
      const cleanup = () => {
        clearTimeout(timeoutHandle)
      }

      // Collect streaming responses
      call.on('data', (data: unknown) => {
        const response = data as GenerateContentResponse

        if (response.data) {
          try {
            content = JSON.parse(response.data) as GenerateContentResponse
            if (!settled) {
              settled = true
              cleanup()
              resolve(content)
            }
          } catch (error) {
            console.error(`[gRPC Provider] Failed to parse response chunk:`, error)
          }
        } else {
          console.warn(`[gRPC Provider] Response data is empty or undefined:`, response)
        }
      })

      call.on('end', () => {
        if (settled) {
          return
        }

        settled = true
        cleanup()

        if (content === null) {
          reject(new Error('gRPC call ended without receiving valid response data'))
        } else {
          resolve(content)
        }
      })

      call.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        console.error(`[gRPC Provider] Stream error:`, error)
        reject(new Error(`gRPC call error: ${error.message}`))
      })

      // Handle gRPC status codes (server-sent errors)
      call.on('status', (status: grpc.StatusObject) => {
        if (status.code !== grpc.status.OK && !settled) {
          settled = true
          cleanup()
          const errorMsg = `gRPC error [${grpc.status[status.code]}]: ${status.details}`
          console.error(`[gRPC Provider] Status error:`, errorMsg)
          reject(new Error(errorMsg))
        }
      })
    })
  }

  /**
   * Detect LLM provider from model identifier.
   *
   * Determines which provider (Claude or Gemini) to use based on the model name.
   * Defaults to Gemini if the model doesn't match Claude patterns.
   *
   * @param model - Model identifier (e.g., 'claude-3-5-sonnet', 'gemini-2.5-flash')
   * @returns Provider name: 'claude' or 'gemini'
   */
  private detectProviderFromModel(model: string): 'claude' | 'gemini' {
    return model.toLowerCase().startsWith('claude') ? 'claude' : 'gemini'
  }

  /**
   * Detect appropriate GCP region from model identifier.
   *
   * Routes Claude models to us-east5 and Gemini models to us-east1.
   * This ensures compatibility with the provider's available regions on Vertex AI.
   *
   * @param model - Model identifier (e.g., 'claude-3-5-sonnet', 'gemini-2.5-flash')
   * @returns GCP region identifier ('us-east5' or 'us-east1')
   */
  private detectRegionFromModel(model: string): string {
    // return model.toLowerCase().startsWith('claude') ? 'us-east5' : 'us-central1'
    return model.toLowerCase().startsWith('claude') ? 'us-east5' : 'global'
  }

  /**
   * Initialize the gRPC client on first use (lazy loading).
   *
   * Loads the protobuf definition, constructs the gRPC service client,
   * and caches it for reuse. Only called once - subsequent calls return immediately.
   *
   * Uses the proto file at runtime to support dynamic loading and avoid bundling
   * proto files into the compiled JavaScript.
   *
   * @throws Error if proto file cannot be found or parsed
   */
  private async initializeClient(): Promise<void> {
    if (this.client) {
      return
    }

    const filename = fileURLToPath(import.meta.url)
    const dirname = path.dirname(filename)
    const protoPath = path.resolve(dirname, '../grpc/internal-llm-grpc.proto')

    const packageDefinition = await protoLoader.load(protoPath, {
      defaults: true,
      enums: String,
      keepCase: true,
      longs: String,
      oneofs: true,
    })

    // Load the package definition and get the LLMService constructor
    interface ProtoPackage {
      byterover: {
        llm: {
          v1: {
            LLMService: new (endpoint: string, credentials: grpc.ChannelCredentials) => LLMServiceClient
          }
        }
      }
    }

    const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoPackage
    const {LLMService} = proto.byterover.llm.v1

    this.client = new LLMService(this.config.grpcEndpoint, this.credentials)
  }

}
