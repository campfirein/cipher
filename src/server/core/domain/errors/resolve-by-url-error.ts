/**
 * Thrown by `IResolveByUrlService` when the backend returns 4xx for a slug resolution.
 * The handler maps `statusCode` to the user-facing CLI error (NotAuthenticatedError / VcError).
 */
export class ResolveByUrlError extends Error {
  public readonly statusCode: number

  public constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ResolveByUrlError'
    this.statusCode = statusCode
  }
}
