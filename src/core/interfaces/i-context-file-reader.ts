import type {Narrative, RawConcept} from '../domain/knowledge/markdown-writer.js'

/**
 * Represents the content of a context file with extracted metadata.
 */
export type ContextFileContent = {
  /** The raw content of the file */
  content: string
  narrative?: Narrative
  /** Relative path within the context tree (e.g., "structure/context.md") */
  path: string
  rawConcept?: RawConcept
  /** Title extracted from the first heading, or the relative path if no heading found */
  title: string
}

/**
 * Interface for reading context files and extracting their metadata.
 * Used to prepare context files for the CoGit API.
 */
export interface IContextFileReader {
  /**
   * Reads a single context file and extracts its metadata.
   * @param relativePath - Relative path within the context tree (e.g., "structure/context.md")
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns ContextFileContent if file exists and can be read, undefined otherwise
   */
  read(relativePath: string, directory?: string): Promise<ContextFileContent | undefined>

  /**
   * Reads multiple context files and extracts their metadata.
   * Files that cannot be read are silently skipped.
   * @param relativePaths - Array of relative paths within the context tree
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns Array of ContextFileContent for successfully read files
   */
  readMany(relativePaths: string[], directory?: string): Promise<ContextFileContent[]>
}
