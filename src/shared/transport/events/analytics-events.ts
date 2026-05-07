export const AnalyticsEvents = {
  TRACK: 'analytics:track',
} as const

export interface AnalyticsTrackRequest {
  readonly event: string
  readonly properties?: Record<string, unknown>
}
