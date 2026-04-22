/**
 * AutoHarness V2 — SDK documentation for harness refinement prompts.
 *
 * Hand-crafted description of the v1.0 `HarnessContextTools` surface.
 * The Refiner LLM consumes this so it knows which tools are available
 * inside the sandbox VM.
 *
 * This is a string constant, not auto-generated from types. LLMs
 * understand natural-language docs better than JSON-schema output.
 * Maintenance is manual: update this when `HarnessContextTools`
 * (core/domain/harness/types.ts) changes.
 */

// Signatures reference HarnessContextTools in core/domain/harness/types.ts.
// If a new tool is added to that interface, update this documentation.
export const TOOLS_SDK_DOCUMENTATION = `You are refining a curate harness that runs inside a sandboxed VM.
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
  * The ctx.abort signal may fire at any time — long-running loops should check it`
