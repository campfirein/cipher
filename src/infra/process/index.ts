/**
 * Process module exports.
 *
 * Architecture v0.5.0:
 * - ProcessManager: Spawns and manages Transport and Agent processes
 * - transport-worker.ts: Transport Process entry point
 * - agent-worker.ts: Agent Process entry point
 * - TransportHandlers: Message routing in Transport Process
 */

export {disposeProcessManager, getProcessManager, ProcessManager} from './process-manager.js'
export type {ProcessManagerConfig, ProcessState} from './process-manager.js'

export {TransportHandlers} from './transport-handlers.js'
