import {createHash, createPrivateKey, createPublicKey} from 'node:crypto'
import {constants} from 'node:fs'
import {access, readFile} from 'node:fs/promises'
import {homedir} from 'node:os'

import type {ParsedSSHKey, SSHKeyProbe, SSHKeyType} from './types.js'

// ── OpenSSH private key format parser ────────────────────────────────────────
// Spec: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
//
// Binary layout:
//   "openssh-key-v1\0"   (magic)
//   string ciphername    ("none" if unencrypted)
//   string kdfname       ("none" if unencrypted)
//   string kdfoptions    (empty if unencrypted)
//   uint32 nkeys         (number of keys, usually 1)
//   string pubkey        (SSH wire-format public key)
//   string private_keys  (encrypted or plaintext private key data)
//
// Private key data (plaintext, nkeys=1):
//   uint32 check1
//   uint32 check2        (must equal check1)
//   string keytype       (e.g., "ssh-ed25519")
//   [key-type-specific private key fields]
//   string comment
//   [padding bytes: 1,2,3,...]

const OPENSSH_MAGIC = 'openssh-key-v1\0'

/** Encode a value as an SSH wire-format length-prefixed string. */
function sshStr(data: Buffer | string): Buffer {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(b.length, 0)
  return Buffer.concat([len, b])
}

const VALID_SSH_KEY_TYPES: ReadonlySet<string> = new Set<SSHKeyType>([
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'ssh-ed25519',
  'ssh-rsa',
])

/** Read a uint32 big-endian from a buffer at offset; returns [value, newOffset] */
function readUInt32(buf: Buffer, offset: number): [number, number] {
  return [buf.readUInt32BE(offset), offset + 4]
}

/** Read an SSH wire-format length-prefixed string; returns [Buffer, newOffset] */
function readSSHString(buf: Buffer, offset: number): [Buffer, number] {
  const [len, afterLen] = readUInt32(buf, offset)
  return [buf.subarray(afterLen, afterLen + len), afterLen + len]
}

/** Parse the binary OpenSSH private key format (unencrypted only). */
function parseOpenSSHKey(raw: string): {
  cipherName: string
  keyType: SSHKeyType
  privateKeyBlob: Buffer
  publicKeyBlob: Buffer
} {
  // Strip PEM armor
  const b64 = raw
    .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
    .replace('-----END OPENSSH PRIVATE KEY-----', '')
    .replaceAll(/\s+/g, '')
  const buf = Buffer.from(b64, 'base64')

  // Verify magic
  const magic = buf.subarray(0, OPENSSH_MAGIC.length).toString()
  if (magic !== OPENSSH_MAGIC) {
    throw new Error('Not an OpenSSH private key (wrong magic bytes)')
  }

  let offset = OPENSSH_MAGIC.length

  // ciphername
  let cipherNameBuf: Buffer
  ;[cipherNameBuf, offset] = readSSHString(buf, offset)
  const cipherName = cipherNameBuf.toString()

  // kdfname (skip value — only offset matters)
  ;[, offset] = readSSHString(buf, offset)

  // kdfoptions (skip value)
  ;[, offset] = readSSHString(buf, offset)

  // nkeys
  let nkeys: number
  ;[nkeys, offset] = readUInt32(buf, offset)
  if (nkeys !== 1) {
    throw new Error(`OpenSSH key file contains ${nkeys} keys; only single-key files are supported`)
  }

  // public key blob (SSH wire format)
  let publicKeyBlob: Buffer
  ;[publicKeyBlob, offset] = readSSHString(buf, offset)

  // private key blob (may be encrypted)
  let privateKeyBlob: Buffer
  ;[privateKeyBlob, offset] = readSSHString(buf, offset)

  // Read key type from public key blob to identify the key
  const [keyTypeBuf] = readSSHString(publicKeyBlob, 0)
  const keyTypeStr = keyTypeBuf.toString()
  if (!VALID_SSH_KEY_TYPES.has(keyTypeStr)) {
    throw new Error(`Unknown SSH key type: '${keyTypeStr}'`)
  }

  const keyType = keyTypeStr as SSHKeyType

  return {cipherName, keyType, privateKeyBlob, publicKeyBlob}
}

/**
 * Convert an OpenSSH Ed25519 private key blob to a Node.js-loadable format.
 *
 * Ed25519 private key blob layout (plaintext):
 *   uint32 check1
 *   uint32 check2
 *   string "ssh-ed25519"
 *   string pubkey (32 bytes)
 *   string privkey (64 bytes: 32-byte seed + 32-byte pubkey)
 *   string comment
 *   padding bytes
 */
