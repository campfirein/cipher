export const GlobalConfigEvents = {
  GET: 'globalConfig:get',
  SET_ANALYTICS: 'globalConfig:setAnalytics',
} as const

export interface GlobalConfigGetResponse {
  readonly analytics: boolean
  readonly deviceId: string
  readonly version: string
}

export interface GlobalConfigSetAnalyticsRequest {
  readonly analytics: boolean
}

export interface GlobalConfigSetAnalyticsResponse {
  readonly current: boolean
  readonly previous: boolean
}
