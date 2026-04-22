import {createHash} from 'node:crypto'
import net from 'node:net'

import type {SSHSignatureResult} from './types.js'

import {getPublicKeyMetadata} from './ssh-key-parser.js'
import {SSHSIG_HASH_ALGORITHM, SSHSIG_MAGIC_PREAMBLE} from './sshsig-constants.js'

const SSHSIG_MAGIC = Buffer.from(SSHSIG_MAGIC_PREAMBLE)

// SSH agent protocol message types
const SSH_AGENTC_REQUEST_IDENTITIES = 11
const SSH_AGENTC_SIGN_REQUEST = 13
const SSH_AGENT_IDENTITIES_ANSWER = 12
const SSH_AGENT_SIGN_RESPONSE = 14
const SSH_AGENT_FAILURE = 5

// SSH agent sign flags
const SSH_AGENT_RSA_SHA2_512 = 4

/**
 * Read a uint32 big-endian from a buffer at offset.
 */
function readUInt32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset)
}

/**
 * Write a uint32 big-endian prefix then data (SSH wire string).
 */
function sshString(data: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(buf.length, 0)
  return Buffer.concat([len, buf])
}

/**
 * Low-level SSH agent client over a Unix domain socket.
 */
class SshAgentClient {
  private readonly socketPath: string

  constructor(socketPath: string) {
    this.socketPath = socketPath
  }

  /** List all identities (public keys) currently held by the agent. */
  async listIdentities(): Promise<Array<{blob: Buffer; comment: string; fingerprint: string}>> {
    const request = Buffer.from([SSH_AGENTC_REQUEST_IDENTITIES])
    const response = await this.request(request)

    if (response[0] !== SSH_AGENT_IDENTITIES_ANSWER) {
      throw new Error(`Agent returned unexpected message type: ${response[0]}`)
    }

    const count = readUInt32(response, 1)
    const identities: Array<{blob: Buffer; comment: string; fingerprint: string}> = []
    let offset = 5

    for (let i = 0; i < count; i++) {
      const blobLen = readUInt32(response, offset)
      offset += 4
      const blob = response.subarray(offset, offset + blobLen)
      offset += blobLen

      const commentLen = readUInt32(response, offset)
      offset += 4
      const comment = response.subarray(offset, offset + commentLen).toString('utf8')
      offset += commentLen

      // Compute SHA256 fingerprint to match against our key
      const hash = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
      const fingerprint = `SHA256:${hash}`

      identities.push({blob, comment, fingerprint})
    }

    return identities
  }

  /** Send a request to the agent and receive the full response. */
  async request(payload: Buffer): Promise<Buffer> {
    const MAX_RESPONSE_SIZE = 1024 * 1024 // 1 MB

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      const chunks: Buffer[] = []
      let settled = false

      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        socket.destroy()
        fn()
      }

      socket.once('connect', () => {
        // Prefix payload with uint32 length
        const lenBuf = Buffer.allocUnsafe(4)
        lenBuf.writeUInt32BE(payload.length, 0)
        socket.write(Buffer.concat([lenBuf, payload]))
      })

      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        const accumulated = Buffer.concat(chunks)

        if (accumulated.length >= 4) {
          const responseLen = readUInt32(accumulated, 0)

          if (responseLen > MAX_RESPONSE_SIZE) {
            settle(() => reject(new Error(`Agent response too large: ${responseLen} bytes`)))
            return
          }

          if (accumulated.length >= 4 + responseLen) {
            const body = accumulated.subarray(4, 4 + responseLen)
            if (body.length === 0) {
              settle(() => reject(new Error('Agent returned empty response body')))
              return
            }

            settle(() => resolve(body))
          }
        }
      })

      socket.once('error', (err) => settle(() => reject(err)))
      socket.once('close', () => {
        settle(() => reject(new Error('Agent socket closed without response')))
      })

      // Timeout after 3 seconds
      socket.setTimeout(3000, () => {
        settle(() => reject(new Error('SSH agent request timed out')))
      })
    })
  }

  /** Request the agent to sign data with a specific key blob. */
  async sign(keyBlob: Buffer, data: Buffer, flags: number = 0): Promise<Buffer> {
    const request = Buffer.concat([
      Buffer.from([SSH_AGENTC_SIGN_REQUEST]),
      sshString(keyBlob),
      sshString(data),
      (() => {
        const f = Buffer.allocUnsafe(4)
        f.writeUInt32BE(flags, 0)
        return f
      })(),
    ])

    const response = await this.request(request)

    if (response[0] === SSH_AGENT_FAILURE) {
      throw new Error('SSH agent refused to sign (key may not be loaded)')
    }

    if (response[0] !== SSH_AGENT_SIGN_RESPONSE) {
      throw new Error(`Agent returned unexpected sign response type: ${response[0]}`)
    }

    // Response: byte SSH_AGENT_SIGN_RESPONSE + string(signature)
    const sigLen = readUInt32(response, 1)
    if (sigLen > response.length - 5) {
      throw new Error(
        `Agent signature truncated: header claims ${sigLen} bytes, body has ${response.length - 5}`,
      )
    }

    return response.subarray(5, 5 + sigLen)
  }
}

