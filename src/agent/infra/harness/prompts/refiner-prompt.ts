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
 *
 * Dynamic sections (parentCode, criticAnalysis) are capped so
 * the static scaffolding (SDK docs, output requirements) is
 * never amputated on weak models with small context windows.
 */

import type {ProjectType} from '../../../core/domain/harness/types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters for the parent code section. */
const MAX_PARENT_CODE_LENGTH = 3000

/** Maximum characters for the critic analysis section. */
const MAX_CRITIC_ANALYSIS_LENGTH = 1000

// ---------------------------------------------------------------------------
// Project-type hints — language-aware guidance for the Refiner
// ---------------------------------------------------------------------------

const PROJECT_TYPE_HINTS: Record<ProjectType, string> = {
  generic: `The project type is "generic" (mixed or unknown language). The harness reads project files of any type — do not assume file extensions or language-specific patterns. Keep file-reading logic flexible.`,
  python: `The project type is "python". Source files typically use .py extensions. When reading project files with ctx.tools.readFile, expect Python source code, requirements.txt, pyproject.toml, and similar Python ecosystem files.`,
  typescript: `The project type is "typescript". Source files typically use .ts/.tsx extensions. When reading project files with ctx.tools.readFile, expect TypeScript source code, package.json, tsconfig.json, and similar Node.js ecosystem files.`,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 30) + '\n... [truncated for brevity]'
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
  const parentCodeSection = truncate(ctx.parentCode, MAX_PARENT_CODE_LENGTH)
  const criticSection = truncate(ctx.criticAnalysis, MAX_CRITIC_ANALYSIS_LENGTH)

  return `You are a harness refiner. Your job is to produce an improved version of the harness code below, guided by the Critic's analysis and the available SDK tools.

## SDK tools reference

${ctx.sdkDocumentation}

## Project context

${PROJECT_TYPE_HINTS[ctx.projectType]}

## Parent harness code (current version)

${parentCodeSection}

## Critic's analysis (what to fix)

${criticSection}

## Output requirements

Produce the COMPLETE replacement harness code as a single string. The code must:

1. Export \`exports.meta\` as a function returning a HarnessMeta object
2. Export the appropriate handler function (\`exports.curate\` or \`exports.query\`) matching the harness's declared commandType
3. Preserve \`version: 1\` in the meta return value (version bumps are handled externally)
4. Only use \`ctx.tools.curate\` and \`ctx.tools.readFile\` — no other APIs
5. Contain no \`require()\`, \`import\`, \`setTimeout\`, \`setInterval\`, or \`process\` calls
6. Stay within the 50-operation cap on ctx.tools.* calls

CRITICAL: Return ONLY the raw JavaScript code. Do NOT wrap it in markdown code fences (\`\`\`). Do NOT include any prose, explanation, or commentary before or after the code. The output is fed directly to a JavaScript parser — any non-code content will cause a syntax error.

Begin your response with \`exports.meta\` — nothing else before it.`
}
