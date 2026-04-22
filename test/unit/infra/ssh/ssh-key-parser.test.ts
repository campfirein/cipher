import {expect} from 'chai'
import {generateKeyPairSync, sign} from 'node:crypto'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {extractPublicKey, parseSSHPrivateKey, probeSSHKey, resolveHome} from '../../../../src/server/infra/ssh/ssh-key-parser.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

function writeU32(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt32BE(value, 0)
  return buf
}

function sshStr(data: Buffer | string): Buffer {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return Buffer.concat([writeU32(b.length), b])
}

function makeEncryptedOpenSSHKey(): string {
  const pubBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(Buffer.alloc(32, 0xaa))])
  const buf = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'binary'),
    sshStr('aes256-ctr'),
    sshStr('bcrypt'),
    sshStr(Buffer.alloc(0)),
    writeU32(1),
    sshStr(pubBlob),
    sshStr(Buffer.alloc(64, 0xbb)),
  ])
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${buf.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----`
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

  afterEach(() => {
    rmSync(tempDir, {force: true, recursive: true})
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

  it('returns opensshEncrypted:true for encrypted OpenSSH-format key', async () => {
    const pubBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(Buffer.alloc(32, 0xaa))])
    const buf = Buffer.concat([
      Buffer.from('openssh-key-v1\0', 'binary'),
      sshStr('aes256-ctr'),
      sshStr('bcrypt'),
      sshStr(Buffer.alloc(0)),
      writeU32(1),
      sshStr(pubBlob),
      sshStr(Buffer.alloc(64, 0xbb)),
    ])
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${buf.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----`
    const keyPath = join(tempDir, 'id_openssh_enc2')
    writeFileSync(keyPath, pem, {mode: 0o600})

    const result = await probeSSHKey(keyPath)
    expect(result.exists).to.be.true
    if (!result.exists) throw new Error('unreachable')
    expect(result.opensshEncrypted).to.be.true
  })

  it('returns needsPassphrase:true for an encrypted PEM key with no passphrase argument', async () => {
    // Pins the no-passphrase code path: createPrivateKey on an encrypted PEM
    // emits ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED (NOT a "user cancelled
    // prompt" — OpenSSL just aborts the read). isPassphraseError must catch
    // this code, otherwise probeSSHKey would surface a raw crypto error
    // instead of asking the caller for a passphrase.
    const {privateKey} = generateKeyPairSync('ed25519', {
      privateKeyEncoding: {cipher: 'aes-256-cbc', format: 'pem', passphrase: 'secret', type: 'pkcs8'},
      publicKeyEncoding: {format: 'pem', type: 'spki'},
    })
    const keyPath = join(tempDir, 'id_ed25519_pem_enc')
    writeFileSync(keyPath, privateKey, {mode: 0o600})

    const result = await probeSSHKey(keyPath)
    expect(result.exists).to.be.true
    if (!result.exists) throw new Error('unreachable')
    expect(result.needsPassphrase).to.be.true
  })

  it('throws "Unsupported OpenSSH key type" for unencrypted RSA OpenSSH key (does not false-prompt for passphrase)', async () => {
    // Regression test for ENG-2002 B6: the isPassphraseError regex used to include
    // /unsupported/, which false-matched parseOpenSSHKey's own error string and
    // caused probeSSHKey to incorrectly return needsPassphrase:true for RSA/ECDSA
    // OpenSSH-format keys, triggering a spurious passphrase prompt.
    const pubBlob = Buffer.concat([sshStr('ssh-rsa'), sshStr(Buffer.alloc(64, 0xaa))])
    const buf = Buffer.concat([
      Buffer.from('openssh-key-v1\0', 'binary'),
      sshStr('none'),                               // cipher: NOT encrypted
      sshStr('none'),                               // kdf
      sshStr(Buffer.alloc(0)),
      writeU32(1),
      sshStr(pubBlob),
      sshStr(Buffer.alloc(64, 0xbb)),
    ])
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${buf.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----`
    const keyPath = join(tempDir, 'id_rsa_openssh')
    writeFileSync(keyPath, pem, {mode: 0o600})

    let caught: unknown
    try {
      await probeSSHKey(keyPath)
    } catch (error) {
      caught = error
    }

    if (!(caught instanceof Error)) {
      expect.fail('probeSSHKey must throw for unsupported key type, not return needsPassphrase:true')
    }

    expect(caught.message).to.match(/Unsupported OpenSSH key type/)
  })

  it('throws a user-grade error (not raw OpenSSL code) for a file that is not a valid SSH key', async () => {
    // Regression test for ENG-2002 AC9-b + C2. Node.js crypto emits
    // ERR_OSSL_UNSUPPORTED for any PEM body it cannot decode. The raw error
    // ("error:1E08010C:DECODER routines::unsupported") is not user-grade;
    // probeSSHKey must translate it to actionable English.
    const malformedPem = '-----BEGIN PRIVATE KEY-----\nQUFBQQ==\n-----END PRIVATE KEY-----'
    const keyPath = join(tempDir, 'malformed_pem')
    writeFileSync(keyPath, malformedPem, {mode: 0o600})

    let caught: unknown
    try {
      await probeSSHKey(keyPath)
    } catch (error) {
      caught = error
    }

    if (!(caught instanceof Error)) {
      expect.fail('probeSSHKey must throw for malformed PEM, not return needsPassphrase:true')
    }

    expect(caught.message).to.match(/not a valid SSH private key/i)
    expect(caught.message).to.not.match(/ERR_OSSL|DECODER routines/)
  })

  it('throws "Unsupported OpenSSH key type" for unencrypted ECDSA OpenSSH key (does not false-prompt for passphrase)', async () => {
    // Same regression as above, but exercising ecdsa-sha2-nistp256.
    const pubBlob = Buffer.concat([sshStr('ecdsa-sha2-nistp256'), sshStr(Buffer.alloc(65, 0xaa))])
    const buf = Buffer.concat([
      Buffer.from('openssh-key-v1\0', 'binary'),
      sshStr('none'),
      sshStr('none'),
      sshStr(Buffer.alloc(0)),
      writeU32(1),
      sshStr(pubBlob),
      sshStr(Buffer.alloc(64, 0xbb)),
    ])
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${buf.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----`
    const keyPath = join(tempDir, 'id_ecdsa_openssh')
    writeFileSync(keyPath, pem, {mode: 0o600})

    let caught: unknown
    try {
      await probeSSHKey(keyPath)
    } catch (error) {
      caught = error
    }

    if (!(caught instanceof Error)) {
      expect.fail('probeSSHKey must throw for unsupported key type, not return needsPassphrase:true')
    }

    expect(caught.message).to.match(/Unsupported OpenSSH key type/)
  })

  it('returns {exists: true, needsPassphrase: true} for encrypted OpenSSH key', async () => {
    // Construct a minimal OpenSSH key with cipherName = 'aes256-ctr' to simulate encrypted key.
    // Must include a valid public key blob + private key blob so parseOpenSSHKey doesn't crash.
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

  // Single setup: every test in this block is read-only against keyPath, so
  // before/after (lifecycle once) is correct — beforeEach would re-create the
  // key file unnecessarily and slow the suite. New tests added here MUST stay
  // read-only; if you need to mutate, use a separate tempDir per test.
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-ssh-parse-test-'))
    keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})
  })

  after(() => {
    rmSync(tempDir, {force: true, recursive: true})
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

  it('throws a user-grade error (not raw OpenSSL code) when given a wrong passphrase for an encrypted PEM key', async () => {
    // Regression test for ENG-2002 AC9-c. createPrivateKey with a wrong
    // passphrase emits ERR_OSSL_BAD_DECRYPT whose raw message
    // ("error:1C800064:Provider routines::bad decrypt") is not user-grade;
    // parseSSHPrivateKey must translate it to actionable English.
    const {privateKey} = generateKeyPairSync('ed25519', {
      privateKeyEncoding: {cipher: 'aes-256-cbc', format: 'pem', passphrase: 'rightpass', type: 'pkcs8'},
      publicKeyEncoding: {format: 'pem', type: 'spki'},
    })
    const encKeyPath = join(tempDir, 'id_ed25519_pem_wrongpp')
    writeFileSync(encKeyPath, privateKey, {mode: 0o600})

    let caught: unknown
    try {
      await parseSSHPrivateKey(encKeyPath, 'wrongpass')
    } catch (error) {
      caught = error
    }

    if (!(caught instanceof Error)) {
      expect.fail('parseSSHPrivateKey must throw when given a wrong passphrase')
    }

    expect(caught.message).to.match(/passphrase/i)
    expect(caught.message).to.not.match(/ERR_OSSL|Provider routines|bad decrypt/i)
  })
})