/**
 * High-level signer that uses ssh-agent to produce sshsig-format signatures.
 */
export class SshAgentSigner {
  private readonly agent: SshAgentClient
  private readonly keyBlob: Buffer
  private readonly keyType: string

  constructor(agent: SshAgentClient, keyBlob: Buffer, keyType: string) {
    this.agent = agent
    this.keyBlob = keyBlob
    this.keyType = keyType
  }

  /**
   * Sign a commit payload using the ssh-agent, producing an armored sshsig signature.
   */
  async sign(payload: string): Promise<SSHSignatureResult> {
    const NAMESPACE = 'git'

    // 1. Hash commit payload with the spec-mandated SHA-512.
    const messageHash = createHash(SSHSIG_HASH_ALGORITHM).update(Buffer.from(payload, 'utf8')).digest()

    // 2. Build signed-data structure per PROTOCOL.sshsig §2 (6-byte SSHSIG preamble)
    const signedData = Buffer.concat([
      SSHSIG_MAGIC,
      sshString(NAMESPACE),
      sshString(''),
      sshString(SSHSIG_HASH_ALGORITHM),
      sshString(messageHash),
    ])

    // 3. Choose sign flags
    const flags = this.keyType === 'ssh-rsa' ? SSH_AGENT_RSA_SHA2_512 : 0

    // 4. Ask agent to sign the signed data blob
    const agentSignature = await this.agent.sign(this.keyBlob, signedData, flags)

    // 5. The agent returns a full SSH signature blob already
    //    (string(key-type) + string(raw-sig))
    //    We use it directly as the sshsig signature field

    // 6. Build sshsig binary envelope
    const versionBuf = Buffer.allocUnsafe(4)
    versionBuf.writeUInt32BE(1, 0)

    const sshsigBinary = Buffer.concat([
      SSHSIG_MAGIC,
      versionBuf,
      sshString(this.keyBlob),
      sshString(NAMESPACE),
      sshString(''),
      sshString(SSHSIG_HASH_ALGORITHM),
      sshString(agentSignature),
    ])

    // 7. Armor
    const base64 = sshsigBinary.toString('base64')
    const lines = base64.match(/.{1,76}/g) ?? [base64]
    const armored = [
      '-----BEGIN SSH SIGNATURE-----',
      ...lines,
      '-----END SSH SIGNATURE-----',
    ].join('\n')

    return {armored, raw: sshsigBinary}
  }
}

/**
 * Try to get an SshAgentSigner for the key at the given path.
 *
 * Priority chain path A: connect to ssh-agent → find matching key → return signer.
 * Returns null (non-throwing) if:
 * - $SSH_AUTH_SOCK is not set
 * - Agent is unreachable
 * - The key at keyPath is not loaded in the agent
 */
export async function tryGetSshAgentSigner(keyPath: string): Promise<null | SshAgentSigner> {
  const agentSocket = process.env.SSH_AUTH_SOCK ?? (process.platform === 'win32' ? String.raw`\\.\pipe\openssh-ssh-agent` : undefined)
  if (!agentSocket) return null

  try {
    const agent = new SshAgentClient(agentSocket)

    // Derive public key fingerprint from key file (reads only public key — no passphrase needed)
    const parsed = await getPublicKeyMetadata(keyPath).catch(() => null)
    if (!parsed) return null

    // Find matching identity in agent
    const identities = await agent.listIdentities()
    const match = identities.find((id) => id.fingerprint === parsed.fingerprint)
    if (!match) return null

    return new SshAgentSigner(agent, match.blob, parsed.keyType)
  } catch {
    // Agent unavailable — degrade gracefully to cache/file path
    return null
  }
}
