/**
 * Interface for raw parser services
 * Implementations handle extraction and transformation of raw IDE session data
 */
export interface IRawParserService {
  /**
   * Parse IDE sessions from a custom directory
   *
   * Extracts raw session data from IDE storage and writes normalized JSON files
   * to output directory (.brv/logs/{ide}/raw).
   *
   * @param customDir - Path to directory containing IDE session data
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  parse(customDir: string): Promise<boolean>
}
