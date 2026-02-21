import type {AuthScheme} from '../../../shared/transport/types/auth-scheme.js'

export interface AuthHeaderParams {
  authScheme?: AuthScheme
  authToken?: string
  headerName?: string
}

/**
 * Builds HTTP auth headers for a hub registry request.
 * Returns an empty object when scheme is 'none' or no token is provided.
 */
export function buildAuthHeaders(params: AuthHeaderParams): Record<string, string> {
  const {authScheme = 'bearer', authToken, headerName} = params

  if (authScheme === 'none' || !authToken) return {}

  switch (authScheme) {
    case 'basic': {
      const encoded = Buffer.from(authToken, 'utf8').toString('base64')
      return {Authorization: `Basic ${encoded}`}
    }

    case 'bearer': {
      return {Authorization: `Bearer ${authToken}`}
    }

    case 'custom-header': {
      if (!headerName) return {}
      return {[headerName]: authToken}
    }

    case 'token': {
      return {Authorization: `token ${authToken}`}
    }

    default: {
      return {}
    }
  }
}