function opensshEd25519ToNodeKey(privateKeyBlob: Buffer): {
  privateKeyPkcs8: Buffer
  publicKeyBlob: Buffer
} {
  let offset = 0

  // check1 and check2 must match (used to verify decryption)
  const [check1] = readUInt32(privateKeyBlob, offset)
  offset += 4
  const [check2] = readUInt32(privateKeyBlob, offset)
  offset += 4

  if (check1 !== check2) {
    throw new Error('OpenSSH key decryption check failed (wrong passphrase?)')
  }

  // key type
  let keyTypeBuf: Buffer
  ;[keyTypeBuf, offset] = readSSHString(privateKeyBlob, offset)
  const keyType = keyTypeBuf.toString()

  if (keyType !== 'ssh-ed25519') {
    throw new Error(`Expected ssh-ed25519 key type, got: ${keyType}`)
  }

  // public key (32 bytes)
  let pubKeyBytes: Buffer
  ;[pubKeyBytes, offset] = readSSHString(privateKeyBlob, offset)

  // private key (64 bytes: first 32 = seed)
  let privKeyBytes: Buffer
  ;[privKeyBytes, offset] = readSSHString(privateKeyBlob, offset)

  // The Ed25519 "private key" in OpenSSH format is the 64-byte concatenation
  // of: seed (32 bytes) + public key (32 bytes).
  // Node.js needs a DER-encoded ASN.1 PKCS8 structure for Ed25519.
  //
  // PKCS8 for Ed25519:
  //   SEQUENCE {
  //     INTEGER 0 (version)
  //     SEQUENCE { OID 1.3.101.112 (id-EdDSA) }
  //     OCTET STRING wrapping OCTET STRING (32-byte seed)
  //   }
  const seed = privKeyBytes.subarray(0, 32)

  // ASN.1 encoding for Ed25519 private key in PKCS8 format
  // This is the known fixed ASN.1 header for Ed25519 PKCS8
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex')
  const pkcs8Der = Buffer.concat([pkcs8Header, seed])

  // SSH wire format public key blob: string("ssh-ed25519") + string(32-byte-pubkey)
  const publicKeyBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(pubKeyBytes)])

  return {privateKeyPkcs8: pkcs8Der, publicKeyBlob}
}

/** Detect whether a PEM key parsing error indicates an encrypted key needing a passphrase. */
function isPassphraseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false

  // Node.js crypto errors expose an `code` property (e.g., 'ERR_OSSL_BAD_DECRYPT')
  const code = 'code' in err && typeof (err as {code: unknown}).code === 'string'
    ? (err as {code: string}).code
    : ''
  if (code.includes('ERR_OSSL') && code.includes('DECRYPT')) return true

  // Fallback: string matching for compatibility across Node.js/OpenSSL versions
  const msg = err.message.toLowerCase()
  return msg.includes('bad decrypt') || msg.includes('passphrase') || msg.includes('bad password')
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if a key file exists and whether it requires a passphrase.
 * Does NOT load the private key material beyond the initial probe.
 */
export async function probeSSHKey(keyPath: string): Promise<SSHKeyProbe> {
  try {
    await access(keyPath, constants.R_OK)
  } catch {
    return {exists: false}
  }

  try {
    const raw = await readFile(keyPath, 'utf8')

    if (raw.includes('BEGIN OPENSSH PRIVATE KEY')) {
      // OpenSSH format: check cipherName field
      const parsed = parseOpenSSHKey(raw)
      const needsPassphrase = parsed.cipherName !== 'none'
      return {
        exists: true,
        needsPassphrase,
        ...(needsPassphrase ? {opensshEncrypted: true} : {}),
      }
    }

    // PEM/PKCS8 format (RSA, ECDSA with traditional headers)
    createPrivateKey({format: 'pem', key: raw})
    return {exists: true, needsPassphrase: false}
  } catch (error: unknown) {
    if (isPassphraseError(error)) {
      return {exists: true, needsPassphrase: true}
    }

    throw error
  }
}

/**
 * Parse an SSH private key file into a usable signing key.
 * Supports:
 *   - OpenSSH native format (Ed25519 only in v1; RSA/ECDSA to follow)
 *   - Standard PEM (PKCS#8, traditional RSA/ECDSA)
 *
 * Throws if passphrase is required but not provided, or if format is unsupported.
 */
