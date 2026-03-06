export const FooEvents = {
  INIT: 'foo:init',
} as const

export interface FooInitResponse {
  gitDir: string
  reinitialized: boolean
}
