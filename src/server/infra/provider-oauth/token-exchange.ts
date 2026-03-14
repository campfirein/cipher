/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'

import type {ProviderTokenResponse, TokenExchangeParams} from './types.js'

import {ProviderTokenExchangeError} from './errors.js'

/**
 * Exchanges an authorization code for tokens at the provider's token endpoint.
 * Supports configurable content type to accommodate different providers:
 * - OpenAI uses application/x-www-form-urlencoded
 * - Anthropic uses application/json
 */
function extractOAuthErrorFields(data: unknown): {error?: string; error_description?: string} {
  if (typeof data !== 'object' || data === null) {
    return {}
  }

  return {
    error: 'error' in data && typeof data.error === 'string' ? data.error : undefined,
    error_description:
      'error_description' in data && typeof data.error_description === 'string' ? data.error_description : undefined,
  }
}

export async function exchangeCodeForTokens(params: TokenExchangeParams): Promise<ProviderTokenResponse> {
  const body: Record<string, string> = {
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  }

  if (params.clientSecret !== undefined) {
    body.client_secret = params.clientSecret
  }

  let response: Awaited<ReturnType<typeof axios.post<ProviderTokenResponse>>>
  try {
    response = await axios.post<ProviderTokenResponse>(
      params.tokenUrl,
      params.contentType === 'application/x-www-form-urlencoded' ? new URLSearchParams(body).toString() : body,
      {
        headers: {
          'Content-Type': params.contentType,
        },
        timeout: 30_000,
      },
    )
  } catch (error) {
    if (isAxiosError(error)) {
      const data: unknown = error.response?.data
      const errorFields = extractOAuthErrorFields(data)
      throw new ProviderTokenExchangeError({
        errorCode: errorFields.error ?? error.code,
        message: errorFields.error_description ?? `Token exchange failed: ${error.message}`,
        statusCode: error.response?.status,
      })
    }

    throw error
  }

  const {data} = response
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new ProviderTokenExchangeError({message: 'Invalid token response: missing access_token'})
  }

  return data
}
