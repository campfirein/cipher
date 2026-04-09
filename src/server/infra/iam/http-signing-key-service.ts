import type {IHttpClient} from '../../core/interfaces/services/i-http-client.js'
import type {ISigningKeyService, SigningKeyResource} from '../../core/interfaces/services/i-signing-key-service.js'

// IAM API wraps all responses in {success, data}
interface ApiEnvelope<T> {
  data: T
  success: boolean
}

// IAM API response wrappers (inside data envelope)
interface CreateSigningKeyData {
  signing_key: RawSigningKeyResource
}

interface ListSigningKeysData {
  signing_keys: RawSigningKeyResource[]
}

// IAM returns snake_case; map to camelCase
interface RawSigningKeyResource {
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
    const response = await this.httpClient.post<ApiEnvelope<CreateSigningKeyData>>(
      `${this.iamBaseUrl}/api/v3/users/me/signing-keys`,
      /* eslint-disable camelcase */
      {public_key: publicKey, title},
      /* eslint-enable camelcase */
    )
    return mapResource(response.data.signing_key)
  }

  async listKeys(): Promise<SigningKeyResource[]> {
    const response = await this.httpClient.get<ApiEnvelope<ListSigningKeysData>>(
      `${this.iamBaseUrl}/api/v3/users/me/signing-keys`,
    )
    return (response.data.signing_keys ?? []).map((raw) => mapResource(raw))
  }

  async removeKey(keyId: string): Promise<void> {
    await this.httpClient.delete(`${this.iamBaseUrl}/api/v3/users/me/signing-keys/${keyId}`)
  }
}
