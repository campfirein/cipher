import {join} from 'node:path'

import type {ProjectType} from '../../core/domain/harness/types.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'

/**
 * AutoHarness V2 Phase 4 Task 4.1 — project type detector.
 *
 * Pure async function consumed by `HarnessBootstrap` (Task 4.2) to decide
 * which template to materialize for a newly-bootstrapped project. Polyglot
 * fallback (choosing between detected types, config override) is Task 4.4;
 * this function returns evidence only.
 */

export interface DetectResult {
  readonly detected: readonly ProjectType[]
}

export async function detectProjectType(
  workingDirectory: string,
  fileSystem: IFileSystem,
): Promise<DetectResult> {
  const [hasTsconfig, packageJsonHasTs, hasPyproject, hasSetupPy, hasSetupCfg] = await Promise.all([
    fileExists(fileSystem, join(workingDirectory, 'tsconfig.json')),
    packageJsonDeclaresTypeScript(fileSystem, join(workingDirectory, 'package.json')),
    fileExists(fileSystem, join(workingDirectory, 'pyproject.toml')),
    fileExists(fileSystem, join(workingDirectory, 'setup.py')),
    fileExists(fileSystem, join(workingDirectory, 'setup.cfg')),
  ])

  const detected: ProjectType[] = []
  if (hasTsconfig || packageJsonHasTs) detected.push('typescript')
  if (hasPyproject || hasSetupPy || hasSetupCfg) detected.push('python')

  if (detected.length === 0) return {detected: ['generic']}
  return {detected}
}

async function fileExists(fileSystem: IFileSystem, filePath: string): Promise<boolean> {
  try {
    await fileSystem.readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function packageJsonDeclaresTypeScript(
  fileSystem: IFileSystem,
  packageJsonPath: string,
): Promise<boolean> {
  let content: string
  try {
    const result = await fileSystem.readFile(packageJsonPath)
    content = result.content
  } catch {
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return false
  }

  if (typeof parsed !== 'object' || parsed === null) return false
  const pkg = parsed as {dependencies?: unknown; devDependencies?: unknown}
  return hasTypeScriptEntry(pkg.dependencies) || hasTypeScriptEntry(pkg.devDependencies)
}

function hasTypeScriptEntry(deps: unknown): boolean {
  if (typeof deps !== 'object' || deps === null) return false
  return Object.hasOwn(deps, 'typescript')
}
