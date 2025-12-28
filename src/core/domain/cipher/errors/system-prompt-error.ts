import {SystemPromptErrorCode} from './system-prompt-error-codes.js'

/**
 * Base error class for system prompt operations.
 *
 * All system prompt-specific errors use this class with factory methods.
 */
export class SystemPromptError extends Error {
  public readonly code: SystemPromptErrorCode
  public readonly details?: Record<string, unknown>
  public readonly suggestion?: string

  /**
   * Creates a new system prompt error.
   *
   * @param message - Error message describing what went wrong
   * @param code - Error code for categorization
   * @param details - Additional error context
   * @param suggestion - Optional recovery suggestion
   */
  public constructor(
    message: string,
    code: SystemPromptErrorCode,
    details?: Record<string, unknown>,
    suggestion?: string,
  ) {
    super(message)
    this.name = 'SystemPromptError'
    this.code = code
    this.details = details
    this.suggestion = suggestion
  }

  /**
   * Factory method: Cache operation failed.
   *
   * @param operation - The cache operation that failed (get, set, invalidate)
   * @param reason - Reason for the failure
   * @returns SystemPromptError instance
   */
  public static cacheOperationFailed(operation: string, reason: string): SystemPromptError {
    return new SystemPromptError(
      `Cache ${operation} operation failed: ${reason}`,
      SystemPromptErrorCode.CACHE_OPERATION_FAILED,
      {operation, reason},
      'Clear the cache and retry, or check file system permissions.',
    )
  }

  /**
   * Factory method: Prompt configuration is invalid.
   *
   * @param reason - Reason why configuration is invalid
   * @param validationErrors - Optional validation error details
   * @returns SystemPromptError instance
   */
  public static configInvalid(reason: string, validationErrors?: unknown): SystemPromptError {
    return new SystemPromptError(
      `Invalid prompt configuration: ${reason}`,
      SystemPromptErrorCode.CONFIG_INVALID,
      {reason, validationErrors},
      'Review the prompt YAML structure and fix any schema violations.',
    )
  }

  /**
   * Factory method: Required field missing from configuration.
   *
   * @param field - Name of the missing field
   * @param filepath - Path to the config file
   * @returns SystemPromptError instance
   */
  public static configMissingField(field: string, filepath: string): SystemPromptError {
    return new SystemPromptError(
      `Missing required field '${field}' in ${filepath}`,
      SystemPromptErrorCode.CONFIG_MISSING_FIELD,
      {field, filepath},
      `Add the '${field}' field to the prompt configuration.`,
    )
  }

  /**
   * Factory method: Contributor execution failed.
   *
   * @param contributorId - ID of the failing contributor
   * @param reason - Reason for the failure
   * @returns SystemPromptError instance
   */
  public static contributorExecutionFailed(contributorId: string, reason: string): SystemPromptError {
    return new SystemPromptError(
      `Contributor '${contributorId}' execution failed: ${reason}`,
      SystemPromptErrorCode.CONTRIBUTOR_EXECUTION_FAILED,
      {contributorId, reason},
      'Check contributor implementation and its dependencies.',
    )
  }

  /**
   * Factory method: Invalid contributor configuration.
   *
   * @param config - The invalid configuration object
   * @returns SystemPromptError instance
   */
  public static contributorInvalidConfig(config: unknown): SystemPromptError {
    return new SystemPromptError(
      'Invalid contributor configuration',
      SystemPromptErrorCode.CONTRIBUTOR_INVALID_CONFIG,
      {config},
      'Verify contributor type and ensure all required fields are present.',
    )
  }

  /**
   * Factory method: Contributor not found in registry.
   *
   * @param contributorId - ID of the missing contributor
   * @returns SystemPromptError instance
   */
  public static contributorNotFound(contributorId: string): SystemPromptError {
    return new SystemPromptError(
      `Contributor not found: ${contributorId}`,
      SystemPromptErrorCode.CONTRIBUTOR_NOT_FOUND,
      {contributorId},
      'Register the contributor before using it in the configuration.',
    )
  }

  /**
   * Factory method: Prompt file not found.
   *
   * @param filepath - Path to the missing file
   * @returns SystemPromptError instance
   */
  public static fileNotFound(filepath: string): SystemPromptError {
    return new SystemPromptError(
      `Prompt file not found: ${filepath}`,
      SystemPromptErrorCode.FILE_NOT_FOUND,
      {filepath},
      'Check that the prompt file exists at the expected path.',
    )
  }

  /**
   * Factory method: Failed to read prompt file.
   *
   * @param filepath - Path to the file
   * @param reason - Reason for the failure
   * @returns SystemPromptError instance
   */
  public static fileReadFailed(filepath: string, reason: string): SystemPromptError {
    return new SystemPromptError(
      `Failed to read prompt file ${filepath}: ${reason}`,
      SystemPromptErrorCode.FILE_READ_FAILED,
      {filepath, reason},
      'Check file permissions and encoding (UTF-8 expected).',
    )
  }

  /**
   * Factory method: File exceeds maximum allowed size.
   *
   * @param filepath - Path to the file
   * @param size - Actual file size in bytes
   * @param maxSize - Maximum allowed size in bytes
   * @returns SystemPromptError instance
   */
  public static fileTooLarge(filepath: string, size: number, maxSize: number): SystemPromptError {
    return new SystemPromptError(
      `File ${filepath} exceeds maximum size (${size} > ${maxSize} bytes)`,
      SystemPromptErrorCode.FILE_TOO_LARGE,
      {filepath, maxSize, size},
      `Reduce file size to under ${maxSize} bytes.`,
    )
  }

  /**
   * Factory method: Invalid file type for prompt loading.
   *
   * @param filepath - Path to the invalid file
   * @param allowedExtensions - List of allowed file extensions
   * @returns SystemPromptError instance
   */
  public static invalidFileType(filepath: string, allowedExtensions: string[]): SystemPromptError {
    return new SystemPromptError(
      `Invalid file type for ${filepath}. Expected: ${allowedExtensions.join(', ')}`,
      SystemPromptErrorCode.FILE_INVALID_TYPE,
      {allowedExtensions, filepath},
      `Use one of the supported file types: ${allowedExtensions.join(', ')}`,
    )
  }

  /**
   * Factory method: Template rendering failed.
   *
   * @param reason - Reason for the failure
   * @param templatePreview - Preview of the template (first 100 chars)
   * @returns SystemPromptError instance
   */
  public static templateRenderFailed(reason: string, templatePreview?: string): SystemPromptError {
    return new SystemPromptError(
      `Template render failed: ${reason}`,
      SystemPromptErrorCode.TEMPLATE_RENDER_FAILED,
      {reason, templatePreview},
      'Check template syntax and ensure all variable placeholders are valid.',
    )
  }

  /**
   * Factory method: Required template variable is missing.
   *
   * @param variable - Name of the missing variable
   * @param template - Path or identifier of the template
   * @returns SystemPromptError instance
   */
  public static templateVariableMissing(variable: string, template: string): SystemPromptError {
    return new SystemPromptError(
      `Missing required template variable '${variable}' in ${template}`,
      SystemPromptErrorCode.TEMPLATE_VARIABLE_MISSING,
      {template, variable},
      `Provide a value for the '${variable}' variable in the build context.`,
    )
  }
}
