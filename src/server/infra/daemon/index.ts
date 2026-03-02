// Daemon infrastructure — classes and utilities for the daemon process.
// For interfaces (IDaemonResilience, etc.), use core/interfaces/daemon/
// brv-server.ts is excluded — it's a process entry point, not a library.
//
// Daemon lifecycle (connectToDaemon, ensureDaemonRunning, discoverDaemon,
// GlobalInstanceManager, SpawnLock) has moved to @campfirein/brv-transport-client.
export * from './daemon-resilience.js'
export * from './heartbeat.js'
export * from './idle-timeout-policy.js'
export * from './port-selector.js'
export * from './shutdown-handler.js'
