import type {ProjectType} from '../../core/domain/harness/types.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../agent/agent-schemas.js'

import {detectProjectType} from './project-detector.js'

// Module-level set keeps the polyglot warning to once per workingDirectory
// per process. Resets on daemon restart — intentional.
const polyglotWarnedPaths = new Set<string>()

export async function detectAndPickTemplate(
  workingDirectory: string,
  fileSystem: IFileSystem,
  config: ValidatedHarnessConfig,
  logger: ILogger,
): Promise<ProjectType> {
  if (config.language !== 'auto') {
    logger.debug('Harness language override applied', {
      language: config.language,
      workingDirectory,
    })
    return config.language
  }

  const {detected} = await detectProjectType(workingDirectory, fileSystem)

  if (detected.length === 0) {
    // Unreachable under Task 4.1's contract (always returns ≥1), kept as a
    // defense-in-depth guard so a future contract change can't produce a
    // silent `undefined` + malformed warn message. Logs loudly so the
    // contract breakage is visible.
    logger.error('Project detector returned empty array — falling back to generic', {
      workingDirectory,
    })
    return 'generic'
  }

  if (detected.length === 1) {
    // Destructure rather than index so TS narrows `single` to `ProjectType`
    // under stricter tsconfig options (e.g. `noUncheckedIndexedAccess`).
    const [single] = detected
    return single
  }

  const overrideOptions = detected.map((t) => `'${t}'`).join(' | ')
  const message = `Polyglot repo detected (${detected.join(', ')}). Defaulting to 'generic' harness templates. Override with \`config.harness.language: ${overrideOptions}\` in your config.`
  const context = {detected, workingDirectory}

  if (polyglotWarnedPaths.has(workingDirectory)) {
    logger.debug(message, context)
  } else {
    polyglotWarnedPaths.add(workingDirectory)
    logger.warn(message, context)
  }

  return 'generic'
}

// @internal — test-only. Resets warn-once state so tests stay isolated
// without having to use distinct workingDirectory paths per case.
export function _clearPolyglotWarningState(): void {
  polyglotWarnedPaths.clear()
}
