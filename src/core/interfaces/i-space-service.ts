import type {Space} from '../domain/entities/space.js'

/**
 * Interface for space-related operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
 */
export interface ISpaceService {
  getSpaces: () => Promise<Space[]>
}
