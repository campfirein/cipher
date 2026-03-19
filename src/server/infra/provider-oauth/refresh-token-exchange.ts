/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'

import type {ProviderTokenResponse, RefreshTokenExchangeParams} from './types.js'

import {extractOAuthErrorFields, ProviderTokenExchangeError} from './errors.js'
import {ProviderTokenResponseSchema} from './types.js'

/**
 * Exchanges a refresh token for a new access token at the provider's token endpoint.
 * Supports configurable content type to accommodate different providers:
 * - OpenAI uses application/x-www-form-urlencoded
 * - Anthropic uses application/json
 */
export async function exchangeRefreshToken(params: RefreshTokenExchangeParams): Promise<ProviderTokenResponse> {
  const body: Record<string, string> = {
    client_id: params.clientId,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
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
        timeout: 30_000,
      },
    )
  } catch (error) {
    if (isAxiosError(error)) {
      const data: unknown = error.response?.data
      const errorFields = extractOAuthErrorFields(data)
      throw new ProviderTokenExchangeError({
        errorCode: errorFields.error ?? error.code,
        message: errorFields.error_description ?? `Token refresh failed: ${error.message}`,
        statusCode: error.response?.status,
      })
    }

    throw error
  }

  return ProviderTokenResponseSchema.parse(response.data)
}
