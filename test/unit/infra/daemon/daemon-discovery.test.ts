import {expect} from 'chai'
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {DAEMON_INSTANCE_FILE} from '../../../../src/server/constants.js'
import {discoverDaemon} from '../../../../src/server/infra/daemon/daemon-discovery.js'

describe('discoverDaemon', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-daemon-discovery-test-')))
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should return no_instance when instance.json does not exist', () => {
    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('no_instance')
    }
  })

  it('should return pid_dead with pid when PID in instance.json is not alive', () => {
    const deadPid = 999_999_999
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: deadPid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
    )

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('pid_dead')
      if (result.reason === 'pid_dead') {
        expect(result.pid).to.equal(deadPid)
      }
    }
  })

  it('should return heartbeat_stale with pid when heartbeat file is missing', () => {
    // Current process PID is alive, but no heartbeat file
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
    )

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('heartbeat_stale')
      if (result.reason === 'heartbeat_stale') {
        expect(result.pid).to.equal(process.pid)
      }
    }
  })

  it('should return heartbeat_stale with pid when heartbeat is older than threshold', () => {
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
    )
    // Write a heartbeat 20s in the past (threshold is 15s)
    writeFileSync(join(testDir, 'heartbeat'), String(Date.now() - 20_000))

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('heartbeat_stale')
      if (result.reason === 'heartbeat_stale') {
        expect(result.pid).to.equal(process.pid)
      }
    }
  })

  it('should return running when instance is valid, PID alive, and heartbeat fresh', () => {
    const port = 37_847
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: process.pid, port, startedAt: Date.now(), version: '1.6.0'}),
    )
    writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.true
    if (result.running) {
      expect(result.pid).to.equal(process.pid)
      expect(result.port).to.equal(port)
    }
  })

  it('should return no_instance when instance.json has invalid JSON', () => {
    writeFileSync(join(testDir, DAEMON_INSTANCE_FILE), 'not valid json{{{')

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('no_instance')
    }
  })

  it('should return no_instance when instance.json has invalid schema', () => {
    writeFileSync(join(testDir, DAEMON_INSTANCE_FILE), JSON.stringify({foo: 'bar'}))

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('no_instance')
    }
  })

  it('should return version_mismatch when expectedVersion differs from daemon version', () => {
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.5.0'}),
    )
    writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))

    const result = discoverDaemon({dataDir: testDir, expectedVersion: '1.6.0'})

    expect(result.running).to.be.false
    if (!result.running) {
      expect(result.reason).to.equal('version_mismatch')
      if (result.reason === 'version_mismatch') {
        expect(result.pid).to.equal(process.pid)
      }
    }
  })

  it('should return running when expectedVersion matches daemon version', () => {
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
    )
    writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))

    const result = discoverDaemon({dataDir: testDir, expectedVersion: '1.6.0'})

    expect(result.running).to.be.true
    if (result.running) {
      expect(result.pid).to.equal(process.pid)
      expect(result.port).to.equal(37_847)
    }
  })

  it('should skip version check when expectedVersion is not provided', () => {
    writeFileSync(
      join(testDir, DAEMON_INSTANCE_FILE),
      JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.5.0'}),
    )
    writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))

    const result = discoverDaemon({dataDir: testDir})

    expect(result.running).to.be.true
  })
})
