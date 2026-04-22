// ── DTOs ─────────────────────────────────────────────────────────────────────

export type SigningKeyResource = {
  createdAt: string
  fingerprint: string
  id: string
  keyType: string
  lastUsedAt?: string
  publicKey: string
  title: string
}

export interface ISigningKeyService {
  addKey(title: string, publicKey: string): Promise<SigningKeyResource>
  listKeys(): Promise<SigningKeyResource[]>
  removeKey(keyId: string): Promise<void>
}
