/**
 * Core Worker - Entry point for CoreProcess when forked from main.ts
 *
 * @deprecated Use transport-worker.ts and agent-worker.ts from src/infra/process/ instead.
 * Architecture v0.5.0 uses 3-process model (Main, Transport, Agent).
 * This file is kept for backward compatibility with existing tests.
 *
 * SIMPLE: Just spawn CoreProcess, handle IPC.
 * Everything else (auth, usecases, session) is inside CoreProcess.
 */

import {ConsoleLogger} from '../cipher/logger/console-logger.js'
import {CoreProcess} from './core-process.js'

type IPCMessage = {type: 'ping'} | {type: 'shutdown'}
type IPCResponse = {error: string; type: 'error'} | {port: number; type: 'ready'} | {type: 'pong'} | {type: 'stopped'}

function sendToParent(message: IPCResponse): void {
  process.send?.(message)
}

const logger = new ConsoleLogger({verbose: false})
let core: CoreProcess | undefined

async function runWorker(): Promise<void> {
  try {
    core = new CoreProcess({
      logger,
      projectRoot: process.cwd(),
    })

    await core.start()

    const state = core.getState()
    logger.info('Core worker started', {port: state.port})
    sendToParent({port: state.port!, type: 'ready'})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Core worker failed', {error: message})
    sendToParent({error: message, type: 'error'})
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  process.on('message', async (msg: IPCMessage) => {
    if (msg.type === 'ping') {
      sendToParent({type: 'pong'})
    } else if (msg.type === 'shutdown') {
      if (core) await core.stop()
      sendToParent({type: 'stopped'})
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    }
  })

  const cleanup = async (): Promise<void> => {
    if (core) await core.stop()
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }

  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)
  process.on('disconnect', cleanup)
}

try {
  await runWorker()
} catch (error) {
  console.error('Core worker fatal:', error)
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
