/**
 * OIDC metadata returned from the discovery endpoint.
 */
export type OidcMetadata = {
  authorizationEndpoint: string
  issuer: string
  scopesSupported?: string[]
  tokenEndpoint: string
}

/**
 * Interface for OIDC discovery services.
 */
export interface IOidcDiscoveryService {
  /**
   * Discovers OIDC configuration from the issuer's well-known endpoint.
   * @param issuerUrl The base URL of the OIDC issuer.
   * @returns The OIDC metadata.
   */
  discover: (issuerUrl: string) => Promise<OidcMetadata>
}
