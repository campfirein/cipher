#!/usr/bin/env node
/**
 * Phase 1 Spike: Verify sshsig format produced by our implementation
 * can be verified by `ssh-keygen -Y verify`.
 *
 * Usage:
 *   node scripts/spike-sshsig.mjs
 *
 * Prerequisites:
 *   - An Ed25519 key at ~/.ssh/id_ed25519 (unencrypted for test)
 *   - ssh-keygen available in PATH
 */

import {execSync} from 'node:child_process'
import {createHash, createPrivateKey, sign as cryptoSign} from 'node:crypto'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

const OPENSSH_MAGIC = 'openssh-key-v1\0'
const SSHSIG_MAGIC = Buffer.from('SSHSIG') // 6 bytes, NO null terminator

function readUInt32(buf, offset) {
  return [buf.readUInt32BE(offset), offset + 4]
}

function readSSHString(buf, offset) {
  const [len, afterLen] = readUInt32(buf, offset)
  return [buf.subarray(afterLen, afterLen + len), afterLen + len]
}

function sshStr(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(buf.length, 0)
  return Buffer.concat([len, buf])
}

function parseAndLoadOpenSSHEd25519(raw) {
  const b64 = raw
    .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
    .replace('-----END OPENSSH PRIVATE KEY-----', '')
    .replaceAll(/\s+/g, '')
  const buf = Buffer.from(b64, 'base64')

  const magic = buf.subarray(0, OPENSSH_MAGIC.length).toString()
  if (magic !== OPENSSH_MAGIC) throw new Error('Not an OpenSSH private key')

  let offset = OPENSSH_MAGIC.length

  let cipherNameBuf; [cipherNameBuf, offset] = readSSHString(buf, offset)
  const cipherName = cipherNameBuf.toString()

  let kdfName; [kdfName, offset] = readSSHString(buf, offset)
  let kdfOpts; [kdfOpts, offset] = readSSHString(buf, offset)
  let nkeys; [nkeys, offset] = readUInt32(buf, offset)

  let pubKeyBlob; [pubKeyBlob, offset] = readSSHString(buf, offset)
  let privKeyBlob; [privKeyBlob, offset] = readSSHString(buf, offset)

  if (cipherName !== 'none') throw new Error(`Encrypted key (cipher: ${cipherName}) — use unencrypted key for spike`)

  // Parse private key blob: check1, check2, keytype, pubkey, privkey, comment, padding
  let privOffset = 0
  const [check1] = readUInt32(privKeyBlob, privOffset); privOffset += 4
  const [check2] = readUInt32(privKeyBlob, privOffset); privOffset += 4
  if (check1 !== check2) throw new Error('Key integrity check failed')

  let keyTypeBuf; [keyTypeBuf, privOffset] = readSSHString(privKeyBlob, privOffset)
  const keyType = keyTypeBuf.toString()

  let pubBytes; [pubBytes, privOffset] = readSSHString(privKeyBlob, privOffset)  // 32 bytes
  let privBytes; [privBytes, privOffset] = readSSHString(privKeyBlob, privOffset)  // 64 bytes

  const seed = privBytes.subarray(0, 32)

  // Construct PKCS8 DER for Ed25519
  // Fixed ASN.1 prefix for Ed25519 PKCS8: SEQUENCE { version, AlgorithmIdentifier{OID}, OCTET STRING { OCTET STRING { seed } } }
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex')
  const pkcs8Der = Buffer.concat([pkcs8Header, seed])
  const privateKeyObject = createPrivateKey({format: 'der', key: pkcs8Der, type: 'pkcs8'})

  // Build SSH wire-format public key blob
  const publicKeyBlob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(pubBytes)])
  const fingerprint = 'SHA256:' + createHash('sha256').update(publicKeyBlob).digest('base64').replace(/=+$/, '')

  return {fingerprint, keyType, privateKeyObject, publicKeyBlob}
}