// ── extractPublicKey tests ────────────────────────────────────────────────────

describe('extractPublicKey()', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'brv-extract-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, {force: true, recursive: true})
  })

  it('extracts public key from encrypted OpenSSH key with no .pub sidecar', async () => {
    const keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, makeEncryptedOpenSSHKey(), {mode: 0o600})

    const result = await extractPublicKey(keyPath)

    expect(result.keyType).to.equal('ssh-ed25519')
    expect(result.publicKeyBlob).to.be.instanceOf(Buffer)
    expect(result.publicKeyBlob.length).to.be.greaterThan(0)
    expect(result.comment).to.be.undefined
  })

  it('prefers .pub sidecar over OpenSSH header when sidecar exists', async () => {
    const keyPath = join(tempDir, 'id_ed25519')
    writeFileSync(keyPath, makeEncryptedOpenSSHKey(), {mode: 0o600})
    writeFileSync(
      `${keyPath}.pub`,
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIERWc7ZeFmViDVndPNPdfAHZi8z9dBhCdlBjVf+xWrUd user@laptop',
      {mode: 0o644},
    )

    const result = await extractPublicKey(keyPath)

    expect(result.keyType).to.equal('ssh-ed25519')
    expect(result.comment).to.equal('user@laptop')
    // Blob should match what's in the .pub file
    const expectedBlob = Buffer.from('AAAAC3NzaC1lZDI1NTE5AAAAIERWc7ZeFmViDVndPNPdfAHZi8z9dBhCdlBjVf+xWrUd', 'base64')
    expect(result.publicKeyBlob.equals(expectedBlob)).to.be.true
  })

  it('extracts public key from unencrypted OpenSSH key with no sidecar', async () => {
    const keyPath = join(tempDir, 'id_ed25519_unenc')
    writeFileSync(keyPath, TEST_OPENSSH_ED25519_KEY, {mode: 0o600})

    const result = await extractPublicKey(keyPath)

    expect(result.keyType).to.equal('ssh-ed25519')
    expect(result.publicKeyBlob).to.be.instanceOf(Buffer)
    expect(result.comment).to.be.undefined
  })

  it('throws for a non-existent file', async () => {
    let threw = false
    try {
      await extractPublicKey(join(tempDir, 'no_such_key'))
    } catch {
      threw = true
    }

    expect(threw).to.be.true
  })

  // Regression test for ENG-2002 AC9-b/c (PR #435 review comment #17).
  // Before the fix, the PEM branch of extractPublicKey called
  // parseSSHPrivateKey(keyPath) with no passphrase. For an encrypted PEM key
  // without a .pub sidecar, Node's createPrivateKey emitted either
  // ERR_OSSL_BAD_DECRYPT (user-facing: "Wrong passphrase ..." — misleading,
  // nobody entered one) or ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED (raw
  // OpenSSL code leaks to the CLI — violates AC9 "no raw OpenSSL codes").
  //
  // The fix must detect passphrase-class errors from parseSSHPrivateKey and
  // replace them with an actionable hint pointing at `ssh-keygen -y -f`.
  it('throws actionable hint (not raw OpenSSL / misleading "wrong passphrase") for encrypted PEM with no sidecar', async () => {
    const {privateKey} = generateKeyPairSync('ed25519', {
      privateKeyEncoding: {cipher: 'aes-256-cbc', format: 'pem', passphrase: 'secret', type: 'pkcs8'},
      publicKeyEncoding: {format: 'pem', type: 'spki'},
    })
    const keyPath = join(tempDir, 'id_ed25519_pem_enc_no_sidecar')
    writeFileSync(keyPath, privateKey, {mode: 0o600})

    let caught: Error | undefined
    try {
      await extractPublicKey(keyPath)
    } catch (error) {
      if (error instanceof Error) caught = error
    }

    expect(caught, 'extractPublicKey must throw on encrypted PEM without sidecar').to.be.instanceOf(Error)
    if (!caught) throw new Error('unreachable')
    // Actionable hint — tells the user exactly how to unblock themselves.
    expect(caught.message).to.include('ssh-keygen -y -f')
    expect(caught.message).to.include(keyPath)
    // Must not misleadingly blame a passphrase the user never entered.
    expect(caught.message).to.not.match(/Wrong passphrase/i)
    // AC9: no raw OpenSSL codes or OpenSSL routine names in user-facing error.
    expect(caught.message).to.not.match(/ERR_OSSL|DECODER routines|Provider routines|bad decrypt/i)
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
