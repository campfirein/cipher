export const FooEvents = {
  INIT: 'foo:init',
} as const

export interface FooInitRequest {
  spaceId: string
  teamId: string
}

export interface FooInitResponse {
  gitDir: string
  remoteUrl: string
}
