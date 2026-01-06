/**
 * Claude Code UserPromptSubmit Hook
 *
 * This script is invoked by Claude Code when a user submits a prompt.
 * It reads JSON from stdin, preprocesses the prompt, queries ByteRover's
 * context tree, and returns relevant context to Claude Code.
 *
 * Usage in .claude/settings.local.json:
 * {
 *   "hooks": {
 *     "UserPromptSubmit": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/this/script.js" }]
 *     }]
 *   }
 * }
 */

import {fileURLToPath} from 'node:url'

import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {HookInput} from './schemas.js'

import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {QueryUseCase} from '../../infra/usecase/query-use-case.js'
import {MAX_PROMPT_LENGTH} from '../shared/constants.js'
import {debugLog, hookErrorLog} from '../shared/debug-logger.js'
import {readStdin} from '../shared/stdin-reader.js'
import {StringCollectorTerminal} from '../shared/string-collector-terminal.js'
import {cleanXmlTags, truncatePrompt} from '../shared/text-cleaner.js'
import {HookSessionStore} from './hook-session-store.js'
import {HookInputSchema} from './schemas.js'

/**
 * Preprocess prompt: truncate first, then clean tags.
 * Truncating before regex prevents potential ReDoS on large inputs.
 *
 * @param prompt - Raw prompt to preprocess
 * @returns Cleaned and truncated prompt
 */
export const preprocessPrompt = (prompt: string): string => {
  const preTruncated = prompt.slice(0, MAX_PROMPT_LENGTH * 2)
  const cleaned = cleanXmlTags(preTruncated)
  return truncatePrompt(cleaned)
}

/**
 * Create QueryUseCase with hook-friendly terminal (same as query.ts).
 *
 * @param terminal - Terminal implementation for output
 * @returns Configured QueryUseCase instance
 */
const createQueryUseCase = (terminal: ITerminal): QueryUseCase => {
  const tokenStore = createTokenStore()
  const globalConfigStore = new FileGlobalConfigStore()
  const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

  return new QueryUseCase({
    terminal,
    trackingService,
  })
}

/**
 * Parse raw JSON input and extract the prompt.
 *
 * @param rawInput - JSON string from Claude Code stdin
 * @returns Parsed data with cleaned prompt, or undefined if:
 *   - JSON parsing fails
 *   - Prompt is empty/whitespace after XML tag cleaning
 *
 * Note: Empty prompts return undefined by design - there's nothing
 * meaningful to query from the context tree.
 */
export const parseHookInput = (rawInput: string): undefined | {cleanedPrompt: string; data: HookInput} => {
  try {
    const result = HookInputSchema.safeParse(JSON.parse(rawInput))
    if (!result.success) return undefined

    const rawPrompt = result.data.prompt ?? ''
    const cleanedPrompt = preprocessPrompt(rawPrompt)
    if (!cleanedPrompt) return undefined

    return {cleanedPrompt, data: result.data}
  } catch {
    return undefined
  }
}

/**
 * Main hook execution function.
 * 1. Reads JSON from stdin
 * 2. Parses and cleans the prompt
 * 3. Saves session info for Stop hook
 * 4. Queries context tree
 * 5. Outputs raw results to stdout
 */
const main = async (): Promise<void> => {
  debugLog('PROMPT', '=== HOOK START ===')

  const input = await readStdin()
  debugLog('PROMPT', '1. RAW INPUT', input)

  const parsed = parseHookInput(input)
  debugLog('PROMPT', '2. PARSED', parsed)

  if (!parsed) {
    debugLog('PROMPT', '3. PARSE FAILED - EXIT')
    return
  }

  const {cleanedPrompt, data} = parsed
  debugLog('PROMPT', '3. CLEANED PROMPT', cleanedPrompt)
  debugLog('PROMPT', '3. CLEANED PROMPT LENGTH', cleanedPrompt.length)

  if (data.session_id && data.transcript_path) {
    const sessionStore = new HookSessionStore()
    await sessionStore.write({
      createdAt: Date.now(),
      sessionId: data.session_id,
      timestamp: Date.now(),
      transcriptPath: data.transcript_path,
    })
    debugLog('PROMPT', '4. SESSION SAVED', data.session_id)
  }

  const terminal = new StringCollectorTerminal()
  const useCase = createQueryUseCase(terminal)
  debugLog('PROMPT', '5. CALLING QUERY USE CASE')

  try {
    await useCase.run({query: cleanedPrompt})
    debugLog('PROMPT', '6. QUERY COMPLETED')

    const output = terminal.getOutput()
    debugLog('PROMPT', '7. OUTPUT LENGTH', output.length)
    debugLog('PROMPT', '7. OUTPUT PREVIEW', output.slice(0, 500))

    if (output) {
      console.log(output)
      debugLog('PROMPT', '8. OUTPUT SENT TO STDOUT')
    }
  } catch (error) {
    debugLog('PROMPT', 'ERROR', error instanceof Error ? error.message : String(error))
  }

  debugLog('PROMPT', '=== HOOK END ===\n')
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  try {
    await main()
  } catch (error) {
    // Log errors but exit 0 to keep Claude Code IDE working
    hookErrorLog('HOOK', error instanceof Error ? error : new Error(String(error)), 'UserPromptSubmit')
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }
}
