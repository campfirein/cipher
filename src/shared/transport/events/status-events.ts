import type {StatusDTO} from '../types/dto.js'

export const StatusEvents = {
  GET: 'status:get',
} as const

export interface StatusGetRequest {
  cwd?: string
  verbose?: boolean
}

export interface StatusGetResponse {
  status: StatusDTO
}
