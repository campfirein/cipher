import type {CleanSession} from '../../domain/entities/parser.js'

/**
 * Interface for clean parser services
 * Implementations handle transformation of raw IDE session data to clean normalized format
 */
export interface ICleanParserService {
  /**
   * Parse and transform raw IDE sessions to clean normalized format
   *
   * Reads raw session files and transforms them into standardized format with
   * normalized messages, metadata, and workspace information.
   * Returns parsed sessions in-memory without writing to disk.
   *
   * @param rawDir - Path to directory containing raw IDE session files
   * @returns Promise resolving to array of CleanSession objects
   */
  parse: (rawDir: string) => Promise<readonly CleanSession[]>
}