export async function parseSSHPrivateKey(
  keyPath: string,
  passphrase?: string,
): Promise<ParsedSSHKey> {
  const raw = await readFile(keyPath, 'utf8')

  // ── OpenSSH native format ──────────────────────────────────────────────
  if (raw.includes('BEGIN OPENSSH PRIVATE KEY')) {
    const {cipherName, keyType, privateKeyBlob} = parseOpenSSHKey(raw)

    if (cipherName !== 'none') {
      if (!passphrase) {
        throw new Error('Passphrase required for encrypted key')
      }

      // Encrypted OpenSSH keys require decryption before parsing.
      // For now, throw a clear error — encrypted OpenSSH key support
      // requires AES-256-CTR + bcrypt KDF implementation (out of scope for v1 spike).
      throw new Error(
        'Encrypted OpenSSH private keys are not yet supported. ' +
          'Please use an unencrypted key or load it via ssh-agent.',
      )
    }

    if (keyType !== 'ssh-ed25519') {
      throw new Error(
        `Unsupported OpenSSH key type: ${keyType}. Only ssh-ed25519 is supported in v1.`,
      )
    }

    const {privateKeyPkcs8, publicKeyBlob: sshPublicKeyBlob} =
      opensshEd25519ToNodeKey(privateKeyBlob)

    const privateKeyObject = createPrivateKey({
      format: 'der',
      key: privateKeyPkcs8,
      type: 'pkcs8',
    })

    const fingerprint = computeFingerprint(sshPublicKeyBlob)

    return {
      fingerprint,
      keyType,
      privateKeyObject,
      publicKeyBlob: sshPublicKeyBlob,
    }
  }

  // ── Standard PEM format (PKCS8, RSA, ECDSA) ───────────────────────────
  const privateKeyObject = createPrivateKey({
    format: 'pem',
    key: raw,
    ...(passphrase ? {passphrase} : {}),
  })

  const publicKey = createPublicKey(privateKeyObject)

  // For non-Ed25519 keys in standard PEM, derive SSH wire format manually
  const asymKeyType = privateKeyObject.asymmetricKeyType
  let publicKeyBlob: Buffer
  let keyType: SSHKeyType

  if (asymKeyType === 'ed25519') {
    const derPub = publicKey.export({format: 'der', type: 'spki'}) as Buffer
    // Ed25519 SPKI DER = 12-byte ASN.1 header + 32-byte raw public key
    const rawPubBytes = derPub.subarray(12)

    keyType = 'ssh-ed25519'
    publicKeyBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(rawPubBytes)])
  } else {
    throw new Error(`Unsupported key type for PEM parsing: ${asymKeyType}`)
  }

  const fingerprint = computeFingerprint(publicKeyBlob)

  return {fingerprint, keyType, privateKeyObject, publicKeyBlob}
}

/** Compute SHA256 fingerprint from SSH wire-format public key blob. */
export function computeFingerprint(publicKeyBlob: Buffer): string {
  const hash = createHash('sha256').update(publicKeyBlob).digest('base64').replace(/=+$/, '')
  return `SHA256:${hash}`
}

/**
 * Attempt to extract public key metadata (fingerprint and keyType) from a key path,
 * checking for a .pub file first, then attempting to parse an OpenSSH private key
 * (which contains the public key even if the private key is encrypted).
 */
export async function getPublicKeyMetadata(keyPath: string): Promise<null | {fingerprint: string; keyType: string}> {
  const pubPath = keyPath.endsWith('.pub') ? keyPath : `${keyPath}.pub`
  try {
    const rawPub = await readFile(pubPath, 'utf8')
    const parts = rawPub.trim().split(' ')
    if (parts.length >= 2) {
      const keyType = parts[0]
      const blob = Buffer.from(parts[1], 'base64')
      return {fingerprint: computeFingerprint(blob), keyType}
    }
  } catch {
    // Ignore error, fallback to private key
  }

  try {
    const raw = await readFile(keyPath, 'utf8')
    if (raw.includes('BEGIN OPENSSH PRIVATE KEY')) {
      const parsed = parseOpenSSHKey(raw)
      return {
        fingerprint: computeFingerprint(parsed.publicKeyBlob),
        keyType: parsed.keyType,
      }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Resolve ~ to the user's home directory in a key path.
 */
export function resolveHome(keyPath: string): string {
  if (keyPath.startsWith('~/') || keyPath === '~') {
    return keyPath.replace('~', homedir())
  }

  return keyPath
}
