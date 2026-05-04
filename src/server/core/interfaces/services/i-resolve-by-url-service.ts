export type ResolveByUrlInput = {
  spaceSlug: string
  teamSlug: string
}

export type ResolveByUrlResult = {
  space: {id: string; name: string; slug: string}
  team: {id: string; name: string; slug: string}
  url: string
}

/**
 * Resolves a (team, space) slug pair to canonical metadata via the cogit `git/resolve` endpoint.
 * Public spaces resolve without auth; private spaces require a session that has access.
 */
export interface IResolveByUrlService {
  resolveByUrl: (input: ResolveByUrlInput, sessionKey?: string) => Promise<ResolveByUrlResult>
}
