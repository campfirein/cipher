/**
 * BRV-208 — TypeScript companion to `mock-acp-server.mjs`.
 *
 * The spawnable bin lives in the `.mjs` file (plain ESM JS) because the
 * SDK's Web-stream typings trip a Node lib type mismatch under
 * `ts-node/esm`. This module exists as the typed surface that Phase 2's
 * ACP-driver tests will import (when they need to inspect / mutate the
 * `MockAcpAgent` class in-process rather than spawn it).
 *
 * Phase 1 ships only the `.mjs` fixture; the `MockAcpAgent` class itself
 * is intentionally not exported here — Phase 2 can either:
 *  - Spawn the fixture and connect over stdio (production path), or
 *  - Refactor the .mjs into a class + entry split, making the class
 *    importable from this `.ts` once the type mismatch is resolved.
 */

export const MOCK_ACP_FIXTURE_BIN = 'test/helpers/mock-acp-server.mjs' as const
