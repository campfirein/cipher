/**
 * AutoHarness V2 — Prompt template tests.
 *
 * Snapshot-style tests that pin exact prompt output for fixed inputs
 * (drift catchers) plus structural assertions that verify each prompt
 * includes the required context sections. All in-memory; no LLM calls.
 */

import {expect} from 'chai'

import type {
  CodeExecOutcome,
  EvaluationScenario,
} from '../../../../src/agent/core/domain/harness/types.js'

import {buildCriticPrompt} from '../../../../src/agent/infra/harness/prompts/critic-prompt.js'
import {buildRefinerPrompt} from '../../../../src/agent/infra/harness/prompts/refiner-prompt.js'
import {TOOLS_SDK_DOCUMENTATION} from '../../../../src/agent/infra/harness/prompts/sdk-documentation.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARENT_CODE = `exports.meta = function meta() {
  return {
    capabilities: ['curate'],
    commandType: 'curate',
    projectPatterns: ['*.ts'],
    version: 1,
  }
}

exports.curate = async function curate(ctx) {
  const file = await ctx.tools.readFile('src/index.ts')
  await ctx.tools.curate([{
    path: 'project/overview',
    type: 'UPSERT',
    title: 'Overview',
    reason: 'Initial curate',
    content: { narrative: { highlights: file.content } },
  }])
  return { applied: [{ path: 'project/overview', status: 'success', type: 'UPSERT' }], summary: { added: 1, deleted: 0, failed: 0, merged: 0, updated: 0 } }
}`

function makeOutcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'exports.curate = async function() {}',
    commandType: 'curate',
    executionTimeMs: 120,
    id: `outcome-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    projectType: 'typescript',
    sessionId: 'session-1',
    success: true,
    timestamp: Date.now(),
    usedHarness: true,
    ...overrides,
  }
}

