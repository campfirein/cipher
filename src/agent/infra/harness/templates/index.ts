import type {HarnessMeta, ProjectType} from '../../../core/domain/harness/types.js'

import * as CurateGeneric from './curate/generic.js'
import * as CuratePython from './curate/python.js'
import * as CurateTypescript from './curate/typescript.js'

export interface Template {
  readonly code: string
  readonly meta: HarnessMeta
}

// Scope note: v1.0 ships `curate` templates only. `query` templates are
// parked until (a) `HarnessCapabilitySchema` gains `'query'` and
// (b) `HarnessContextTools` exposes a `query` method. Follow-up tickets
// will extend the registry additively; no existing key changes.
export type SupportedCommandType = 'curate'

const REGISTRY: Record<SupportedCommandType, Record<ProjectType, Template>> = {
  curate: {
    generic: {code: CurateGeneric.TEMPLATE_CODE, meta: CurateGeneric.TEMPLATE_META},
    python: {code: CuratePython.TEMPLATE_CODE, meta: CuratePython.TEMPLATE_META},
    typescript: {code: CurateTypescript.TEMPLATE_CODE, meta: CurateTypescript.TEMPLATE_META},
  },
}

export function getTemplate(
  commandType: SupportedCommandType,
  projectType: ProjectType,
): Template {
  const template = REGISTRY[commandType][projectType]
  if (template === undefined) {
    // Unreachable under the current type signature, but guards against
    // silent `undefined` when `SupportedCommandType` widens ahead of a
    // new template landing.
    throw new Error(`no template registered for commandType=${commandType}, projectType=${projectType}`)
  }

  return template
}
