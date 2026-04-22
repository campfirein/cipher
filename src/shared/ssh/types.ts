import type * as crypto from 'node:crypto'

export type SSHKeyType =
  | 'ecdsa-sha2-nistp256'
  | 'ecdsa-sha2-nistp384'
  | 'ecdsa-sha2-nistp521'
  | 'ssh-ed25519'
  | 'ssh-rsa'

export type ParsedSSHKey = {
  /** SHA256 fingerprint — used for display and matching with IAM */
  fingerprint: string
  /** Key type identifier (e.g., 'ssh-ed25519') */
  keyType: SSHKeyType
  /** Node.js crypto KeyObject — opaque, not extractable */
  privateKeyObject: crypto.KeyObject
  /** Raw public key blob in SSH wire format (for embedding in sshsig) */
  publicKeyBlob: Buffer
}

export type SSHSignatureResult = {
  /** Armored SSH signature (-----BEGIN SSH SIGNATURE----- ... -----END SSH SIGNATURE-----) */
  armored: string
  /** Raw sshsig binary (before base64 armoring) */
  raw: Buffer
}

export type SSHKeyProbeResult = {
  exists: false
}

export type SSHKeyProbeResultFound = {
  exists: true
  needsPassphrase: boolean
  /** True when the key is OpenSSH native format AND encrypted (bcrypt KDF + AES cipher). */
  opensshEncrypted?: boolean
}

export type SSHKeyProbe = SSHKeyProbeResult | SSHKeyProbeResultFound
