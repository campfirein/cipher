// CommonJS-in-string template body per phase_3_4_handoff.md §C7.
// v1.0 placeholder: `ctx.tools.curate(ctx.env)` — real adapter shape decided by Task 4.2.
import type {HarnessMeta} from '../../../../core/domain/harness/types.js'

export const TEMPLATE_CODE = `
exports.meta = function meta() {
  return {
    capabilities: ['curate'],
    commandType: 'curate',
    projectPatterns: ['**/*.ts', '**/*.tsx', 'tsconfig.json'],
    version: 1,
  }
}

exports.curate = async function curate(ctx) {
  return ctx.tools.curate(ctx.env)
}
`

export const TEMPLATE_META: HarnessMeta = {
  capabilities: ['curate'],
  commandType: 'curate',
  projectPatterns: ['**/*.ts', '**/*.tsx', 'tsconfig.json'],
  version: 1,
}
