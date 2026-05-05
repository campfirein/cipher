export const GlobalConfigEvents = {
  GET: 'globalConfig:get',
} as const

export interface GlobalConfigGetResponse {
  readonly analytics: boolean
  readonly deviceId: string
  readonly version: string
}
