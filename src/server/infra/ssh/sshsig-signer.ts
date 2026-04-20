import {createHash, sign} from 'node:crypto'

import type {ParsedSSHKey, SSHSignatureResult} from './types.js'

import {SSHSIG_MAGIC} from './sshsig-constants.js'

const SSHSIG_VERSION = 1
const NAMESPACE = 'git'
const HASH_ALGORITHM = 'sha512'

/**
 * Encode a Buffer or string as an SSH wire-format length-prefixed string.
 * Format: uint32(len) + bytes
 */
function sshString(data: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const lenBuf = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(buf.length, 0)
  return Buffer.concat([lenBuf, buf])
}

/**
 * Create an SSH signature for a commit payload using the sshsig format.
 *
 * The returned armored signature is suitable for embedding directly as
 * the `gpgsig` header value in a git commit object.
 *
 * @param payload - The raw commit object text (as passed by isomorphic-git's onSign callback)
 * @param key     - Parsed SSH key from ssh-key-parser
 */
export function signCommitPayload(payload: string, key: ParsedSSHKey): SSHSignatureResult {
  // 1. Hash the commit payload with SHA-512
  //    isomorphic-git passes payload as a string; convert to bytes first
  const messageHash = createHash('sha512').update(Buffer.from(payload, 'utf8')).digest()

  // 2. Build the "signed data" structure per PROTOCOL.sshsig §2
  //    This is what the private key actually signs — NOT the raw payload.
  const signedData = Buffer.concat([
    SSHSIG_MAGIC, //  6-byte preamble per spec
    sshString(NAMESPACE), //  "git"
    sshString(''), //  reserved (empty)
    sshString(HASH_ALGORITHM), //  "sha512"
    sshString(messageHash), //  H(payload)
  ])

  // 3. Sign the signed data with the private key
  //    Ed25519: sign(null, data, key)    — algorithm is implicit in the key
  //    RSA:     sign('sha512', data, key) — must specify hash explicitly
  //    ECDSA:   sign(null, data, key)    — algorithm follows the curve
  const isRsa = key.keyType === 'ssh-rsa'
  const rawSignature = sign(isRsa ? 'sha512' : null, signedData, key.privateKeyObject)

  // 4. Build the SSH signature blob (key-type-specific wrapper)
  //    Ed25519: string("ssh-ed25519")        + string(64-byte-sig)
  //    RSA:     string("rsa-sha2-512")        + string(rsa-sig)   ← NOT "ssh-rsa"
  //    ECDSA:   string("ecdsa-sha2-nistp256") + string(ecdsa-sig)
  const blobKeyType = isRsa ? 'rsa-sha2-512' : key.keyType
  const signatureBlob = Buffer.concat([sshString(blobKeyType), sshString(rawSignature)])

  // 5. Build the full sshsig binary envelope per PROTOCOL.sshsig §3
  const versionBuf = Buffer.allocUnsafe(4)
  versionBuf.writeUInt32BE(SSHSIG_VERSION, 0)

  const sshsigBinary = Buffer.concat([
    SSHSIG_MAGIC, //  magic preamble
    versionBuf, //  version = 1
    sshString(key.publicKeyBlob), //  public key blob
    sshString(NAMESPACE), //  "git"
    sshString(''), //  reserved
    sshString(HASH_ALGORITHM), //  "sha512"
    sshString(signatureBlob), //  wrapped signature
  ])

  // 6. Armor with PEM-style headers (76-char line wrapping, as ssh-keygen does)
  const base64 = sshsigBinary.toString('base64')
  const lines = base64.match(/.{1,76}/g) ?? [base64]
  const armored = ['-----BEGIN SSH SIGNATURE-----', ...lines, '-----END SSH SIGNATURE-----'].join(
    '\n',
  )

  return {armored, raw: sshsigBinary}
}
