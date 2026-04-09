# ENG-2002: [CLI] Local Commit SSH Signing Support — Implementation Plan

**Issue:** [ENG-2002](https://linear.app/byterover/issue/ENG-2002/cli-local-commit-ssh-signing-support)
**Branch:** `hieu/eng-2002-cli-local-commit-ssh-signing-support`
**Milestone:** 8 — SSH Signing Key Verification
**Depends on:** ENG-1997 (IAM SSH Signing Key CRUD & Storage)
**Related:** ENG-1999 (CoGit Commit Signature Verification on Receive-Pack)
**Created:** 2026-04-08

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [File Inventory](#3-file-inventory)
4. [Phase 1: Research — sshsig Format from Node.js](#4-phase-1-research--sshsig-format-from-nodejs)
5. [Phase 2: SSH Key Parsing & sshsig Signing Module](#5-phase-2-ssh-key-parsing--sshsig-signing-module)
6. [Phase 3: Config Extensions](#6-phase-3-config-extensions)
7. [Phase 4: Commit Signing Integration](#7-phase-4-commit-signing-integration)
8. [Phase 5: Signing Key Management Commands](#8-phase-5-signing-key-management-commands)
9. [Phase 6: Import from Git Config](#9-phase-6-import-from-git-config)
10. [Phase 7: Tests](#10-phase-7-tests)
11. [Phase 8: Error Handling & Edge Cases](#11-phase-8-error-handling--edge-cases)
12. [Dependency Graph](#12-dependency-graph)
13. [Risk & Open Questions](#13-risk--open-questions)
14. [Pre-implementation Corrections (from Code Review)](#14-pre-implementation-corrections-from-code-review)

---

## 1. Overview

Enable `brv vc commit` to sign commits locally with the user's SSH private key before pushing to CoGit. When signed commits are pushed via `brv vc push`, CoGit's receive-pack hook (ENG-1999) will detect the `gpgsig` header, fetch the author's registered signing keys from IAM, and verify the signature — storing the result in `commit_signatures`.

**Key architectural decisions:**

- **Local signing only** — the CLI reads the SSH private key from disk (or delegates to ssh-agent), signs locally. No key leaves the machine.
- **isomorphic-git `onSign` callback** — receives commit payload bytes, returns SSH signature bytes that get embedded as the `gpgsig` header.
- **sshsig binary format** — must produce the exact binary structure that Git 2.34+ and `ssh-keygen -Y verify` expect (magic preamble `SSHSIG`, namespace `git`, hash algorithm, signature blob).
- **Node.js `crypto` module** — for Ed25519/RSA/ECDSA signing. No native binary dependencies.
- **Option C: ssh-agent-first with in-memory cache fallback** — signing resolves key via priority chain: (1) ssh-agent if `$SSH_AUTH_SOCK` available, (2) cached `ParsedSSHKey` in daemon memory (TTL 30 min), (3) file-based fallback (prompt passphrase once, then cache). This achieves GitHub-like zero-prompt UX for the common case.
- **Per-project config** — signing key path and auto-sign preference stored in `vc-git-config.json`.
- **IAM integration** — convenience commands to upload/list/remove the public key counterpart to IAM for server-side verification.

**Out of scope:**

- Hardware key support (YubiKey)
- GPG signing
- Automatic key generation

---

## 2. Architecture

### 2.1 Signing Flow

```
brv vc commit -m "message"
    │
    ├── 1. Load config: vc-git-config.json
    │       → user.signingkey = "~/.ssh/id_ed25519"
    │       → commit.sign = true
    │
    ├── 2. Resolve signing key — Option C priority chain:
    │       │
    │       ├── [A] ssh-agent available? ($SSH_AUTH_SOCK set & responsive)
    │       │       → Use SshAgentSigner: send payload to agent, receive signature
    │       │       → Zero prompts. GitHub-like UX.
    │       │
    │       ├── [B] ParsedSSHKey in daemon memory cache? (TTL 30 min)
    │       │       → Cache hit: use cached key object directly
    │       │       → Zero prompts.
    │       │
    │       └── [C] File fallback:
    │               → Read key file from disk
    │               → Unencrypted: parse directly, add to cache
    │               → Encrypted: throw PASSPHRASE_REQUIRED
    │                   CLI prompts once → retry with passphrase
    │                   Daemon decrypts, caches ParsedSSHKey (TTL 30 min)
    │
    ├── 3. isomorphic-git commit({ onSign })
    │       │
    │       └── onSign({ payload: string })
    │               │
    │               ├── Hash payload with SHA-512
    │               ├── Build SSHSIG binary structure:
    │               │     MAGIC_PREAMBLE ("SSHSIG\0")
    │               │     + version (uint32 = 1)
    │               │     + public_key_blob
    │               │     + namespace ("git")
    │               │     + reserved ("")
    │               │     + hash_algorithm ("sha512")
    │               │     + signature_blob
    │               ├── Sign the SSHSIG "signed data"
    │               └── Return armored SSH signature:
    │                     -----BEGIN SSH SIGNATURE-----
    │                     <base64 of SSHSIG binary>
    │                     -----END SSH SIGNATURE-----
    │
    └── 4. Commit object written with gpgsig header
```

**UX outcome per scenario:**

| User setup | Key encrypted | UX |
|------------|---------------|----|
| ssh-agent running (ssh-add done) | Any | **0 prompts** — GitHub parity |
| No ssh-agent, unencrypted key | No | **0 prompts** — frictionless |
| No ssh-agent, encrypted key (first commit of session) | Yes | **1 prompt** → cached 30 min |
| No ssh-agent, encrypted key (subsequent commits, within TTL) | Yes | **0 prompts** |
| After daemon restart or TTL expiry | Yes | **1 prompt** again |

### 2.2 Verification Flow (server-side, for context)

```
brv vc push
    │
    └── git receive-pack on CoGit
            │
            ├── ScanCommitSignaturesUseCase: detect gpgsig header
            ├── INSERT commit_signatures (status = pending)
            └── CommitVerificationWorker (async):
                    ├── IAM: GET /internal/signing-keys?email=author@...
                    ├── golang.org/x/crypto/ssh: verify sshsig
                    └── UPDATE status → verified / unverified
```

### 2.3 Key Management Flow

```
brv signing-key add --key ~/.ssh/id_ed25519.pub --title "Work laptop"
    │
    └── POST /api/v3/users/me/signing-keys { title, public_key }
            → IAM stores key with fingerprint
            → Returns { id, keyType, fingerprint, title, ... }

brv signing-key list
    │
    └── GET /api/v3/users/me/signing-keys
            → List all registered keys with fingerprints

brv signing-key remove <keyId>
    │
    └── DELETE /api/v3/users/me/signing-keys/:id
            → Revokes key
```

---

## 3. File Inventory

### New Files (13 files)

| # | File | Layer | Purpose |
|---|------|-------|---------|
| 1 | `src/server/infra/ssh/ssh-key-parser.ts` | Infra | Parse OpenSSH private key format, extract key type & public key blob |
| 2 | `src/server/infra/ssh/sshsig-signer.ts` | Infra | Build sshsig binary structure & produce armored SSH signature |
| 3 | `src/server/infra/ssh/ssh-agent-signer.ts` | Infra | **[NEW — Option C]** Communicate with ssh-agent via `$SSH_AUTH_SOCK`, request signature without touching private key file |
| 4 | `src/server/infra/ssh/signing-key-cache.ts` | Infra | **[NEW — Option C]** In-memory TTL cache for `ParsedSSHKey` — keyed by fingerprint, 30 min TTL, auto-invalidate on config change |
| 5 | `src/server/infra/ssh/types.ts` | Infra | Types: `ParsedSSHKey`, `SigningResult`, `SshAgentKey`, key type enums |
| 6 | `src/server/infra/ssh/index.ts` | Infra | Module barrel export |
| 7 | `src/server/infra/iam/http-signing-key-service.ts` | Infra | HTTP client for IAM signing key CRUD API |
| 8 | `src/server/core/interfaces/services/i-signing-key-service.ts` | Core | `ISigningKeyService` interface |
| 9 | `src/server/infra/transport/handlers/signing-key-handler.ts` | Infra | Daemon handler for signing-key CRUD events |
| 10 | `src/oclif/commands/signing-key/add.ts` | CLI | `brv signing-key add` command |
| 11 | `src/oclif/commands/signing-key/list.ts` | CLI | `brv signing-key list` command |
| 12 | `src/oclif/commands/signing-key/remove.ts` | CLI | `brv signing-key remove` command |
| 13 | `test/ssh/ssh-agent-signer.test.ts` | Test | ssh-agent signer unit tests (mock agent socket) |
| 14 | `test/ssh/ssh-key-parser.test.ts` | Test | Key parsing unit tests |
| 15 | `test/ssh/sshsig-signer.test.ts` | Test | sshsig signing + verification tests |

### Modified Files (12 files)

| # | File | Change |
|---|------|--------|
| 1 | `src/server/core/interfaces/vc/i-vc-git-config-store.ts` | Extend `IVcGitConfig` with `signingKey`, `commitSign` fields |
| 2 | `src/server/infra/vc/file-vc-git-config-store.ts` | Update `isIVcGitConfig` type guard to validate new fields |
| 3 | `src/server/infra/git/isomorphic-git-service.ts` | Add `onSign` callback to `commit()` |
| 4 | `src/server/core/interfaces/services/i-git-service.ts` | Extend `CommitGitParams` with `onSign` |
| 5 | `src/server/core/interfaces/services/i-http-client.ts` | Add `delete()` method to `IHttpClient` interface |
| 6 | `src/server/infra/http/authenticated-http-client.ts` | Implement `delete()` method |
| 7 | `src/server/infra/transport/handlers/vc-handler.ts` | Wire signing in `handleCommit()`, add `--import-git-signing` to `handleConfig()` |
| 8 | `src/shared/transport/events/vc-events.ts` | Add signing config keys, extend commit request, add `INVALID_CONFIG_VALUE` error code |
| 9 | `src/oclif/commands/vc/commit.ts` | Add `--sign`/`--no-sign` flags, passphrase retry logic |
| 10 | `src/oclif/commands/vc/config.ts` | Extend `VC_CONFIG_KEYS` with signing keys |
| 11 | `src/shared/transport/types/dto.ts` | Add `SigningKeyDTO` type |
| 12 | `src/server/constants.ts` | Add signing-related error codes (if needed) |

---

## 4. Phase 1: Research — sshsig Format from Node.js

> **This phase is a spike — do it FIRST to derisk the entire feature.**

### 4.1 Problem Statement

Git-compatible SSH signatures use the **sshsig** format defined by the [OpenSSH PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig) spec. This is NOT a standard `crypto.sign()` output — it wraps the raw cryptographic signature in a specific binary envelope.

### 4.2 sshsig Wire Format

```
MAGIC_PREAMBLE  = "SSHSIG\0"          (6 bytes + null)
VERSION         = uint32(1)            (4 bytes, big-endian)
PUBLIC_KEY      = string(public_key_blob)
NAMESPACE       = string("git")
RESERVED        = string("")
HASH_ALGORITHM  = string("sha512")
SIGNATURE       = string(signature_blob)
```

Where `string(x)` = `uint32(len(x)) + x` (SSH wire format length-prefixed).

The **signed data** (what the private key actually signs) is:

```
MAGIC_PREAMBLE  = "SSHSIG\0"
NAMESPACE       = string("git")
RESERVED        = string("")
HASH_ALGORITHM  = string("sha512")
H(message)      = string(sha512(commit_payload))
```

### 4.3 Evaluation Approach

Evaluate these options in order:

1. **`sshpk` library** — Check if it can produce sshsig-format output. If it can parse SSH keys and produce the sshsig binary structure, this is the easiest path. Look at `sshpk.parsePrivateKey()` and check for `createSign()` with sshsig namespace support.

2. **Custom serializer with Node.js `crypto`** — Build the sshsig binary structure manually:
   - `crypto.createPrivateKey()` to load PEM
   - `crypto.sign()` for raw signature
   - Manual binary serialization of the sshsig envelope
   - This is the most reliable path if `sshpk` doesn't support sshsig.

3. **Other libraries** — `ssh2` (has key parsing), `@aspect-build/sshsig` (if exists), etc.

### 4.4 Spike Deliverable

A standalone script that:
1. Reads an Ed25519 private key from `~/.ssh/id_ed25519`
2. Signs a test commit payload
3. Produces an armored SSH signature
4. Can be verified by `ssh-keygen -Y verify` with an allowed_signers file

**Verification command:**
```bash
echo "test commit payload" | ssh-keygen -Y verify \
  -f allowed_signers \
  -I "user@example.com" \
  -n git \
  -s signature.sig
```

### 4.5 Recommendation

Based on the sshsig spec analysis, **Option 2 (custom serializer)** is likely the right path. The sshsig binary format is straightforward (~80 lines of code), and using Node.js `crypto` directly avoids adding a dependency for a narrow use case. The key complexity is:

- Correctly extracting the **public key blob** from the private key (SSH wire format, not PEM)
- Building the **signed data** structure (MAGIC + namespace + reserved + hash_alg + H(message))
- Armoring the output with `-----BEGIN SSH SIGNATURE-----` / `-----END SSH SIGNATURE-----`

---

## 5. Phase 2: SSH Key Parsing & sshsig Signing Module

### 5.1 `src/server/infra/ssh/types.ts`

```typescript
export type SSHKeyType = 'ssh-ed25519' | 'ssh-rsa' | 'ecdsa-sha2-nistp256' | 'ecdsa-sha2-nistp384' | 'ecdsa-sha2-nistp521'

export interface ParsedSSHKey {
  /** Key type identifier (e.g., 'ssh-ed25519') */
  keyType: SSHKeyType
  /** Raw public key blob in SSH wire format (for embedding in sshsig) */
  publicKeyBlob: Buffer
  /** Node.js crypto KeyObject for signing */
  privateKeyObject: crypto.KeyObject
  /** SHA256 fingerprint (for display/matching with IAM) */
  fingerprint: string
}

export interface SSHSignatureResult {
  /** Armored SSH signature (-----BEGIN SSH SIGNATURE----- ... -----END SSH SIGNATURE-----) */
  armored: string
  /** Raw sshsig binary (before base64 armoring) */
  raw: Buffer
}
```

### 5.2 `src/server/infra/ssh/ssh-key-parser.ts`

**Responsibilities:**

1. Read private key file from disk
2. Detect if passphrase-protected → return `{ needsPassphrase: true }` or parsed key
3. Parse with `crypto.createPrivateKey({ key, format: 'pem', passphrase })`
4. Extract key type from the parsed key
5. Derive public key blob in SSH wire format (needed for sshsig structure)
6. Compute SHA256 fingerprint

**Key challenge:** Extracting the public key blob in SSH wire format from a `crypto.KeyObject`. Approach:

```typescript
// Export public key in SSH format
const publicKeySSH = privateKeyObject.export({ type: 'spki', format: 'der' })
// OR: use crypto.createPublicKey(privateKeyObject).export({ type: 'ssh' })
// The 'ssh' format gives us: "ssh-ed25519 AAAA..."
// Parse out the base64 blob (everything after the key type prefix)
```

**Note:** `crypto.KeyObject.export({ type: 'ssh' })` is available in Node.js 20+ and returns the standard SSH public key format. We can parse the base64 portion to get the raw blob.

**Functions:**

```typescript
/**
 * Check if a key file exists and whether it needs a passphrase.
 * Does NOT load the key into memory beyond initial probe.
 */
export async function probeSSHKey(keyPath: string): Promise<
  | { exists: false }
  | { exists: true; needsPassphrase: boolean }
>

/**
 * Parse an SSH private key file into a usable signing key.
 * Throws if passphrase is required but not provided, or if format is unsupported.
 */
export async function parseSSHPrivateKey(
  keyPath: string,
  passphrase?: string,
): Promise<ParsedSSHKey>
```

### 5.3 `src/server/infra/ssh/sshsig-signer.ts`

**Responsibilities:**

1. Build the "signed data" structure per sshsig spec
2. Sign it with the private key
3. Build the full sshsig binary envelope
4. Armor with PEM-style headers

**Functions:**

```typescript
/**
 * Create an SSH signature for a commit payload.
 * Returns the armored signature string to embed in the gpgsig header.
 *
 * @param payload - The commit object text (without gpgsig header).
 *   isomorphic-git's onSign passes this as a string.
 * @param key - Parsed SSH key from ssh-key-parser
 * @returns Armored SSH signature
 */
export function signCommitPayload(
  payload: string,
  key: ParsedSSHKey,
): SSHSignatureResult
```

**Implementation outline:**

```typescript
import { createHash, sign } from 'node:crypto'

const SSHSIG_MAGIC = Buffer.from('SSHSIG\0')
const SSHSIG_VERSION = 1
const NAMESPACE = 'git'
const HASH_ALGORITHM = 'sha512'

function sshString(data: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length)
  return Buffer.concat([len, buf])
}

export function signCommitPayload(
  payload: string,
  key: ParsedSSHKey,
): SSHSignatureResult {
  // 1. Hash the commit payload (convert string to bytes first)
  const messageHash = createHash('sha512').update(Buffer.from(payload)).digest()

  // 2. Build "signed data" (what the key actually signs)
  const signedData = Buffer.concat([
    SSHSIG_MAGIC,                           // "SSHSIG\0"
    sshString(NAMESPACE),                   // "git"
    sshString(''),                          // reserved
    sshString(HASH_ALGORITHM),              // "sha512"
    sshString(messageHash),                 // H(payload)
  ])

  // 3. Sign the signed data
  const signature = sign(null, signedData, key.privateKeyObject)

  // 4. Wrap signature in SSH signature blob format
  //    (key-type-specific: e.g., for ed25519: string("ssh-ed25519") + string(raw_sig))
  const signatureBlob = Buffer.concat([
    sshString(key.keyType),
    sshString(signature),
  ])

  // 5. Build full sshsig binary envelope
  const versionBuf = Buffer.alloc(4)
  versionBuf.writeUInt32BE(SSHSIG_VERSION)

  const sshsigBinary = Buffer.concat([
    SSHSIG_MAGIC,                           // "SSHSIG\0"
    versionBuf,                             // version = 1
    sshString(key.publicKeyBlob),           // public key blob
    sshString(NAMESPACE),                   // "git"
    sshString(''),                          // reserved
    sshString(HASH_ALGORITHM),              // "sha512"
    sshString(signatureBlob),               // signature
  ])

  // 6. Armor
  const base64 = sshsigBinary.toString('base64')
  const lines = base64.match(/.{1,76}/g) ?? [base64]
  const armored = [
    '-----BEGIN SSH SIGNATURE-----',
    ...lines,
    '-----END SSH SIGNATURE-----',
  ].join('\n')

  return { armored, raw: sshsigBinary }
}
```

**RSA/ECDSA notes:**

- **Ed25519:** `crypto.sign(null, data, key)` — algorithm is implicit
- **RSA:** `crypto.sign('sha512', data, key)` — must specify hash; sshsig key type is `rsa-sha2-512`
- **ECDSA:** `crypto.sign(null, data, key)` — algorithm matches curve; signature blob format differs (SSH wraps `(r, s)` integers)

The signature blob format is key-type-specific. For each type:

| Key Type | Signature Blob | Sign Algorithm |
|----------|---------------|----------------|
| `ssh-ed25519` | `string("ssh-ed25519") + string(64-byte-sig)` | `sign(null, data, key)` |
| `rsa-sha2-512` | `string("rsa-sha2-512") + string(rsa-sig)` | `sign('sha512', data, { key, padding: RSA_PKCS1_PADDING })` |
| `ecdsa-sha2-nistp256` | `string("ecdsa-sha2-nistp256") + string(ecdsa-sig-blob)` | `sign(null, data, key)` + convert DER to SSH format |

**Priority:** Ed25519 first (most common for SSH signing). RSA and ECDSA can follow.

---

## 6. Phase 3: Config Extensions

### 6.1 Extend `IVcGitConfig` Interface

**File:** `src/server/core/interfaces/vc/i-vc-git-config-store.ts`

```typescript
export interface IVcGitConfig {
  email?: string
  name?: string
  // NEW — Phase 3
  signingKey?: string     // Path to SSH private key (e.g., "~/.ssh/id_ed25519")
  commitSign?: boolean    // Auto-sign all commits (default: false)
}
```

### 6.1b Update `isIVcGitConfig` Type Guard

**File:** `src/server/infra/vc/file-vc-git-config-store.ts`

The existing type guard only validates `name` and `email`. It must be updated to accept the new fields:

```typescript
function isIVcGitConfig(value: unknown): value is IVcGitConfig {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.name === undefined || typeof v.name === 'string') &&
    (v.email === undefined || typeof v.email === 'string') &&
    (v.signingKey === undefined || typeof v.signingKey === 'string') &&
    (v.commitSign === undefined || typeof v.commitSign === 'boolean')
  )
}
```

### 6.2 Extend `VcConfigKey` Type & `VC_CONFIG_KEYS`

**File:** `src/shared/transport/events/vc-events.ts`

```typescript
export type VcConfigKey = 'user.email' | 'user.name' | 'user.signingkey' | 'commit.sign'
export const VC_CONFIG_KEYS: readonly string[] = ['user.name', 'user.email', 'user.signingkey', 'commit.sign']
```

### 6.3 Extend `FIELD_MAP` in `vc-handler.ts`

```typescript
const FIELD_MAP: Record<string, keyof IVcGitConfig> = {
  'user.email': 'email',
  'user.name': 'name',
  'user.signingkey': 'signingKey',
  'commit.sign': 'commitSign',
}
```

**Note:** `commit.sign` accepts `"true"` / `"false"` strings from CLI but stores as `boolean` in JSON. The handler needs a type coercion step.

**Prerequisite:** Add `INVALID_CONFIG_VALUE: 'ERR_VC_INVALID_CONFIG_VALUE'` to `VcErrorCode` in `vc-events.ts`.

```typescript
// In handleConfig() SET branch:
let storedValue: string | boolean = data.value
if (field === 'commitSign') {
  if (data.value !== 'true' && data.value !== 'false') {
    throw new VcError(`'commit.sign' must be 'true' or 'false'`, VcErrorCode.INVALID_CONFIG_VALUE)
  }
  storedValue = data.value === 'true'
}
const merged = { ...existing, [field]: storedValue }
```

### 6.4 Config Validation for `user.signingkey`

When setting `user.signingkey`, validate that:
1. The file path exists (resolve `~` to home dir)
2. The file is readable
3. The file looks like an SSH private key (starts with `-----BEGIN OPENSSH PRIVATE KEY-----` or similar)

This is a soft validation — warn but don't block if the file doesn't exist yet. Hard-fail only at commit time.

**Print fingerprint on SET (key UX improvement for multi-key users):**

When the key file exists and is readable at config-set time, parse it and print the fingerprint so the user can immediately confirm they set the correct key:

```typescript
// In handleConfig() SET branch, after storing 'user.signingkey':
if (field === 'signingKey' && data.value) {
  const resolvedPath = resolveHome(data.value)
  const probe = await probeSSHKey(resolvedPath)
  if (probe.exists && !probe.needsPassphrase) {
    try {
      const parsed = await parseSSHPrivateKey(resolvedPath)
      // Return fingerprint as part of the response hint (not a separate field —
      // include in a structured log or append to value string for display)
      // CLI layer prints: "✓ Signing key set: SHA256:abc123... (ssh-ed25519)"
      // Hint: "Make sure this key is registered: brv signing-key add --key <path>.pub"
    } catch {
      // Key exists but unreadable at this time — ignore, hard-fail at commit
    }
  }
}
```

**Implementation note:** The `handleConfig()` response type (`IVcConfigResponse`) only has `key` and `value`. Add a `hint?: string` field, or handle display entirely in `vc-handler.ts` via a structured log. Do not change the transport contract for this — fingerprint display is best-effort.

**Why this matters for multi-key users:** A user with `~/.ssh/id_ed25519`, `~/.ssh/work_key`, `~/.ssh/personal_key` can instantly verify they configured the right key without running a separate command.

### 6.5 Usage Examples

```bash
# Set signing key path — fingerprint printed on success:
brv vc config user.signingkey ~/.ssh/id_ed25519
# Output: ✓ Signing key set: SHA256:abc123def... (ssh-ed25519)
#         → Make sure this key is registered: brv signing-key add --key ~/.ssh/id_ed25519.pub

# Enable auto-signing
brv vc config commit.sign true

# Read current signing key
brv vc config user.signingkey
# → ~/.ssh/id_ed25519

# Disable auto-signing
brv vc config commit.sign false
```

---

## 7. Phase 4: Commit Signing Integration

### 7.1 Modify `vc/commit.ts` — Add `--sign` / `--no-sign` Flags

```typescript
static flags = {
  message: Flags.string({ char: 'm', description: 'Commit message' }),
  sign: Flags.boolean({ char: 'S', description: 'Sign the commit with SSH key', allowNo: true }),
}
```

Behavior:
- `brv vc commit -m "msg" -S` → always sign (override config)
- `brv vc commit -m "msg" --no-sign` → never sign (override config)
- `brv vc commit -m "msg"` → sign if `commit.sign = true` in config

The CLI sends the flag state to the daemon:

```typescript
// IVcCommitRequest extended:
export interface IVcCommitRequest {
  message: string
  sign?: boolean       // undefined = use config, true = force sign, false = force no-sign
  passphrase?: string  // Only sent on retry when key is passphrase-protected
}
```

### 7.2 Modify `vc-handler.ts` `handleCommit()`

Option C priority chain — ssh-agent → cache → file fallback:

```typescript
private async handleCommit(data: IVcCommitRequest, clientId: string): Promise<IVcCommitResponse> {
  // ... existing validation (git init, staged files, author config) ...

  // Determine if signing is requested
  const shouldSign = data.sign ?? config.commitSign ?? false

  let onSign: ((payload: string) => Promise<{ signature: string }>) | undefined

  if (shouldSign) {
    // Validate signing key is configured
    const keyPath = config.signingKey
    if (!keyPath) {
      throw new VcError(
        'Signing key not configured. Run: brv vc config user.signingkey <path-to-key>',
        VcErrorCode.SIGNING_KEY_NOT_CONFIGURED,
      )
    }

    const resolvedPath = resolveHome(keyPath)

    // ── OPTION C: Priority chain ──────────────────────────────────────────

    // [A] Try ssh-agent first (zero-prompt path)
    const agentSigner = await tryGetSshAgentSigner(resolvedPath)
    if (agentSigner) {
      onSign = async (payload: string) => {
        const result = await agentSigner.sign(payload)
        return { signature: result.armored }
      }
    } else {
      // [B] Try in-memory cache (zero-prompt path, within 30-min TTL)
      const cached = this.signingKeyCache.get(resolvedPath)
      let parsedKey = cached ?? null

      if (!parsedKey) {
        // [C] File fallback — probe key
        const probe = await probeSSHKey(resolvedPath)
        if (!probe.exists) {
          throw new VcError(
            `Signing key not found: ${keyPath}`,
            VcErrorCode.SIGNING_KEY_NOT_FOUND,
          )
        }

        // If passphrase needed but not provided → ask CLI to retry once
        if (probe.needsPassphrase && !data.passphrase) {
          throw new VcError(
            'SSH key is passphrase-protected.',
            VcErrorCode.PASSPHRASE_REQUIRED,
          )
        }

        // Parse and cache (TTL 30 min)
        parsedKey = await parseSSHPrivateKey(resolvedPath, data.passphrase)
        this.signingKeyCache.set(resolvedPath, parsedKey)
      }

      const key = parsedKey
      onSign = async (payload: string) => {
        const result = signCommitPayload(payload, key)
        return { signature: result.armored }
      }
    }
    // ─────────────────────────────────────────────────────────────────────
  }

  // Create commit (with or without signing)
  const commit = await this.gitService.commit({
    author: { email: config.email, name: config.name },
    directory,
    message: data.message,
    onSign,
  })

  return { message: commit.message, sha: commit.sha }
}
```

**`VcHandler` gets a `SigningKeyCache` instance injected via `IVcHandlerDeps`** (singleton in daemon, shared across all commits):

```typescript
export interface IVcHandlerDeps {
  // ... existing deps ...
  signingKeyCache: SigningKeyCache  // NEW
}
```

### 7.3 Signing Key Resolution — Option C Detail

#### Path A: ssh-agent (zero-prompt)

`tryGetSshAgentSigner(keyPath)` checks `$SSH_AUTH_SOCK`:
1. If not set → return `null` (fall through to B)
2. Connect to agent socket, request list of identities
3. Find identity whose public key fingerprint matches `keyPath`'s public key
4. If found → return `SshAgentSigner` (wraps agent sign request)
5. If not found → return `null` (key not loaded in agent, fall through to B)

```typescript
// ssh-agent-signer.ts — simplified
export async function tryGetSshAgentSigner(
  keyPath: string,
): Promise<SshAgentSigner | null> {
  const agentSocket = process.env.SSH_AUTH_SOCK
  if (!agentSocket) return null
  try {
    const agent = new SshAgentClient(agentSocket)
    const identities = await agent.listIdentities()    // SSH_AGENTC_REQUEST_IDENTITIES
    const pubKey = await derivePublicKey(keyPath)      // from file, no passphrase needed
    const match = identities.find(id => id.fingerprint === pubKey.fingerprint)
    if (!match) return null
    return new SshAgentSigner(agent, match)
  } catch {
    return null   // agent unavailable — degrade gracefully
  }
}
```

**Protocol:** SSH agent protocol is a simple Unix socket protocol. Messages:
- `SSH_AGENTC_REQUEST_IDENTITIES` → list public keys in agent
- `SSH_AGENTC_SIGN_REQUEST` → ask agent to sign data with a specific key

Node.js `net.createConnection(agentSocket)` handles the socket I/O.

#### Path B: In-memory cache (zero-prompt, within TTL)

```typescript
// signing-key-cache.ts
export class SigningKeyCache {
  private readonly cache = new Map<string, { key: ParsedSSHKey; expiresAt: number }>()
  private readonly ttlMs: number

  constructor(ttlMs = 30 * 60 * 1000) {   // default: 30 minutes
    this.ttlMs = ttlMs
  }

  get(keyPath: string): ParsedSSHKey | null {
    const entry = this.cache.get(keyPath)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(keyPath)
      return null
    }
    return entry.key
  }

  set(keyPath: string, key: ParsedSSHKey): void {
    this.cache.set(keyPath, { key, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(keyPath: string): void {
    this.cache.delete(keyPath)
  }

  invalidateAll(): void {
    this.cache.clear()
  }
}
```

**Cache invalidation triggers:**

| Trigger | Action |
|---------|--------|
| TTL expires | Auto-cleared on next access |
| `user.signingkey` config changes | `cache.invalidate(oldPath)` in `handleConfig()` SET |
| Daemon restart | Cleared automatically (in-memory) |
| Signing fails with key mismatch | `cache.invalidate(keyPath)`, re-throw |

#### Path C: File fallback + passphrase prompt (error-retry)

Only reached when ssh-agent unavailable AND cache miss.

**Flow:**
1. CLI sends `{ message, sign: true }` (no passphrase)
2. Daemon: file exists but encrypted → throws `VcErrorCode.PASSPHRASE_REQUIRED`
3. CLI catches error, prompts **once** via `@inquirer/prompts`
4. CLI retries with `{ message, sign: true, passphrase: '...' }`
5. Daemon decrypts key → **adds to cache (30 min TTL)** → signs
6. Subsequent commits within 30 min → **cache hit, no prompt**

```typescript
// vc/commit.ts — retry logic (unchanged interface, cache is daemon-side)
import {password} from '@inquirer/prompts'

try {
  result = await withDaemonRetry(async (client) =>
    client.requestWithAck<IVcCommitResponse>(VcEvents.COMMIT, {message, sign}),
  )
} catch (error) {
  if (isVcError(error, VcErrorCode.PASSPHRASE_REQUIRED)) {
    const passphrase = await password({message: '🔐 Enter passphrase for SSH key:'})
    result = await withDaemonRetry(async (client) =>
      client.requestWithAck<IVcCommitResponse>(VcEvents.COMMIT, {message, sign, passphrase}),
    )
  } else {
    throw error
  }
}
```

**Security note:**
- Passphrase travels over local Socket.IO (127.0.0.1 only), never over network
- Daemon discards raw passphrase string immediately after `parseSSHPrivateKey()` returns
- `ParsedSSHKey.privateKeyObject` is a Node.js `crypto.KeyObject` — opaque, not extractable
- Cache stores `KeyObject`, never the passphrase string

### 7.4 Extend `CommitGitParams` and `isomorphic-git-service.ts`

**File:** `src/server/core/interfaces/services/i-git-service.ts`

```typescript
export type CommitGitParams = BaseGitParams & {
  author?: { email: string; name: string }
  message: string
  onSign?: (payload: string) => { signature: string } | Promise<{ signature: string }>
}
```

**File:** `src/server/infra/git/isomorphic-git-service.ts`

```typescript
async commit(params: CommitGitParams): Promise<GitCommit> {
  // ... existing author resolution, merge head handling ...

  const sha = await git.commit({
    author,
    dir,
    fs,
    message: params.message,
    ...(parent ? { parent } : {}),
    ...(params.onSign ? {
      onSign: ({ payload }: { payload: string }) => {
        return params.onSign!(payload)
      },
    } : {}),
  })

  // ... existing return ...
}
```

**isomorphic-git `onSign` API (v1.37.2):**

```typescript
// isomorphic-git type definitions:
type SignParams = { payload: string; secretKey: string }
type SignCallback = (args: SignParams) => { signature: string } | Promise<{ signature: string }>
```

- `payload`: raw commit object text WITHOUT `gpgsig` header (tree, parent, author, committer, blank line, message)
- `secretKey`: value from `signingKey` option (we don't use this — our key is loaded separately)
- Return `{ signature }`: the armored signature string, inserted as `gpgsig` header value
- isomorphic-git handles the `gpgsig` header formatting (leading spaces on continuation lines) automatically

---

## 8. Phase 5: Signing Key Management Commands

### 8.0 Prerequisite: Add `delete()` to `IHttpClient`

**File:** `src/server/core/interfaces/services/i-http-client.ts`

The current `IHttpClient` only has `get`, `post`, `put`. The signing key `remove` command needs `delete`:

```typescript
export interface IHttpClient {
  get: <T>(url: string, config?: HttpRequestConfig) => Promise<T>
  post: <TResponse, TData = unknown>(url: string, data?: TData, config?: HttpRequestConfig) => Promise<TResponse>
  put: <TResponse, TData = unknown>(url: string, data?: TData, config?: HttpRequestConfig) => Promise<TResponse>
  // NEW
  delete: <T = void>(url: string, config?: HttpRequestConfig) => Promise<T>
}
```

**File:** `src/server/infra/http/authenticated-http-client.ts` — implement `delete()` following the same pattern as `get()`.

### 8.1 IAM Signing Key Service

**File:** `src/server/core/interfaces/services/i-signing-key-service.ts`

```typescript
export interface SigningKeyResource {
  id: string
  keyType: string
  publicKey: string
  fingerprint: string
  title: string
  createdAt: string
  lastUsedAt?: string
}

export interface ISigningKeyService {
  addKey(title: string, publicKey: string): Promise<SigningKeyResource>
  listKeys(): Promise<SigningKeyResource[]>
  removeKey(keyId: string): Promise<void>
}
```

**File:** `src/server/infra/iam/http-signing-key-service.ts`

```typescript
export class HttpSigningKeyService implements ISigningKeyService {
  constructor(private httpClient: IHttpClient) {}

  async addKey(title: string, publicKey: string): Promise<SigningKeyResource> {
    return this.httpClient.post<SigningKeyResource>(
      '/api/v3/users/me/signing-keys',
      { title, public_key: publicKey },
    )
  }

  async listKeys(): Promise<SigningKeyResource[]> {
    const response = await this.httpClient.get<{ data: SigningKeyResource[] }>(
      '/api/v3/users/me/signing-keys',
    )
    return response.data
  }

  async removeKey(keyId: string): Promise<void> {
    await this.httpClient.delete(`/api/v3/users/me/signing-keys/${keyId}`)
  }
}
```

**Base URL:** Uses `BRV_API_BASE_URL` (IAM service), NOT `BRV_COGIT_API_BASE_URL`.

### 8.2 Transport Events

**File:** `src/shared/transport/events/vc-events.ts` (or new `signing-key-events.ts`)

```typescript
export const SigningKeyEvents = {
  ADD: 'signing-key:add',
  LIST: 'signing-key:list',
  REMOVE: 'signing-key:remove',
} as const

export interface ISigningKeyAddRequest {
  keyPath: string   // Path to .pub file — daemon reads and sends content
  title: string
}

export interface ISigningKeyAddResponse {
  id: string
  keyType: string
  fingerprint: string
  title: string
}

export interface ISigningKeyListResponse {
  keys: SigningKeyResource[]
}

export interface ISigningKeyRemoveRequest {
  keyId: string
}
```

### 8.3 `brv signing-key add`

**File:** `src/oclif/commands/signing-key/add.ts`

```typescript
export default class SigningKeyAdd extends Command {
  static description = 'Upload an SSH public key to ByteRover for commit signature verification'

  static flags = {
    key: Flags.string({ required: true, description: 'Path to SSH public key file (.pub)' }),
    title: Flags.string({ required: true, description: 'Human-readable key title' }),
  }

  static examples = [
    'brv signing-key add --key ~/.ssh/id_ed25519.pub --title "Work laptop"',
  ]

  async run(): Promise<void> {
    const { flags } = await this.parse(SigningKeyAdd)
    const result = await withDaemonRetry(async (client) => {
      return client.requestWithAck<ISigningKeyAddResponse>(
        SigningKeyEvents.ADD,
        { keyPath: flags.key, title: flags.title },
      )
    })
    this.log(`Key added: ${result.fingerprint} (${result.keyType}) — "${result.title}"`)
  }
}
```

### 8.4 `brv signing-key list`

**File:** `src/oclif/commands/signing-key/list.ts`

```typescript
export default class SigningKeyList extends Command {
  static description = 'List SSH signing keys registered with ByteRover'

  async run(): Promise<void> {
    const result = await withDaemonRetry(async (client) => {
      return client.requestWithAck<ISigningKeyListResponse>(SigningKeyEvents.LIST, {})
    })

    if (result.keys.length === 0) {
      this.log('No signing keys registered.')
      return
    }

    for (const key of result.keys) {
      const lastUsed = key.lastUsedAt ? ` (last used: ${key.lastUsedAt})` : ''
      this.log(`${key.fingerprint}  ${key.keyType}  "${key.title}"  [${key.id}]${lastUsed}`)
    }
  }
}
```

### 8.5 `brv signing-key remove`

**File:** `src/oclif/commands/signing-key/remove.ts`

```typescript
export default class SigningKeyRemove extends Command {
  static description = 'Remove an SSH signing key from ByteRover'

  static args = {
    keyId: Args.string({ required: true, description: 'Signing key ID to remove' }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(SigningKeyRemove)
    await withDaemonRetry(async (client) => {
      return client.requestWithAck(SigningKeyEvents.REMOVE, { keyId: args.keyId })
    })
    this.log(`Signing key ${args.keyId} removed.`)
  }
}
```

### 8.6 Daemon Handler

**File:** `src/server/infra/transport/handlers/signing-key-handler.ts` (new file — separate from `vc-handler.ts`)

**Rationale:** `signing-key` is a separate command namespace (not under `vc`), and it communicates with IAM (not git). A separate handler keeps concerns separated and `vc-handler.ts` focused.

```typescript
export class SigningKeyHandler {
  constructor(
    private readonly transport: ITransportServer,
    private readonly signingKeyService: ISigningKeyService,
  ) {}

  setup(): void {
    this.transport.onRequest<ISigningKeyAddRequest, ISigningKeyAddResponse>(
      SigningKeyEvents.ADD, (data, clientId) => this.handleAdd(data, clientId),
    )
    this.transport.onRequest<Record<string, never>, ISigningKeyListResponse>(
      SigningKeyEvents.LIST, (data, clientId) => this.handleList(data, clientId),
    )
    this.transport.onRequest<ISigningKeyRemoveRequest, void>(
      SigningKeyEvents.REMOVE, (data, clientId) => this.handleRemove(data, clientId),
    )
  }

  private async handleAdd(data: ISigningKeyAddRequest, _clientId: string): Promise<ISigningKeyAddResponse> {
    // Read public key file from disk (daemon has filesystem access)
    const resolvedPath = resolveHome(data.keyPath)
    const publicKey = await readFile(resolvedPath, 'utf8')
    const result = await this.signingKeyService.addKey(data.title, publicKey.trim())
    return { id: result.id, keyType: result.keyType, fingerprint: result.fingerprint, title: result.title }
  }
  // ... handleList, handleRemove delegate to this.signingKeyService
}
```

**DI wiring:** Instantiate `SigningKeyHandler` in the daemon bootstrap code, alongside other handlers. Pass the `HttpSigningKeyService` (constructed with the IAM-targeted `AuthenticatedHttpClient` using `BRV_API_BASE_URL`).

**Important:** The `add` command receives a **file path** from the CLI, but the daemon reads the file content and sends it to IAM. This keeps the HTTP call in the daemon (where the authenticated HTTP client lives).

---

## 9. Phase 6: Import from Git Config

### 9.1 `brv vc config --import-git-signing`

Convenience command that reads the user's git config and imports signing settings:

```bash
brv vc config --import-git-signing
# Reads from: git config --global user.signingkey
# Reads from: git config --global commit.gpgsign
# Applies to: vc-git-config.json
```

### 9.2 Implementation

**File:** `src/oclif/commands/vc/config.ts`

Add a `--import-git-signing` flag:

```typescript
static flags = {
  'import-git-signing': Flags.boolean({
    description: 'Import signing configuration from git config',
    default: false,
  }),
}
```

**File:** `vc-handler.ts` — new handler method:

```typescript
private async handleImportGitSigning(clientId: string): Promise<IVcConfigResponse[]> {
  const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

  // Read git config values via child_process
  const signingKey = await execGitConfig('user.signingkey')
  const gpgSign = await execGitConfig('commit.gpgsign')
  const gpgFormat = await execGitConfig('gpg.format')

  const results: IVcConfigResponse[] = []

  // Only import if gpg.format is 'ssh' (we don't support GPG)
  if (gpgFormat && gpgFormat !== 'ssh') {
    throw new VcError(
      `Git is configured for '${gpgFormat}' signing, but brv only supports SSH signing.`,
      VcErrorCode.UNSUPPORTED_SIGNING_FORMAT,
    )
  }

  if (signingKey) {
    const existing = (await this.vcGitConfigStore.get(projectPath)) ?? {}
    await this.vcGitConfigStore.set(projectPath, { ...existing, signingKey })
    results.push({ key: 'user.signingkey', value: signingKey })
  }

  if (gpgSign === 'true') {
    const existing = (await this.vcGitConfigStore.get(projectPath)) ?? {}
    await this.vcGitConfigStore.set(projectPath, { ...existing, commitSign: true })
    results.push({ key: 'commit.sign', value: 'true' })
  }

  return results
}

/**
 * Read a git config value with local-before-global precedence.
 *
 * Resolution order (mirrors git's own behavior):
 *   1. Local config  — `git -C <projectPath> config <key>`  (per-repo, no --global)
 *   2. Global config — `git config --global <key>`
 *
 * This matters for multi-key users who set different signing keys per repo:
 *   git config --global user.signingkey ~/.ssh/id_ed25519   ← default
 *   git -C ~/work/project config user.signingkey ~/.ssh/work_key  ← overrides
 *
 * @param key   Git config key, e.g. 'user.signingkey'
 * @param projectPath  The user's actual project root (not the context-tree dir)
 */
async function execGitConfig(key: string, projectPath?: string): Promise<string | undefined> {
  // 1. Try local config first (only when projectPath is available)
  if (projectPath) {
    try {
      const { stdout } = await execAsync(`git -C ${JSON.stringify(projectPath)} config ${key}`)
      const local = stdout.trim()
      if (local) return local
    } catch {
      // No local config for this key — fall through to global
    }
  }

  // 2. Fall back to global config
  try {
    const { stdout } = await execAsync(`git config --global ${key}`)
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

// Update call sites in handleImportGitSigning() to pass projectPath:
//   const signingKey = await execGitConfig('user.signingkey', projectPath)
//   const gpgSign   = await execGitConfig('commit.gpgsign',   projectPath)
//   const gpgFormat = await execGitConfig('gpg.format',       projectPath)
```

---

## 10. Phase 7: Tests

### 10.1 Unit Tests — SSH Key Parsing

**File:** `test/ssh/ssh-key-parser.test.ts`

| # | Test Case | Description |
|---|-----------|-------------|
| 1 | Parse unencrypted Ed25519 key | Load key, verify type = `ssh-ed25519`, fingerprint matches `ssh-keygen -l` |
| 2 | Parse unencrypted RSA key | Load RSA key, verify type = `ssh-rsa` |
| 3 | Parse unencrypted ECDSA key (P-256) | Verify type = `ecdsa-sha2-nistp256` |
| 4 | Parse passphrase-protected Ed25519 | Provide correct passphrase → success |
| 5 | Wrong passphrase | Provide wrong passphrase → specific error |
| 6 | No passphrase for encrypted key | Omit passphrase → `needsPassphrase` or error |
| 7 | File not found | Non-existent path → error |
| 8 | Invalid format | Random text file → error |
| 9 | PEM vs OpenSSH format | Handle both `BEGIN OPENSSH PRIVATE KEY` and `BEGIN RSA PRIVATE KEY` |
| 10 | Probe key — unencrypted | `probeSSHKey()` returns `{ exists: true, needsPassphrase: false }` |
| 11 | Probe key — encrypted | `probeSSHKey()` returns `{ exists: true, needsPassphrase: true }` |

**Test fixture keys:** Generate throwaway SSH keys for testing (committed to repo). NEVER use real keys.

```bash
ssh-keygen -t ed25519 -f test/fixtures/test_ed25519 -N ""
ssh-keygen -t ed25519 -f test/fixtures/test_ed25519_encrypted -N "testpass"
ssh-keygen -t rsa -b 2048 -f test/fixtures/test_rsa -N ""
ssh-keygen -t ecdsa -b 256 -f test/fixtures/test_ecdsa -N ""
```

### 10.2 Unit Tests — sshsig Signing

**File:** `test/ssh/sshsig-signer.test.ts`

| # | Test Case | Description |
|---|-----------|-------------|
| 1 | Sign with Ed25519 → verify with `ssh-keygen` | Gold standard: produce signature, verify externally |
| 2 | Sign with RSA → verify with `ssh-keygen` | Same, RSA key |
| 3 | Sign with ECDSA → verify with `ssh-keygen` | Same, ECDSA key |
| 4 | Armored format correct | Check `-----BEGIN SSH SIGNATURE-----` header/footer, valid base64 |
| 5 | Namespace is `git` | Parse raw binary, verify namespace field |
| 6 | Different payloads → different signatures | Determinism/non-collision check |
| 7 | Empty payload | Edge case — should still produce valid signature |
| 8 | Binary payload | Non-UTF8 bytes in payload |

**External verification** (in tests that can shell out):

```typescript
it('should produce a signature verifiable by ssh-keygen', async () => {
  const key = await parseSSHPrivateKey('test/fixtures/test_ed25519')
  const payload = Buffer.from('tree abc123\nauthor Test <test@test.com> ...\n\ncommit message')
  const result = signCommitPayload(payload, key)

  // Write allowed_signers and signature to temp files
  // Run: ssh-keygen -Y verify -f allowed_signers -I test@test.com -n git -s sig < payload
  // Assert exit code 0
})
```

### 10.3 Unit Tests — Config Extensions

| # | Test Case | Description |
|---|-----------|-------------|
| 1 | Set `user.signingkey` | Persists to `vc-git-config.json` |
| 2 | Get `user.signingkey` | Reads back correctly |
| 3 | Set `commit.sign true` | Stores as boolean `true` |
| 4 | Set `commit.sign false` | Stores as boolean `false` |
| 5 | Set `commit.sign invalid` | Error: must be true/false |
| 6 | Backward compat | Old config without signing fields → no crash |

### 10.4 Unit Tests — Commit Signing Integration

| # | Test Case | Description |
|---|-----------|-------------|
| 1 | Commit with signing enabled | `onSign` callback called, commit SHA returned |
| 2 | Commit with signing disabled | No `onSign` callback, normal commit |
| 3 | Commit with `--sign` flag override | Signs even when `commit.sign = false` |
| 4 | Commit with `--no-sign` flag override | Skips signing when `commit.sign = true` |
| 5 | Missing signing key path | Error: `ERR_VC_SIGNING_KEY_NOT_CONFIGURED` |
| 6 | Non-existent key file | Error: `ERR_VC_SIGNING_KEY_NOT_FOUND` |
| 7 | Passphrase-protected key, no passphrase in request | Error: `ERR_VC_PASSPHRASE_REQUIRED` |
| 8 | Wrong passphrase | Error: `ERR_VC_SIGNING_KEY_WRONG_PASSPHRASE` |
| 9 | Passphrase-protected key with correct passphrase (retry) | Signs successfully |

### 10.5 Unit Tests — Signing Key Commands

| # | Test Case | Description |
|---|-----------|-------------|
| 1 | `signing-key add` — happy path | Reads .pub file, sends to IAM, returns fingerprint |
| 2 | `signing-key add` — file not found | Error message |
| 3 | `signing-key add` — invalid key format | Error message |
| 4 | `signing-key add` — IAM error (duplicate) | Conflict error |
| 5 | `signing-key list` — with keys | Displays table |
| 6 | `signing-key list` — empty | "No signing keys registered" |
| 7 | `signing-key remove` — success | Confirmation message |
| 8 | `signing-key remove` — not found | Error message |

---

## 11. Phase 8: Error Handling & Edge Cases

### 11.1 New Error Codes

Add to `VcErrorCode` in `src/shared/transport/events/vc-events.ts` (follows existing `ERR_VC_*` prefix):

```typescript
// Signing errors — add to VcErrorCode const
INVALID_CONFIG_VALUE: 'ERR_VC_INVALID_CONFIG_VALUE',
PASSPHRASE_REQUIRED: 'ERR_VC_PASSPHRASE_REQUIRED',
SIGNING_KEY_NOT_CONFIGURED: 'ERR_VC_SIGNING_KEY_NOT_CONFIGURED',
SIGNING_KEY_NOT_FOUND: 'ERR_VC_SIGNING_KEY_NOT_FOUND',
SIGNING_KEY_INVALID_FORMAT: 'ERR_VC_SIGNING_KEY_INVALID_FORMAT',
SIGNING_KEY_WRONG_PASSPHRASE: 'ERR_VC_SIGNING_KEY_WRONG_PASSPHRASE',
SIGNING_KEY_UNSUPPORTED_TYPE: 'ERR_VC_SIGNING_KEY_UNSUPPORTED_TYPE',
SIGNING_FAILED: 'ERR_VC_SIGNING_FAILED',
UNSUPPORTED_SIGNING_FORMAT: 'ERR_VC_UNSUPPORTED_SIGNING_FORMAT',

// Signing key management errors — add to VcErrorCode const
SIGNING_KEY_UPLOAD_FAILED: 'ERR_VC_SIGNING_KEY_UPLOAD_FAILED',
SIGNING_KEY_LIMIT_REACHED: 'ERR_VC_SIGNING_KEY_LIMIT_REACHED',
```

### 11.2 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| `~` in key path | Resolve to `$HOME` before use |
| Symlinked key file | Follow symlinks (`fs.realpath`) |
| Key file permission issues | Clear error: "Cannot read key file: permission denied" |
| Very large key file (not an SSH key) | Size check: reject files > 100KB |
| Key path with spaces | Quote properly in all operations |
| Config migration | Old `vc-git-config.json` without signing fields → treat as `undefined` (backward compat) |
| Concurrent commits | `ParsedSSHKey` is stateless, safe for concurrent use |
| SSH key rotation | User changes key on disk → next commit uses new key automatically (no caching of key object) |
| Passphrase not provided (timeout) | CLI prompt has timeout, error if no response |

### 11.3 Security Considerations

| Concern | Mitigation |
|---------|------------|
| Passphrase in memory | Zero-fill passphrase buffer after `crypto.createPrivateKey()` returns |
| Passphrase in transport | Local Socket.IO only (127.0.0.1), never over network |
| Private key in memory | `KeyObject` is opaque in Node.js, not extractable after parse |
| Key path logged | Never log full key path in production — only fingerprint |
| Passphrase logged | Never log passphrase under any circumstances |
| Private key in .brv config | Config stores the PATH, never the key content |

---

## 12. Dependency Graph

```
Phase 1: Research (sshsig spike)
    │
    ▼
Phase 2: SSH Module (ssh-key-parser.ts, sshsig-signer.ts)
    │
    ├──────────────────────┐
    ▼                      ▼
Phase 3: Config         Phase 5: Signing Key Commands
Extensions                 │
    │                      ├── i-signing-key-service.ts
    ▼                      ├── http-signing-key-service.ts
Phase 4: Commit            ├── signing-key/add.ts
Signing Integration        ├── signing-key/list.ts
    │                      └── signing-key/remove.ts
    ▼                      │
Phase 6: Import Git        │
Config                     │
    │                      │
    ▼                      ▼
Phase 7: Tests ◄───────────┘
    │
    ▼
Phase 8: Error Handling & Edge Cases (cross-cutting, done throughout)
```

**Parallelization opportunities:**
- Phase 3 (Config) and Phase 5 (Key Commands) can be developed in parallel after Phase 2
- Phase 6 (Import) depends on Phase 3 only
- Phase 7 (Tests) should be written alongside each phase, but integration tests come last

---

## 13. Risk & Open Questions

### 13.1 High Risk

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | **sshsig binary format** — subtle serialization bugs cause signatures that look valid but fail verification | Signed commits rejected by CoGit | Phase 1 spike with `ssh-keygen -Y verify` validation. Cross-test against CoGit's `sshverify/verifier.go` |
| 2 | **isomorphic-git `onSign` callback shape** — API designed for PGP but used for SSH | SSH signatures might not embed correctly | **VERIFIED:** `onSign` is a generic callback; SSH armored signatures work. See Appendix A. Pin version at ^1.37.2. |
| 3 | **RSA/ECDSA signature blob format** — SSH wraps signatures differently per key type | RSA/ECDSA keys produce invalid signatures | Start with Ed25519 only. Add RSA/ECDSA in follow-up with dedicated tests. |

### 13.2 Medium Risk

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 4 | **Node.js `crypto` OpenSSH key format support** — older OpenSSH key formats may not parse | Some users' keys won't work | Test with keys from OpenSSH 7.x, 8.x, 9.x. Document supported formats. |
| 5 | **ssh-agent protocol compatibility** — agent socket protocol varies slightly between OpenSSH versions | Agent path A silently fails | Degrade gracefully: `tryGetSshAgentSigner` returns `null` on any error, falls through to cache/file. |
| 6 | **IAM API not ready** — ENG-1997 may not be deployed yet | `signing-key add/list/remove` commands fail | Signing key commands are independent of local signing. Can be developed and tested against mock. Ship local signing first. |

### 13.3 Open Questions

| # | Question | Options | Decision |
|---|----------|---------|----------|
| 1 | **Cache parsed key in memory?** | A) No cache B) 30min TTL cache | ✅ **DECIDED: B** — Option C requires cache as Path B. 30 min TTL. Invalidate on config change or daemon restart. |
| 2 | **ssh-agent support?** | A) Out of scope B) In scope as Path A of Option C | ✅ **DECIDED: B** — ssh-agent is Path A. Degrade gracefully if unavailable. Achieves GitHub-like UX. |
| 3 | **`--import-git-signing` also upload key to IAM?** | A) Import config only B) Import + offer upload | **A** — keep `config` and `signing-key` commands separate. |
| 4 | **Which key types to support in v1?** | A) Ed25519 only B) Ed25519 + RSA C) All three | **A** — Ed25519 is the modern default. RSA/ECDSA in follow-up. |
| 5 | **Pre-commit check if key is registered on IAM?** | A) No — sign regardless B) Warn if not uploaded | **B** — Warn (non-blocking). Prevents silent `unverified` commits. See UX scenario P1. |
| 6 | **Error when `commit.sign = true` but no key configured?** | A) Hard error B) Warning + unsigned commit | **A** — User explicitly enabled signing; silent fallback to unsigned is surprising. |

---

## Appendix A: isomorphic-git `onSign` Callback Reference (verified v1.37.2)

From isomorphic-git's `index.d.ts`:

```typescript
// Type definitions:
type SignParams = {
  /** a plaintext message (the commit object text without gpgsig) */
  payload: string
  /** an 'ASCII armor' encoded PGP key (from signingKey option, or undefined) */
  secretKey: string
}
type SignCallback = (args: SignParams) => { signature: string } | Promise<{ signature: string }>

// commit() options (relevant subset):
{
  onSign?: SignCallback
  signingKey?: string  // forwarded to onSign as secretKey — NOT used in our flow
}
```

- `payload`: The raw commit object text (tree, parent, author, committer, blank line, message) — exactly what gets signed
- `secretKey`: Comes from `signingKey` option. We don't use this — our key is loaded from disk separately
- `signature`: The returned string is embedded as the `gpgsig` header value (armored SSH signature block)
- The callback can be sync or async (returns `{ signature }` or `Promise<{ signature }>`)

> **Note:** The API was designed for PGP, but `onSign` is a generic callback. Returning an SSH armored signature works — isomorphic-git simply embeds the returned string as-is in the `gpgsig` header.

The signature is inserted between the `committer` and blank line in the commit object:

```
tree <sha>
parent <sha>
author Name <email> timestamp tz
committer Name <email> timestamp tz
gpgsig -----BEGIN SSH SIGNATURE-----
 <base64 line 1>
 <base64 line 2>
 ...
 -----END SSH SIGNATURE-----

Commit message here
```

Note: Each line of the signature (except the first) is prefixed with a single space in the commit object. isomorphic-git handles this formatting automatically.

---

## Appendix B: Server-Side Expectations (ENG-1999)

CoGit's `sshverify/verifier.go` expects:

1. **Armored SSH signature** in the `gpgsig` header (standard `-----BEGIN/END SSH SIGNATURE-----`)
2. **sshsig binary format** inside the base64 payload
3. **Namespace = `git`** (verified strictly)
4. **Hash algorithm = `sha256` or `sha512`** (both supported)
5. **Public key in sshsig matches a key registered in IAM** for the commit author's email
6. The **commit payload** (everything in the commit object except the `gpgsig` header itself) is what was signed

The verifier tries each of the author's registered keys against the signature. If any key matches → `verified`. If none match → `unverified`.

---

## Appendix C: Estimated Scope

| Phase | New Lines (est.) | Modified Lines (est.) | Complexity |
|-------|------------------|-----------------------|------------|
| Phase 1 (Spike) | ~100 | 0 | High (research) |
| Phase 2 (SSH Module + Agent + Cache) | ~480 | 0 | High (crypto + agent protocol) |
| Phase 3 (Config) | ~20 | ~60 | Low |
| Phase 4 (Commit Integration) | ~100 | ~120 | Medium |
| Phase 5 (Key Commands) | ~300 | ~50 | Medium |
| Phase 6 (Import Git Config) | ~50 | ~20 | Low |
| Phase 7 (Tests) | ~650 | 0 | Medium |
| Phase 8 (Error Handling) | ~30 | ~20 | Low |
| **Total** | **~1,730** | **~270** | |

**Delta vs. original:** +~300 lines new / +~20 lines modified — for `ssh-agent-signer.ts` (~130 lines), `signing-key-cache.ts` (~60 lines), and additional tests.

**Note:** Phase 5 estimates include `IHttpClient.delete()` addition, `signing-key-handler.ts`, and DI wiring.

---

## 14. Pre-implementation Corrections (from Code Review)

> Những vấn đề này được phát hiện khi đối chiếu plan với codebase thực tế (2026-04-08).
> **Tất cả phải được sửa trước hoặc trong quá trình thực hiện phase tương ứng.**

---

### 14.1 [🔴 Critical] Fix hardcoded error message trong `vc/config.ts`

**Vấn đề:** `src/oclif/commands/vc/config.ts` line 24 hardcode danh sách allowed keys:

```typescript
// HIỆN TẠI — sẽ sai ngay sau khi Phase 3 thêm signing keys:
this.error(`Unknown key '${key}'. Allowed: user.name, user.email.`)
```

Sau khi `VC_CONFIG_KEYS` được mở rộng (Phase 3), message này sẽ outdated và gây nhầm lẫn cho user.

**Fix — áp dụng cùng lúc với Phase 3:**

```typescript
// THAY BẰNG (dynamic, tự cập nhật khi thêm key mới):
if (!isVcConfigKey(key)) {
  const allowed = VC_CONFIG_KEYS.join(', ')
  this.error(`Unknown key '${key}'. Allowed: ${allowed}.`)
}
```

**File:** `src/oclif/commands/vc/config.ts`
**Thực hiện:** Cùng với Phase 3.

---

### 14.2 [🔴 Critical] Update `FIELD_MAP` type và thêm boolean coercion trong `vc-handler.ts`

**Vấn đề:** `FIELD_MAP` hiện tại có type quá hẹp:

```typescript
// HIỆN TẠI — dòng 80 vc-handler.ts:
const FIELD_MAP: Record<string, 'email' | 'name'> = {
  'user.email': 'email',
  'user.name': 'name',
}
```

Khi thêm `commitSign` (lưu dạng `boolean` trong JSON), TypeScript sẽ báo lỗi type mismatch.

**Fix — áp dụng cùng lúc với Phase 3:**

```typescript
// 1. Mở rộng FIELD_MAP type:
const FIELD_MAP: Record<string, keyof IVcGitConfig> = {
  'user.email': 'email',
  'user.name': 'name',
  'user.signingkey': 'signingKey',   // Phase 3
  'commit.sign': 'commitSign',        // Phase 3
}

// 2. Trong handleConfig() — SET branch, thêm coercion trước khi ghi:
if (data.value !== undefined) {
  const existing = (await this.vcGitConfigStore.get(projectPath)) ?? {}
  let storedValue: string | boolean = data.value
  if (field === 'commitSign') {
    if (data.value !== 'true' && data.value !== 'false') {
      throw new VcError(
        `'commit.sign' must be 'true' or 'false', got '${data.value}'.`,
        VcErrorCode.INVALID_CONFIG_VALUE,  // thêm ở Phase 8
      )
    }
    storedValue = data.value === 'true'
  }
  const merged = { ...existing, [field]: storedValue }
  await this.vcGitConfigStore.set(projectPath, merged)
  return { key: data.key, value: String(storedValue) }
}
```

**File:** `src/server/infra/transport/handlers/vc-handler.ts`
**Thực hiện:** Cùng với Phase 3.

---

### 14.3 [🟡 Medium] Fix type mismatch `IVcConfigResponse.value` khi GET boolean field

**Vấn đề:** `IVcConfigResponse` có `value: string`, nhưng khi đọc `commitSign` từ config store, value là `boolean`. GET path hiện tại:

```typescript
// HIỆN TẠI — vc-handler.ts handleConfig() GET branch:
const value = config?.[field]  // type: string | boolean | undefined
// ...
return { key: data.key, value }  // ❌ TypeScript error: boolean not assignable to string
```

**Fix — áp dụng cùng lúc với Phase 3:**

```typescript
// GET branch:
const value = config?.[field]
if (value === undefined) {
  throw new VcError(`'${data.key}' is not set.`, VcErrorCode.CONFIG_KEY_NOT_SET)
}
// Coerce tất cả values về string khi trả về — boolean.toString() → 'true'/'false'
return { key: data.key, value: String(value) }
```

**File:** `src/server/infra/transport/handlers/vc-handler.ts`
**Thực hiện:** Cùng với Phase 3.

---

### 14.4 [🟡 Medium] Xác định daemon bootstrap file để wire `SigningKeyHandler`

**Vấn đề:** Phase 5 yêu cầu wiring `SigningKeyHandler` vào daemon, nhưng plan không chỉ rõ file bootstrap nào cần sửa.

**Action cần làm trước Phase 5:**

1. Tìm đến file khởi tạo daemon (có thể trong `src/server/daemon/` hoặc `src/server/infra/daemon/`)
2. Xác nhận pattern inject handler (pattern hiện tại: `new VcHandler(deps).setup()`)
3. Thêm `new SigningKeyHandler({ transport, signingKeyService }).setup()` theo cùng pattern
4. Đảm bảo `HttpSigningKeyService` dùng `BRV_API_BASE_URL` (IAM), **không phải** `BRV_COGIT_API_BASE_URL`
5. Export `SigningKeyHandler` từ `src/server/infra/transport/handlers/index.ts`

**File:** `src/server/infra/daemon/brv-server.ts` (daemon bootstrap, confirmed) + `src/server/infra/transport/handlers/index.ts`
**Thực hiện:** Đầu Phase 5, trước khi viết handler.

---

### 14.5 [🟡 Medium] Bổ sung merge commit test vào Phase 7

**Vấn đề:** `handleCommit()` có special path cho merge commits (đọc `MERGE_HEAD`, set `parent[]`). Plan Phase 7 không có test case cho scenario này khi signing được bật.

**Thêm vào test matrix Phase 7.4 (Commit Signing Integration):**

| # | Test Case | Description |
|---|-----------|-------------|
| 10 | **Merge commit with signing enabled** | `MERGE_HEAD` tồn tại + signing bật → `onSign` được gọi, merge commit có đúng 2 parents + gpgsig header |
| 11 | **Signing không block merge-continue** | `brv vc merge --continue` với signing config → commit được tạo và signed |

**File:** `test/ssh/sshsig-signer.test.ts` hoặc test file cho `vc-handler`
**Thực hiện:** Cùng với Phase 7.

---

### 14.6 Recommended Implementation Sequence

Dựa trên dependency thực tế và các corrections trên:

```
Phase 1 (sshsig spike — derisk trước)
    │  Verify: ssh-keygen -Y verify pass
    ▼
Phase 2 (SSH Module: ssh-key-parser, sshsig-signer)
    │  Ed25519 only. ECDSA → follow-up ticket.
    ▼
Phase 3 (Config Extensions)         Phase 5 (Signing Key Commands)
    │  + Fix 14.1, 14.2, 14.3            │  + Fix 14.4 (locate bootstrap)
    │  (làm song song với Phase 5)        │
    ▼                                    ▼
Phase 4 (Commit Signing Integration)
    │  + Verify merge commit scenario (Fix 14.5)
    ▼
Phase 6 (Import from Git Config)
    ▼
Phase 7 (Tests — viết song song với từng phase)
    │  + Add merge commit signing test cases
    ▼
Phase 8 (Error Handling — cross-cutting, làm xuyên suốt)
```

**Ghi chú quan trọng:**
- Phase 1 (spike) phải pass `ssh-keygen -Y verify` trước khi đi tiếp — đây là gate check duy nhất cho toàn bộ feature.
- Phase 8 error codes (`INVALID_CONFIG_VALUE`, v.v.) nên được định nghĩa *trước* Phase 3 để handlers có thể throw đúng codes ngay từ đầu.
- Tests nên được viết song song với từng phase, không để dồn vào cuối.
