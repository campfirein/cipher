import {expect} from 'chai'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {parseSSHPrivateKey} from '../../../../src/server/infra/ssh/ssh-key-parser.js'
import {signCommitPayload} from '../../../../src/server/infra/ssh/sshsig-signer.js'

/**
 * Real Ed25519 key for testing — NOT a production key.
 * Generated with: ssh-keygen -t ed25519 -f /tmp/brv_test_key -N "" -C "test@example.com"
 * Fingerprint: SHA256:R573at4sJuUgWnT+H8ivsX1khl0dKCW9KzJwDz00nmg
 */
const TEST_OPENSSH_ED25519_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAmIfT6LJouOpJugPKYl7yiJwYIlrh124TOYjaNzxjNQgAAAJgCtf3VArX9
1QAAAAtzc2gtZWQyNTUxOQAAACAmIfT6LJouOpJugPKYl7yiJwYIlrh124TOYjaNzxjNQg
AAEB01GDi+m4swI3lsGv870+yJFfAJP0CcFSDPcTyCUpaBSYh9Posmi46km6A8piXvKIn
BgiWuHXbhM5iNo3PGM1CAAAAEHRlc3RAZXhhbXBsZS5jb20BAgMEBQ==
-----END OPENSSH PRIVATE KEY-----`

describe('signCommitPayload()', () => {
  let tempDir: string
  let keyPath: string

  // Helper: parse key once and reuse across tests
  let parsedKey: Awaited<ReturnType<typeof parseSSHPrivateKey>>

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-sshsig-test-'))
    keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})
    parsedKey = await parseSSHPrivateKey(keyPath)
  })

  it('returns an SSHSignatureResult with armored and raw fields', async () => {
    const result = signCommitPayload('tree abc123\nauthor Test\n\ninitial commit\n', parsedKey)
    expect(result).to.have.keys(['armored', 'raw'])
  })

  it('armored signature starts with -----BEGIN SSH SIGNATURE-----', async () => {
    const result = signCommitPayload('test payload', parsedKey)
    expect(result.armored).to.match(/^-----BEGIN SSH SIGNATURE-----/)
  })

  it('armored signature ends with -----END SSH SIGNATURE-----', async () => {
    const result = signCommitPayload('test payload', parsedKey)
    expect(result.armored.trim()).to.match(/-----END SSH SIGNATURE-----$/)
  })

  it('raw buffer starts with SSHSIG magic (6 bytes)', async () => {
    const result = signCommitPayload('test payload', parsedKey)
    const magic = result.raw.subarray(0, 6).toString()
    expect(magic).to.equal('SSHSIG')
  })

  it('different payloads produce different signatures', async () => {
    const r1 = signCommitPayload('payload one', parsedKey)
    const r2 = signCommitPayload('payload two', parsedKey)
    expect(r1.armored).to.not.equal(r2.armored)
  })

  it('produces a valid base64 body in the armored output', async () => {
    const result = signCommitPayload('test', parsedKey)
    const lines = result.armored.split('\n')
    // Remove BEGIN/END headers and join
    const bodyLines = lines.filter(
      (l) => !l.startsWith('-----') && l.trim().length > 0,
    )
    const b64 = bodyLines.join('')
    // Valid base64 should be decodable
    expect(() => Buffer.from(b64, 'base64')).to.not.throw()
  })

  it('raw buffer is a Buffer', async () => {
    const result = signCommitPayload('test', parsedKey)
    expect(result.raw).to.be.instanceOf(Buffer)
  })
})