function signCommitPayload(payload, key) {
  const messageHash = createHash('sha512').update(Buffer.from(payload, 'utf8')).digest()

  const signedData = Buffer.concat([
    SSHSIG_MAGIC,
    sshStr('git'),
    sshStr(''),
    sshStr('sha512'),
    sshStr(messageHash),
  ])

  const rawSignature = cryptoSign(null, signedData, key.privateKeyObject)
  const signatureBlob = Buffer.concat([sshStr(key.keyType), sshStr(rawSignature)])

  const versionBuf = Buffer.allocUnsafe(4)
  versionBuf.writeUInt32BE(1, 0)

  const sshsigBinary = Buffer.concat([
    SSHSIG_MAGIC,
    versionBuf,
    sshStr(key.publicKeyBlob),
    sshStr('git'),
    sshStr(''),
    sshStr('sha512'),
    sshStr(signatureBlob),
  ])

  const base64 = sshsigBinary.toString('base64')
  const lines = base64.match(/.{1,76}/g) ?? [base64]
  const armored = ['-----BEGIN SSH SIGNATURE-----', ...lines, '-----END SSH SIGNATURE-----'].join('\n')
  return armored
}

async function main() {
  const keyPath = join(homedir(), '.ssh', 'id_ed25519')
  const testPayload = 'tree abc123\nauthor Test User <test@example.com> 1712345678 +0700\n\ntest commit message\n'
  const signer = 'test@example.com'
  const tmpDir = '/tmp/brv-sshsig-spike'

  console.log('\n🔑 ENG-2002 Phase 1 Spike: sshsig format verification\n')
  console.log(`Key path:    ${keyPath}`)

  // 1. Parse key
  let key
  try {
    const raw = readFileSync(keyPath, 'utf8')
    key = parseAndLoadOpenSSHEd25519(raw)
    console.log(`\n✅ Key parsed successfully`)
    console.log(`   Type:        ${key.keyType}`)
    console.log(`   Fingerprint: ${key.fingerprint}`)
  } catch (error) {
    console.error(`\n❌ Failed to parse key: ${error.message}`)
    process.exit(1)
  }

  // 2. Sign
  let armored
  try {
    armored = signCommitPayload(testPayload, key)
    console.log(`\n✅ Signature produced (${armored.length} chars)`)
    console.log(`   ${armored.split('\n')[0]}`)
    console.log(`   [... ${armored.split('\n').length - 2} lines ...]`)
    console.log(`   ${armored.split('\n').at(-1)}`)
  } catch (error) {
    console.error(`\n❌ Signing failed: ${error.message}`)
    process.exit(1)
  }

  // 3. Write to temp files + verify
  try {
    mkdirSync(tmpDir, {recursive: true})
    const sigFile = join(tmpDir, 'test.sig')
    const payloadFile = join(tmpDir, 'test.payload')
    const allowedSignersFile = join(tmpDir, 'allowed_signers')

    const pubKeyStr = execSync(`ssh-keygen -y -f ${keyPath}`).toString().trim()
    writeFileSync(sigFile, armored)
    writeFileSync(payloadFile, testPayload)
    writeFileSync(allowedSignersFile, `${signer} ${pubKeyStr}\n`)

    console.log(`\n📁 Files written to ${tmpDir}`)
    console.log(`   Signature: ${sigFile}`)
    console.log(`   Allowed signers: ${pubKeyStr.slice(0, 50)}...`)

    const verifyCmd = `ssh-keygen -Y verify -f ${allowedSignersFile} -I ${signer} -n git -s ${sigFile}`
    console.log(`\n🔍 Running: echo <payload> | ${verifyCmd}\n`)

    const output = execSync(`${verifyCmd} < ${payloadFile}`, {encoding: 'utf8'})
    console.log(`✅ SPIKE PASSED`)
    console.log(`   ssh-keygen output: ${output.trim()}`)
    console.log('\n🎉 Phase 1 gate check: PASSED. Proceed to Phase 2.\n')
  } catch (error) {
    console.error(`\n❌ SPIKE FAILED: ${error.message}`)
    if (error.stderr) console.error(`   stderr: ${error.stderr.toString()}`)
    console.error('\n   Phase 1 gate check: FAILED.\n')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
