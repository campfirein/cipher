// Stub: types driven by brv query-log view command (ENG-1897).
// Full IQueryLogStore interface will be added in ENG-1888.

// Re-export domain types — single source of truth is in the entity.
export {QUERY_LOG_STATUSES, QUERY_LOG_TIERS} from '../../domain/entities/query-log-entry.js'
export type {QueryLogStatus, QueryLogTier} from '../../domain/entities/query-log-entry.js'
