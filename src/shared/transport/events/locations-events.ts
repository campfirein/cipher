import type {ProjectLocationDTO} from '../types/dto.js'

export const LocationsEvents = {
  GET: 'locations:get',
} as const

export interface LocationsGetResponse {
  locations: ProjectLocationDTO[]
}