function makeScenario(overrides: Partial<EvaluationScenario> = {}): EvaluationScenario {
  return {
    code: 'exports.curate = async function(ctx) { await ctx.tools.curate([]) }',
    commandType: 'curate',
    expectedBehavior: 'Curates project files successfully',
    id: `scenario-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    projectType: 'typescript',
    taskDescription: 'Curate the project overview',
    ...overrides,
  }
}

/** 50 outcomes: 30 success, 20 failed — realistic distribution for a struggling harness. */
function makeRecentOutcomes(): CodeExecOutcome[] {
  const outcomes: CodeExecOutcome[] = []
  for (let i = 0; i < 30; i++) {
    outcomes.push(makeOutcome({id: `outcome-s-${i}`, success: true}))
  }

  for (let i = 0; i < 20; i++) {
    outcomes.push(makeOutcome({id: `outcome-f-${i}`, stderr: 'TypeError: Cannot read property', success: false}))
  }

  return outcomes
}

const CRITIC_ANALYSIS = `# Critic analysis
- Failure pattern: TypeError when reading file content
- Root cause: The harness assumes readFile always returns a non-empty content field, but some files are binary or empty
- Suggested change: Add a guard checking file.content before passing to curate operations`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Harness prompts — SDK documentation, Critic, and Refiner', () => {
  // Test 1: SDK documentation mentions required tools and ops cap
  describe('TOOLS_SDK_DOCUMENTATION', () => {
    it('mentions ctx.tools.curate, ctx.tools.readFile, and 50-ops cap', () => {
      expect(TOOLS_SDK_DOCUMENTATION).to.include('ctx.tools.curate')
      expect(TOOLS_SDK_DOCUMENTATION).to.include('ctx.tools.readFile')
      expect(TOOLS_SDK_DOCUMENTATION).to.include('50')
      // Verify it's a non-trivial documentation string
      expect(TOOLS_SDK_DOCUMENTATION.length).to.be.greaterThan(200)
    })
  })

  // Test 2: Critic prompt includes all required context sections
  describe('buildCriticPrompt', () => {
    it('includes parent code, heuristic, scenario count, and failed outcomes', () => {
      const outcomes = makeRecentOutcomes()
      const scenarios = [makeScenario(), makeScenario({expectedBehavior: 'Should fail gracefully on missing files', id: 'scenario-neg'})]

      const prompt = buildCriticPrompt({
        heuristic: 0.42,
        parentCode: PARENT_CODE,
        recentOutcomes: outcomes,
        scenarios,
      })

      // Parent code present
      expect(prompt).to.include('exports.meta')
      expect(prompt).to.include('exports.curate')
      // Heuristic value
      expect(prompt).to.include('0.42')
      // Scenario count or scenario content present
      expect(prompt).to.include('scenario')
      // At least one failed outcome's stderr surfaced as raw data
      expect(prompt).to.include('TypeError')
      // Raw outcomes show OK/FAIL status per outcome
      expect(prompt).to.include('[OK]')
      expect(prompt).to.include('[FAIL]')
    })

    // Test 3: Critic prompt ceiling — 8000 chars on reference input
    it('output does not exceed 8000 characters on reference input', () => {
      const outcomes = makeRecentOutcomes()
      const scenarios = [makeScenario(), makeScenario()]

      const prompt = buildCriticPrompt({
        heuristic: 0.42,
        parentCode: PARENT_CODE,
        recentOutcomes: outcomes,
        scenarios,
      })

      expect(prompt.length).to.be.at.most(8000)
    })
  })

  // Test 4: Refiner prompt includes all required context
  describe('buildRefinerPrompt', () => {
    it('includes parent code, critic analysis, and SDK docs', () => {
      const prompt = buildRefinerPrompt({
        criticAnalysis: CRITIC_ANALYSIS,
        parentCode: PARENT_CODE,
        projectType: 'typescript',
        sdkDocumentation: TOOLS_SDK_DOCUMENTATION,
      })

      // Parent code present
      expect(prompt).to.include('exports.meta')
      // Critic analysis present
      expect(prompt).to.include('Failure pattern')
      expect(prompt).to.include('Root cause')
      // SDK documentation present
      expect(prompt).to.include('ctx.tools.curate')
      expect(prompt).to.include('ctx.tools.readFile')
    })

    // Test 5: Refiner prompt explicitly forbids markdown fences
    it('explicitly forbids markdown fences in instructions', () => {
      const prompt = buildRefinerPrompt({
        criticAnalysis: CRITIC_ANALYSIS,
        parentCode: PARENT_CODE,
        projectType: 'typescript',
        sdkDocumentation: TOOLS_SDK_DOCUMENTATION,
      })

      // The prompt text itself must instruct the LLM not to use fences
      const lowerPrompt = prompt.toLowerCase()
      expect(lowerPrompt).to.match(/no\s+markdown|do\s+not.*markdown|without.*markdown|no.*```|do\s+not.*```|never.*```/)
    })

    // Test 7: Refiner prompt exercises each ProjectType
    it('varies output per ProjectType (typescript, python, generic)', () => {
      const baseCtx = {
        criticAnalysis: CRITIC_ANALYSIS,
        parentCode: PARENT_CODE,
        sdkDocumentation: TOOLS_SDK_DOCUMENTATION,
      }

      const tsPrompt = buildRefinerPrompt({...baseCtx, projectType: 'typescript'})
      const pyPrompt = buildRefinerPrompt({...baseCtx, projectType: 'python'})
      const genPrompt = buildRefinerPrompt({...baseCtx, projectType: 'generic'})

      // Each prompt should mention its project type
      expect(tsPrompt.toLowerCase()).to.include('typescript')
      expect(pyPrompt.toLowerCase()).to.include('python')
      expect(genPrompt.toLowerCase()).to.include('generic')

      // Prompts should differ from each other (project-type-aware)
      expect(tsPrompt).to.not.equal(pyPrompt)
      expect(tsPrompt).to.not.equal(genPrompt)
      expect(pyPrompt).to.not.equal(genPrompt)
    })
  })

  // Test 6: Snapshot — pin exact output for fixed inputs
  describe('snapshot — exact output for fixed inputs', () => {
    // Use minimal deterministic fixtures for reproducible snapshots
    const snapshotParentCode = `exports.meta = function() { return { capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1 } }
exports.curate = async function(ctx) { return { applied: [], summary: { added: 0, deleted: 0, failed: 0, merged: 0, updated: 0 } } }`

    const snapshotOutcomes: CodeExecOutcome[] = [
      {
        code: 'test',
        commandType: 'curate',
        executionTimeMs: 100,
        id: 'outcome-1',
        projectId: 'proj-1',
        projectType: 'typescript',
        sessionId: 'session-1',
        stderr: 'Error: file not found',
        success: false,
        timestamp: 1_700_000_000_000,
        usedHarness: true,
      },
      {
        code: 'test',
        commandType: 'curate',
        executionTimeMs: 50,
        id: 'outcome-2',
        projectId: 'proj-1',
        projectType: 'typescript',
        sessionId: 'session-1',
        success: true,
        timestamp: 1_700_000_000_000,
        usedHarness: true,
      },
    ]

    const snapshotScenarios: EvaluationScenario[] = [
      {
        code: 'test-code',
        commandType: 'curate',
        expectedBehavior: 'Curates successfully',
        id: 'scenario-1',
        projectId: 'proj-1',
        projectType: 'typescript',
        taskDescription: 'Curate project overview',
      },
    ]

    it('buildCriticPrompt produces stable output for fixed input', () => {
      const prompt = buildCriticPrompt({
        heuristic: 0.5,
        parentCode: snapshotParentCode,
        recentOutcomes: snapshotOutcomes,
        scenarios: snapshotScenarios,
      })

      // Snapshot will be pinned after implementation — initial run captures the output.
      // For now, assert it's a non-empty string to confirm the function works.
      expect(prompt).to.be.a('string').with.length.greaterThan(0)

      // Pin the exact output (filled after first green run)
      expect(prompt).to.equal(CRITIC_PROMPT_SNAPSHOT)
    })

    it('buildRefinerPrompt produces stable output for fixed input', () => {
      const prompt = buildRefinerPrompt({
        criticAnalysis: '- Failure pattern: file not found\n- Root cause: missing guard\n- Suggested change: add existence check',
        parentCode: snapshotParentCode,
        projectType: 'typescript',
        sdkDocumentation: TOOLS_SDK_DOCUMENTATION,
      })

      expect(prompt).to.be.a('string').with.length.greaterThan(0)

      // Pin the exact output (filled after first green run)
      expect(prompt).to.equal(REFINER_PROMPT_SNAPSHOT)
    })
  })
})

