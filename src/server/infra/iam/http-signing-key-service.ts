import type {IHttpClient} from '../../core/interfaces/services/i-http-client.js'
import type {ISigningKeyService, SigningKeyResource} from '../../core/interfaces/services/i-signing-key-service.js'

import {VcErrorCode} from '../../../shared/transport/events/vc-events.js'
import {VcError} from '../../core/domain/errors/vc-error.js'

// IAM API wraps all responses in {success, data}
type ApiEnvelope<T> = {
  data: T
  success: boolean
}

// IAM API response wrappers (inside data envelope)
type CreateSigningKeyData = {
  signing_key: RawSigningKeyResource
}

type ListSigningKeysData = {
  signing_keys: RawSigningKeyResource[]
}

// IAM returns snake_case; map to camelCase
type RawSigningKeyResource = {
  created_at: string
  fingerprint: string
  id: string
  key_type: string
  last_used_at?: string
  public_key: string
  title: string
}

function mapResource(raw: RawSigningKeyResource): SigningKeyResource {
  return {
    createdAt: raw.created_at,
    fingerprint: raw.fingerprint,
    id: raw.id,
    keyType: raw.key_type,
    lastUsedAt: raw.last_used_at,
    publicKey: raw.public_key,
    title: raw.title,
  }
}

/**
 * HTTP client for the IAM signing key CRUD API.
 *
 * API base: /api/v3/users/me/signing-keys (configured via BRV_API_BASE_URL / httpClient base URL)
 */
export class HttpSigningKeyService implements ISigningKeyService {
  private readonly httpClient: IHttpClient
  private readonly iamBaseUrl: string

  constructor(httpClient: IHttpClient, iamBaseUrl: string) {
    this.httpClient = httpClient
    this.iamBaseUrl = iamBaseUrl.replace(/\/$/, '')
  }

  async addKey(title: string, publicKey: string): Promise<SigningKeyResource> {
    let response: ApiEnvelope<CreateSigningKeyData>
    try {
      response = await this.httpClient.post<ApiEnvelope<CreateSigningKeyData>>(
        `${this.iamBaseUrl}/api/v3/users/me/signing-keys`,
        /* eslint-disable camelcase */
        {public_key: publicKey, title},
        /* eslint-enable camelcase */
      )
    } catch (error) {
      // AuthenticatedHttpClient collapses non-2xx axios errors into Error
      // instances whose message carries the HTTP status. Translate the
      // duplicate-key signal (409) into a structured VcError so callers can
      // branch on the code instead of regex-matching English substrings.
      if (error instanceof Error && /\b409\b|conflict/i.test(error.message)) {
        throw new VcError(
          'This SSH public key is already registered with your Byterover account.',
          VcErrorCode.SIGNING_KEY_ALREADY_EXISTS,
        )
      }

      throw error
    }

    if (!response.success) {
      throw new Error('IAM signing-key add request failed (response.success=false)')
    }

    return mapResource(response.data.signing_key)
  }

  async listKeys(): Promise<SigningKeyResource[]> {
    const response = await this.httpClient.get<ApiEnvelope<ListSigningKeysData>>(
      `${this.iamBaseUrl}/api/v3/users/me/signing-keys`,
    )
    if (!response.success) {
      throw new Error('IAM signing-key list request failed (response.success=false)')
    }

    return (response.data.signing_keys ?? []).map((raw) => mapResource(raw))
  }

  async removeKey(keyId: string): Promise<void> {
    await this.httpClient.delete(`${this.iamBaseUrl}/api/v3/users/me/signing-keys/${keyId}`)
  }
}
