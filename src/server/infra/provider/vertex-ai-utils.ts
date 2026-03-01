/**
 * Vertex AI Utilities
 *
 * Shared helpers for Google Vertex AI provider configuration.
 */

import {readFileSync} from 'node:fs'

/**
 * Resolve the Google Cloud project ID for Vertex AI.
 * Priority: GOOGLE_CLOUD_PROJECT env var → project_id from service account JSON.
 */
export function resolveVertexAiProject(credentialPath: string | undefined): string | undefined {
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return process.env.GOOGLE_CLOUD_PROJECT
  }

  const filePath = credentialPath || process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (filePath) {
    try {
      const content = JSON.parse(readFileSync(filePath, 'utf8'))
      if (typeof content.project_id === 'string' && content.project_id) {
        return content.project_id
      }
    } catch {
      // File read/parse failed — fall through to undefined
    }
  }

  return undefined
}
