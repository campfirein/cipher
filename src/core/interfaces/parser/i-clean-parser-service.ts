/**
 * Interface for clean parser services
 * Implementations handle transformation of raw IDE session data to clean normalized format
 */
export interface ICleanParserService {
  /**
   * Parse and transform raw IDE sessions to clean normalized format
   *
   * Reads raw session files and transforms them into standardized format with
   * normalized messages, metadata, and workspace information. Writes results to
   * output directory (.brv/logs/{ide}/clean).
   *
   * @param rawDir - Path to directory containing raw IDE session files
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  parse(rawDir: string): Promise<boolean>
}
