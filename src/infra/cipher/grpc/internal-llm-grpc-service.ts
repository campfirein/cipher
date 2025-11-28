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
  executionMetadata?: string
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
  grpcEndpoint: string
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
   * @param executionMetadata - Optional execution metadata (mode, executionContext)
   * @returns Response in GenerateContentResponse format
   */
  public async generateContent(
    contents: Content[] | MessageCreateParamsNonStreaming,
    config: GenerateContentConfig | RequestOptions,
    model: string,
    executionMetadata?: Record<string, unknown>,
  ): Promise<GenerateContentResponse> {
    await this.initializeClient()

    const request: GenerateRequest = {
      executionMetadata: JSON.stringify(executionMetadata ?? {}),
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

    return this.callGrpcGenerate(request)
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

      // Log gRPC request
      // console.log('[gRPC] Request:', request)

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

        // Parse gRPC error to extract user-friendly message
        const userMessage = this.parseGrpcError(error)
        reject(new Error(userMessage))
      })

      // Handle gRPC status codes (server-sent errors)
      call.on('status', (status: grpc.StatusObject) => {
        if (status.code !== grpc.status.OK && !settled) {
          settled = true
          cleanup()

          // Parse status error to extract user-friendly message
          const userMessage = this.parseGrpcStatusError(status)
          reject(new Error(userMessage))
        }
      })
    })
  }

  /**
   * Check if error message contains any of the given keywords
   */
  private containsAny(message: string, keywords: string[]): boolean {
    return keywords.some((keyword) => message.includes(keyword))
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

  /**
   * Parse gRPC error to extract user-friendly error message.
   *
   * Handles common gRPC error patterns and extracts meaningful messages:
   * - RESOURCE_EXHAUSTED: Billing/quota issues
   * - UNAUTHENTICATED: Authentication failures
   * - PERMISSION_DENIED: Authorization issues
   * - UNAVAILABLE: Service unavailability
   * - Other errors: Generic failure message
   *
   * @param error - gRPC error object
   * @returns User-friendly error message
   */
  private parseGrpcError(error: NodeJS.ErrnoException): string {
    const errorMessage = error.message || String(error)

    // Check resource exhausted errors
    const resourceError = this.parseResourceExhaustedError(errorMessage)
    if (resourceError) return resourceError

    // Check authentication errors
    if (this.containsAny(errorMessage, ['UNAUTHENTICATED', 'authentication'])) {
      return '❌ Authentication failed: Your session may have expired. Please run "brv login" to re-authenticate.'
    }

    // Check permission errors
    if (this.containsAny(errorMessage, ['PERMISSION_DENIED', 'permission'])) {
      return '❌ Permission denied: You do not have access to this resource. Please check your team/space permissions.'
    }

    // Check network/connection errors
    if (
      this.containsAny(errorMessage, [
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'connection refused',
        'network',
        'dns',
        'getaddrinfo',
      ])
    ) {
      return '❌ Network error: Unable to connect to ByteRover servers. Please check your internet connection and try again.'
    }

    // Check service availability errors
    if (this.containsAny(errorMessage, ['UNAVAILABLE', 'unavailable'])) {
      return '❌ Service unavailable: ByteRover API is temporarily unavailable. Please try again later.'
    }

    // Generic error with cleaned message
    return `❌ API error: ${errorMessage.split(':').pop()?.trim() || 'Unknown error occurred'}`
  }

  /**
   * Parse gRPC status error to extract user-friendly error message.
   *
   * @param status - gRPC status object
   * @returns User-friendly error message
   */
  private parseGrpcStatusError(status: grpc.StatusObject): string {
    const statusName = grpc.status[status.code]
    const details = status.details || 'No details provided'

    // Map common status codes to user-friendly messages
    switch (status.code) {
      case grpc.status.DEADLINE_EXCEEDED: {
        return '❌ Request timeout: The API request took too long. Please try again.'
      }

      case grpc.status.INVALID_ARGUMENT: {
        return `❌ Invalid request: ${details}`
      }

      case grpc.status.NOT_FOUND: {
        return '❌ Resource not found: The requested resource does not exist.'
      }

      case grpc.status.PERMISSION_DENIED: {
        return '❌ Permission denied: You do not have access to this resource.'
      }

      case grpc.status.RESOURCE_EXHAUSTED: {
        if (details.includes('Billing') || details.includes('credentials')) {
          return '❌ Billing error: Your ByteRover account may not have sufficient credits or valid payment method.'
        }

        return '❌ Resource exhausted: API quota or billing limit reached.'
      }

      case grpc.status.UNAUTHENTICATED: {
        return '❌ Authentication failed: Your session may have expired. Please run "brv login" to re-authenticate.'
      }

      case grpc.status.UNAVAILABLE: {
        // Check if it's a network error (user's connection) vs server unavailable
        const detailsLower = details.toLowerCase()
        if (
          detailsLower.includes('enotfound') ||
          detailsLower.includes('econnrefused') ||
          detailsLower.includes('etimedout') ||
          detailsLower.includes('network') ||
          detailsLower.includes('dns') ||
          detailsLower.includes('getaddrinfo')
        ) {
          return '❌ Network error: Unable to connect to ByteRover servers. Please check your internet connection and try again.'
        }

        return '❌ Service unavailable: ByteRover API is temporarily unavailable. Please try again later.'
      }

      default: {
        return `❌ API error [${statusName}]: ${details}`
      }
    }
  }

  /**
   * Parse resource exhausted errors (billing/quota)
   */
  private parseResourceExhaustedError(errorMessage: string): null | string {
    if (!errorMessage.includes('RESOURCE_EXHAUSTED')) return null

    if (this.containsAny(errorMessage, ['Billing service error', 'Invalid credentials'])) {
      return '❌ Billing error: Your ByteRover account may not have sufficient credits or valid payment method. Please check your account settings.'
    }

    if (this.containsAny(errorMessage, ['quota', 'rate limit'])) {
      return '❌ Rate limit exceeded: You have reached your API quota. Please wait or upgrade your plan.'
    }

    return '❌ Resource exhausted: API quota or billing limit reached. Please check your ByteRover account.'
  }
}
