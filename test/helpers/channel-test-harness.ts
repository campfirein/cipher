/**
 * ChannelTestHarness — daemon boot + oclif runner for Phase 1 integration tests.
 *
 * STATUS: STUB. The shape is locked in Slice 1.1 so the failing happy-path
 * integration test compiles; the runtime is filled in across Slices 1.4 (when
 * the channel orchestrator + handler exist) and 1.5 (when oclif channel
 * commands exist). Until then, `boot()` and `run()` throw to surface the red
 * signal each subsequent slice turns green.
 *
 * Consumers (see test/integration/channel-phase1-*.test.ts):
 *
 *   const projectDir = await makeTempContextTree()
 *   const harness = await ChannelTestHarness.boot({ projectDir })
 *   try {
 *     const result = await harness.run('channel new pi-test')
 *     // result.exitCode === 0
 *     // result.stdout / result.stderr available
 *
 *     // Auth-rejection canary: point at an orphan BRV_DATA_DIR.
 *     const orphan = await makeTempDir()
 *     const denied = await harness.run('channel new should-fail', { env: { BRV_DATA_DIR: orphan } })
 *     // denied.exitCode !== 0; denied.stderr matches /CHANNEL_UNAUTHORIZED|DAEMON_NOT_INITIALISED/
 *   } finally {
 *     await harness.shutdown()
 *   }
 *
 * Slice 1.4 / 1.5 will replace the stub with one of:
 *   (a) In-process: boot SocketIOTransportServer + register channel-handler,
 *       run oclif commands via @oclif/core's Config.runCommand against a
 *       daemon-client pointed at the in-process server.
 *   (b) Subprocess: spawn ./bin/dev.js for daemon and each command (slower,
 *       more realistic). Fallback per IMPLEMENTATION_PHASE_1.md §1.1 Risks.
 */

export type ChannelTestHarnessBootOptions = {
  readonly projectDir: string
}

export type ChannelTestHarnessRunOptions = {
  readonly env?: Readonly<Record<string, string>>
}

export type ChannelTestHarnessRunResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

const NOT_IMPLEMENTED =
  'ChannelTestHarness is a Slice 1.1 stub. Runtime lands in Slices 1.4 (handler) and 1.5 (oclif). ' +
  'See plan/channel-protocol/IMPLEMENTATION_PHASE_1.md for the schedule.'

export class ChannelTestHarness {
  private constructor(
    public readonly projectDir: string,
  ) {}

  static async boot(_options: ChannelTestHarnessBootOptions): Promise<ChannelTestHarness> {
    throw new Error(NOT_IMPLEMENTED)
  }

  async run(_args: string, _options?: ChannelTestHarnessRunOptions): Promise<ChannelTestHarnessRunResult> {
    throw new Error(NOT_IMPLEMENTED)
  }

  async shutdown(): Promise<void> {
    // No-op until boot() has a runtime; the stub never holds resources.
  }

  /**
   * Crash-recovery fault injection: deletes the `turn.json` snapshot for the
   * given (channel, turn) so the reader is forced to replay `events.jsonl`.
   * Implementation lands in Slice 1.3 (storage) — path resolution uses the
   * canonical layout under `<projectDir>/.brv/context-tree/channel/<id>/`.
   */
  async simulateSnapshotLoss(_channelId: string, _turnId: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED)
  }
}

/**
 * Parse JSON from a command's stdout. Throws with the raw output included in
 * the error message when parsing fails, so test failures are debuggable
 * without an extra round-trip.
 */
export const parseJson = <T = unknown>(stdout: string): T => {
  try {
    return JSON.parse(stdout) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse JSON from stdout: ${message}\n---stdout---\n${stdout}\n---end---`)
  }
}
