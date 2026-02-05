/**
 * Curate service implementation for sandbox integration.
 * Wraps the curate-tool logic for use in the sandbox's tools.* SDK.
 */

import type {
  CurateOperation,
  CurateOperationResult,
  CurateOptions,
  CurateResult,
  DetectDomainsInput,
  DetectDomainsResult,
  ICurateService,
} from '../../core/interfaces/i-curate-service.js'

import {executeCurate} from '../tools/implementations/curate-tool.js'

/**
 * Default base path for knowledge storage.
 */
const DEFAULT_BASE_PATH = '.brv/context-tree'

/**
 * Validate operations and return early failures for common mistakes.
 * This provides better error messages before the operation is attempted.
 */
function validateOperations(operations: CurateOperation[]): CurateOperationResult[] {
  const failures: CurateOperationResult[] = []

  for (const op of operations) {
    if (op.type === 'MERGE') {
      // MERGE requires mergeTarget and mergeTargetTitle
      if (!op.mergeTarget) {
        failures.push({
          message:
            'MERGE operation requires mergeTarget (the destination path). Did you mean to use UPDATE instead? Use UPDATE to modify an existing file with new content, MERGE is only for combining two existing files.',
          path: op.path,
          status: 'failed',
          type: 'MERGE',
        })
        continue
      }

      if (!op.mergeTargetTitle) {
        failures.push({
          message:
            'MERGE operation requires mergeTargetTitle (the destination file title). MERGE combines source file into target file. Did you mean to use UPDATE instead?',
          path: op.path,
          status: 'failed',
          type: 'MERGE',
        })
        continue
      }

      // Warn if content is provided (it will be ignored) - add to failures with warning message
      if (op.content) {
        failures.push({
          message:
            'MERGE operation ignores the content field. MERGE reads content from existing files and combines them. If you want to update a file with new content, use UPDATE instead.',
          path: op.path,
          status: 'failed',
          type: 'MERGE',
        })
        continue
      }
    }

    // ADD, UPDATE, and UPSERT require content
    if ((op.type === 'ADD' || op.type === 'UPDATE' || op.type === 'UPSERT') && !op.content) {
      failures.push({
        message: `${op.type} operation requires content with rawConcept and/or narrative.`,
        path: op.path,
        status: 'failed',
        type: op.type,
      })
    }

    // ADD, UPDATE, and UPSERT require title
    if ((op.type === 'ADD' || op.type === 'UPDATE' || op.type === 'UPSERT') && !op.title) {
      failures.push({
        message: `${op.type} operation requires a title (becomes the .md filename).`,
        path: op.path,
        status: 'failed',
        type: op.type,
      })
    }
  }

  return failures
}

/**
 * Curate service implementation.
 * Provides curate and domain detection operations for the sandbox.
 */
export class CurateService implements ICurateService {
  /**
   * Execute curate operations on knowledge topics.
   *
   * @param operations - Array of curate operations to apply
   * @param options - Curate options
   * @returns Curate result with applied operations and summary
   */
  async curate(operations: CurateOperation[], options?: CurateOptions): Promise<CurateResult> {
    const basePath = options?.basePath ?? DEFAULT_BASE_PATH

    // Pre-validate operations to catch common mistakes early
    const validationFailures = validateOperations(operations)
    if (validationFailures.length > 0) {
      // Return early with validation failures and helpful messages
      return {
        applied: validationFailures,
        summary: {
          added: 0,
          deleted: 0,
          failed: validationFailures.length,
          merged: 0,
          updated: 0,
        },
      }
    }

    // Call the underlying executeCurate function from curate-tool
    const result = await executeCurate({
      basePath,
      operations,
    })

    return result
  }

  /**
   * Detect and validate domains from input data.
   * This is a pass-through validation that ensures domain names are valid.
   *
   * @param domains - Array of detected domains with text segments
   * @returns Validated domains
   */
  async detectDomains(domains: DetectDomainsInput[]): Promise<DetectDomainsResult> {
    // Validate domain names (must be valid for filesystem)
    const validatedDomains = domains.filter((domain) => {
      // Check for empty category
      if (!domain.category || domain.category.length === 0) {
        return false
      }

      // Check for invalid characters in domain name
      // Allow only letters, numbers, underscores, and hyphens
      if (!/^[\w-]+$/.test(domain.category)) {
        return false
      }

      // Ensure text segments array is non-empty
      if (!domain.textSegments || domain.textSegments.length === 0) {
        return false
      }

      return true
    })

    return {
      domains: validatedDomains,
    }
  }
}

/**
 * Creates a curate service instance.
 *
 * @returns CurateService instance
 */
export function createCurateService(): ICurateService {
  return new CurateService()
}
