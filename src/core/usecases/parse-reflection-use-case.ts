import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ReflectorOutputJson} from '../domain/entities/reflector-output.js'

import {sanitizeHint} from '../../utils/ace-file-helpers.js'
import {ReflectorOutput} from '../domain/entities/reflector-output.js'

export interface ParseReflectionResult {
  error?: string
  filePath?: string
  reflection?: ReflectorOutput
  success: boolean
}

/**
 * Use case for parsing and saving reflection output from agent.
 * Validates reflection JSON and stores to .br/ace/reflections/{timestamp}.json
 */
export class ParseReflectionUseCase {
  private static readonly ACE_DIR = 'ace'
  private static readonly BR_DIR = '.br'
  private static readonly REFLECTIONS_DIR = 'reflections'

  public async execute(
    reflectionJson: ReflectorOutputJson,
    directory?: string,
  ): Promise<ParseReflectionResult> {
    try {
      // Parse and validate reflection
      const reflection = ReflectorOutput.fromJson(reflectionJson)

      // Prepare output directory
      const baseDir = directory ?? process.cwd()
      const reflectionsDir = join(
        baseDir,
        ParseReflectionUseCase.BR_DIR,
        ParseReflectionUseCase.ACE_DIR,
        ParseReflectionUseCase.REFLECTIONS_DIR,
      )

      // Ensure directory exists
      await mkdir(reflectionsDir, {recursive: true})

      // Generate filename with hint and timestamp
      const timestamp = new Date().toISOString().replaceAll(':', '-')
      const sanitizedHint = sanitizeHint(reflection.hint)
      const filename = sanitizedHint
        ? `reflection-${sanitizedHint}-${timestamp}.json`
        : `reflection-${timestamp}.json`
      const filePath = join(reflectionsDir, filename)

      // Serialize and save
      const content = JSON.stringify(reflection.toJson(), null, 2)
      await writeFile(filePath, content, 'utf8')

      return {
        filePath,
        reflection,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to parse reflection',
        success: false,
      }
    }
  }
}
