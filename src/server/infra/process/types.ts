/**
 * Shared types for the process module (TransportHandlers, TaskRouter, ConnectionCoordinator).
 * TaskInfo moved to core domain for cross-cutting use (e.g. lifecycle hooks).
 */
export type {TaskInfo} from '../../core/domain/transport/task-info.js'
