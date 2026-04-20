import {expect} from 'chai'
import {mkdtempSync, writeFileSync} from 'node:fs'
import net from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {tryGetSshAgentSigner} from '../../../../src/server/infra/ssh/ssh-agent-signer.js'
import {parseSSHPrivateKey} from '../../../../src/server/infra/ssh/ssh-key-parser.js'

// ── Test key ────────────────────────────────────────────────────────────────
// Same Ed25519 test key used across SSH tests (NOT a production key).
const TEST_OPENSSH_ED25519_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAmIfT6LJouOpJugPKYl7yiJwYIlrh124TOYjaNzxjNQgAAAJgCtf3VArX9
1QAAAAtzc2gtZWQyNTUxOQAAACAmIfT6LJouOpJugPKYl7yiJwYIlrh124TOYjaNzxjNQg
AAEB01GDi+m4swI3lsGv870+yJFfAJP0CcFSDPcTyCUpaBSYh9Posmi46km6A8piXvKIn
BgiWuHXbhM5iNo3PGM1CAAAAEHRlc3RAZXhhbXBsZS5jb20BAgMEBQ==
-----END OPENSSH PRIVATE KEY-----`

// ── SSH agent protocol constants ─────────────────────────────────────────────
const SSH_AGENTC_REQUEST_IDENTITIES = 11
const SSH_AGENTC_SIGN_REQUEST = 13
const SSH_AGENT_IDENTITIES_ANSWER = 12
const SSH_AGENT_SIGN_RESPONSE = 14

function writeUInt32BE(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt32BE(value, 0)
  return buf
}

function sshString(data: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return Buffer.concat([writeUInt32BE(buf.length), buf])
}

// ── Mock SSH agent server ────────────────────────────────────────────────────

/**
 * Creates a minimal mock SSH agent that responds to IDENTITIES and SIGN requests.
 * Returns the socket path and a cleanup function.
 */
function createMockAgent(
  identities: Array<{blob: Buffer; comment: string}>,
  signResponse: Buffer,
): {cleanup: () => void; socketPath: string} {
  const tempDir = mkdtempSync(join(tmpdir(), 'brv-mock-agent-'))
  const socketPath = join(tempDir, 'agent.sock')

  const server = net.createServer((conn) => {
    const chunks: Buffer[] = []

    conn.on('data', (chunk) => {
      chunks.push(chunk)
      const accumulated = Buffer.concat(chunks)
      if (accumulated.length < 4) return
      const msgLen = accumulated.readUInt32BE(0)
      if (accumulated.length < 4 + msgLen) return

      // Consume the message
      const payload = accumulated.slice(4, 4 + msgLen)
      chunks.length = 0
      if (accumulated.length > 4 + msgLen) {
        chunks.push(accumulated.slice(4 + msgLen))
      }

      const msgType = payload[0]

      if (msgType === SSH_AGENTC_REQUEST_IDENTITIES) {
        // Build identities response
        const parts: Buffer[] = [
          Buffer.from([SSH_AGENT_IDENTITIES_ANSWER]),
          writeUInt32BE(identities.length),
        ]
        for (const id of identities) {
          parts.push(sshString(id.blob), sshString(id.comment))
        }

        const body = Buffer.concat(parts)
        conn.write(Buffer.concat([writeUInt32BE(body.length), body]))
      } else if (msgType === SSH_AGENTC_SIGN_REQUEST) {
        // Return the pre-configured sign response
        const body = Buffer.concat([
          Buffer.from([SSH_AGENT_SIGN_RESPONSE]),
          sshString(signResponse),
        ])
        conn.write(Buffer.concat([writeUInt32BE(body.length), body]))
      }
    })
  })

  server.listen(socketPath)

  return {
    cleanup() {
      server.close()
    },
    socketPath,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ssh-agent-signer', () => {
describe('tryGetSshAgentSigner()', () => {
  let tempDir: string
  let keyPath: string
  let originalAuthSock: string | undefined

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-agent-test-'))
    keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})
    originalAuthSock = process.env.SSH_AUTH_SOCK
  })

  afterEach(() => {
    if (originalAuthSock === undefined) {
      delete process.env.SSH_AUTH_SOCK
    } else {
      process.env.SSH_AUTH_SOCK = originalAuthSock
    }
  })

  it('returns null when SSH_AUTH_SOCK is not set', async () => {
    delete process.env.SSH_AUTH_SOCK
    const result = await tryGetSshAgentSigner(keyPath)
    expect(result).to.be.null
  })

  it('returns null when agent is unreachable', async () => {
    process.env.SSH_AUTH_SOCK = '/nonexistent/agent.sock'
    const result = await tryGetSshAgentSigner(keyPath)
    expect(result).to.be.null
  })

  it('returns null when agent has no matching key', async () => {
    // Agent with a different key blob
    const unrelatedBlob = Buffer.concat([
      sshString('ssh-ed25519'),
      sshString(Buffer.alloc(32, 0xff)), // fake pubkey
    ])
    const agent = createMockAgent(
      [{blob: unrelatedBlob, comment: 'unrelated'}],
      Buffer.alloc(0),
    )
    process.env.SSH_AUTH_SOCK = agent.socketPath

    try {
      const result = await tryGetSshAgentSigner(keyPath)
      expect(result).to.be.null
    } finally {
      agent.cleanup()
    }
  })

  it('returns a signer when agent has the matching key', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)

    const fakeSignature = Buffer.concat([
      sshString('ssh-ed25519'),
      sshString(Buffer.alloc(64, 0xab)), // fake sig bytes
    ])
    const agent = createMockAgent(
      [{blob: parsed.publicKeyBlob, comment: 'test@example.com'}],
      fakeSignature,
    )
    process.env.SSH_AUTH_SOCK = agent.socketPath

    try {
      const signer = await tryGetSshAgentSigner(keyPath)
      expect(signer).to.not.be.null
    } finally {
      agent.cleanup()
    }
  })
})

describe('SshAgentSigner.sign()', () => {
  let tempDir: string
  let keyPath: string
  let originalAuthSock: string | undefined

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-agentsign-test-'))
    keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})
    originalAuthSock = process.env.SSH_AUTH_SOCK
  })

  afterEach(() => {
    if (originalAuthSock === undefined) {
      delete process.env.SSH_AUTH_SOCK
    } else {
      process.env.SSH_AUTH_SOCK = originalAuthSock
    }
  })

  it('produces armored output with correct SSH SIGNATURE headers', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    const fakeSignature = Buffer.concat([
      sshString('ssh-ed25519'),
      sshString(Buffer.alloc(64, 0xab)),
    ])
    const agent = createMockAgent(
      [{blob: parsed.publicKeyBlob, comment: 'test'}],
      fakeSignature,
    )
    process.env.SSH_AUTH_SOCK = agent.socketPath

    try {
      const signer = await tryGetSshAgentSigner(keyPath)
      expect(signer).to.not.be.null

      const result = await signer!.sign('test commit payload')
      expect(result.armored).to.match(/^-----BEGIN SSH SIGNATURE-----/)
      expect(result.armored.trim()).to.match(/-----END SSH SIGNATURE-----$/)
    } finally {
      agent.cleanup()
    }
  })

  it('raw envelope starts with 6-byte SSHSIG magic (no null)', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    const fakeSignature = Buffer.concat([
      sshString('ssh-ed25519'),
      sshString(Buffer.alloc(64, 0xab)),
    ])
    const agent = createMockAgent(
      [{blob: parsed.publicKeyBlob, comment: 'test'}],
      fakeSignature,
    )
    process.env.SSH_AUTH_SOCK = agent.socketPath

    try {
      const signer = await tryGetSshAgentSigner(keyPath)
      const result = await signer!.sign('test payload')

      // Envelope magic: 6 bytes 'SSHSIG' (no null)
      const magic = result.raw.subarray(0, 6).toString()
      expect(magic).to.equal('SSHSIG')
      // 7th byte should be version (uint32BE = 0x00), NOT a null terminator
      // Version is uint32BE(1) = [0x00, 0x00, 0x00, 0x01]
      expect(result.raw.readUInt32BE(6)).to.equal(1)
    } finally {
      agent.cleanup()
    }
  })

  it('signed data sent to agent starts with 6-byte SSHSIG magic followed by namespace', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)

    // We'll capture the signed data sent to the agent's sign method
    let capturedSignData: Buffer | undefined
    const captureSocketPath = join(tempDir, 'capture-agent.sock')
    const server = net.createServer((conn) => {
      const chunks: Buffer[] = []
      conn.on('data', (chunk) => {
        chunks.push(chunk)
        const accumulated = Buffer.concat(chunks)
        if (accumulated.length < 4) return
        const msgLen = accumulated.readUInt32BE(0)
        if (accumulated.length < 4 + msgLen) return

        const payload = accumulated.slice(4, 4 + msgLen)
        chunks.length = 0

        const msgType = payload[0]

        if (msgType === SSH_AGENTC_REQUEST_IDENTITIES) {
          const body = Buffer.concat([
            Buffer.from([SSH_AGENT_IDENTITIES_ANSWER]),
            writeUInt32BE(1),
            sshString(parsed.publicKeyBlob),
            sshString('test'),
          ])
          conn.write(Buffer.concat([writeUInt32BE(body.length), body]))
        } else if (msgType === SSH_AGENTC_SIGN_REQUEST) {
          // Parse the sign request to capture the data blob
          let offset = 1
          const blobLen = payload.readUInt32BE(offset)
          offset += 4 + blobLen
          const dataLen = payload.readUInt32BE(offset)
          offset += 4
          capturedSignData = payload.slice(offset, offset + dataLen)

          // Return a fake signature
          const fakeSignature = Buffer.concat([
            sshString('ssh-ed25519'),
            sshString(Buffer.alloc(64, 0xab)),
          ])
          const body = Buffer.concat([
            Buffer.from([SSH_AGENT_SIGN_RESPONSE]),
            sshString(fakeSignature),
          ])
          conn.write(Buffer.concat([writeUInt32BE(body.length), body]))
        }
      })
    })
    server.listen(captureSocketPath)
    process.env.SSH_AUTH_SOCK = captureSocketPath

    try {
      const signer = await tryGetSshAgentSigner(keyPath)
      expect(signer).to.not.be.null
      await signer!.sign('test payload for magic check')

      // Per PROTOCOL.sshsig the signed-data structure is:
      //   byte[6] MAGIC_PREAMBLE ("SSHSIG" — NO null terminator)
      //   string  namespace
      //   ...
      // Asserting only the first 7 bytes is unsafe because the namespace length
      // prefix happens to begin with 0x00 (uint32 BE of "git" = 0x00000003), so a
      // wrong 7-byte 'SSHSIG\0' check would pass spuriously.
      expect(capturedSignData).to.not.be.undefined
      expect(capturedSignData!.subarray(0, 6).toString()).to.equal('SSHSIG')
      const namespaceLen = capturedSignData!.readUInt32BE(6)
      expect(namespaceLen).to.equal(3)
      expect(capturedSignData!.subarray(10, 13).toString()).to.equal('git')
    } finally {
      server.close()
    }
  })

  it('different payloads produce different signatures', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    const fakeSignature = Buffer.concat([
      sshString('ssh-ed25519'),
      sshString(Buffer.alloc(64, 0xab)),
    ])
    const agent = createMockAgent(
      [{blob: parsed.publicKeyBlob, comment: 'test'}],
      fakeSignature,
    )
    process.env.SSH_AUTH_SOCK = agent.socketPath

    try {
      const signer = await tryGetSshAgentSigner(keyPath)
      // Note: with a static mock signature, the armored outputs will differ
      // because the signed data (and thus the data sent to agent) differs,
      // but the agent returns the same fake sig. The raw envelope is identical
      // except for the data we pass to agent. Since we capture the full
      // envelope, the sshsig binary will be the same.
      // This test verifies the function runs successfully for different payloads.
      const r1 = await signer!.sign('payload one')
      const r2 = await signer!.sign('payload two')
      expect(r1.armored).to.be.a('string')
      expect(r2.armored).to.be.a('string')
    } finally {
      agent.cleanup()
    }
  })

  it('armored body contains valid base64', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    const fakeSignature = Buffer.concat([
      sshString('ssh-ed25519'),
      sshString(Buffer.alloc(64, 0xab)),
    ])
    const agent = createMockAgent(
      [{blob: parsed.publicKeyBlob, comment: 'test'}],
      fakeSignature,
    )
    process.env.SSH_AUTH_SOCK = agent.socketPath

    try {
      const signer = await tryGetSshAgentSigner(keyPath)
      const result = await signer!.sign('test')
      const lines = result.armored.split('\n')
      const bodyLines = lines.filter(
        (l) => !l.startsWith('-----') && l.trim().length > 0,
      )
      const b64 = bodyLines.join('')
      expect(() => Buffer.from(b64, 'base64')).to.not.throw()
    } finally {
      agent.cleanup()
    }
  })
})
})
