/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'

import {
  COPILOT_TOKEN_URL,
  DEVICE_FLOW_INTERVAL_BUFFER,
  GITHUB_API_VERSION,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_OAUTH_TOKEN_URL,
} from '../../../shared/constants/copilot.js'
import {extractOAuthErrorFields, ProviderTokenExchangeError} from './errors.js'

export type DeviceCodeResponse = {
  deviceCode: string
  expiresIn: number
  interval: number
  userCode: string
  verificationUri: string
}

export type RequestDeviceCodeParams = {
  clientId: string
  scope: string
}

export type PollForAccessTokenParams = {
  clientId: string
  deviceCode: string
  expiresIn: number
  interval: number
  intervalBuffer?: number
  signal?: AbortSignal
  /** Seconds added to interval on slow_down response (default 5 per RFC). Injectable for testing. */
  slowDownIncrement?: number
}

export type CopilotTokenResponse = {
  expiresAt: number
  token: string
}

type DeviceCodeApiResponse = {
  device_code: string
  expires_in: number
  interval: number
  user_code: string
  verification_uri: string
}

type OAuthTokenApiResponse = {
  access_token?: string
  error?: string
  error_description?: string
}

type CopilotTokenApiResponse = {
  expires_at: number
  token: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function requestDeviceCode(params: RequestDeviceCodeParams): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    scope: params.scope,
  }).toString()

  const response = await axios.post<DeviceCodeApiResponse>(GITHUB_DEVICE_CODE_URL, body, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  const {data} = response
  return {
    deviceCode: data.device_code,
    expiresIn: data.expires_in,
    interval: data.interval,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
  }
}

export async function pollForAccessToken(params: PollForAccessTokenParams): Promise<string> {
  if (params.signal?.aborted) {
    throw new Error('Device flow cancelled')
  }

  const buffer = params.intervalBuffer ?? DEVICE_FLOW_INTERVAL_BUFFER
  let currentInterval = params.interval
  const deadline = Date.now() + params.expiresIn * 1000

  /* eslint-disable no-await-in-loop */
  while (Date.now() < deadline) {
    if (params.signal?.aborted) {
      throw new Error('Device flow cancelled')
    }

    const body = new URLSearchParams({
      client_id: params.clientId,
      device_code: params.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString()

    const response = await axios.post<OAuthTokenApiResponse>(GITHUB_OAUTH_TOKEN_URL, body, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    const {data} = response

    if (data.access_token) {
      return data.access_token
    }

    if (data.error === 'authorization_pending') {
      await delay((currentInterval + buffer) * 1000)
      continue
    }

    if (data.error === 'slow_down') {
      currentInterval += params.slowDownIncrement ?? 5
      await delay((currentInterval + buffer) * 1000)
      continue
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired')
    }

    if (data.error === 'access_denied') {
      throw new Error('Authorization denied by user')
    }

    throw new Error(data.error_description ?? data.error ?? 'Unknown error during device flow')
  }
  /* eslint-enable no-await-in-loop */

  throw new Error('Device code expired')
}

export async function exchangeForCopilotToken(githubToken: string): Promise<CopilotTokenResponse> {
  let response: {data: CopilotTokenApiResponse}
  try {
    response = await axios.get<CopilotTokenApiResponse>(COPILOT_TOKEN_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `token ${githubToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    })
  } catch (error) {
    if (isAxiosError(error)) {
      const data: unknown = error.response?.data
      const errorFields = extractOAuthErrorFields(data)
      throw new ProviderTokenExchangeError({
        errorCode: errorFields.error ?? error.code,
        message: errorFields.error_description ?? `Copilot token exchange failed: ${error.message}`,
        statusCode: error.response?.status,
      })
    }

    throw error
  }

  return {
    expiresAt: response.data.expires_at,
    token: response.data.token,
  }
}
