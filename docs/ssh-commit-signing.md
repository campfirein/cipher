# SSH Commit Signing

ByteRover signs commits with an SSH key. When enabled, every commit carries a
cryptographic signature and shows as **Verified** in the ByteRover UI and via
`git verify-commit`.

## Quick start

```bash
# 1. Generate (skip if you already have a key)
ssh-keygen -t ed25519 -C "you@example.com" -f ~/.ssh/id_ed25519_signing

# 2. Register the public key with ByteRover
brv signing-key add --key ~/.ssh/id_ed25519_signing.pub --title "My laptop"

# 3. Tell brv where the private key lives
brv vc config user.signingkey ~/.ssh/id_ed25519_signing

# 4. Sign every commit automatically
brv vc config commit.sign true
```

From here `brv vc commit -m "..."` produces a signed commit.

---

## Supported key formats

| Key format                                          | Direct (file) | Via ssh-agent |
| --------------------------------------------------- | :-----------: | :-----------: |
| Ed25519, OpenSSH format, **unencrypted**            |       ✅      |       ✅      |
| Ed25519, OpenSSH format, passphrase-protected       |       ❌      |       ✅      |
| RSA / ECDSA, any format                             |       ❌      |       ✅      |

If your key falls into a row that only supports the ssh-agent column, load it
into the agent before signing:

```bash
ssh-add ~/.ssh/id_rsa            # macOS / Linux / WSL
```

On Windows PowerShell with the OpenSSH agent service running:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add $HOME\.ssh\id_rsa
```

`brv vc commit --sign` automatically prefers ssh-agent when it is available
(`SSH_AUTH_SOCK` set on Unix, `\\.\pipe\openssh-ssh-agent` on Windows) — you
do not need to change any brv config.

---

## Passphrase-protected keys (without ssh-agent)

For an unencrypted Ed25519 key on disk you do not need a passphrase. For any
other passphrase-protected key, **use ssh-agent** (above) — that is the
expected path for the vast majority of users.

The narrow exception is an Ed25519 key saved in legacy PEM/PKCS8 format
(rather than the modern OpenSSH format that `ssh-keygen` produces by
default). Keys in that format support direct passphrase entry:

```bash
# Pass once via flag
brv vc commit -m "msg" --sign --passphrase "$MY_PASS"

# Or via env var (preferred for CI / scripts — keeps the secret out of shell history)
BRV_SSH_PASSPHRASE="$MY_PASS" brv vc commit -m "msg" --sign
```

`brv` does **not** prompt interactively for the passphrase — `brv vc` is a
non-interactive oclif command. If a passphrase is required and neither
`--passphrase` nor `BRV_SSH_PASSPHRASE` is provided, the command exits with a
clear error pointing to both options.

---

## Cross-platform notes

### macOS / Linux

Default key location: `~/.ssh/id_ed25519`. ssh-agent is started by your shell
or DE; check with `ssh-add -l`.

### Windows (PowerShell, native OpenSSH)

- Install OpenSSH from "Optional Features" if not present.
- Default key location: `$HOME\.ssh\id_ed25519`.
- The agent runs as a Windows service, not a per-shell process.

### WSL

WSL has its own ssh-agent independent of the Windows agent. Either:

- Generate keys inside WSL and use `ssh-add` there, or
- Bridge to the Windows agent via `npiperelay` + `socat` (community guides
  exist) — beyond this doc's scope.

When pointing brv at a key, use the WSL path (`/mnt/c/...` for Windows-side
files, plain `~/...` for WSL-side).

---

## Existing git SSH signing config

If you already configured `git config gpg.format ssh` and
`git config user.signingKey ...`, brv can import directly:

```bash
brv vc config --import-git-signing
```

This reads `user.signingKey` and `commit.gpgSign` from your git config and
copies them into brv's project config — no manual setup.

---

## Verification

Verify any signed commit with the standard `git verify-commit`:

```bash
# Build an allowed_signers file once
echo "you@example.com $(cat ~/.ssh/id_ed25519_signing.pub)" > ~/.config/brv/allowed_signers

# Verify
cd .brv/context-tree
git -c gpg.ssh.allowedSignersFile=~/.config/brv/allowed_signers verify-commit HEAD
```

Expected: `Good "git" signature for you@example.com with ED25519 key SHA256:...`.

---

## Removing a key

```bash
brv signing-key list              # list registered keys + IDs
brv signing-key remove <key-id>   # remove from ByteRover
```

This deletes the public key from ByteRover only. The private key on disk and
any `brv vc config user.signingkey` setting are untouched.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Error: Encrypted OpenSSH private keys are not supported for direct signing.` | brv cannot decrypt OpenSSH-format encrypted keys natively. | Run `ssh-add <keypath>` to load the key into ssh-agent, then retry. |
| `Error: Unsupported OpenSSH key type: ssh-rsa` | RSA / ECDSA OpenSSH keys are not parsed natively. | Same — load via `ssh-add`. |
| `Signing key requires a passphrase. Provide it via the --passphrase flag or BRV_SSH_PASSPHRASE…` | PEM-format key needs a passphrase and none was supplied. | Pass `--passphrase` or set `BRV_SSH_PASSPHRASE`. |
| `Could not verify signature.` from `git verify-commit` | `allowed_signers` file missing or wrong fingerprint. | Re-create as shown in **Verification**. |
