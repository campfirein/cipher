/**
 * Error codes for system prompt operations.
 *
 * Used by SystemPromptError factory to create structured error objects.
 */
export enum SystemPromptErrorCode {
  /**
   * Cache operation failed.
   *
   * Error during cache read, write, or invalidation.
   */
  CACHE_OPERATION_FAILED = 'CACHE_OPERATION_FAILED',

  /**
   * Prompt configuration is invalid.
   *
   * YAML structure doesn't match expected schema.
   */
  CONFIG_INVALID = 'CONFIG_INVALID',

  /**
   * Required field missing from configuration.
   *
   * A mandatory field like 'prompt' or 'prompts' is not present.
   */
  CONFIG_MISSING_FIELD = 'CONFIG_MISSING_FIELD',

  /**
   * Contributor execution failed.
   *
   * Error occurred while generating contributor content.
   */
  CONTRIBUTOR_EXECUTION_FAILED = 'CONTRIBUTOR_EXECUTION_FAILED',

  /**
   * Invalid contributor configuration.
   *
   * Contributor config doesn't match expected structure.
   */
  CONTRIBUTOR_INVALID_CONFIG = 'CONTRIBUTOR_INVALID_CONFIG',

  /**
   * Contributor not found in registry.
   *
   * The specified contributor ID is not registered.
   */
  CONTRIBUTOR_NOT_FOUND = 'CONTRIBUTOR_NOT_FOUND',

  /**
   * Invalid file type for prompt loading.
   *
   * File extension is not in the allowed list (e.g., .yml, .yaml).
   */
  FILE_INVALID_TYPE = 'FILE_INVALID_TYPE',

  /**
   * Prompt file not found.
   *
   * The specified YAML prompt file does not exist at the expected path.
   */
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',

  /**
   * Failed to read prompt file.
   *
   * I/O error when attempting to read file contents.
   */
  FILE_READ_FAILED = 'FILE_READ_FAILED',

  /**
   * File exceeds maximum allowed size.
   *
   * Prompt files have a size limit to prevent memory issues.
   */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  /**
   * Template rendering failed.
   *
   * Error during variable substitution in template.
   */
  TEMPLATE_RENDER_FAILED = 'TEMPLATE_RENDER_FAILED',

  /**
   * Required template variable is missing.
   *
   * A placeholder in the template has no corresponding value.
   */
  TEMPLATE_VARIABLE_MISSING = 'TEMPLATE_VARIABLE_MISSING',
}
