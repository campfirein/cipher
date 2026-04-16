import {expect} from 'chai'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {parseSSHPrivateKey, probeSSHKey, resolveHome} from '../../../../src/server/infra/ssh/ssh-key-parser.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

function writeU32(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt32BE(value, 0)
  return buf
}

/**
 * A real Ed25519 private key in OpenSSH native format (unencrypted).
 * Generated with: ssh-keygen -t ed25519 -f /tmp/brv_test_key -N "" -C "test@example.com"
 * This key is used ONLY for unit testing — never for any real credentials.
 * Fingerprint: SHA256:R573at4sJuUgWnT+H8ivsX1khl0dKCW9KzJwDz00nmg
 */
const TEST_OPENSSH_ED25519_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAmIfT6LJouOpJugPKYl7yiJwYIlrh124TOYjaNzxjNQgAAAJgCtf3VArX9
1QAAAAtzc2gtZWQyNTUxOQAAACAmIfT6LJouOpJugPKYl7yiJwYIlrh124TOYjaNzxjNQg
AAEB01GDi+m4swI3lsGv870+yJFfAJP0CcFSDPcTyCUpaBSYh9Posmi46km6A8piXvKIn
BgiWuHXbhM5iNo3PGM1CAAAAEHRlc3RAZXhhbXBsZS5jb20BAgMEBQ==
-----END OPENSSH PRIVATE KEY-----`

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ssh-key-parser', () => {
describe('probeSSHKey()', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-ssh-test-'))
  })

  it('returns {exists: false} for non-existent file', async () => {
    const result = await probeSSHKey(join(tempDir, 'missing_key'))
    expect(result).to.deep.equal({exists: false})
  })

  it('returns {exists: true, needsPassphrase: false} for unencrypted OpenSSH key', async () => {
    const keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})
    const result = await probeSSHKey(keyPath)
    expect(result.exists).to.be.true
    if (!result.exists) throw new Error('unreachable')
    expect(result.needsPassphrase).to.be.false
  })

  it('returns {exists: true, needsPassphrase: true} for encrypted OpenSSH key', async () => {
    // Construct a minimal OpenSSH key with cipherName = 'aes256-ctr' to simulate encrypted key.
    // Must include a valid public key blob + private key blob so parseOpenSSHKey doesn't crash.
    const sshStr = (s: Buffer | string) => {
      const b = Buffer.isBuffer(s) ? s : Buffer.from(s)
      return Buffer.concat([writeU32(b.length), b])
    }

    const pubBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(Buffer.alloc(32, 0xaa))])

    const buf = Buffer.concat([
      Buffer.from('openssh-key-v1\0', 'binary'),  // magic
      sshStr('aes256-ctr'),                        // ciphername
      sshStr('bcrypt'),                            // kdfname
      sshStr(Buffer.alloc(0)),                     // kdfoptions (empty)
      writeU32(1),                                 // nkeys = 1
      sshStr(pubBlob),                             // public key blob
      sshStr(Buffer.alloc(64, 0xbb)),              // private key blob (encrypted placeholder)
    ])
    const b64 = buf.toString('base64')
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----`

    const keyPath = join(tempDir, 'id_ed25519_enc')
    writeFileSync(keyPath, pem, {mode: 0o600})

    const result = await probeSSHKey(keyPath)
    expect(result.exists).to.be.true
    if (!result.exists) throw new Error('unreachable')
    expect(result.needsPassphrase).to.be.true
  })
})

// ── parseSSHPrivateKey tests ──────────────────────────────────────────────────

describe('parseSSHPrivateKey()', () => {
  let tempDir: string
  let keyPath: string

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-ssh-parse-test-'))
    keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})
  })

  it('returns a ParsedSSHKey with correct shape', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)

    expect(parsed).to.have.keys(['fingerprint', 'keyType', 'privateKeyObject', 'publicKeyBlob'])
  })

  it('keyType is ssh-ed25519', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    expect(parsed.keyType).to.equal('ssh-ed25519')
  })

  it('fingerprint is SHA256:... format', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    expect(parsed.fingerprint).to.match(/^SHA256:[A-Za-z0-9+/]+$/)
  })

  it('publicKeyBlob starts with ssh-ed25519 keytype string (SSH wire format)', async () => {
    const parsed = await parseSSHPrivateKey(keyPath)
    // First 4 bytes = length of "ssh-ed25519" = 11
    const len = parsed.publicKeyBlob.readUInt32BE(0)
    const keyType = parsed.publicKeyBlob.subarray(4, 4 + len).toString()
    expect(keyType).to.equal('ssh-ed25519')
  })

  it('privateKeyObject is a valid KeyObject that can sign', async () => {
    const {sign} = await import('node:crypto')
    const parsed = await parseSSHPrivateKey(keyPath)

    // Ed25519 uses sign(null, data, key) — algorithm is implicit
    const sig = sign(null, Buffer.from('test payload'), parsed.privateKeyObject)
    expect(sig).to.be.instanceOf(Buffer)
    expect(sig.length).to.be.greaterThan(0)
  })

  it('throws for missing file', async () => {
    let threw = false
    try {
      await parseSSHPrivateKey('/nonexistent/key')
    } catch {
      threw = true
    }

    expect(threw).to.be.true
  })
})

// ── resolveHome tests ─────────────────────────────────────────────────────────

describe('resolveHome()', () => {
  it('replaces leading ~ with HOME', () => {
    const home = process.env.HOME ?? '/home/user'
    const result = resolveHome('~/.ssh/id_ed25519')
    expect(result).to.equal(`${home}/.ssh/id_ed25519`)
  })

  it('replaces bare ~ with HOME', () => {
    const home = process.env.HOME ?? '/home/user'
    const result = resolveHome('~')
    expect(result).to.equal(home)
  })

  it('does not modify absolute paths', () => {
    const result = resolveHome('/home/user/.ssh/id_ed25519')
    expect(result).to.equal('/home/user/.ssh/id_ed25519')
  })

  it('does not modify relative paths', () => {
    const result = resolveHome('keys/id_ed25519')
    expect(result).to.equal('keys/id_ed25519')
  })
})
})
