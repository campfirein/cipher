/**
 * Claude Code Stop Hook
 *
 * This script is invoked by Claude Code when the user stops/cancels execution.
 * It extracts the last assistant text response from the transcript and
 * auto-curates it to the ByteRover context tree.
 *
 * Usage in .claude/settings.local.json:
 * {
 *   "hooks": {
 *     "Stop": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/this/script.js" }]
 *     }]
 *   }
 * }
 */

import {fileURLToPath} from 'node:url'

import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {StopHookInput} from './schemas.js'

import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../../infra/usecase/curate-use-case.js'
import {debugLog, hookErrorLog} from '../shared/debug-logger.js'
import {readStdin} from '../shared/stdin-reader.js'
import {StringCollectorTerminal} from '../shared/string-collector-terminal.js'
import {HookSessionStore} from './hook-session-store.js'
import {StopHookInputSchema} from './schemas.js'
import {getLastAssistantResponse} from './transcript-parser.js'

/**
 * Create CurateUseCase with hook-friendly terminal.
 *
 * @param terminal - Terminal implementation for output
 * @returns Configured CurateUseCase instance
 */
const createCurateUseCase = (terminal: ITerminal): CurateUseCase => {
  const tokenStore = createTokenStore()
  const globalConfigStore = new FileGlobalConfigStore()
  const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

  return new CurateUseCase({
    terminal,
    trackingService,
  })
}

/**
 * Parse raw JSON input from Stop hook event.
 *
 * @param rawInput - JSON string from Claude Code stdin
 * @returns The parsed data, or undefined if parsing fails
 */
export const parseStopHookInput = (rawInput: string): StopHookInput | undefined => {
  try {
    const result = StopHookInputSchema.safeParse(JSON.parse(rawInput))
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

/**
 * Main hook execution function.
 * 1. Reads JSON from stdin
 * 2. Retrieves session info saved by UserPromptSubmit hook
 * 3. Parses transcript to extract assistant text
 * 4. Auto-curates the response to context tree
 */
const main = async (): Promise<void> => {
  debugLog('STOP', '=== STOP HOOK START ===')

  const input = await readStdin()
  debugLog('STOP', '1. RAW INPUT', input)

  const data = parseStopHookInput(input)
  debugLog('STOP', '2. PARSED DATA', data)

  if (!data || !data.session_id || !data.transcript_path) {
    debugLog('STOP', '3. MISSING DATA - EXIT')
    return
  }

  const sessionStore = new HookSessionStore()
  const session = await sessionStore.read(data.session_id)
  debugLog('STOP', '3. SESSION FROM STORE', session)

  if (!session) {
    debugLog('STOP', '4. NO SESSION FOUND - EXIT')
    return
  }

  debugLog('STOP', '4. PARSING TRANSCRIPT', data.transcript_path)
  debugLog('STOP', '4. AFTER TIMESTAMP', session.timestamp)

  const assistantText = await getLastAssistantResponse(data.transcript_path, session.timestamp)
  debugLog('STOP', '5. ASSISTANT TEXT LENGTH', assistantText?.length ?? 0)
  debugLog('STOP', '5. ASSISTANT TEXT PREVIEW', assistantText?.slice(0, 500))

  if (!assistantText) {
    debugLog('STOP', '6. NO ASSISTANT TEXT - EXIT')
    return
  }

  const terminal = new StringCollectorTerminal()
  const useCase = createCurateUseCase(terminal)
  debugLog('STOP', '6. CALLING CURATE USE CASE')

  try {
    await useCase.run({context: assistantText})
    debugLog('STOP', '7. CURATE COMPLETED')
  } catch (error) {
    debugLog('STOP', 'ERROR', error instanceof Error ? error.message : String(error))
  }

  debugLog('STOP', '=== STOP HOOK END ===\n')
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  try {
    await main()
  } catch (error) {
    // Log errors but exit 0 to keep Claude Code IDE working
    hookErrorLog('HOOK', error instanceof Error ? error : new Error(String(error)), 'Stop')
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }
}
