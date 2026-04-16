import {expect} from 'chai'
import {createHash, verify as cryptoVerify, generateKeyPairSync} from 'node:crypto'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ParsedSSHKey} from '../../../../src/server/infra/ssh/types.js'

import {parseSSHPrivateKey} from '../../../../src/server/infra/ssh/ssh-key-parser.js'
import {signCommitPayload} from '../../../../src/server/infra/ssh/sshsig-signer.js'

/** Parse an SSH wire-format length-prefixed string from a buffer. Returns [value, nextOffset]. */
function readSSHString(buf: Buffer, offset: number): [Buffer, number] {
  const len = buf.readUInt32BE(offset)
  return [buf.subarray(offset + 4, offset + 4 + len), offset + 4 + len]
}

/**
 * Extract the signature blob key-type string and raw signature bytes from
 * an armored sshsig output. Returns {keyType, rawSig}.
 */
function extractSigFromArmored(armored: string): {keyType: string; rawSig: Buffer} {
  const lines = armored.split('\n')
  const b64 = lines.filter((l) => !l.startsWith('-----') && l.trim().length > 0).join('')
  const raw = Buffer.from(b64, 'base64')

  // Envelope layout (all length-prefixed SSH strings):
  // 'SSHSIG' (6 bytes) + version uint32 (4 bytes) + pubkey + namespace + reserved + hash-algo + sig-blob
  let offset = 10 // skip magic (6) + version (4)
  ;[, offset] = readSSHString(raw, offset) // pubkey
  ;[, offset] = readSSHString(raw, offset) // namespace
  ;[, offset] = readSSHString(raw, offset) // reserved
  ;[, offset] = readSSHString(raw, offset) // hash-algo
  const [sigBlob] = readSSHString(raw, offset) // signature blob

  // Signature blob: string(key-type) + string(raw-sig)
  const [keyTypeBuf, afterKeyType] = readSSHString(sigBlob, 0)
  const [rawSig] = readSSHString(sigBlob, afterKeyType)
  return {keyType: keyTypeBuf.toString(), rawSig}
}

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

  describe('with RSA key', () => {
    let rsaKey: ParsedSSHKey

    before(() => {
      const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048})
      // publicKeyBlob is used for embedding in the envelope only — a placeholder is fine
      rsaKey = {
        fingerprint: 'SHA256:placeholder',
        keyType: 'ssh-rsa',
        privateKeyObject: privateKey,
        publicKeyBlob: Buffer.alloc(0),
      }
    })

  it('signature blob key-type is rsa-sha2-512 (not ssh-rsa)', () => {
    const result = signCommitPayload('test payload', rsaKey)
    const {keyType} = extractSigFromArmored(result.armored)
    expect(keyType).to.equal('rsa-sha2-512')
  })

  it('RSA signature is verifiable with sha512 algorithm', async () => {
    const payload = 'tree abc\nauthor Test\n\ncommit message\n'
    const result = signCommitPayload(payload, rsaKey)
    const {rawSig} = extractSigFromArmored(result.armored)

    // Reconstruct signed data (same structure sshsig-signer builds internally)
    function sshString(data: Buffer | string): Buffer {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
      const lenBuf = Buffer.allocUnsafe(4)
      lenBuf.writeUInt32BE(buf.length, 0)
      return Buffer.concat([lenBuf, buf])
    }

    const messageHash = createHash('sha512').update(Buffer.from(payload, 'utf8')).digest()
    const signedData = Buffer.concat([
      Buffer.from('SSHSIG\0'),
      sshString('git'),
      sshString(''),
      sshString('sha512'),
      sshString(messageHash),
    ])

    // Extract public key from our private key and verify
    const {createPublicKey} = await import('node:crypto')
    const pub = createPublicKey(rsaKey.privateKeyObject)
    const valid = cryptoVerify('sha512', signedData, pub, rawSig)
    expect(valid).to.be.true
  })
  })
})
