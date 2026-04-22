/**
 * AutoHarness V2 — Refiner prompt builder.
 *
 * The Refiner LLM produces a complete replacement harness code
 * string based on the Critic's analysis, the parent code, and
 * the SDK documentation. Its output goes directly to
 * `HarnessModuleBuilder.build` — no intermediate parsing.
 *
 * The prompt explicitly forbids markdown fences because the
 * module builder does not strip them. Weak models that still
 * emit fences are handled by a fallback in the Synthesizer
 * (not here).
 */

import type {ProjectType} from '../../../core/domain/harness/types.js'

// ---------------------------------------------------------------------------
// Project-type hints — language-aware guidance for the Refiner
// ---------------------------------------------------------------------------

const PROJECT_TYPE_HINTS: Record<ProjectType, string> = {
  generic: `The project type is "generic" (mixed or unknown language). The harness reads project files of any type — do not assume file extensions or language-specific patterns. Keep file-reading logic flexible.`,
  python: `The project type is "python". Source files typically use .py extensions. When reading project files with ctx.tools.readFile, expect Python source code, requirements.txt, pyproject.toml, and similar Python ecosystem files.`,
  typescript: `The project type is "typescript". Source files typically use .ts/.tsx extensions. When reading project files with ctx.tools.readFile, expect TypeScript source code, package.json, tsconfig.json, and similar Node.js ecosystem files.`,
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RefinerPromptContext {
  readonly criticAnalysis: string
  readonly parentCode: string
  readonly projectType: ProjectType
  readonly sdkDocumentation: string
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildRefinerPrompt(ctx: RefinerPromptContext): string {
  return `You are a harness refiner. Your job is to produce an improved version of the harness code below, guided by the Critic's analysis and the available SDK tools.

## SDK tools reference

${ctx.sdkDocumentation}

## Project context

${PROJECT_TYPE_HINTS[ctx.projectType]}

## Parent harness code (current version)

${ctx.parentCode}

## Critic's analysis (what to fix)

${ctx.criticAnalysis}

## Output requirements

Produce the COMPLETE replacement harness code as a single string. The code must:

1. Export \`exports.meta\` as a function returning a HarnessMeta object
2. Export \`exports.curate\` as an async function taking \`ctx\` and returning a CurateResult
3. Preserve \`version: 1\` in the meta return value (version bumps are handled externally)
4. Only use \`ctx.tools.curate\` and \`ctx.tools.readFile\` — no other APIs
5. Contain no \`require()\`, \`import\`, \`setTimeout\`, \`setInterval\`, or \`process\` calls
6. Stay within the 50-operation cap on ctx.tools.* calls

CRITICAL: Return ONLY the raw JavaScript code. Do NOT wrap it in markdown code fences (\`\`\`). Do NOT include any prose, explanation, or commentary before or after the code. The output is fed directly to a JavaScript parser — any non-code content will cause a syntax error.

Begin your response with \`exports.meta\` — nothing else before it.`
}
