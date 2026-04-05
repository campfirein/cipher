/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'

import type {ProviderTokenResponse, TokenExchangeParams} from './types.js'

import {ProxyConfig} from '../http/proxy-config.js'
import {extractOAuthErrorFields, ProviderTokenExchangeError} from './errors.js'
import {ProviderTokenResponseSchema} from './types.js'

/**
 * Exchanges an authorization code for tokens at the provider's token endpoint.
 * Supports configurable content type to accommodate different providers:
 * - OpenAI uses application/x-www-form-urlencoded
 * - Anthropic uses application/json
 */
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

  let response: {data: unknown}
  try {
    response = await axios.post(
      params.tokenUrl,
      params.contentType === 'application/x-www-form-urlencoded' ? new URLSearchParams(body).toString() : body,
      {
        headers: {
          'Content-Type': params.contentType,
        },
        httpAgent: ProxyConfig.getProxyAgent(),
        httpsAgent: ProxyConfig.getProxyAgent(),
        proxy: false,
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

  return ProviderTokenResponseSchema.parse(response.data)
}
