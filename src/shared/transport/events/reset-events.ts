export const ResetEvents = {
  EXECUTE: 'reset:execute',
} as const

export interface ResetExecuteResponse {
  success: boolean
}