// ---------------------------------------------------------------------------
// Snapshot constants — filled after first green implementation run.
// Changing prompt wording requires updating these snapshots explicitly.
// ---------------------------------------------------------------------------

const CRITIC_PROMPT_SNAPSHOT = `You are a harness quality critic. Analyze the following harness version and its recent execution outcomes to identify the root cause of failures.

## Current harness code

\`\`\`js
exports.meta = function() { return { capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1 } }
exports.curate = async function(ctx) { return { applied: [], summary: { added: 0, deleted: 0, failed: 0, merged: 0, updated: 0 } } }
\`\`\`

## Performance

Current heuristic score (H): 0.5
Recent outcomes (2 total):
  [FAIL] curate 100ms harness=true err="Error: file not found"
  [OK] curate 50ms harness=true

## Evaluation scenarios (1 total)

  1. [curate] Curate project overview — expected: Curates successfully

## Your task

Analyze the harness code, outcomes, and scenarios above. Identify:
1. What failure pattern is most common
2. What the root cause is in the harness code
3. What structural change would fix it

Respond in exactly this format:
# Critic analysis
- Failure pattern: <short description of the most common failure>
- Root cause: <mechanism in the code causing failures>
- Suggested change: <structural hint for the Refiner — what to change, not the full code>`

const REFINER_PROMPT_SNAPSHOT = `You are a harness refiner. Your job is to produce an improved version of the harness code below, guided by the Critic's analysis and the available SDK tools.

## SDK tools reference

You are refining a curate harness that runs inside a sandboxed VM.
The only tools available to the harness function are on the \`ctx.tools\` object:

  ctx.tools.curate(operations, options?)
    Performs curate operations on the project's knowledge tree.
    Parameters:
      operations: CurateOperation[] — array of operations to apply.
        Each operation has:
          type: 'ADD' | 'UPDATE' | 'UPSERT' | 'MERGE' | 'DELETE'
          path: string — domain/topic or domain/topic/subtopic
          reason: string — why this operation is being performed
          title?: string — title for the context file
          content?: { narrative?: { highlights?, rules?, examples?, structure?, dependencies? }, rawConcept?: { task?, files?, changes?, flow?, patterns?, author?, timestamp? }, facts?: Array<{ statement, subject?, value?, category? }>, relations?: string[], snippets?: string[] }
          summary?: string — one-line semantic summary
          confidence?: 'high' | 'low'
          impact?: 'high' | 'low'
      options?: { basePath?: string }
    Returns: CurateResult — { applied: CurateOperationResult[], summary: { added, deleted, failed, merged, updated } }

  ctx.tools.readFile(filePath, options?)
    Reads a file from the project's working directory.
    Parameters:
      filePath: string — path relative to the working directory
      options?: { encoding?: BufferEncoding, offset?: number, limit?: number }
    Returns: FileContent — { content: string, formattedContent: string, lines: number, totalLines: number, size: number, truncated: boolean, encoding: string, message: string }

Constraints:
  * Must export exactly: exports.meta = function() { return HarnessMeta }; exports.curate = async function(ctx) { ... }
  * May only call ctx.tools.curate and ctx.tools.readFile — no other APIs
  * No async work except via ctx.tools.* calls
  * No setTimeout / setInterval / process / require / node: built-in modules
  * Total calls to ctx.tools.* must not exceed 50 per invocation (ops cap enforced by the sandbox)
  * The ctx.abort signal may fire at any time — long-running loops should check it

## Project context

The project type is "typescript". Source files typically use .ts/.tsx extensions. When reading project files with ctx.tools.readFile, expect TypeScript source code, package.json, tsconfig.json, and similar Node.js ecosystem files.

## Parent harness code (current version)

exports.meta = function() { return { capabilities: ['curate'], commandType: 'curate', projectPatterns: [], version: 1 } }
exports.curate = async function(ctx) { return { applied: [], summary: { added: 0, deleted: 0, failed: 0, merged: 0, updated: 0 } } }

## Critic's analysis (what to fix)

- Failure pattern: file not found
- Root cause: missing guard
- Suggested change: add existence check

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
