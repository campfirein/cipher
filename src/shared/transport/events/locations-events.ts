import type {ProjectLocationDTO} from '../types/dto.js'

export const LocationsEvents = {
  GET: 'locations:get',
  REVEAL: 'locations:reveal',
} as const

export interface LocationsGetResponse {
  locations: ProjectLocationDTO[]
}

export interface LocationsRevealRequest {
  projectPath: string
}

export interface LocationsRevealResponse {
  projectPath: string
}
