import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {ISigningKeyService, SigningKeyResource} from '../../../core/interfaces/services/i-signing-key-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type IVcSigningKeyRequest,
  type IVcSigningKeyResponse,
  type SigningKeyItem,
  VcEvents,
} from '../../../../shared/transport/events/vc-events.js'
import {AuthenticatedHttpClient} from '../../http/authenticated-http-client.js'
import {HttpSigningKeyService} from '../../iam/http-signing-key-service.js'

export interface SigningKeyHandlerDeps {
  iamBaseUrl: string
  tokenStore: ITokenStore
  transport: ITransportServer
}

function toSigningKeyItem(resource: SigningKeyResource): SigningKeyItem {
  return {
    createdAt: resource.createdAt,
    fingerprint: resource.fingerprint,
    id: resource.id,
    keyType: resource.keyType,
    lastUsedAt: resource.lastUsedAt,
    publicKey: resource.publicKey,
    title: resource.title,
  }
}

/**
 * Handles vc:signing-key events from the CLI.
 * Creates a fresh authenticated HTTP client per request to use the current session key.
 */
export class SigningKeyHandler {
  private readonly iamBaseUrl: string
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: SigningKeyHandlerDeps) {
    this.iamBaseUrl = deps.iamBaseUrl
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<IVcSigningKeyRequest, IVcSigningKeyResponse>(
      VcEvents.SIGNING_KEY,
      async (data) => {
        const signingKeyService = await this.createService()
        return this.handle(signingKeyService, data)
      },
    )
  }

  private async createService(): Promise<ISigningKeyService> {
    const token = await this.tokenStore.load()
    const sessionKey = token?.sessionKey ?? ''
    const httpClient = new AuthenticatedHttpClient(sessionKey)
    return new HttpSigningKeyService(httpClient, this.iamBaseUrl)
  }

  private async handle(
    service: ISigningKeyService,
    data: IVcSigningKeyRequest,
  ): Promise<IVcSigningKeyResponse> {
    switch (data.action) {
      case 'add': {
        const key = await service.addKey(data.title, data.publicKey)
        return {action: 'add', key: toSigningKeyItem(key)}
      }

      case 'list': {
        const keys = await service.listKeys()
        return {action: 'list', keys: keys.map((k) => toSigningKeyItem(k))}
      }

      case 'remove': {
        await service.removeKey(data.keyId)
        return {action: 'remove'}
      }
    }
  }
}
